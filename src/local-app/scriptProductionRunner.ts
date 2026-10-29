import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {ownerTransaction} from './ownerTransaction.js';
import {nextScriptProductionAction,type ContinuationSnapshot,type ProductionAction} from './scriptProductionContinuation.js';
import type {ScriptProductionRecord} from './scriptProductionStore.js';
export interface ProductionScope {episode_id:string;owner_id:string;authorization_hash:string}
export function productionActionId(scope:ProductionScope,action:ProductionAction){
 const h=createHash('sha256').update(JSON.stringify([scope.episode_id,scope.authorization_hash,action.command,action.identity])).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
export async function readContinuationSnapshot(c:Parameters<Parameters<typeof ownerTransaction>[3]>[0],scope:ProductionScope):Promise<ContinuationSnapshot|null>{
 const record=(await c.query('SELECT * FROM local_identity.script_productions WHERE episode_id=$1 AND enabled AND authorization_hash=$2',[scope.episode_id,scope.authorization_hash])).rows[0] as ScriptProductionRecord|undefined;
 if(!record)return null;
 const e=(await c.query('SELECT e.*,b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1 AND e.main_script_revision_id=$2',[scope.episode_id,record.script_revision_id])).rows[0];
 if(!e)return null;
 const review=(await c.query("SELECT p.id,a.relative_path artifact_path,p.context_snapshot#>'{worker_result,storyboard,shots}' shots FROM public.review_packages p JOIN public.artifacts a ON a.id=p.artifact_id WHERE p.episode_id=$1 AND p.stage='storyboard_review' AND p.invalidated_at IS NULL ORDER BY p.revision_number DESC LIMIT 1",[e.id])).rows[0];
 const drafts=review?(await c.query('SELECT d.*,local_identity.caption_text_is_confirmed(d.id) caption_confirmed FROM public.shot_preparation_drafts d WHERE d.episode_id=$1 AND d.review_package_id=$2',[e.id,review.id])).rows:[];
 const tasks=(await c.query('SELECT id,status,provider,task_type,input_snapshot,invalidated_at,created_at FROM public.tasks WHERE episode_id=$1 ORDER BY created_at DESC',[e.id])).rows.filter(t=>{
  const source=t.input_snapshot.storyboard_review_package_id??t.input_snapshot.shot_preparation?.review_package_id;
  return !source||source===review?.id;
 });
 const materials=(await c.query('SELECT r.task_id,m.id FROM public.paid_generation_reservations r JOIN public.tasks t ON t.id=r.task_id JOIN public.production_material_revisions m ON m.id=r.material_revision_id WHERE t.episode_id=$1',[e.id])).rows;
 return{episode:e,record,review,drafts,tasks,videoMaterials:Object.fromEntries(materials.map(m=>[m.task_id,{id:m.id}]))};
}
export function startScriptProductionRunner(pool:Pool,execute:(scope:ProductionScope,command:string,data:Record<string,unknown>,key:string)=>Promise<unknown>,intervalMs=4000){
 let stopped=false,pump:Promise<void>|undefined;
 async function scan(){
  let scopes:ProductionScope[];
  try{scopes=(await pool.query('SELECT * FROM local_identity.script_production_scopes()')).rows;}catch{return;}
  for(const scope of scopes){
   if(stopped)break;
   let status='等待当前任务';
   try{
    const state=await ownerTransaction(pool,scope.owner_id,true,c=>readContinuationSnapshot(c,scope));
    if(!state)continue;
    const decision=nextScriptProductionAction(state);
    if('wait'in decision)status=decision.wait;
    else{await execute(scope,decision.action.command,decision.action.data,productionActionId(scope,decision.action));status='已安排：'+decision.action.command;}
   }catch(error){status=error instanceof Error?error.message:'自动继续暂不可用';}
   await ownerTransaction(pool,scope.owner_id,false,async c=>{await c.query('UPDATE local_identity.script_productions SET last_status=$3,updated_at=clock_timestamp() WHERE episode_id=$1 AND authorization_hash=$2 AND last_status IS DISTINCT FROM $3',[scope.episode_id,scope.authorization_hash,status.slice(0,1000)]);}).catch(()=>{});
  }
 }
 function wake(){if(!stopped&&!pump)pump=scan().finally(()=>{pump=undefined;});return pump??Promise.resolve();}
 const timer=setInterval(()=>void wake(),intervalMs);timer.unref?.();
 return{wake,async stop(){stopped=true;clearInterval(timer);await pump;}};
}
