// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {access,writeFile} from 'node:fs/promises';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';
import {csrfFor} from './sessions';
import {readProductionQuality} from './productionQuality';
import {inspectMediaRoot} from './mediaRootSettings';
const enabled=!!process.env.LOOP_METRICS_TEST_CONTEXT;
async function fixture(){
 const contextPath=process.env.LOOP_METRICS_TEST_CONTEXT;if(!contextPath)throw Error('Explicit isolated metrics context required');
 const {runtimeContext}=await import(contextPath);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Daily environment prohibited');
 // The fixture registers an actual deep media root. Its mount is the real
 // filesystem mount, rather than the deep directory itself (the old default).
 const runtime={mountPath:''};
 return productionWorkspaceFixture({testContextModule:contextPath,runtime,onSetup:async point=>{
  if(point.stage==='directory'&&point.root)runtime.mountPath=(await inspectMediaRoot(point.root)).mountPath;
 }});
}
it.skipIf(!enabled)('persists Owner-selected business quality atomically with creation and revisioned commands without changing generation settings',async()=>{
 const f=await fixture();
 try{
  const post=async(command:string,data:Record<string,unknown>,key=randomUUID(),token=f.token)=>{
   const r=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrfFor(token)},body:JSON.stringify({command,data,idempotencyKey:key})});return{status:r.status,body:await r.json()};
  };
  expect(await readProductionQuality(f.pool,f.owner,f.episode)).toEqual({enabled:false,tier:'unspecified',revision:0});
  expect((await post('setProductionQuality',{episodeId:f.episode,tier:'high',expectedRevision:0})).status).toBe(409);
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const settings=(await f.c.query('SELECT input_snapshot,provider,model,budget_limit_cents,max_attempts FROM public.tasks WHERE id=$1',[f.task])).rows[0];
  const key=randomUUID(),data={episodeId:f.episode,tier:'low',expectedRevision:0};
  const saved=await post('setProductionQuality',data,key);expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body).toEqual({tier:'low',revision:1});
  expect(await post('setProductionQuality',data,key)).toEqual(saved);
  expect((await post('setProductionQuality',{...data,tier:'high'},key)).status).toBe(409);
  expect((await post('setProductionQuality',{...data,tier:'high'})).status).toBe(409);
  await ownerTransaction(f.pool,f.other,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  expect((await post('setProductionQuality',{...data,tier:'high',expectedRevision:1},randomUUID(),f.otherToken)).status).toBe(403);
  expect((await post('setProductionQuality',{...data,tier:'ultra',expectedRevision:1})).status).toBe(400);
  const task=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,provider,model) VALUES($1,$2,'generate_narration','completed','{}','volcengine_tts','seed-tts-2.0')",[task,f.episode]);
  expect((await f.c.query('SELECT tier,revision FROM local_identity.production_metric_task_quality WHERE task_id=$1',[task])).rows[0]).toEqual({tier:'low',revision:1});
  expect((await post('setProductionQuality',{...data,tier:'high',expectedRevision:1})).body).toEqual({tier:'high',revision:2});
  expect((await f.c.query('SELECT tier,revision FROM local_identity.production_metric_task_quality WHERE task_id=$1',[task])).rows[0]).toEqual({tier:'low',revision:1});
  expect(await readProductionQuality(f.pool,f.owner,f.episode)).toEqual({enabled:true,tier:'high',revision:2});
  expect((await f.c.query('SELECT input_snapshot,provider,model,budget_limit_cents,max_attempts FROM public.tasks WHERE id=$1',[f.task])).rows[0]).toEqual(settings);
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const createKey=randomUUID(),created=await post('create',{accountId:account,title:'隔离质量档新建',businessQualityTier:'medium'},createKey);
  expect(created.status,JSON.stringify(created.body)).toBe(200);expect(await readProductionQuality(f.pool,f.owner,created.body.id)).toEqual({enabled:true,tier:'medium',revision:1});
  expect(await post('create',{accountId:account,title:'隔离质量档新建',businessQualityTier:'medium'},createKey)).toEqual(created);
  const defaultCreated=await post('create',{accountId:account,title:'隔离默认质量档'});
  expect(defaultCreated.status,JSON.stringify(defaultCreated.body)).toBe(200);expect(await readProductionQuality(f.pool,f.owner,defaultCreated.body.id)).toEqual({enabled:true,tier:'unspecified',revision:0});
  // A local statistics failure must roll back the new business object and its
  // receipt, without loosening any production or filesystem guard.
  await f.c.query("CREATE FUNCTION local_identity.test_quality_creation_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Controlled quality fact failure';END $$;CREATE TRIGGER test_quality_creation_failure BEFORE INSERT ON local_identity.production_metric_quality_versions FOR EACH ROW EXECUTE FUNCTION local_identity.test_quality_creation_failure()");
  const failedKey=randomUUID();
  try{
   expect((await post('create',{accountId:account,title:'隔离质量档事务回滚',businessQualityTier:'high'},failedKey)).status).toBe(409);
   const intent=(await f.c.query('SELECT episode_id FROM local_identity.episode_creation_intents WHERE idempotency_key=$1',[failedKey])).rows[0];expect(intent?.episode_id).toBeTruthy();
   expect((await f.c.query('SELECT count(*)::int n FROM public.episodes WHERE id=$1',[intent.episode_id])).rows[0].n).toBe(0);
   expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_events WHERE episode_id=$1',[intent.episode_id])).rows[0].n).toBe(0);
   expect((await f.c.query('SELECT count(*)::int n FROM local_identity.command_receipts WHERE idempotency_key=$1',[failedKey])).rows[0].n).toBe(0);
  }finally{await f.c.query('DROP TRIGGER test_quality_creation_failure ON local_identity.production_metric_quality_versions;DROP FUNCTION local_identity.test_quality_creation_failure()');}
  await f.c.query("UPDATE public.episodes SET stage='production_completed' WHERE id=$1",[f.episode]);
  expect((await post('setProductionQuality',{...data,tier:'medium',expectedRevision:2})).status).toBe(409);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled||!process.env.LOOP_METRICS_UI_FIXTURE)('holds a clearly isolated quality fixture for browser verification',async()=>{
 const f=await fixture();
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const output=process.env.LOOP_METRICS_UI_FIXTURE!,stopFile=output+'.stop';
  await writeFile(output,JSON.stringify({origin:f.origin,episodeId:f.episode,ownerId:f.owner,email:f.email,password:f.password,stopFile,dailyRuntime:false},null,2),{mode:0o600});
  const deadline=Date.now()+300000;
  while(Date.now()<deadline){try{await access(stopFile);break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}
 }finally{await f.close();}
},330000);
