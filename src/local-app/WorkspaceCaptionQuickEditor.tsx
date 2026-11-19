import {useEffect,useMemo,useRef,useState} from 'react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {ProductionWorkspace} from '../productionWorkspace';
import {isValidShotCaptionContract,normalizeShotCaptionContract,type ShotCaptionContract} from '../shotCaptions';
import {workspaceCaptionFieldErrors} from '../workspaceCaptionValidation';
import {useWorkspaceCaptionOperation} from './useWorkspaceCaptionOperation';
import {captionPreparationIssue,captionFailureIssue} from './workspaceCaptionFeedback';
import {captionDraftCues} from './workspaceCaptionPreparation';
import './workspace-caption-preparation.css';

interface Props {workspace:ProductionWorkspace;selectedShotId?:string;isDisabled?:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(workspace:ProductionWorkspace)=>void}
export function WorkspaceCaptionPreparation({workspace,selectedShotId,isDisabled=false,command,onChange}:Props){
 const clip=workspace.clips.find(c=>c.shotId===(selectedShotId??workspace.clips[0]?.shotId));
 const state=workspace.captions?.find(c=>c.shotId===clip?.shotId);
 const audio=useRef<HTMLAudioElement>(null),draftKey=`loop-caption-adjustment:${workspace.id}:${clip?.shotId}`;
 // Restore before the first persistence effect. StrictMode may replay effects,
 // so an initial empty draft must never erase a recoverable stored adjustment.
 const recovered=useMemo(()=>{
  let restored:{contract:ShotCaptionContract;inputFingerprint:string}|null=null;
  try{
   const value=JSON.parse(sessionStorage.getItem(draftKey)??'null'),raw=value?.contract;
   if(value&&typeof value.inputFingerprint==='string'&&raw?.version==='shot-captions/v1'&&typeof raw.enabled==='boolean'&&typeof raw.text==='string'&&Array.isArray(raw.cues)){
    const normalized=normalizeShotCaptionContract(raw,{enabled:raw.enabled,text:raw.text});
    // Strip model metadata without silently dropping an owner's invalid row.
    if(normalized.cues.length===raw.cues.length&&isValidShotCaptionContract(normalized))restored={inputFingerprint:value.inputFingerprint,contract:normalized};
   }
  }catch{/* A corrupt optional draft does not alter saved captions. */}
  return restored;
 },[draftKey]);
 const [draft,setDraft]=useState(recovered),[opened,setOpened]=useState(!!recovered),[position,setPosition]=useState(0),[validation,setValidation]=useState('');
 useEffect(()=>{try{if(draft)sessionStorage.setItem(draftKey,JSON.stringify(draft));else sessionStorage.removeItem(draftKey);}catch{/* Optional local draft. */}},[draftKey,draft]);
 const contract=draft?.contract??(state?.contract?normalizeShotCaptionContract(state.contract,{enabled:state.contract.enabled,text:state.contract.text}):undefined);
 const operation=useWorkspaceCaptionOperation({workspace,clipId:clip?.id??'',itemId:clip?.itemId,inputFingerprint:draft?.inputFingerprint??state?.inputFingerprint,contract:contract??({} as ShotCaptionContract),readOnly:false,disabled:isDisabled,command,onChange,onSaved:()=>{setDraft(null);setOpened(false);}});
 if(!state||!clip||!contract)return null;
 const disabled=isDisabled||operation.pending||workspace.stale;
 const issue=captionPreparationIssue(state);
 const status=issue?.status??(state.timing==='current'?state.alignmentMethod==='manual'?'字幕已就绪 · 已手工调整':'字幕已就绪':state.timing==='waiting'?'正在同步字幕…':state.timing==='failed'?'自动同步未完成，可直接调整':!state.audioTrackId?'采用声音后自动同步；也可手工调整':state.alignmentReady===false?'当前声音需要手工调整字幕':'等待自动同步');
 function edit(cues:ShotCaptionContract['cues']){operation.reset();setValidation('');const clean=cues.map(({id,text,startMs,endMs})=>({id,text,startMs,endMs}));setDraft({inputFingerprint:draft?.inputFingerprint??state!.inputFingerprint,contract:{...contract!,contentMode:'independent',text:clean.map(c=>c.text).join(''),cues:clean}});}
 function open(){const cues=state!.timing==='failed'&&state!.suggestedCues?.length?state!.suggestedCues:contract!.cues.length?contract!.cues:captionDraftCues(contract!.text,state!.durationMs);setDraft({inputFingerprint:state!.inputFingerprint,contract:normalizeShotCaptionContract({...contract!,contentMode:'independent',cues},{enabled:contract!.enabled,text:contract!.text})});setOpened(true);}
 function update(index:number,patch:Partial<ShotCaptionContract['cues'][number]>){edit(contract!.cues.map((c,i)=>i===index?{...c,...patch}:c));}
 async function save(){
  const errors=workspaceCaptionFieldErrors(contract,state!.durationMs);
  if(!contract!.cues.length){setValidation('请为字幕设置出现和消失时间。');return;}
  if(Object.keys(errors).length){setValidation(Object.values(errors)[0]);return;}
  const canonical=normalizeShotCaptionContract(contract,{enabled:contract!.enabled,text:contract!.text});
  await operation.run('saveWorkspaceCaptions',{captionContract:canonical});
 }
 const active=contract.cues.find(c=>position>=c.startMs&&position<c.endMs);
 const preview=state.audioPreview;
 return <section className="workspace-captions workspace-caption-preparation" aria-label={uiText('字幕准备')}>
  <header><span role="status">{uiText(status)}</span><Button size="xs" color="secondary" isDisabled={disabled||opened} onPress={open}>{uiText('调整字幕')}</Button></header>
  {preview&&<audio key={JSON.stringify(preview)} ref={audio} controls preload="none" aria-label={uiText('播放当前声音并核对字幕')} src={'/_local-artifact?'+new URLSearchParams({episode:workspace.episodeId,path:preview.relativePath})}
   onLoadedMetadata={event=>{event.currentTarget.currentTime=preview.startSeconds;event.currentTarget.playbackRate=preview.playbackRate;}}
   onTimeUpdate={event=>{const media=event.currentTarget,time=preview.offsetSeconds+(media.currentTime-preview.startSeconds)/preview.playbackRate;setPosition(Math.max(0,Math.min(state.durationMs,Math.round(time*1000))));if(media.currentTime>preview.startSeconds+preview.durationSeconds*preview.playbackRate)media.pause();}}/>}
  {preview&&<p className="workspace-caption-playback-text" aria-label={uiText('当前播放字幕')}>{active?.text??'　'}</p>}
  {state.timing!=='current'&&(issue?.message||state.detail)&&<p role="status">{uiText(issue?.message??state.detail??'')}</p>}
  {!!state.reviewPhrases?.length&&<p>{uiText('需要检查：')}{state.reviewPhrases.join('、')}</p>}
  {opened&&<div className="workspace-caption-quick-editor">
   {draft&&draft.inputFingerprint!==state.inputFingerprint&&<p role="alert">{uiText('声音、正文或镜头已变化；原调整已保留，请取消后按当前内容重新调整。')}</p>}
   {state.timing!=='current'&&<p>{uiText('以下时间供你调整，保存后按人工安排使用。')}</p>}
   {contract.cues.map((cue,index)=><fieldset key={cue.id} disabled={disabled} className="workspace-caption-quick-cue"><legend>{uiText('第 {value0} 句',{value0:String(index+1)})}</legend>
    <label>{uiText('字幕')}<input aria-label={uiText('第 {value0} 句字幕',{value0:String(index+1)})} value={cue.text} onChange={e=>update(index,{text:e.target.value})}/></label>
    <div className="workspace-caption-fields">{(['startMs','endMs'] as const).map((field,i)=><label key={field}>{uiText(i?'消失时间（秒）':'出现时间（秒）')}<input type="number" min="0" max={state.durationMs/1000} step="0.01" aria-label={uiText('第 {value0} 句{value1}时间（秒）',{value0:String(index+1),value1:i?'消失':'出现'})} value={Number.isFinite(cue[field])?cue[field]/1000:''} onChange={e=>update(index,{[field]:e.target.value.trim()===''?NaN:Number(e.target.value)*1000})}/>{preview&&<Button size="xs" color="tertiary" onPress={()=>update(index,{[field]:position})}>{uiText(i?'到这里消失':'从这里出现')}</Button>}</label>)}</div>
   </fieldset>)}
   <footer><Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>{setDraft(null);setOpened(false);setValidation('');}}>{uiText('取消')}</Button><Button size="sm" color="primary" isDisabled={disabled} onPress={()=>void save()}>{uiText('保存调整')}</Button></footer>
  </div>}
  {state.audioTrackId&&state.timing!=='waiting'&&<details><summary>{uiText('重新自动同步')}</summary><p>{uiText('重新处理会替换当前字幕时间，正文保持不变。')}</p><Button size="xs" color="secondary" isDisabled={disabled||opened} onPress={()=>void operation.run('requestWorkspaceCaptionAlignment',{localOnly:true})}>{uiText('确认重新同步')}</Button></details>}
  {(validation||operation.error)&&<p role="alert">{uiText(validation||captionFailureIssue(operation.error)?.message||operation.error)}</p>}
  {operation.progress&&<p role="status">{uiText(operation.progress)}</p>}
  {operation.canResume&&<Button size="xs" color="secondary" isDisabled={disabled} onPress={()=>void operation.resume()}>{uiText('核对并继续保存')}</Button>}
 </section>;
}
