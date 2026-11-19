import {useEffect,useMemo,useReducer,useRef} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {ShotCaptionContract} from '../shotCaptions';
import {useWorkspaceReading} from './useWorkspaceReading';

type CaptionCommand='saveWorkspaceCaptions'|'requestWorkspaceCaptionAlignment'|'applyWorkspaceCaptionAlignment'|'confirmWorkspaceCaptionText';
interface Attempt {name:CaptionCommand;extra:Record<string,unknown>;requested:ShotCaptionContract;base:ProductionWorkspace;inputFingerprint?:string;data?:Record<string,unknown>}
interface Options {
 workspace:ProductionWorkspace;clipId:string;itemId?:string;inputFingerprint?:string;contract:ShotCaptionContract;
 readOnly:boolean;disabled?:boolean;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(workspace:ProductionWorkspace)=>void;
 onSaved:(submitted:ShotCaptionContract)=>void;
}
/** Preparation commands retain their frozen payload for receipt recovery.
 * Timeline captions are edited and saved by the native editor itself. */
export function useWorkspaceCaptionOperation(options:Options){
 const latest=useRef(options);latest.current=options;
 const owner=useMemo(()=>({generation:0,busy:false,attempt:null as Attempt|null,error:'',progress:''}),[options.workspace.episodeId,options.workspace.id,options.workspace.scriptRevisionId,options.clipId]);
 const active=useRef(owner);active.current=owner;
 const [,render]=useReducer((value:number)=>value+1,0);
 const reading=useWorkspaceReading(options.workspace,options.onChange,options.clipId,'无法读取当前保存版本。');
 useEffect(()=>{owner.generation++;return()=>{owner.generation++;owner.busy=false;owner.attempt=null;};},[owner]);
 function reset(){if(owner.busy)return;owner.attempt=null;owner.error='';owner.progress='';render();}
 async function execute(attempt:Attempt,resuming=false){
  const current=latest.current;
  if(owner.busy||current.readOnly||current.disabled||current.workspace.stale)return;
  if(resuming&&JSON.stringify(current.contract)!==JSON.stringify(attempt.requested)){reset();owner.error='字幕输入已变化，请核对后重新操作。';render();return;}
  const generation=owner.generation,owns=()=>active.current===owner&&owner.generation===generation;
  const check=()=>{if(!owns()||latest.current.readOnly||latest.current.workspace.stale)throw Object.assign(Error('字幕操作已结束。'),{name:'AbortError'});};
  let observed:ProductionWorkspace|undefined;
  owner.busy=true;owner.attempt=attempt;owner.error='';owner.progress='正在登记字幕结果…';render();
  try{
   if(resuming){
    observed=await reading.read();check();
    if(observed.scriptRevisionId!==attempt.base.scriptRevisionId)throw Error('工程脚本已变化，请重新核对字幕。');
    if(!observed.clips.some(clip=>clip.id===current.clipId&&clip.itemId===current.itemId))throw Error('当前字幕片段已变化，请重新选择。');
   }
   attempt.data??={episodeId:attempt.base.episodeId,workspaceId:attempt.base.id,expectedRevision:attempt.base.revision,clipId:options.clipId,
    ...(attempt.name==='saveWorkspaceCaptions'?{captionContract:attempt.requested,...(attempt.inputFingerprint?{expectedInputFingerprint:attempt.inputFingerprint}:{})}:attempt.name==='requestWorkspaceCaptionAlignment'?{}:{expectedInputFingerprint:attempt.inputFingerprint}),...attempt.extra};
   const result=await current.command(attempt.name,attempt.data) as ProductionWorkspace|{workspace:ProductionWorkspace};check();
   const saved='workspace' in result?result.workspace:result;
   if(saved.id!==attempt.base.id||saved.episodeId!==attempt.base.episodeId)throw Error('字幕保存结果不属于当前工程，请重新核对。');
   if(!observed||saved.revision>observed.revision)reading.publish(saved);
   if(attempt.name==='saveWorkspaceCaptions')latest.current.onSaved(attempt.requested);
   owner.attempt=null;owner.progress='';
  }catch(cause){if(owns()&&!(cause instanceof Error&&cause.name==='AbortError')){owner.error=cause instanceof Error?cause.message:'字幕操作未完成。';owner.progress='字幕操作尚未确认，可核对后继续。';}}
  finally{if(owns()){owner.busy=false;render();}}
 }
 return{pending:owner.busy,error:owner.error,progress:owner.progress,canResume:!!owner.attempt&&!owner.busy,reset,
  resume:()=>owner.attempt?execute(owner.attempt,true):Promise.resolve(),
  run:(name:CaptionCommand,extra:Record<string,unknown>={})=>execute({name,extra:{...extra},requested:options.contract,base:options.workspace,inputFingerprint:options.inputFingerprint}),
 };
}
