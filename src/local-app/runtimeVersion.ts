import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import * as runtimeBuild from '../orchestration/runtimeBuild.js';
import type {RuntimeVersionStatus,RuntimeVersionState} from '../observability/runtimeStatus.js';

type RuntimeRelease={id:string;root:string};
export interface RuntimeVersionOptions {projectRoot:string;runtimeRelease?:RuntimeRelease;workerRelease?:()=>string|null}
// Older local deployments have no pinned release identity. They remain unverified.
const releases=runtimeBuild as typeof runtimeBuild & {assertRuntimeRelease?:(root:string,release:RuntimeRelease)=>Promise<void>;readPreparedRuntimeRelease?:(root:string)=>Promise<RuntimeRelease>};
/** Observation only: the pinned release remains the authority for readiness and execution. */
export function createRuntimeVersionReader(options:RuntimeVersionOptions){
 const startedAt=new Date().toISOString(),backend=options.runtimeRelease;
 let cache:{at:number;value:Promise<RuntimeVersionStatus>}|undefined;
 return function readVersion():Promise<RuntimeVersionStatus>{
  const at=Date.now();if(cache&&at-cache.at>=0&&at-cache.at<10000)return cache.value;
  const value=(async():Promise<RuntimeVersionStatus>=>{
   const workerReleaseId=options.workerRelease?.()??null;
   if(!releases.assertRuntimeRelease||!releases.readPreparedRuntimeRelease)return{state:'unknown',backendReleaseId:null,workerReleaseId:null,preparedReleaseId:null,startedAt,checkedAt:new Date(at).toISOString()};
   let prepared:RuntimeRelease|undefined,state:RuntimeVersionState='unknown';
   const preparing=await stat(join(options.projectRoot,'dist/runtime-preparing')).then(()=>true,()=>false);
   let runningValid=false;
   if(backend){try{await releases.assertRuntimeRelease(options.projectRoot,backend);runningValid=true;}catch{state='running_invalid';}}
   try{prepared=await releases.readPreparedRuntimeRelease(options.projectRoot);}
   catch(cause){if(state!=='running_invalid')state=(cause as {code?:string}).code==='runtime_release_invalid'?'prepared_invalid':'not_prepared';}
   if(backend&&runningValid){
    if(workerReleaseId&&workerReleaseId!==backend.id)state='mismatch';
    else if(prepared){
     if(prepared.id!==backend.id)state='restart_required';
     else if(preparing)state='preparing';
     else{
      try{await runtimeBuild.assertPreparedRuntime(options.projectRoot);state=workerReleaseId?'current':'unknown';}
      catch(cause){const code=(cause as {code?:string}).code;state=code==='runtime_source_changed'?'source_changed':code==='runtime_release_invalid'?'running_invalid':code==='runtime_not_prepared'?'not_prepared':'unknown';}
     }
    }else if(preparing)state='preparing';
   }
   return{state,backendReleaseId:backend?.id??null,workerReleaseId,preparedReleaseId:prepared?.id??null,startedAt,checkedAt:new Date(at).toISOString()};
  })();cache={at,value};return value;
 };
}
