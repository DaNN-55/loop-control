import {useEffect,useRef,useState} from 'react';
import {Trash2} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {defaultShotCaptionContract,normalizeShotCaptionContract,shotCaptionAnchors,shotCaptionAnchorLabels,shotCaptionSafeAreas,shotCaptionSafeAreaLabels,type ShotCaptionContract} from '../shotCaptions';
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
 useEffect(()=>{const draft=drafts.current.get(clipId);if(draft&&draft.fingerprint===state?.inputFingerprint){setContract(draft.contract);setDirty(true);}else{setContract(state?.contract??defaultShotCaptionContract(clip?.text??'','independent'));setDirty(false);}},[clipId,workspace.project?.sha256,state?.inputFingerprint,state?.textConfirmed]);
 function change(next:ShotCaptionContract){drafts.current.set(clipId,{contract:next,fingerprint:state?.inputFingerprint});setContract(next);setDirty(true);setError('');}
 function spatial(patch:Partial<ShotCaptionContract['spatial']>){change(normalizeShotCaptionContract({...contract,spatial:{...contract.spatial,...patch}},{enabled:contract.enabled,text:contract.text}));}
 async function run(name:string,extra:Record<string,unknown>={}){if(!clip)return;setPending(true);setError('');try{
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
   {saved.spatial.safeArea==='custom'&&<dl className="workspace-saved-facts">{(['top','right','bottom','left'] as const).map((side,index)=><div key={side}><dt>{['上','右','下','左'][index]}边距</dt><dd>{Math.round((saved.spatial.insets?.[side]??0)*100)}%</dd></div>)}</dl>}
   {saved.cues.length>0&&<details className="workspace-saved-timing"><summary>字幕时序 · {saved.cues.length} 条</summary><table aria-label="已保存字幕时序"><thead><tr><th>开始</th><th>结束</th><th>正文</th></tr></thead><tbody>{saved.cues.map(cue=><tr key={cue.id}><td>{(cue.startMs/1000).toFixed(2)}s</td><td>{(cue.endMs/1000).toFixed(2)}s</td><td>{cue.text}</td></tr>)}</tbody></table></details>}
   {state?.detail&&<p role="alert">{state.detail}</p>}
  </section>;
 }
 return <section className="workspace-captions" aria-label="工作台字幕"><header><h3>{alignmentOnly?'字幕对齐':'字幕'}</h3><span role="status">{dirty?'有未保存修改':state?`${timingLabels[state.timing]}${state.textConfirmed?' · 正文已核对':''}`:''}</span></header>
  <div className="workspace-caption-selectors"><label>字幕片段<NativeSelect size="sm" aria-label="字幕片段" value={clipId} disabled={pending} onChange={e=>setClipId(e.target.value)}>{workspace.clips.filter((c,i,all)=>all.findIndex(v=>v.shotId===c.shotId)===i).map(c=><option key={c.id} value={c.id}>{c.shotId} · {c.text.slice(0,18)}</option>)}</NativeSelect></label>
  {!alignmentOnly&&<label>字幕模式<NativeSelect size="sm" aria-label="字幕模式" value={!contract.enabled?'off':contract.contentMode} disabled={disabled} onChange={e=>{const value=e.target.value;change({...contract,enabled:value!=='off',contentMode:value==='follow_tts'?'follow_tts':'independent',text:value==='follow_tts'?state?.narrationText??contract.text:contract.text,cues:value==='follow_tts'&&state?.narrationText!==contract.text?[]:contract.cues});}}><option value="follow_tts" disabled={!state?.narrationText}>跟随口播</option><option value="independent">独立字幕</option><option value="off">关闭字幕</option></NativeSelect></label>}</div>
  {!alignmentOnly&&<><label>字幕正文<textarea aria-label="字幕正文" rows={3} disabled={disabled||contract.contentMode==='follow_tts'} value={contract.text} onChange={e=>change({...contract,text:e.target.value,cues:[]})}/></label>
  <div className="workspace-caption-fields"><label>字幕位置<NativeSelect size="sm" aria-label="字幕位置" value={contract.spatial.anchor} disabled={disabled} onChange={e=>spatial({anchor:e.target.value as ShotCaptionContract['spatial']['anchor']})}>{shotCaptionAnchors.map(a=><option key={a} value={a}>{shotCaptionAnchorLabels[a]}</option>)}</NativeSelect></label><label>字幕安全区<NativeSelect size="sm" aria-label="字幕安全区" value={contract.spatial.safeArea} disabled={disabled} onChange={e=>spatial({safeArea:e.target.value as ShotCaptionContract['spatial']['safeArea']})}>{shotCaptionSafeAreas.map(a=><option key={a} value={a}>{shotCaptionSafeAreaLabels[a]}</option>)}</NativeSelect></label>
  <label>行数<input aria-label="字幕行数" type="number" min={1} max={2} value={contract.spatial.maxLines} disabled={disabled} onChange={e=>spatial({maxLines:Number(e.target.value)})}/></label><label>每行字数<input aria-label="字幕每行字数" type="number" min={1} max={24} value={contract.spatial.maxCharactersPerLine} disabled={disabled} onChange={e=>spatial({maxCharactersPerLine:Number(e.target.value)})}/></label></div>
  {contract.spatial.safeArea==='custom'&&<div className="workspace-caption-fields">{(['top','right','bottom','left'] as const).map((side,i)=><label key={side}>{['上','右','下','左'][i]}边距<input aria-label={`字幕${side}安全边距`} type="number" min={0} max={.4} step={.01} value={contract.spatial.insets?.[side]??0} disabled={disabled} onChange={e=>spatial({insets:{...contract.spatial.insets!,[side]:Number(e.target.value)}})}/></label>)}</div>}
  <details><summary>手工校时 · 毫秒</summary>{contract.cues.map((cue,index)=><div className="workspace-caption-cue" key={cue.id}><input aria-label={`cue ${index+1} 正文`} value={cue.text} disabled={disabled} onChange={e=>change({...contract,cues:contract.cues.map((v,i)=>i===index?{...v,text:e.target.value}:v)})}/><input aria-label={`cue ${index+1} 开始毫秒`} type="number" min={0} value={cue.startMs} disabled={disabled} onChange={e=>change({...contract,cues:contract.cues.map((v,i)=>i===index?{...v,startMs:Number(e.target.value)}:v)})}/><input aria-label={`cue ${index+1} 结束毫秒`} type="number" min={0} value={cue.endMs} disabled={disabled} onChange={e=>change({...contract,cues:contract.cues.map((v,i)=>i===index?{...v,endMs:Number(e.target.value)}:v)})}/><button aria-label={`删除 cue ${index+1}`} disabled={disabled} onClick={()=>change({...contract,cues:contract.cues.filter((_,i)=>i!==index)})}><Trash2 size={14}/></button></div>)}<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>{const start=contract.cues.at(-1)?.endMs??0;change({...contract,cues:[...contract.cues,{id:crypto.randomUUID(),text:contract.cues.length?'':contract.text,startMs:start,endMs:Math.min(start+1000,state?.durationMs??start+1000)}]});}}>添加 cue</Button></details></>}
  {error&&<p role="alert">{error}</p>}{state?.detail&&<p role="alert">{state.detail}</p>}
  <footer>{!alignmentOnly&&<Button size="sm" color="primary" isDisabled={disabled} onPress={()=>void run('saveWorkspaceCaptions')}>保存字幕</Button>}<Button size="sm" color="secondary" isDisabled={disabled||dirty||!state?.audioTrackId} onPress={()=>void run('requestWorkspaceCaptionAlignment',{localOnly:true})}>声学对齐</Button>{state?.taskId&&<Button size="sm" color="secondary" isDisabled={disabled||dirty} onPress={()=>void run('applyWorkspaceCaptionAlignment',{taskId:state.taskId})}>采用对齐</Button>}{!alignmentOnly&&<Button size="sm" color="secondary" isDisabled={disabled||dirty||state?.timing!=='current'||state.textConfirmed} onPress={()=>void run('confirmWorkspaceCaptionText')}>正文已核对</Button>}</footer>
 </section>;
}
