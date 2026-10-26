import {constants} from 'node:fs';
import {copyFile,lstat,open,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,basename,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import type {Pool,PoolClient} from 'pg';
import {validateWorkerResult} from '../worker/contracts.js';
import type {ArtifactManifest,WorkerResult,WorkerTaskPackage} from '../worker/contracts.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {verifyArtifactIndex} from '../worker/mediaLibrary.js';
import {verifyReportedStoryboardArtifact} from '../worker/storyboardArtifact.js';

export interface NativeAttemptFence {p_task_id:string;p_attempt:number;p_lease_token:string}
export async function prepareNativeAttemptOutput(taskPackage:WorkerTaskPackage,fence:NativeAttemptFence,additionalInputs:ArtifactManifest[]=[]){
 if(fence.p_task_id!==taskPackage.task.id||fence.p_attempt!==taskPackage.budget.attempt)throw Error('输出尝试与冻结任务不一致。');
 const identity=createHash('sha256').update(JSON.stringify(fence)).digest('hex');
 const marker=await safeAssetOutputPath(taskPackage.assets.allowedRoot,`.native-worker-attempts/${identity}/identity.json`);
 const stagingRoot=dirname(marker);
 await writeFile(marker,JSON.stringify({taskId:taskPackage.task.id,attempt:fence.p_attempt})+'\n',{flag:'wx',mode:0o600});
 const staged={...taskPackage,assets:{...taskPackage.assets,allowedRoot:stagingRoot}};
 const inputs=[...taskPackage.assets.inputs,...additionalInputs];
 await verifyArtifactIndex({assetRoot:taskPackage.assets.allowedRoot,episodeId:taskPackage.episode.id,artifacts:inputs});
 for(const input of new Map(inputs.map(input=>[input.relativePath,input])).values()){
  const destination=await safeAssetOutputPath(stagingRoot,input.relativePath);
  await copyFile(join(taskPackage.assets.allowedRoot,input.relativePath),destination,constants.COPYFILE_FICLONE|constants.COPYFILE_EXCL);
 }
 await verifyArtifactIndex({assetRoot:stagingRoot,episodeId:taskPackage.episode.id,artifacts:inputs});
 // Normal planners may use an exclusive direct write rather than mkdir.
 // Prepare only the frozen parent path; the executor must create the file.
 await safeAssetOutputPath(stagingRoot,taskPackage.output.relativePath);
 async function verify(artifacts:ArtifactManifest[],storyboard?:WorkerResult['storyboard']){
  await verifyArtifactIndex({assetRoot:stagingRoot,episodeId:taskPackage.episode.id,artifacts});
  if(storyboard)await verifyReportedStoryboardArtifact({assetRoot:stagingRoot,frozenInputs:taskPackage.assets.inputs,relativePath:taskPackage.output.relativePath,storyboard});
 }
 let uncertain=false;
 return{taskPackage:staged,verify,get uncertain(){return uncertain;},async publish(pool:Pick<Pool,'connect'>,result:WorkerResult){
  if(uncertain)throw Error('产物发布结果尚未确认，不能自动重复登记。');
  if(result.status!=='completed')throw Error('只有已完成产物可以发布。');
  if(result.artifacts.some(artifact=>inputs.some(input=>input.relativePath===artifact.relativePath)))throw Error('发布产物不能覆盖冻结输入或已审核复用来源。');
  const backupRoot=dirname(await safeAssetOutputPath(stagingRoot,'.publication-backups/identity.json'));
  const client=await pool.connect();
  const prepared:PreparedPublication[]=[],modified:PreparedPublication[]=[];
  let commitSent=false;
  async function outcome(status:string){await writeFile(join(stagingRoot,'publication-outcome.json'),JSON.stringify({status,taskId:fence.p_task_id,attempt:fence.p_attempt,files:prepared.map(file=>({candidate:file.artifact,previous:file.previous??null}))},null,2)+'\n',{mode:0o600}).catch(()=>{});}
  try{
   await client.query('BEGIN');
   // The existing lease function asserts this attempt/token and updates the
   // task row. Keep that row lock until files and result registration finish.
   await client.query('SELECT local_identity.input_worker_call($1,$2)',['refresh_worker_task_lease',fence]);
   const artifacts=new Map(result.artifacts.map(artifact=>[artifact.relativePath,artifact]));
   // These two existing executor outputs are physical diagnostics rather than
   // indexed artifacts. Preserve their established paths under the same fence.
   const auxiliary:string[]=[];
   if(taskPackage.provider==='openchatcut'&&(taskPackage.aRoll?.adapter==='openchatcut_card_video'||taskPackage.media?.adapter==='openchatcut_card_video'))auxiliary.push(`episodes/${taskPackage.episode.id}/card-video/${taskPackage.task.id}/project.json`);
   if(taskPackage.finalRender)auxiliary.push(`${dirname(taskPackage.finalRender.projectRelativePath)}/openchatcut-runtime.json`);
   for(const path of auxiliary)if(!artifacts.has(path)){
    const bytes=await readFile(await safeAssetOutputPath(stagingRoot,path));
    artifacts.set(path,{artifactType:'native_executor_auxiliary',relativePath:path,fileSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
   }
   const files=[...artifacts.values()];
   const authority=await outputAuthority(client,fence,files.map(file=>file.relativePath));
   assertFrozenOutput(authority,taskPackage,result);
   if(authority.conflicts.length)throw Error('发布路径已被其他任务索引，不能覆盖历史产物。');
   // Both the task row lock and path locks predate this savepoint. SQL error
   // recovery must retain all of them until old bytes are restored.
   await client.query('SAVEPOINT native_output_publication');
   if(files.some(artifact=>inputs.some(input=>input.relativePath===artifact.relativePath)))throw Error('发布产物不能覆盖冻结输入或已审核复用来源。');
   await verify(files,result.storyboard);
   for(const artifact of files)prepared.push(await preparePublication(taskPackage.assets.allowedRoot,stagingRoot,backupRoot,artifact));
   await durableReceipt(stagingRoot,{version:1,fence,taskPackage,assetRoot:taskPackage.assets.allowedRoot,inputHash:authority.inputHash,result,files:prepared.map(file=>({artifact:file.artifact,previous:file.previous})),status:'prepared'});
   for(const file of prepared){modified.push(file);await atomicReplace(file.temporary,file.destination);}
   await client.query('SELECT local_identity.input_worker_call($1,$2)',['report_worker_result',{...fence,p_result:result}]);
   commitSent=true;
   await client.query('COMMIT');
   // Successful temporary input copies need not inflate future media backups.
   // Published files have separate inodes; failed/uncertain attempts stay put.
   await rm(stagingRoot,{recursive:true,force:true}).catch(()=>{});
  }catch(error){
   if(modified.length){
    if(commitSent)uncertain=true;
    else try{
     await client.query('ROLLBACK TO SAVEPOINT native_output_publication');
     for(const file of [...modified].reverse())await restorePublication(backupRoot,file);
     await outcome('restored_before_unlock');
    }catch{uncertain=true;}
   }
   // Once COMMIT or the connection outcome is unknown, restoring could replace
   // bytes already referenced by a committed result or a newer attempt. Keep
   // both generations and do not automatically report a new failed result.
   if(uncertain)await outcome(commitSent?'commit_unknown':'restore_unknown');
   if(!commitSent)await client.query('ROLLBACK').catch(()=>{});
   throw error;
  }
  finally{await Promise.all(prepared.map(file=>rm(file.temporary,{force:true}).catch(()=>{})));client.release(uncertain);}
 }};
}

interface PreparedPublication{artifact:ArtifactManifest;destination:string;temporary:string;previous?:ArtifactManifest}
async function preparePublication(assetRoot:string,stagingRoot:string,backupRoot:string,artifact:ArtifactManifest):Promise<PreparedPublication>{
 const destination=await safeAssetOutputPath(assetRoot,artifact.relativePath);
 const temporary=join(dirname(destination),`.${basename(destination)}.${randomUUID()}.publishing`);
 let previous:ArtifactManifest|undefined;
 try{
  const existing=await lstat(destination).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;return null;});
  if(existing){
   if(!existing.isFile())throw Error('已有产物目标不是普通文件。');
   const backup=await safeAssetOutputPath(backupRoot,artifact.relativePath);
   await copyFile(destination,backup,constants.COPYFILE_FICLONE|constants.COPYFILE_EXCL);
   const handle=await open(backup,'r');try{await handle.sync();}finally{await handle.close();}
   const backupDirectory=await open(dirname(backup),'r');try{await backupDirectory.sync();}finally{await backupDirectory.close();}
   const bytes=await readFile(backup);previous={...artifact,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};
  }
  // A separate inode also isolates a child still holding its staging fd.
  await copyVerifiedFile(join(stagingRoot,artifact.relativePath),temporary,artifact);
  return{artifact,destination,temporary,previous};
 }catch(error){await rm(temporary,{force:true}).catch(()=>{});throw error;}
}
async function restorePublication(backupRoot:string,file:PreparedPublication){
 if(!file.previous){await rm(file.destination,{force:true});return;}
 const temporary=join(dirname(file.destination),`.${basename(file.destination)}.${randomUUID()}.restoring`);
 try{await copyVerifiedFile(join(backupRoot,file.artifact.relativePath),temporary,file.previous);await atomicReplace(temporary,file.destination);}
 finally{await rm(temporary,{force:true}).catch(()=>{});}
}
async function copyVerifiedFile(source:string,destination:string,artifact:ArtifactManifest){
 await copyFile(source,destination,constants.COPYFILE_FICLONE|constants.COPYFILE_EXCL);
 const file=await open(destination,'r');try{await file.sync();}finally{await file.close();}
 const bytes=await readFile(destination);
 if(bytes.length!==artifact.fileSize||createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw Error('发布产物与已验证输出不一致。');
}
interface OutputAuthority{output:{relative_path:string;required_artifact_types:string[];content_type:string;review_stage:string};reviewProjectPath:string|null;finalProjectPath:string|null;status:string;inputHash:string;result:WorkerResult|null;artifacts:ArtifactManifest[];conflicts:ArtifactManifest[]}
interface PublicationReceipt{version:1;fence:NativeAttemptFence;taskPackage:WorkerTaskPackage;assetRoot:string;inputHash:string;result:WorkerResult;files:Array<{artifact:ArtifactManifest;previous?:ArtifactManifest}>;status:string}
async function outputAuthority(client:Pick<PoolClient,'query'>,fence:NativeAttemptFence,paths:string[]):Promise<OutputAuthority>{
 const {rows}=await client.query('SELECT local_identity.native_output_authority($1,$2,$3,$4) authority',[fence.p_task_id,fence.p_attempt,fence.p_lease_token,paths]);
 if(!rows[0]?.authority)throw Error('产物权威核对不可用，保留当前文件等待重试。');
 return rows[0].authority;
}
async function durableReceipt(stagingRoot:string,receipt:PublicationReceipt){
 const path=join(stagingRoot,'publication-receipt-private.json'),temporary=path+'.'+randomUUID();
 try{
  const file=await open(temporary,'wx',0o600);
  try{const receiptSha256=createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
   await file.writeFile(JSON.stringify({...receipt,receiptSha256},null,2)+'\n');await file.sync();}finally{await file.close();}
  await rename(temporary,path);const directory=await open(stagingRoot,'r');try{await directory.sync();}finally{await directory.close();}
 }finally{await rm(temporary,{force:true}).catch(()=>{});}
}

// Explicit local recovery only: never invokes an executor, Provider or budget refund.
export async function recoverNativeAttemptOutput(pool:Pick<Pool,'connect'>,paths:{assetRoot:string;stagingRoot:string}):Promise<{status:'completed';registered:boolean}>{
 const envelope=JSON.parse(await readFile(join(paths.stagingRoot,'publication-receipt-private.json'),'utf8'));
 const {receiptSha256,...receipt}=envelope as PublicationReceipt&{receiptSha256:string};
 if(receiptSha256!==createHash('sha256').update(JSON.stringify(receipt)).digest('hex'))throw Error('私有发布凭据指纹不一致。');
 if(!receipt.taskPackage?.task||!Array.isArray(receipt.files)||!receipt.files.length||receipt.files.length>256)throw Error('私有发布凭据缺少冻结任务或产物。');
 validateWorkerResult(receipt.result,receipt.taskPackage);
 const fence=receipt.fence;
 if(receipt.version!==1||!fence||!Number.isSafeInteger(fence.p_attempt)||fence.p_attempt<0||receipt.result?.taskId!==fence.p_task_id||receipt.result.status!=='completed'||receipt.taskPackage.task.id!==fence.p_task_id||receipt.taskPackage.budget.attempt!==fence.p_attempt||await realpath(receipt.assetRoot)!==await realpath(paths.assetRoot))throw Error('私有发布凭据格式或资产目录不一致。');
 const identity=createHash('sha256').update(JSON.stringify(fence)).digest('hex');
 if(await realpath(paths.stagingRoot)!==join(await realpath(paths.assetRoot),'.native-worker-attempts',identity))throw Error('发布恢复目录不属于此任务尝试。');
 const client=await pool.connect(),backupRoot=join(paths.stagingRoot,'.publication-backups');
 const files:PreparedPublication[]=[];
 let commitSent=false,modified=false,unknown=false;
 try{
  await client.query('BEGIN');
  const authority=await outputAuthority(client,fence,receipt.files.map(file=>file.artifact.relativePath));
  assertFrozenOutput(authority,receipt.taskPackage,receipt.result);
  if(authority.inputHash!==receipt.inputHash||authority.conflicts.length)throw Error('冻结输入已变化或路径被其他任务索引，拒绝旧尝试恢复。');
  const registered=authority.status==='completed';
  if(registered){
   if(!isDeepStrictEqual(authority.result,receipt.result)||receipt.result.artifacts.some(artifact=>!authority.artifacts.some(indexed=>isDeepStrictEqual(indexed,artifact))))throw Error('数据库已登记结果或产物指纹与私有凭据不一致。');
  }else if(authority.status!=='running'||authority.artifacts.length)throw Error('数据库结果不明确，保留凭据等待核对。');
  for(const entry of receipt.files){
   const {artifact,previous}=entry;
   if(!receipt.result.artifacts.some(indexed=>indexed.relativePath===artifact.relativePath&&isDeepStrictEqual(indexed,artifact))&&artifact.artifactType!=='native_executor_auxiliary')throw Error('发布凭据的产物清单不一致。');
   const destination=await safeAssetOutputPath(paths.assetRoot,artifact.relativePath);
   const current=await readFile(destination).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;return null;});
   const matches=(expected:ArtifactManifest)=>current?.length===expected.fileSize&&createHash('sha256').update(current!).digest('hex')===expected.sha256;
   if(current&&!matches(artifact)&&!(previous&&matches(previous)))throw Error('目标文件已有未识别字节，拒绝覆盖。');
   const temporary=join(dirname(destination),`.${basename(destination)}.${randomUUID()}.recovering`);
   try{await copyVerifiedFile(join(paths.stagingRoot,artifact.relativePath),temporary,artifact);}catch(error){await rm(temporary,{force:true}).catch(()=>{});throw error;}
   files.push({artifact,previous,destination,temporary});
   if(!registered&&previous){
    const bytes=await readFile(join(backupRoot,artifact.relativePath));
    if(bytes.length!==previous.fileSize||createHash('sha256').update(bytes).digest('hex')!==previous.sha256)throw Error('旧文件备份不完整，保留 unknown。');
   }
  }
  // The receipt was durable before the first original replacement. Keep the
  // same backups across every retry, including process/connection failures.
  await durableReceipt(paths.stagingRoot,{...receipt,status:'reconciling'});
  if(!registered){for(const file of files)await restorePublication(backupRoot,file);}
  await client.query('SAVEPOINT native_output_publication');
  for(const file of files){modified=true;await atomicReplace(file.temporary,file.destination);}
  if(!registered)await client.query('SELECT local_identity.input_worker_call($1,$2)',['report_worker_result',{...fence,p_result:receipt.result}]);
  commitSent=true;await client.query('COMMIT');
  await durableReceipt(paths.stagingRoot,{...receipt,status:'reconciled_completed'});
  return{status:'completed',registered:!registered};
 }catch(error){
  if(modified&&!commitSent)try{
   await client.query('ROLLBACK TO SAVEPOINT native_output_publication');
   // Only an uncommitted running attempt has old bytes as its authority.
   // A completed DB result always authorizes candidate bytes instead.
   const state=await outputAuthority(client,fence,receipt.files.map(file=>file.artifact.relativePath));
   if(state.status==='running')for(const file of files)await restorePublication(backupRoot,file);
  }catch{unknown=true;}
  if(commitSent)unknown=true;
  if(!commitSent)await client.query('ROLLBACK').catch(()=>{unknown=true;});
  await durableReceipt(paths.stagingRoot,{...receipt,status:unknown?'recovery_unknown':'retry_required'}).catch(()=>{});
  throw error;
 }finally{
  await Promise.all(files.map(file=>rm(file.temporary,{force:true}).catch(()=>{})));
  client.release(unknown);
 }
}
async function atomicReplace(source:string,destination:string){
 await rename(source,destination);const directory=await open(dirname(destination),'r');try{await directory.sync();}finally{await directory.close();}
}

function assertFrozenOutput(authority:OutputAuthority,p:WorkerTaskPackage,result:WorkerResult){
 const output=authority.output;
 if(!output||output.relative_path!==p.output.relativePath||output.content_type!==p.output.contentType||output.review_stage!==p.output.reviewStage||!isDeepStrictEqual(output.required_artifact_types,p.output.requiredArtifactTypes)||authority.reviewProjectPath!==(p.reviewRender?.projectRelativePath??null)||authority.finalProjectPath!==(p.finalRender?.projectRelativePath??null)||!result.artifacts.some(artifact=>artifact.artifactType===output.required_artifact_types[0]&&artifact.relativePath===output.relative_path))throw Error('产物或私有凭据与数据库冻结输出不一致。');
}
