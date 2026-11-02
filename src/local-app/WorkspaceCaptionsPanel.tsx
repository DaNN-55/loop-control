import {useEffect,useRef,useState} from 'react';
import {Trash2} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {defaultShotCaptionContract,normalizeShotCaptionContract,shotCaptionAnchors,shotCaptionAnchorLabels,shotCaptionSafeAreas,shotCaptionSafeAreaLabels,type ShotCaptionContract} from '../shotCaptions';
import {workspaceCaptionFieldErrors} from '../workspaceCaptionValidation';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
import './workspace-captions.css';
const timingLabels={missing:'待校时',current:'时序有效',stale:'时序已过期',waiting:'对齐处理中',failed:'对齐失败'};
export function WorkspaceCaptionsPanel({workspace,command,onChange,bridge,readOnly=false,alignmentOnly=false}:{workspace:ProductionWorkspace;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(workspace:ProductionWorkspace)=>void;bridge?:EmbeddedStudioBridge;readOnly?:boolean;alignmentOnly?:boolean}){
 const [clipId,setClipId]=useState(workspace.clips[0]?.id??''),[contract,setContract]=useState<ShotCaptionContract>(()=>workspace.captions?.[0]?.contract??defaultShotCaptionContract('','independent')),[pending,setPending]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
 useEffect(()=>{if(!bridge?.selectedShotId)return;const selected=workspace.clips.find(c=>c.shotId===bridge.selectedShotId);if(selected)setClipId(selected.id);},[bridge?.selectedShotId]);
 const drafts=useRef(new Map<string,{contract:ShotCaptionContract;fingerprint:string|undefined}>());
 const clip=workspace.clips.find(c=>c.id===clipId),state=workspace.captions?.find(c=>c.shotId===clip?.shotId),disabled=readOnly||pending||workspace.stale||!!bridge&&!bridge.connected;
 useEffect(()=>{if(!workspace.clips.some(c=>c.id===clipId))setClipId(workspace.clips[0]?.id??'');},[workspace.clips,clipId]);
 useEffect(()=>{const draft=drafts.current.get(clipId);if(draft){setContract(draft.contract);setDirty(true);}else{setContract(state?.contract??defaultShotCaptionContract(clip?.text??'','independent'));setDirty(false);}},[clipId,workspace.project?.sha256,state?.inputFingerprint,state?.textConfirmed]);
 function change(next:ShotCaptionContract){drafts.current.set(clipId,{contract:next,fingerprint:state?.inputFingerprint});setContract(next);setDirty(true);setError('');}
 function spatial(patch:Partial<ShotCaptionContract['spatial']>){const next={...contract,spatial:{...contract.spatial,...patch}};change(patch.safeArea?{...next,spatial:normalizeShotCaptionContract(next,{enabled:contract.enabled,text:contract.text}).spatial}:next);}
 const fieldErrors=workspaceCaptionFieldErrors(contract,state?.durationMs);
 function fieldFeedback(key:string){return fieldErrors[key]?<span id={`caption-${clipId}-${key}-error`} role="alert">{fieldErrors[key]}</span>:null;}
 function fieldAccessibility(key:string){return {'aria-invalid':!!fieldErrors[key],'aria-describedby':fieldErrors[key]?`caption-${clipId}-${key}-error`:undefined};}
 function numberInput(value:string,scale=1){return value.trim()===''?NaN:Number(value)*scale;}
 async function run(name:string,extra:Record<string,unknown>={}){if(!clip)return;if(name==='saveWorkspaceCaptions'&&Object.keys(fieldErrors).length){setError('请修正标出的字幕字段后保存。');return;}setPending(true);setError('');try{
  let current=workspace;
  if(name==='saveWorkspaceCaptions'){
   const native=bridge?await bridge.applyCaptions(clip.itemId,contract):contract;
   // A native flush may have advanced the project revision; read that receipt
   // before issuing the provenance command against the same Owner boundary.
   if(bridge){const response=await fetch(`/api/local/episodes/${workspace.episodeId}/workspace`);if(!response.ok)throw Error('无法读取当前保存版本。');current=(await response.json()).workspace;}
   const value=await command(name,{episodeId:workspace.episodeId,workspaceId:current.id,expectedRevision:current.revision,clipId,captionContract:native,...(bridge?{nativeApplied:true}:{})});drafts.current.delete(clipId);onChange(value as ProductionWorkspace);setDirty(false);
  }else if(name==='applyWorkspaceCaptionAlignment'&&bridge){
   await bridge.save();const response=await fetch(`/api/local/episodes/${workspace.episodeId}/workspace`);if(!response.ok)throw Error('无法读取当前保存版本。');current=(await response.json()).workspace;
   const prepared=await command('prepareWorkspaceCaptionAlignment',{episodeId:workspace.episodeId,workspaceId:current.id,expectedRevision:current.revision,clipId,expectedInputFingerprint:state?.inputFingerprint,...extra}) as {captionContract:ShotCaptionContract};
   await bridge.applyCaptions(clip.itemId,prepared.captionContract,true);
   const updated=await fetch(`/api/local/episodes/${workspace.episodeId}/workspace`);if(!updated.ok)throw Error('无法读取当前保存版本。');current=(await updated.json()).workspace;
   onChange(await command(name,{episodeId:workspace.episodeId,workspaceId:current.id,expectedRevision:current.revision,clipId,expectedInputFingerprint:state?.inputFingerprint,nativeApplied:true,...extra}) as ProductionWorkspace);
  }else{
   if(bridge){await bridge.save();const response=await fetch(`/api/local/episodes/${workspace.episodeId}/workspace`);if(!response.ok)throw Error('无法读取当前保存版本。');current=(await response.json()).workspace;}
   const value=await command(name,{episodeId:workspace.episodeId,workspaceId:current.id,expectedRevision:current.revision,clipId,...(name==='requestWorkspaceCaptionAlignment'?{}:{expectedInputFingerprint:state?.inputFingerprint}),...extra}) as ProductionWorkspace|{workspace:ProductionWorkspace};onChange('workspace' in value?value.workspace:value);
  }
 }catch(cause){setError(cause instanceof Error?cause.message:'字幕操作未完成。');}finally{setPending(false);}}
 if(readOnly){
  const saved=state?.contract??defaultShotCaptionContract(clip?.text??'','independent');
  return <section className="workspace-captions workspace-captions-readonly" aria-label="工作台字幕">
   <header><h3>字幕</h3>{state&&<span role="status">{timingLabels[state.timing]}{state.textConfirmed?' · 正文已核对':''}</span>}</header>
   <label>字幕片段<NativeSelect size="sm" aria-label="字幕片段" value={clipId} disabled={!workspace.clips.length} onChange={event=>setClipId(event.target.value)}>{workspace.clips.filter((c,i,all)=>all.findIndex(v=>v.shotId===c.shotId)===i).map(c=><option key={c.id} value={c.id}>{c.shotId} · {c.text.slice(0,18)}</option>)}</NativeSelect></label>
   <p className="workspace-saved-caption" aria-label="字幕正文">{saved.text||'未设置字幕正文'}</p>
   <dl className="workspace-saved-facts">
    <div><dt>字幕模式</dt><dd>{!saved.enabled?'已关闭':saved.contentMode==='follow_tts'?'跟随口播':'独立字幕'}</dd></div>
    <div><dt>字幕位置</dt><dd>{shotCaptionAnchorLabels[saved.spatial.anchor]}</dd></div>
    <div><dt>安全区</dt><dd>{shotCaptionSafeAreaLabels[saved.spatial.safeArea]}</dd></div>
    <div><dt>排版</dt><dd>{saved.spatial.maxLines} 行 · 每行 {saved.spatial.maxCharactersPerLine} 字</dd></div>
   </dl>
   {saved.spatial.safeArea==='custom'&&<dl className="workspace-saved-facts">{(['top','right','bottom','left'] as const).map((side,index)=><div key={side}><dt>{['上','右','下','左'][index]}边距</dt><dd>{Number(((saved.spatial.insets?.[side]??0)*100).toFixed(6))}%</dd></div>)}</dl>}
   {saved.cues.length>0&&<details className="workspace-saved-timing"><summary>字幕时序 · {saved.cues.length} 条</summary><table aria-label="已保存字幕时序"><thead><tr><th>开始（秒）</th><th>结束（秒）</th><th>正文</th></tr></thead><tbody>{saved.cues.map(cue=><tr key={cue.id}><td>{(cue.startMs/1000).toFixed(3)}</td><td>{(cue.endMs/1000).toFixed(3)}</td><td>{cue.text}</td></tr>)}</tbody></table></details>}
   {state?.detail&&<p role="alert">{state.detail}</p>}
  </section>;
 }
 return <section className="workspace-captions" aria-label="工作台字幕"><header><h3>{alignmentOnly?'字幕对齐':'字幕'}</h3><span role="status">{dirty?'有未保存修改':state?`${timingLabels[state.timing]}${state.textConfirmed?' · 正文已核对':''}`:''}</span></header>
  <div className="workspace-caption-selectors"><label>字幕片段<NativeSelect size="sm" aria-label="字幕片段" value={clipId} disabled={pending} onChange={e=>setClipId(e.target.value)}>{workspace.clips.filter((c,i,all)=>all.findIndex(v=>v.shotId===c.shotId)===i).map(c=><option key={c.id} value={c.id}>{c.shotId} · {c.text.slice(0,18)}</option>)}</NativeSelect></label>
  {!alignmentOnly&&<label>字幕模式<NativeSelect size="sm" aria-label="字幕模式" value={!contract.enabled?'off':contract.contentMode} disabled={disabled} onChange={e=>{const value=e.target.value;change({...contract,enabled:value!=='off',contentMode:value==='follow_tts'?'follow_tts':'independent',text:value==='follow_tts'?state?.narrationText??contract.text:contract.text,cues:value==='follow_tts'&&state?.narrationText!==contract.text?[]:contract.cues});}}><option value="follow_tts" disabled={!state?.narrationText}>跟随口播</option><option value="independent">独立字幕</option><option value="off">关闭字幕</option></NativeSelect></label>}</div>
  {!alignmentOnly&&<><label>字幕正文<textarea aria-label="字幕正文" rows={3} disabled={disabled||contract.contentMode==='follow_tts'} value={contract.text} {...fieldAccessibility('text')} onChange={e=>change({...contract,text:e.target.value,cues:[]})}/>{fieldFeedback('text')}</label>
  <div className="workspace-caption-fields"><label>字幕位置<NativeSelect size="sm" aria-label="字幕位置" value={contract.spatial.anchor} disabled={disabled} onChange={e=>spatial({anchor:e.target.value as ShotCaptionContract['spatial']['anchor']})}>{shotCaptionAnchors.map(a=><option key={a} value={a}>{shotCaptionAnchorLabels[a]}</option>)}</NativeSelect></label><label>字幕安全区<NativeSelect size="sm" aria-label="字幕安全区" value={contract.spatial.safeArea} disabled={disabled} onChange={e=>spatial({safeArea:e.target.value as ShotCaptionContract['spatial']['safeArea']})}>{shotCaptionSafeAreas.map(a=><option key={a} value={a}>{shotCaptionSafeAreaLabels[a]}</option>)}</NativeSelect></label>
  <label>行数<input aria-label="字幕行数" type="number" min={1} max={2} value={Number.isFinite(contract.spatial.maxLines)?contract.spatial.maxLines:''} {...fieldAccessibility('maxLines')} disabled={disabled} onChange={e=>spatial({maxLines:numberInput(e.target.value)})}/>{fieldFeedback('maxLines')}</label><label>每行字数<input aria-label="字幕每行字数" type="number" min={1} max={24} value={Number.isFinite(contract.spatial.maxCharactersPerLine)?contract.spatial.maxCharactersPerLine:''} {...fieldAccessibility('maxCharactersPerLine')} disabled={disabled} onChange={e=>spatial({maxCharactersPerLine:numberInput(e.target.value)})}/>{fieldFeedback('maxCharactersPerLine')}</label></div>
  {contract.spatial.safeArea==='custom'&&<div className="workspace-caption-fields">{(['top','right','bottom','left'] as const).map((side,i)=><label key={side}>{['上','右','下','左'][i]}边距（%）<input aria-label={`字幕${['上','右','下','左'][i]}边距（%）`} type="number" min={0} max={40} step="any" value={Number.isFinite(contract.spatial.insets?.[side])?Number(((contract.spatial.insets?.[side]??0)*100).toFixed(6)):''} {...fieldAccessibility(`margin-${side}`)} disabled={disabled} onChange={e=>spatial({insets:{...contract.spatial.insets!,[side]:numberInput(e.target.value,.01)}})}/>{fieldFeedback(`margin-${side}`)}</label>)}</div>}
  <details className="workspace-caption-manual"><summary>手工校时</summary>{state?.durationMs!==undefined&&<p className="workspace-caption-window">当前镜头窗口：0–{Number((state.durationMs/1000).toFixed(3))} 秒</p>}
   <div className="workspace-caption-table-scroll"><table className="workspace-caption-timing" aria-label="字幕条目"><thead><tr><th scope="col">正文</th><th scope="col">开始（秒）</th><th scope="col">结束（秒）</th><th scope="col"><span className="workspace-caption-sr-only">操作</span></th></tr></thead><tbody>{contract.cues.map((cue,index)=><tr key={cue.id}>
    <td><input aria-label={`字幕条目 ${index+1} 正文`} value={cue.text} {...fieldAccessibility(`cue-${index}-text`)} disabled={disabled} onChange={e=>change({...contract,cues:contract.cues.map((v,i)=>i===index?{...v,text:e.target.value}:v)})}/>{fieldFeedback(`cue-${index}-text`)}</td>
    {(['startMs','endMs'] as const).map((field,i)=><td key={field}><input aria-label={`字幕条目 ${index+1} ${i?'结束':'开始'}（秒）`} type="number" min={0} max={state?.durationMs!==undefined?state.durationMs/1000:undefined} step={.001} value={Number.isFinite(cue[field])?cue[field]/1000:''} {...fieldAccessibility(`cue-${index}-${field}`)} disabled={disabled} onChange={e=>change({...contract,cues:contract.cues.map((v,n)=>n===index?{...v,[field]:numberInput(e.target.value,1000)}:v)})}/>{fieldFeedback(`cue-${index}-${field}`)}</td>)}
    <td><button type="button" aria-label={`删除字幕条目 ${index+1}`} disabled={disabled} onClick={()=>change({...contract,cues:contract.cues.filter((_,i)=>i!==index)})}><Trash2 size={14}/></button></td></tr>)}</tbody></table></div>
   <Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>{const start=contract.cues.at(-1)?.endMs??0;change({...contract,cues:[...contract.cues,{id:crypto.randomUUID(),text:contract.cues.length?'':contract.text,startMs:start,endMs:Math.min(start+1000,state?.durationMs??start+1000)}]});}}>添加字幕条目</Button></details></>}

  {error&&<p role="alert">{error}</p>}{state?.detail&&<p role="alert">{state.detail}</p>}
  <footer>{!alignmentOnly&&<Button size="sm" color="primary" isDisabled={disabled} onPress={()=>void run('saveWorkspaceCaptions')}>保存字幕</Button>}<Button size="sm" color="secondary" isDisabled={disabled||dirty||!state?.audioTrackId} onPress={()=>void run('requestWorkspaceCaptionAlignment',{localOnly:true})}>声学对齐</Button>{state?.taskId&&<Button size="sm" color="secondary" isDisabled={disabled||dirty} onPress={()=>void run('applyWorkspaceCaptionAlignment',{taskId:state.taskId})}>采用对齐</Button>}{!alignmentOnly&&<Button size="sm" color="secondary" isDisabled={disabled||dirty||state?.timing!=='current'||state.textConfirmed} onPress={()=>void run('confirmWorkspaceCaptionText')}>正文已核对</Button>}</footer>
 </section>;
}
