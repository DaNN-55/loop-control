import {useEffect,useId,useRef,useState} from 'react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {isWorkspaceItemAudible} from '../workspaceAudio';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {useWorkspaceReading,useWorkspacePolling} from './useWorkspaceReading';
import {workspaceTaskPresentation} from '../workspaceTaskPresentation';
import {WorkspaceVisualTaskStatus} from './WorkspaceVisualTaskStatus';
import {WorkspaceAudioAudition} from './WorkspaceAudioAudition';
import {reconcileWorkspaceOutput} from './workspaceOutputReconciliationClient';
import './workspace-audio.css';
interface Props {workspace:ProductionWorkspace;project?:OpenChatCutProject|null;selectedShotId?:string;pending:boolean;readOnly?:boolean;active?:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChanged:(w:ProductionWorkspace)=>void}
export function WorkspaceSourceVoicePanel({workspace:w,project,selectedShotId,pending,readOnly=false,active=true,command,onChanged}:Props){
 const shotId=selectedShotId??w.clips[0]?.shotId,clips=w.clips.filter(c=>c.shotId===shotId),input=clips[0]?.voiceInput;
 const videos=project?.timelines.flatMap(t=>t.items.filter(i=>clips.some(c=>c.itemId===i.id)&&i.kind==='video'&&typeof i.src==='string'))??[];
 const scope=w.id+':'+shotId,[choice,setChoice]=useState<{scope:string;id:string}|null>(null),source=videos.find(v=>v.id===(choice?.scope===scope?choice.id:undefined))??videos[0];
 const [busy,setBusy]=useState(false),[failure,setFailure]=useState<{scope:string;message:string}|null>(null),working=useRef(false),mounted=useRef(false),current=useRef(scope),id=useId();current.current=scope;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const reading=useWorkspaceReading(w,onChanged,shotId??'episode','无法读取当前原声状态。');
 const writable=useRef(false);writable.current=!readOnly&&!pending&&!w.stale&&active;
 const disabled=!writable.current||busy;
 const preparations=w.audio?.preparations.filter(p=>p.kind==='source'&&p.shotId===shotId&&p.source?.provider!=='registered')??[];
 const canPrepareSource=!!source&&!preparations.some(p=>p.sourceItemId===source.id&&!workspaceTaskPresentation(p.generationTask??{status:p.status}).hidden&&!p.generationTask?.invalidated);
 const pollingError=useWorkspacePolling(reading,{enabled:active&&!busy&&!pending&&preparations.some(p=>p.taskId&&['ready','running'].includes(p.status)),interval:3000});
 const recorded=project?.timelines.flatMap(t=>t.items.filter(i=>i.kind==='audio'&&i.id==='workspace-source-shot-'+shotId&&i.sourceAssetId==='audio-track-'+input?.audioTrack?.id).map(item=>({item,timeline:t})))[0];
 async function perform(action:(saved:ProductionWorkspace,owns:()=>boolean)=>Promise<void>){
  if(disabled||working.current)return;working.current=true;setBusy(true);setFailure(null);const started=scope,owns=()=>mounted.current&&current.current===started;
  try{const saved=await reading.idle();if(!saved||!owns()||!writable.current)return;await action(saved,owns);}
  catch(error){if(owns()&&!(error instanceof Error&&error.name==='AbortError'))setFailure({scope:started,message:error instanceof Error?error.message:'原声操作未完成，请重新读取。'});}
  finally{working.current=false;if(mounted.current)setBusy(false);}
 }
 async function run(name:string,data:Record<string,unknown>){return perform(async(saved,owns)=>{
  const value=await command(name,{episodeId:saved.episodeId,workspaceId:saved.id,expectedRevision:saved.revision,...data}) as ProductionWorkspace;
  if(owns()){if(!value||!Array.isArray(value.clips)||value.id!==saved.id||value.episodeId!==saved.episodeId)throw Error('未收到当前工程的原声结果，请重新读取。');reading.publish(value);}
 });}
 function reconcile(p:typeof preparations[number],recover=false){return perform(async(saved,owns)=>{if(recover&&p.generationTask)await reconcileWorkspaceOutput(saved.episodeId,p.generationTask);if(owns())await reading.read();});}
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
