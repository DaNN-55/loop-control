import {Pool,type PoolConfig} from 'pg';
import type {WorkerDatabasePort} from '../orchestration/workerDispatch.js';
export function assertWorkerDatabaseBinding(worker:PoolConfig,application:Pick<PoolConfig,'host'|'port'|'database'>){
 if(!application||worker.host!==application.host||worker.port!==application.port||worker.database!==application.database)throw Error('本地HTTP与Worker数据库绑定不一致。');
}
export function createWorkerDatabase(config:PoolConfig){
 if(config.host!=='127.0.0.1'||config.user!=='loop_worker'||!Number.isInteger(config.port)||(config.port??0)<1||(config.port??0)>65535||typeof config.database!=='string'||!config.database||!config.password||Object.keys(config).some(k=>!['host','port','user','database','password'].includes(k)))throw Error('Invalid native Worker database configuration');
 const pool=new Pool({...config,max:4,connectionTimeoutMillis:3000,idleTimeoutMillis:10000});
 // pg discards a disconnected idle client. Keep the service alive; the next
 // readiness check reports connection failures without serializing pg clients.
 pool.on('error',()=>{});
 return pool;
}
export async function assertNativeWorkerDatabase(pool:Pool,database:string,narration=false){
 const narrationPrivilege=narration?" AND has_function_privilege(current_user,'local_identity.input_task_connection(uuid,integer,uuid)','EXECUTE')":"";
 const {rows:[row]}=await pool.query("SELECT session_user='loop_worker' AND current_database()=$1 AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) AND has_function_privilege(current_user,'local_identity.plan_input_tasks(uuid)','EXECUTE') AND has_function_privilege(current_user,'local_identity.claim_input_task(uuid,integer)','EXECUTE') AND has_function_privilege(current_user,'local_identity.input_worker_call(text,jsonb)','EXECUTE')"+narrationPrivilege+" ready",[database]);
 if(!row?.ready)throw Error('Native Worker database identity or permissions differ');
}
export function nativeWorkerPort(pool:Pool):WorkerDatabasePort{
 return {
  async plan(scope){return (await pool.query('SELECT id FROM local_identity.plan_input_tasks($1)',[scope.episodeId??null])).rowCount??0;},
  async rpc(name,args){
   if(name==='claim_next_worker_task')return (await pool.query('SELECT * FROM local_identity.claim_input_task($1,$2)',[args.p_task_id??null,args.p_worker_capacity])).rows;
   if(name==='worker_retry_delay_ms')return [0]; // Service's durable four-second scan handles persisted backoff.
   if(!['report_worker_result','report_worker_progress','refresh_worker_task_lease'].includes(name))throw Error('Unsupported native Worker operation');
   await pool.query('SELECT local_identity.input_worker_call($1,$2)',[name,args]);return [];
  },
 };
}
