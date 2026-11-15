import type {PoolClient} from 'pg';
import {productionMetricsEnabled} from './productionQuality.js';

/** One application instance only; restored Owner UUIDs in another instance
 * never share in-flight counts. Nothing is persisted while collection is off. */
export function localExportActivity(){
 const active=new Map<string,number>();
 return{count:(ownerId:string)=>active.get(ownerId)??0,start(ownerId:string){
  active.set(ownerId,(active.get(ownerId)??0)+1);let done=false;
  return()=>{if(done)return;done=true;const next=active.get(ownerId)!-1;if(next)active.set(ownerId,next);else active.delete(ownerId);};
 }};
}
export type LocalExportActivity=ReturnType<typeof localExportActivity>;
const signature='local_identity.record_workspace_local_export(uuid,uuid,text,timestamptz)';
export async function localExportStartedAt(c:PoolClient):Promise<string|null>{
 if(!await productionMetricsEnabled(c))return null;
 if(!(await c.query('SELECT to_regprocedure($1) IS NOT NULL present',[signature])).rows[0]?.present)return null;
 return(await c.query('SELECT clock_timestamp()::text started')).rows[0].started;
}

/** Persist the actual result atomically, without a statistics row lock during render. */
export async function recordLocalExport(c:PoolClient,workspaceId:string,exportId:string,phase:'finished'|'rejected',startedAt:string|null){
 if(!await productionMetricsEnabled(c))return;
 if(!(await c.query('SELECT to_regprocedure($1) IS NOT NULL present',[signature])).rows[0]?.present)return;
 await c.query('SELECT local_identity.record_workspace_local_export($1,$2,$3,$4)',[workspaceId,exportId,phase,startedAt]);
}
