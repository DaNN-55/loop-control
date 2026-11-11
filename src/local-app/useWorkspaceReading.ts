import {useEffect,useMemo,useRef,useState} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';

type WorkspaceLoader=(workspace:ProductionWorkspace)=>Promise<ProductionWorkspace>;
export interface WorkspaceReading {
 read(load?:WorkspaceLoader):Promise<ProductionWorkspace>;
 publish(value:ProductionWorkspace):void;
 /** Fence outstanding replies synchronously when the owner accepts a command result. */
 observe(value:ProductionWorkspace|null):void;
 poll(load?:WorkspaceLoader):Promise<boolean>;
 idle():Promise<void>;
}
/** Reading belongs to one workspace and target. Drafts and mutations stay with their callers. */
export function useWorkspaceReading(workspace:ProductionWorkspace|null,onChange:(value:ProductionWorkspace)=>void,targetItemId:string,readError:string):WorkspaceReading{
 const changed=useRef(onChange);changed.current=onChange;
 const reader=useMemo(()=>{
  let active=false,latest=workspace,provided=workspace,issued=0,accepted=0;
  const requests=new Set<AbortController>(),idleWaiters=new Set<()=>void>();
  function releaseWaiters(){for(const resolve of idleWaiters)resolve();idleWaiters.clear();}
  const cancelled=()=>Object.assign(new Error('Workspace reading ended.'),{name:'AbortError'});
  function publish(value:ProductionWorkspace,sequence=++issued){
   if(!active||!workspace||value.episodeId!==workspace.episodeId||value.id!==workspace.id||(latest&&value.revision<latest.revision)||sequence<accepted)return latest??value;
   latest=value;accepted=sequence;changed.current(value);return value;
  }
  function end(){active=false;for(const request of requests)request.abort();releaseWaiters();}
  async function read(load?:WorkspaceLoader){
   if(!active||!workspace||!latest)throw cancelled();
   const sequence=++issued,controller=new AbortController();requests.add(controller);
   try{
    let value:ProductionWorkspace|null;
    // Some refresh commands reconcile the first narration. Keep their server-side work intact.
    if(load)value=await load(latest);
    else{
     const response=await fetch(`/api/local/episodes/${workspace.episodeId}/workspace`,{signal:controller.signal});
     if(!response.ok)throw Error(readError);
     value=(await response.json()).workspace as ProductionWorkspace|null;
    }
    if(!active||controller.signal.aborted)throw cancelled();
    if(!value||value.id!==workspace.id||value.episodeId!==workspace.episodeId)throw Error('工程版本已变化，请重新打开当前工作版本。');
    return publish(value,sequence);
   }catch(cause){if(!active||controller.signal.aborted||sequence<accepted)throw cancelled();throw cause;}
   finally{requests.delete(controller);if(!requests.size)releaseWaiters();}
  }
  return {read,publish(value:ProductionWorkspace){publish(value);},
   async poll(load?:WorkspaceLoader){if(!active||requests.size)return false;await read(load);return true;},
   async idle(){if(active&&requests.size)await new Promise<void>(resolve=>idleWaiters.add(resolve));},
   observe(value:ProductionWorkspace|null){
    if(value&&workspace&&(value.id!==workspace.id||value.episodeId!==workspace.episodeId)){end();return;}
    if(value!==provided){provided=value;if(value&&value!==latest&&(!latest||value.revision>=latest.revision)){latest=value;accepted=++issued;}}
   },
   start(){active=true;return end;},
  };
  // A target switch ends the old read even when the HTTP adapter ignores AbortSignal.
 },[workspace?.episodeId,workspace?.id,targetItemId,readError]);
 reader.observe(workspace);
 useEffect(()=>reader.start(),[reader]);
 return reader;
}

interface PollingOptions {enabled:boolean;interval:number;load?:WorkspaceLoader;immediate?:boolean}
/** Visibility controls scheduling. Existing writes may settle before the next refresh. */
export function useWorkspacePolling(reader:WorkspaceReading,{enabled,interval,load,immediate=false}:PollingOptions){
 const loader=useRef(load);loader.current=load;
 const [failure,setFailure]=useState<{reader:WorkspaceReading;error:Error}|null>(null);
 useEffect(()=>{
  if(!enabled)return;
  let active=true,resuming=false,timer:ReturnType<typeof setInterval>|undefined;
  async function tick(afterPending=false){
   if(!active||document.hidden)return;
   if(afterPending)await reader.idle();
   if(!active||document.hidden)return;
   try{if(await reader.poll(loader.current))if(active)setFailure(null);}
   catch(cause){if(active&&!document.hidden&&!(cause instanceof Error&&cause.name==='AbortError'))setFailure({reader,error:cause instanceof Error?cause:Error('状态读取失败，请重试。')});}
  }
  async function resume(){if(resuming)return;resuming=true;try{await tick(true);}finally{resuming=false;}}
  function visibility(){
   clearInterval(timer);
   if(document.hidden)return;
   void resume();timer=setInterval(()=>void tick(),interval);
  }
  if(!document.hidden){if(immediate)void tick();timer=setInterval(()=>void tick(),interval);}
  document.addEventListener('visibilitychange',visibility);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
 },[reader,enabled,interval,immediate]);
 return enabled&&failure?.reader===reader?failure.error:null;
}
