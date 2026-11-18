import {useEffect,useId,useRef,useState} from 'react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {isWorkspaceItemAudible,resolveWorkspaceMainVoice} from '../workspaceAudio';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {useWorkspaceReading,useWorkspacePolling} from './useWorkspaceReading';
import {workspaceTaskPresentation} from '../workspaceTaskPresentation';
import {WorkspaceVisualTaskStatus} from './WorkspaceVisualTaskStatus';
import {WorkspaceAudioAudition} from './WorkspaceAudioAudition';
import {reconcileWorkspaceOutput} from './workspaceOutputReconciliationClient';
import './workspace-audio.css';
interface Props {workspace:ProductionWorkspace;project?:OpenChatCutProject|null;selectedShotId?:string;pending:boolean;readOnly?:boolean;active?:boolean;connect?:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChanged:(w:ProductionWorkspace)=>void}
interface ConnectIntent {sourceId:string;signature:string;phase:'waiting'|'adopting'|'check'}
export function WorkspaceSourceVoicePanel({workspace:w,project,selectedShotId,pending,readOnly=false,active=true,connect=false,command,onChanged}:Props){
 const shotId=selectedShotId??w.clips[0]?.shotId,clips=w.clips.filter(c=>c.shotId===shotId),input=clips[0]?.voiceInput;
 const videos=project?.timelines.flatMap(t=>t.items.filter(i=>clips.some(c=>c.itemId===i.id)&&i.kind==='video'&&typeof i.src==='string'))??[];
 const scope=w.id+':'+shotId,[choice,setChoice]=useState<{scope:string;id:string}|null>(null),source=videos.find(v=>v.id===(choice?.scope===scope?choice.id:undefined))??videos[0];
 const [busy,setBusy]=useState(false),[failure,setFailure]=useState<{scope:string;message:string}|null>(null),working=useRef(false),mounted=useRef(false),current=useRef(scope),id=useId();current.current=scope;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const reading=useWorkspaceReading(w,onChanged,shotId??'episode','无法读取当前原声状态。');
 const writable=useRef(false);writable.current=!readOnly&&!pending&&!w.stale&&active;
 const disabled=!writable.current||busy;
 const preparations=w.audio?.preparations.filter(p=>p.kind==='source'&&p.shotId===shotId&&p.source?.provider!=='registered')??[];
 const currentSourceSha=typeof source?.sourceContentHash==='string'?source.sourceContentHash:(project?.assets.find(a=>a.id===source?.sourceAssetId) as {sourceContentHash?:string}|undefined)?.sourceContentHash;
 const matchesSource=(p:typeof preparations[number])=>p.sourceItemId===source?.id&&(!p.sourceSha256||!currentSourceSha||p.sourceSha256===currentSourceSha)&&!p.generationTask?.invalidated;
 const canPrepareSource=!!source&&!preparations.some(p=>matchesSource(p)&&!workspaceTaskPresentation(p.generationTask??{status:p.status}).hidden);
 const pollingError=useWorkspacePolling(reading,{enabled:active&&!busy&&!pending&&preparations.some(p=>p.taskId&&['ready','running'].includes(p.status)),interval:3000});
 const recorded=project?.timelines.flatMap(t=>t.items.filter(i=>i.kind==='audio'&&i.id==='workspace-source-shot-'+shotId&&i.sourceAssetId==='audio-track-'+input?.audioTrack?.id).map(item=>({item,timeline:t})))[0];
 const intentKey=`loop-source-connect:${w.id}:${shotId}`,signature=source?JSON.stringify([source.id,source.src,source.sourceAssetId,source.srcInFrame??0,source.durationInFrames,source.playbackRate??1]):'';
 const [intent,setIntent]=useState<ConnectIntent|null>(()=>{try{const value=JSON.parse(sessionStorage.getItem(intentKey)??'null');return value&&typeof value.sourceId==='string'&&typeof value.signature==='string'&&['waiting','adopting','check'].includes(value.phase)?value:null;}catch{return null;}});
 function remember(value:ConnectIntent|null){setIntent(value);try{if(value)sessionStorage.setItem(intentKey,JSON.stringify(value));else sessionStorage.removeItem(intentKey);}catch{/* Current connection remains available. */}}
 const currentPreparation=preparations.find(matchesSource);
 const sourceCurrent=project?resolveWorkspaceMainVoice(project,shotId??'').sourceCurrent!==false:true;
 const sourceUsed=sourceCurrent&&(w.audio?.mix.voices.some(v=>v.shotId===shotId&&v.mode==='source'&&v.sourceCurrent!==false&&v.sourceItemId===source?.id)??false);
 const ready=(p:typeof preparations[number])=>p.status==='completed'&&!!p.audioTrackId&&!!p.relativePath&&!!p.sha256&&!workspaceTaskPresentation(p.generationTask??{status:p.status}).held&&!workspaceTaskPresentation(p.generationTask??{status:p.status}).unknown&&!p.generationTask?.invalidated;
 async function perform(action:(saved:ProductionWorkspace,owns:()=>boolean)=>Promise<void>){
  if(disabled||working.current)return;working.current=true;setBusy(true);setFailure(null);const started=scope,owns=()=>mounted.current&&current.current===started;
  try{const saved=await reading.idle();if(!saved||!owns()||!writable.current)return;await action(saved,owns);return true;}
  catch(error){if(owns()&&!(error instanceof Error&&error.name==='AbortError'))setFailure({scope:started,message:error instanceof Error?error.message:'原声操作未完成，请重新读取。'});return false;}
  finally{working.current=false;if(mounted.current)setBusy(false);}
 }
 async function run(name:string,data:Record<string,unknown>){return perform(async(saved,owns)=>{
  const value=await command(name,{episodeId:saved.episodeId,workspaceId:saved.id,expectedRevision:saved.revision,...data}) as ProductionWorkspace;
  if(owns()){if(!value||!Array.isArray(value.clips)||value.id!==saved.id||value.episodeId!==saved.episodeId)throw Error('未收到当前工程的原声结果，请重新读取。');reading.publish(value);}
 });}
 function reconcile(p:typeof preparations[number],recover=false){return perform(async(saved,owns)=>{if(recover&&p.generationTask)await reconcileWorkspaceOutput(saved.episodeId,p.generationTask);if(owns())await reading.read();});}
 async function connectPrepared(p:typeof preparations[number]){
  if(!source)return;
  remember({sourceId:String(source.id),signature,phase:'adopting'});
  await perform(async(saved,owns)=>{
   const result=await command('adoptWorkspaceAudio',{episodeId:saved.episodeId,workspaceId:saved.id,expectedRevision:saved.revision,preparationId:p.id}) as ProductionWorkspace;
   if(owns()){reading.publish(result);remember(null);}
  });
  // An interrupted or failed response needs an explicit check, never a looping adoption.
  setIntent(value=>{if(!value)return null;const next={...value,phase:'check' as const};try{sessionStorage.setItem(intentKey,JSON.stringify(next));}catch{/* Optional storage. */}return next;});
 }
 async function connectSource(){
  if(!source||disabled)return;
  if(input?.audioTrack&&clips.some(c=>c.source?.materialRevisionId===input.visual?.materialRevisionId)){
   await run('adoptWorkspaceRecordedVoice',{shotId,audioTrackId:input.audioTrack.id,expectedSha256:input.audioTrack.sha256});return;
  }
  if(currentPreparation){
   const task=workspaceTaskPresentation(currentPreparation.generationTask??{status:currentPreparation.status});
   if(task.held||task.unknown)return;
   if(ready(currentPreparation)){await connectPrepared(currentPreparation);return;}
   if(task.canRetry){remember({sourceId:String(source.id),signature,phase:'waiting'});if(await run('prepareWorkspaceAudio',{kind:'source',preparationId:currentPreparation.id,retry:true})===false)remember({sourceId:String(source.id),signature,phase:'check'});return;}
   remember({sourceId:String(source.id),signature,phase:'waiting'});return;
  }
  remember({sourceId:String(source.id),signature,phase:'waiting'});
  if(await run('prepareWorkspaceAudio',{kind:'source',shotId,sourceItemId:source.id})===false)remember({sourceId:String(source.id),signature,phase:'check'});
 }
 useEffect(()=>{
  if(!connect||!intent||disabled)return;
  if(sourceUsed){remember(null);return;}
  if(intent.sourceId!==source?.id||intent.signature!==signature){remember(null);return;}
  if(intent.phase==='waiting'&&currentPreparation&&ready(currentPreparation))void connectPrepared(currentPreparation);
 },[connect,intent,disabled,sourceUsed,source?.id,signature,currentPreparation?.id,currentPreparation?.status,currentPreparation?.audioTrackId,currentPreparation?.generationTask]);
 if(connect)return <section className="workspace-audio workspace-source-voice" aria-label={uiText('视频原声')}>
  {videos.length>1&&<label>{uiText('使用哪个视频的声音')}<NativeSelect size="sm" aria-label={uiText('使用哪个视频的声音')} value={String(source?.id??'')} disabled={disabled} onChange={event=>{setChoice({scope,id:event.target.value});remember(null);}}>{videos.map(video=><option key={String(video.id)} value={String(video.id)}>{String(video.name??'视频')}</option>)}</NativeSelect></label>}
  {!sourceCurrent&&<p role="status">{uiText('画面已更换，请重新接入当前视频的原声。')}</p>}
  {!videos.length?<p>{uiText('先为本镜头选用一个视频，再使用它的原声。')}</p>:<Button size="sm" color="primary" isDisabled={disabled||sourceUsed||!!currentPreparation&&(workspaceTaskPresentation(currentPreparation.generationTask??{status:currentPreparation.status}).held||workspaceTaskPresentation(currentPreparation.generationTask??{status:currentPreparation.status}).unknown)} onPress={()=>void connectSource()}>{sourceUsed?uiText('正在使用视频原声'):busy||intent?.phase==='waiting'&&!currentPreparation?.error?uiText('正在接入视频原声…'):uiText('使用视频原声')}</Button>}
  {currentPreparation&&ready(currentPreparation)&&<WorkspaceAudioAudition label={uiText('视频原声试听')} showControls={false} preload="none" src={`/_local-artifact?${new URLSearchParams({episode:w.episodeId,path:currentPreparation.relativePath!,sha256:currentPreparation.sha256!})}`}/>}
  {currentPreparation?.generationTask&&<WorkspaceVisualTaskStatus task={currentPreparation.generationTask} label={uiText('视频原声')} disabled={disabled} onRefresh={()=>void reconcile(currentPreparation)} onReconcile={()=>void reconcile(currentPreparation,true)} onResume={()=>void reconcile(currentPreparation)}/>}
  {currentPreparation?.error&&<p role="alert">{uiText(currentPreparation.error)}</p>}
  {intent?.phase==='check'&&<p role="status">{uiText('请先核对当前原声结果，再决定是否继续使用。')}</p>}
  {pollingError&&<p role="alert">{uiText('暂时无法更新原声状态，请重新读取。')}</p>}
  {failure?.scope===scope&&<p role="alert">{uiText(failure.message)}</p>}
 </section>;
 if(!input&&!videos.length&&!preparations.length)return null;
 return <section className="workspace-audio workspace-source-voice" aria-label={uiText('原片主声音')}>
  <h3>{uiText('原片声音')}</h3>
  {input&&<><p className="workspace-audio-note">{uiText(recorded?isWorkspaceItemAudible(recorded.item,recorded.timeline)?'原登记原声 · 当前已设为主声':'原登记原声 · 已采用，当前静音':'原登记原声 · 尚未设为主声')}</p>
   {input.audioTrack?<Button size="sm" color="secondary" isDisabled={disabled||!videos.length||!!recorded} onPress={()=>void run('adoptWorkspaceRecordedVoice',{shotId,audioTrackId:input.audioTrack!.id,expectedSha256:input.audioTrack!.sha256})}>{uiText('采用原登记原声')}</Button>:<p className="workspace-audio-note">{uiText('原选择没有可复用的登记音轨，可在采用画面后按当前原片准备。')}</p>}
  </>}
  {videos.length>0?<div className="workspace-audio-form"><label htmlFor={id}>{uiText('当前原片')}<NativeSelect id={id} name="workspaceVoiceSource" size="sm" value={String(source?.id??'')} disabled={disabled} onChange={event=>{setChoice({scope,id:event.target.value});setFailure(null);}}>{videos.map(video=><option key={String(video.id)} value={String(video.id)}>{String(video.name??'原片')}</option>)}</NativeSelect></label><Button size="sm" color="secondary" isDisabled={disabled||!canPrepareSource} onPress={()=>{if(source)void run('prepareWorkspaceAudio',{kind:'source',shotId,sourceItemId:source.id});}}>{uiText('准备当前原片原声')}</Button></div>:<p className="workspace-audio-note">{uiText('先明确采用原画面，再选择主声音。')}</p>}
  {preparations.map(p=>{const task=workspaceTaskPresentation(p.generationTask??{status:p.status}),used=project?.timelines.some(t=>t.items.some(i=>i.kind==='audio'&&i.id===p.adoptedItemId&&i.sourceAssetId==='audio-track-'+p.audioTrackId)),ready=p.status==='completed'&&!!p.audioTrackId&&!!p.relativePath&&!!p.sha256&&!task.held&&!task.unknown&&!p.generationTask?.invalidated;
   return <div className="workspace-audio-group" key={p.id}><h4>{p.description}</h4><p className="workspace-audio-note">{uiText(used?'当前已设为主声':ready?'可用，尚未设为主声':task.summary)}</p>
    {ready&&<WorkspaceAudioAudition label={p.description} showControls={false} preload="none" src={`/_local-artifact?${new URLSearchParams({episode:w.episodeId,path:p.relativePath!,sha256:p.sha256!})}`}/>}
    {ready&&!used&&<Button size="sm" color="primary" aria-label={uiText('采用原片原声 {value0}',{value0:p.description})} isDisabled={disabled||!project} onPress={()=>void run('adoptWorkspaceAudio',{preparationId:p.id})}>{uiText('采用为主声')}</Button>}
    {task.canRetry&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>void run('prepareWorkspaceAudio',{kind:'source',preparationId:p.id,retry:true})}>{uiText('重试原声准备')}</Button>}
    {p.generationTask&&(task.held||task.unknown)&&<WorkspaceVisualTaskStatus task={p.generationTask} label={uiText('原声')} taskNoun={uiText('原声任务')} disabled={disabled} onRefresh={()=>void reconcile(p)} onReconcile={()=>void reconcile(p,true)} onResume={()=>void reconcile(p)}/>}
    {p.error&&<p role="alert">{uiText(p.error)}</p>}
   </div>;
  })}
  {pollingError&&<p role="alert">{uiText('无法读取当前原声状态，请重新读取。')}</p>}
  {failure?.scope===scope&&<p role="alert">{uiText(failure.message)}</p>}
 </section>;
}
