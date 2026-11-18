import {useRef,useState} from 'react';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {WorkspaceNarrationPanel,type WorkspaceMainVoiceMode} from './WorkspaceNarrationPanel';
import {WorkspaceSourceVoicePanel} from './WorkspaceSourceVoicePanel';
import {useWorkspaceReading} from './useWorkspaceReading';
import type {ProductionWorkspace} from '../productionWorkspace';

type Props=Parameters<typeof WorkspaceNarrationPanel>[0]&{project?:OpenChatCutProject|null};
function initialMode(workspace:ProductionWorkspace,shotId:string|undefined):WorkspaceMainVoiceMode{
 const voice=workspace.audio?.mix.voices.find(v=>v.shotId===shotId),narration=workspace.narration?.find(n=>n.shotId===shotId);
 if(narration?.requestedMode)return narration.requestedMode;
 if(voice?.mode==='source')return 'source';
 if(narration?.enabled===false)return 'none';
 if(workspace.clips.find(c=>c.shotId===shotId)?.voiceInput?.mode==='source')return 'source';
 return narration?.mode==='manual'?'manual':narration?.mode==='tts'||narration?.enabled===true?'tts':'none';
}
export function WorkspaceMainVoicePanel(props:Props){
 const shotId=props.selectedShotId??props.workspace.clips[0]?.shotId;
 if(props.readOnly)return <><WorkspaceSourceVoicePanel workspace={props.workspace} project={props.project} selectedShotId={shotId} pending={props.pending} readOnly active={props.active} command={props.command} onChanged={props.onChanged}/><WorkspaceNarrationPanel {...props}/></>;
 return <MainVoiceTarget key={props.workspace.id+':'+shotId} {...props} selectedShotId={shotId}/>;
}
function MainVoiceTarget(props:Props){
 const {workspace,selectedShotId:shotId,command,onChanged}=props;
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),working=useRef(false);
 const mode=initialMode(workspace,shotId);
 const reader=useWorkspaceReading(workspace,onChanged,shotId??'episode','无法读取当前声音设置。');
 async function changeMode(next:WorkspaceMainVoiceMode){
  if(props.readOnly||props.pending||working.current||workspace.stale||next===mode)return;
  working.current=true;setError('');setBusy(true);
  try{
   const current=await reader.read(),clip=current.clips.find(c=>c.shotId===shotId);if(!clip)throw Error('当前镜头已变化。');
   const changed=await command('setWorkspaceNarrationEnabled',{episodeId:current.episodeId,workspaceId:current.id,expectedRevision:current.revision,clipId:clip.id,enabled:next==='tts'||next==='manual',voiceMode:next}) as ProductionWorkspace;
   reader.publish(changed);
  }catch(cause){setError(cause instanceof Error?cause.message:'声音设置未保存。');}finally{working.current=false;setBusy(false);}
 }
 return <>
  <WorkspaceNarrationPanel {...props} pending={props.pending||busy} managedVoice={{mode,onChange:next=>void changeMode(next),source:<WorkspaceSourceVoicePanel workspace={workspace} project={props.project} selectedShotId={shotId} pending={props.pending||busy} readOnly={props.readOnly} active={props.active!==false&&mode==='source'} connect command={command} onChanged={onChanged}/>}}/>
  {error&&<p role="alert">{error}</p>}
 </>;
}
