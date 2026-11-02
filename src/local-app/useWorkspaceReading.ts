import {useEffect,useMemo,useRef} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';

type WorkspaceLoader=(workspace:ProductionWorkspace)=>Promise<ProductionWorkspace>;
export interface WorkspaceReading {
 read(load?:WorkspaceLoader):Promise<ProductionWorkspace>;
 publish(value:ProductionWorkspace):void;
 /** Fence outstanding replies synchronously when the owner accepts a command result. */
 observe(value:ProductionWorkspace|null):void;
 poll(load?:WorkspaceLoader):Promise<void>;
}
/** Reading belongs to one workspace and target. Drafts and mutations stay with their callers. */
export function useWorkspaceReading(workspace:ProductionWorkspace|null,onChange:(value:ProductionWorkspace)=>void,targetItemId:string,readError:string):WorkspaceReading{
 const changed=useRef(onChange);changed.current=onChange;
 const reader=useMemo(()=>{
  let active=false,latest=workspace,provided=workspace,issued=0,accepted=0;
  const requests=new Set<AbortController>();
  const cancelled=()=>Object.assign(new Error('Workspace reading ended.'),{name:'AbortError'});
  function publish(value:ProductionWorkspace,sequence=++issued){
   if(!active||!workspace||value.episodeId!==workspace.episodeId||value.id!==workspace.id||(latest&&value.revision<latest.revision)||sequence<accepted)return latest??value;
   latest=value;accepted=sequence;changed.current(value);return value;
  }
  function end(){active=false;for(const request of requests)request.abort();}
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
   finally{requests.delete(controller);}
  }
  return {read,publish(value:ProductionWorkspace){publish(value);},
   async poll(load?:WorkspaceLoader){if(active&&!requests.size)await read(load);},
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

/** Keep existing polling cadence, but share in-flight ownership with explicit reads. */
export function useWorkspacePolling(reader:WorkspaceReading,enabled:boolean,interval:number,onError?:()=>void,load?:WorkspaceLoader){
 const error=useRef(onError);error.current=onError;
 const loader=useRef(load);loader.current=load;
 useEffect(()=>{
  if(!enabled)return;
  let active=true;
  const timer=setInterval(()=>{void reader.poll(loader.current).catch(cause=>{if(active&&!(cause instanceof Error&&cause.name==='AbortError'))error.current?.();});},interval);
  return()=>{active=false;clearInterval(timer);};
 },[reader,enabled,interval]);
}
