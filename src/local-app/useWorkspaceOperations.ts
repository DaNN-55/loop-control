import {useEffect,useMemo,useReducer,useRef} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutStudioWorkspace} from '../reviews/reviewRevision';
import type {EmbeddedStudioSession} from './EmbeddedStudioHost';

type Selection={shotId:string;itemId:string};
type State=
 |{phase:'ready'|'preparing'|'closed'}
 |{phase:'opening';session:EmbeddedStudioSession|null;destination:'editor'|'stay'}
 |{phase:'editing'|'saving'|'closing';session:EmbeddedStudioSession};
type Prepare={scriptRevisionId:string;boardId?:string;reason?:string;legacyDecision?:'preserve'|'fresh';stayOnCurrentStep?:boolean};
interface Options {
 episodeId:string;readOnly:boolean;reopen:boolean;
 current:()=>ProductionWorkspace|null;
 command:(name:string,data:unknown,owns:()=>boolean)=>Promise<unknown>;
 publish:(workspace:ProductionWorkspace)=>void;
 error:(message:string)=>void;
 prepared:(stayOnCurrentStep:boolean)=>void;
 opened:()=>void;
 closed:(destination:'preparation'|'delivery',selection:Selection|undefined,workspace:ProductionWorkspace)=>void;
 missingSources:()=>void;
 recover:()=>void;
}
const cancelled=()=>Object.assign(Error('工作区操作已结束，请重新打开当前工程。'),{name:'AbortError'});
/** ADR-0037: local operation ownership; navigation, business validity and native flush remain independent. */
export function useWorkspaceOperations(options:Options){
 const latest=useRef(options);latest.current=options;
 const owner=useMemo(()=>({state:{phase:'ready'} as State}),[options.episodeId]);
 const active=useRef(owner);active.current=owner;
 const [,render]=useReducer((version:number)=>version+1,0);
 function transition(state:State){owner.state=state;render();}
 function owns(state:State){return active.current===owner&&owner.state===state&&state.phase!=='closed';}
 function available(){return active.current===owner&&owner.state.phase!=='closed'&&!latest.current.readOnly;}
 useEffect(()=>{if(owner.state.phase==='closed')transition({phase:'ready'});return()=>{owner.state={phase:'closed'};};},[owner]);
 function publish(state:State,result:ProductionWorkspace,source:ProductionWorkspace|null){
  if(!owns(state)||!available())throw cancelled();
  const current=latest.current.current();
  if(result.episodeId!==options.episodeId||source&&(current?.id!==source.id||result.id!==source.id||current.scriptRevisionId!==source.scriptRevisionId||result.revision<current.revision))throw cancelled();
  latest.current.publish(result);
 }
 async function prepare(input:Prepare){
  if(!available()||owner.state.phase!=='ready')return;
  const state:State={phase:'preparing'},source=latest.current.current();transition(state);
  const replan=source&&(source.stale||source.scriptRevisionId!==input.scriptRevisionId);
  try{
   const result=await latest.current.command(replan?'replanWorkspace':'prepareWorkspace',{episodeId:options.episodeId,...(input.boardId&&(!source||input.scriptRevisionId===source.scriptRevisionId)?{reviewPackageId:input.boardId}:{}),expectedScriptRevisionId:input.scriptRevisionId,...(replan?{workspaceId:source.id,expectedRevision:source.revision,...(input.reason?{reason:input.reason}:{})}:{}),...(input.legacyDecision?{legacyDecision:input.legacyDecision}:{})},()=>owns(state));
   if(!owns(state)||!available())return;
   if(result&&typeof result==='object'&&'planning' in result){latest.current.error('后端仍在使用旧版分镜流程。更新本地服务后，再进入分镜台。');return;}
   if(!result||!Array.isArray((result as ProductionWorkspace).clips)){latest.current.error('未收到有效的分镜工程，请重试。');return;}
   publish(state,result as ProductionWorkspace,source);latest.current.prepared(!!input.stayOnCurrentStep);
  }finally{if(owns(state))transition({phase:'ready'});}
 }
 async function open(){
  const previous=owner.state;
  if(!available()||previous.phase!=='ready'&&(previous.phase!=='editing'||!latest.current.reopen))return;
  const source=latest.current.current();if(!source)return;
  if(source.readiness.placeholders.length||source.readiness.missingSources.length){latest.current.missingSources();return;}
  const state:State={phase:'opening',session:'session' in previous?previous.session:null,destination:'editor'};transition(state);
  try{
   const result=await latest.current.command('openWorkspaceStudio',{episodeId:options.episodeId,workspaceId:source.id,expectedRevision:source.revision},()=>owns(state)&&state.destination==='editor') as {studioUrl:string;workspace:OpenChatCutStudioWorkspace;productionWorkspace:ProductionWorkspace};
   publish(state,result.productionWorkspace,source);
   if(state.destination==='stay'){transition(previous);return;}
   transition({phase:'editing',session:{studioUrl:result.studioUrl,workspace:result.workspace,sourcePath:source.project.relativePath,launchId:crypto.randomUUID()}});latest.current.opened();
  }finally{if(owns(state)){transition(previous);if(state.destination==='stay')latest.current.recover();}}
 }
 function editing(session:EmbeddedStudioSession){
  const state=owner.state;if(!available()||state.phase!=='editing'||state.session!==session)throw cancelled();
  const source=latest.current.current();if(!source)throw cancelled();return source;
 }
 async function save(session:EmbeddedStudioSession,file:OpenChatCutStudioWorkspace){
  const source=editing(session),state:State={phase:'saving',session};transition(state);
  try{
   const result=await latest.current.command('saveWorkspaceStudio',{episodeId:options.episodeId,workspaceId:source.id,expectedRevision:source.revision,workspaceRelativePath:file.relativePath,projectId:file.projectId,expectedWorkspaceSha256:file.sha256},()=>owns(state)) as OpenChatCutStudioWorkspace&{productionWorkspace:ProductionWorkspace};
   publish(state,result.productionWorkspace,source);return result;
  }finally{if(owns(state))transition({phase:'editing',session});}
 }
 async function close(session:EmbeddedStudioSession,destination:'preparation'|'delivery',selection?:Selection){
  const source=editing(session),state:State={phase:'closing',session};transition(state);
  try{
   const result=await latest.current.command('closeWorkspaceStudio',{episodeId:options.episodeId,workspaceId:source.id,expectedRevision:source.revision},()=>owns(state)) as ProductionWorkspace;
   publish(state,result,source);transition({phase:'ready'});latest.current.closed(destination,selection,result);
  }finally{if(owns(state))transition({phase:'editing',session});}
 }
 function cancelOpening(){const state=owner.state;if(owns(state)&&state.phase==='opening'){state.destination='stay';render();}}
 const state=owner.state;
 return {prepare,open,save,close,cancelOpening,preparing:state.phase==='preparing',opening:state.phase==='opening'&&state.destination==='editor',session:'session' in state?state.session:null};
}
