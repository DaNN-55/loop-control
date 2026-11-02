import type {Pool} from 'pg';
import type {OwnerSession} from './sessions.js';
import {sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError} from './configurationCommands.js';
/** Owner grants access to this original task only. Proof, lease and paths are resolved by the Worker. */
export async function reconcileOwnerNativeOutput(pool:Pool,session:OwnerSession,body:Record<string,unknown>,recover?:((taskId:string,attempt:number)=>Promise<{status:'completed';registered:boolean}>)){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(Object.keys(body).some(k=>!['episodeId','taskId','attempt'].includes(k))||typeof body.episodeId!=='string'||!uuid.test(body.episodeId)||typeof body.taskId!=='string'||!uuid.test(body.taskId)||!Number.isSafeInteger(body.attempt)||Number(body.attempt)<0)throw new ConfigurationError(400,'产物核对标识无效。');
 const taskId=body.taskId,attempt=Number(body.attempt);
 await sessionTransaction(pool,session,async c=>{
  const task=(await c.query("SELECT t.status,t.attempt FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id JOIN public.account_memberships m ON m.account_id=e.account_id JOIN local_identity.input_episodes i ON i.episode_id=e.id WHERE t.id=$1 AND e.id=$2 AND m.user_id=$3 AND m.role='owner' AND t.invalidated_at IS NULL",[taskId,body.episodeId,session.id])).rows[0];
  if(!task)throw new ConfigurationError(404,'原任务不可见。');
  if(task.attempt!==attempt+1||!['running','completed'].includes(task.status))throw new ConfigurationError(409,'原任务或尝试已变化，请刷新后核对。');
 });
 if(!recover)throw new ConfigurationError(503,'产物核对服务尚未就绪，请稍后重试。');
 try{return await recover(taskId,attempt);}catch(error){const message=error instanceof Error?error.message:'';const reason=(error as NodeJS.ErrnoException)?.code==='ENOENT'?'原发布记录或文件缺失':/凭据|JSON/.test(message)?'原发布记录不完整或已变化':/目录|输入|资产/.test(message)?'原目录或冻结输入已变化':'原产物未能安全恢复';throw new ConfigurationError(409,reason+'。请保留当前任务和文件，核对后再试。');}
}
