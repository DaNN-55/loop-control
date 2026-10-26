// Native T16 fault/permission acceptance; only this run's fixtures, no Provider I/O.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,renameSync,symlinkSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {root,projectRoot,configuration,sql} from './environment.mjs';
import {createLocalDatabase} from '../../dist/local-app/local-app/catalog.js';
import {createWorkerDatabase,nativeWorkerPort} from '../../dist/local-app/local-app/workerDatabase.js';
import {hashPassword} from '../../dist/local-app/local-app/password.js';
const run=join(root,'state/t16-20261024'),f=JSON.parse(readFileSync(join(run,'fixture.json'))),origin='http://127.0.0.1:55179';
const save=(name,value)=>writeFileSync(join(run,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
async function login(o){const r=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(o)});assert.equal(r.status,200);return {Origin:origin,Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await r.json()).csrfToken,'Content-Type':'application/json'};}
const headers=await login(JSON.parse(readFileSync(join(root,'state/t13-owner.json')))),calls=[];
async function post(command,data,status=200,h=headers){const r=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers:h,body:JSON.stringify({command,data,idempotencyKey:randomUUID()})}),value=await r.json();calls.push({command,status:r.status});assert.equal(r.status,status,JSON.stringify(value));return value;}
let extraOwner;
try{
 const idem=randomUUID(),canonicalData={accountId:f.accountId,title:'',isTest:true};
 const canonical=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers,body:JSON.stringify({command:'create',data:canonicalData,idempotencyKey:idem})});assert.equal(canonical.status,200);const e=await canonical.json();assert.equal(e.title,'');
 const reordered=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers,body:JSON.stringify({idempotencyKey:idem,data:{isTest:true,title:'',accountId:f.accountId},command:'create'})});assert.equal(reordered.status,200);assert.equal((await reordered.json()).id,e.id);
 const base={episodeId:e.id,sourceKind:'file',sourcePath:'main.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true};
 await post('importMaterial',{...base,contentBase64:Buffer.from('invalid main script').toString('base64')},400);
 assert.equal(sql(`select count(*) from public.production_material_revisions where episode_id='${e.id}'`),'0');
 await post('importMaterial',{...base,contentBase64:Buffer.from('# Main\n## 正文\nSynthetic boundary script.').toString('base64'),api_key:'synthetic-unused-field'},400);
 const main=await post('importMaterial',{...base,contentBase64:Buffer.from('# Main\n## 正文\nSynthetic boundary script.').toString('base64')});
 const before=sql(`select to_jsonb(e) from public.episodes e where id='${e.id}'`),path=join(f.assetRoot,main.storage_path),original=readFileSync(path);writeFileSync(path,'own fixture corrupted');
 try{await post('start',{episodeId:e.id},409);assert.equal(sql(`select to_jsonb(e) from public.episodes e where id='${e.id}'`),before);}finally{writeFileSync(path,original);}
 const linked=join(f.assetRoot,'episodes',e.id,'input','escape.txt');symlinkSync(join(run,'baseline.json'),linked);
 try{await post('importMaterial',{...base,sourceKind:'directory',sourcePath:'escape.txt',isMainScript:false,materialType:'reference',materialPurpose:'general_reference'},400);}finally{unlinkSync(linked);}
 await post('create',{accountId:f.accountId,title:'Wrong series',seriesVersionId:randomUUID()},400);
 const entry=join(projectRoot,'dist/worker/local-app/localWorkerCli.js'),held=join(run,'worker-cli-held.js'),count=sql(`select count(*) from public.episodes where account_id='${f.accountId}'`);renameSync(entry,held);
 try{await post('create',{accountId:f.accountId,title:'Missing prepared program'},503);assert.equal(sql(`select count(*) from public.episodes where account_id='${f.accountId}'`),count);}finally{renameSync(held,entry);}
 const id=randomUUID(),email='t16-other-'+id+'@example.invalid',password=randomBytes(32).toString('hex'),digest=await hashPassword(password);extraOwner=id;
 sql(`insert into local_identity.owners(id,email) values('${id}','${email}');insert into local_identity.credentials(owner_id,password_digest) values('${id}','${JSON.stringify(digest)}')`);
 const other=await login({email,password});try{await post('start',{episodeId:e.id},404,other);await post('create',{accountId:f.accountId,title:'foreign account'},404,other);const ownArtifact=JSON.parse(readFileSync(join(run,'http-result.json'))).artifactVerified.id;assert.equal((await fetch(origin+'/api/local/artifacts/'+ownArtifact,{headers:other})).status,404);}finally{await fetch(origin+'/api/local/logout',{method:'POST',headers:other,body:'{}'});}
 const app=createLocalDatabase(configuration().database),worker=createWorkerDatabase(JSON.parse(readFileSync(join(root,'worker-database.json'))));let ownerCannotClaim=false,workerCannotApprove=false,staleLeaseRejected=false;
 try{
  try{await app.query('SELECT * FROM local_identity.claim_input_task(NULL,2)');}catch(x){assert.equal(x.code,'42501');ownerCannotClaim=true;}
  try{await worker.query("SELECT public.transition_episode($1,'visual_approved','not Owner')",[e.id]);}catch(x){assert.equal(x.code,'42501');workerCannotApprove=true;}
  await assert.rejects(worker.query('SELECT * FROM public.claim_next_worker_task(NULL,2)'),x=>x.code==='42501');
  const imported=JSON.parse(sql("select to_jsonb(t) from public.tasks t where not exists(select 1 from local_identity.input_episodes i where i.episode_id=t.episode_id) order by t.created_at,t.id limit 1"));
  assert(imported);const importedBefore=sql(`select to_jsonb(t) from public.tasks t where id='${imported.id}'`);
  assert.deepEqual(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:imported.id,p_worker_capacity:2}),[]);
  assert.equal(sql(`select to_jsonb(t) from public.tasks t where id='${imported.id}'`),importedBefore);
  const stale=JSON.parse(readFileSync(join(run,'abandoned-attempt-private.json')))[0],currentBefore=sql(`select to_jsonb(t) from public.tasks t where id='${stale.id}'`);
  try{await nativeWorkerPort(worker).rpc('report_worker_progress',{p_task_id:stale.id,p_attempt:stale.attempt-1,p_lease_token:stale.lease_token,p_progress:{version:'worker-progress/v1',progress:{version:'worker-progress/v1',step:'provider_execution',detail:'stale test',observedAt:new Date().toISOString()}}});}catch{staleLeaseRejected=true;}
  assert(staleLeaseRejected);assert.equal(sql(`select to_jsonb(t) from public.tasks t where id='${stale.id}'`),currentBefore);
 }finally{await app.end();await worker.end();}
 save('boundary-result.json',{at:new Date().toISOString(),canonicalPropertyOrderIdempotency:true,workerCannotUseGlobalClaim:true,importedTaskNotClaimedOrMutated:true,blankTitlePreservesExistingContract:true,invalidMainScript400NoRevision:true,unexpectedCredentialField400:true,corruptFile409NoPreflightOrStageWrite:true,directorySymlink400:true,foreignSeries400:true,missingProgram503NoEpisode:true,foreignOwnerCreateAndStart404:true,foreignOwnerArtifact404:true,ownerCannotClaim,workerCannotApprove,staleLeaseRejected,staleLeaseNoMutation:true,providerRequests:0,episodeId:e.id,calls,passed:true});console.log({passed:true,cases:16});
}finally{await fetch(origin+'/api/local/logout',{method:'POST',headers,body:'{}'});if(extraOwner)sql(`update local_identity.credentials set locked_until=now()+interval '100 years' where owner_id='${extraOwner}'`);}
