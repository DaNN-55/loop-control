import {captionFailureIssue} from './workspaceCaptionFeedback';
import {FeedbackNotice} from '../ui/FeedbackNotice';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import {useWorkspacePolling,useWorkspaceReading} from './useWorkspaceReading';
import {nextAutomaticCaption} from './workspaceCaptionPreparation';
import {uiText} from '../i18n/ui';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
import {applyStudioCaptionAlignment} from './studioCaptionAutomation';

interface Props {workspace:ProductionWorkspace;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(workspace:ProductionWorkspace)=>void;disabled?:boolean;bridge?:EmbeddedStudioBridge}
/** One coordinator per workspace. Same-input attempts survive refresh and never loop. */
export function WorkspaceCaptionAutomation(props:Props){
 const current=useRef(props);current.current=props;
 const owner=useMemo(()=>({alive:true,busy:false,attempts:new Set<string>()}),[props.workspace.id]);
 const reader=useWorkspaceReading(props.workspace,props.onChange,'automatic-captions','无法读取字幕准备状态。');
 const [cycle,setCycle]=useState(0),[error,setError]=useState('');
 const errorTarget=useRef<{clipId:string;inputFingerprint:string}|null>(null);
 useEffect(()=>{owner.alive=true;return()=>{owner.alive=false;};},[owner]);
 const waiting=props.workspace.captions?.some(c=>c.contract.enabled&&c.timing==='waiting'&&c.alignmentStatus!=='completed');
 const pollingError=useWorkspacePolling(reader,{enabled:!props.disabled&&!!waiting,interval:2500});
 const signature=JSON.stringify(props.workspace.captions?.map(c=>[c.clipId,c.inputFingerprint,c.timing,c.taskId,c.alignmentStatus,c.contract.enabled]));
 useEffect(()=>{
  const previous=errorTarget.current,c=previous?props.workspace.captions?.find(c=>c.clipId===previous.clipId):undefined;
  if(previous&&(!c||!c.contract.enabled||c.timing==='current'||c.inputFingerprint!==previous.inputFingerprint)){errorTarget.current=null;setError('');}
 },[signature]);
 useEffect(()=>{
  if(props.disabled||props.workspace.stale||owner.busy||props.bridge&&!props.bridge.connected)return;
  const unattempted=(w:ProductionWorkspace)=>(w.captions??[]).filter(c=>{
   const action=nextAutomaticCaption([c]);if(!action)return false;
   const identity=JSON.stringify([w.id,c.clipId,c.inputFingerprint,action.name,c.taskId]);
   if(owner.attempts.has(identity))return false;
   try{return !sessionStorage.getItem('loop-caption-auto:'+identity);}catch{return true;}
  });
  const next=nextAutomaticCaption(unattempted(props.workspace));if(!next)return;
  const key=JSON.stringify([props.workspace.id,next.caption.clipId,next.caption.inputFingerprint,next.name,next.caption.taskId]);
  const storageKey='loop-caption-auto:'+key;
  if(owner.attempts.has(key))return;
  try{if(sessionStorage.getItem(storageKey))return;}catch{/* In-memory guard still applies. */}
  owner.busy=true;
  void(async()=>{
   try{
    if(current.current.bridge)await current.current.bridge.save();
    const w=await reader.read();
    if(!owner.alive||current.current.disabled||current.current.workspace.id!==w.id)return;
    const fresh=nextAutomaticCaption(unattempted(w));
    if(!fresh||fresh.name!==next.name||fresh.caption.clipId!==next.caption.clipId||fresh.caption.inputFingerprint!==next.caption.inputFingerprint){owner.attempts.add(key);return;}
    owner.attempts.add(key);try{sessionStorage.setItem(storageKey,'submitted');}catch{/* Optional reload guard. */}
    const c=fresh.caption;
    const result=current.current.bridge&&fresh.name==='applyWorkspaceCaptionAlignment'
     ?await applyStudioCaptionAlignment({workspace:w,caption:c,bridge:current.current.bridge,command:current.current.command,read:()=>reader.read(),isCurrent:()=>owner.alive&&!current.current.disabled})
     :await current.current.command(fresh.name,{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,clipId:c.clipId,expectedInputFingerprint:c.inputFingerprint,automatic:true,...(fresh.name==='requestWorkspaceCaptionAlignment'?{localOnly:true}:{taskId:c.taskId})}) as ProductionWorkspace|{workspace:ProductionWorkspace};
    if(!owner.alive)return;
    reader.publish('workspace' in result?result.workspace:result);if(errorTarget.current?.clipId===fresh.caption.clipId){errorTarget.current=null;setError('');}
   }catch(cause){if(owner.alive&&!(cause instanceof Error&&cause.name==='AbortError')){owner.attempts.add(key);errorTarget.current={clipId:next.caption.clipId,inputFingerprint:next.caption.inputFingerprint};setError(captionFailureIssue(cause)?.message??'字幕自动处理未完成，请在字幕页核对具体状态或手工调整。');}}
   finally{owner.busy=false;if(owner.alive&&!current.current.disabled)setCycle(value=>value+1);}
  })();
 },[owner,reader,props.disabled,props.workspace.id,props.workspace.stale,props.bridge?.connected,signature,cycle]);
 return <FeedbackNotice message={error||pollingError?uiText(error||'字幕状态暂时无法更新，请重新读取工程。'):''} tone="warning"/>;
}
