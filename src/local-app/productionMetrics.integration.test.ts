// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {readProductionMetrics} from './productionMetrics';
import {ownerTransaction} from './ownerTransaction';
const enabled=!!process.env.LOOP_METRICS_TEST_CONTEXT;

it.skipIf(!enabled)('reads a nonempty Owner-scoped snapshot without writes, duplicate joins or fabricated historical facts',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_METRICS_TEST_CONTEXT!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only an explicitly isolated metrics fixture is allowed');
 const f=await productionWorkspaceFixture({testContextModule:process.env.LOOP_METRICS_TEST_CONTEXT});try{
  const prepared=await f.request('prepareWorkspace',{expectedScriptRevisionId:f.script});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);const w=prepared.body;
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const otherAccount=randomUUID(),otherEpisode=randomUUID(),testEpisode=randomUUID(),oldEpisode=randomUUID();
  await f.c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1::uuid,$1::uuid::text,'Metrics other owner','Asia/Shanghai')",[otherAccount]);
  await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[otherAccount,f.other]);
  await f.c.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,'{}',true)",[otherAccount]);
  await f.c.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[otherAccount]);
  await f.c.query("UPDATE public.episodes SET created_at='2025-10-31T16:00:00Z' WHERE id=$1",[f.episode]);
  await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,created_at,is_test) VALUES($1,$2,$2,'Other Owner','2025-11-01T00:00:00Z',false),($3,$4,$4,'Synthetic test','2025-11-01T00:00:00Z',true),($5,$4,$4,'Created outside period','2025-10-01T00:00:00Z',false)",[otherEpisode,otherAccount,testEpisode,account,oldEpisode]);
  async function task(episode:string,kind:string,cost:number,created:string,completed:string){const id=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,input_snapshot,created_at,completed_at,actual_cost_cents) VALUES($1,$2,$3,'completed',CASE WHEN $3='generate_narration' THEN 'volcengine_tts' ELSE 'local' END,CASE WHEN $3='generate_narration' THEN 'seed-tts-2.0' ELSE 'native-delivery' END,'metrics-retained-fixture','{}',$4,$5,$6)",[id,episode,kind,created,completed,cost]);return id;}
  const media=await task(f.episode,'generate_narration',7,'2025-10-31T16:00:00Z','2025-11-01T00:00:30Z');
  for(const [attempt,status,start,end,cost]of [[0,'failed','2025-11-01T00:00:00Z','2025-11-01T00:00:20Z',7],[1,'completed','2025-11-01T00:00:10Z','2025-11-01T00:00:30Z',0]]as const)await f.c.query('INSERT INTO public.task_runs(task_id,attempt,task_package,status,started_at,completed_at,actual_cost_cents) VALUES($1,$2,\'{}\',$3,$4,$5,$6)',[media,attempt,status,start,end,cost]);
  await f.c.query("INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents,created_at) VALUES($1,$2,'narration',100,'2025-11-01T00:00:00Z')",[media,account]);
  const testTask=await task(testEpisode,'generate_narration',99,'2025-11-01T00:00:00Z','2025-11-01T00:00:10Z'),otherTask=await task(otherEpisode,'generate_narration',999,'2025-11-01T00:00:00Z','2025-11-01T00:00:10Z');
  for(const [id,cost]of [[testTask,99],[otherTask,999]]as const)await f.c.query("INSERT INTO public.task_runs(task_id,attempt,task_package,status,started_at,completed_at,actual_cost_cents) VALUES($1,0,'{}','completed','2025-11-01T00:00:00Z','2025-11-01T00:00:10Z',$2)",[id,cost]);
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),exportId=randomUUID();
  await f.c.query("INSERT INTO local_identity.workspace_exports(id,workspace_id,episode_id,project_content_version,content_sha256,project,status,checks,created_by,created_at) VALUES($1,$2,$3,1,$4,$5,'ready','[]',$6,'2025-11-01T00:00:00Z')",[exportId,w.id,f.episode,w.contentSha256,project,f.owner]);
  for(const end of ['2025-11-01T00:01:00Z','2025-11-02T00:01:00Z']){const id=await task(f.episode,'prepare_publish_package',0,'2025-11-01T00:00:00Z',end);await f.c.query("INSERT INTO local_identity.workspace_deliveries(id,workspace_id,episode_id,export_id,task_id,created_at) VALUES($1,$2,$3,$4,$1,'2025-11-01T00:00:00Z')",[id,w.id,f.episode,exportId]);}
  await f.c.query("INSERT INTO local_identity.workspace_candidate_decisions(workspace_id,candidate_id,decision,text_version,main_script_text,input_fingerprint,source_sha256,project_sha256,created_at) VALUES($1,$2,'adopted','Synthetic','Synthetic','synthetic',repeat('a',64),repeat('b',64),'2025-11-01T00:00:00Z')",[w.id,randomUUID()]);
  const digest=async()=> (await f.c.query(`SELECT jsonb_object_agg(name,value) snapshot FROM (SELECT 'tasks' name,md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) value FROM public.tasks t UNION ALL SELECT 'runs',md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.task_runs t UNION ALL SELECT 'reservations',md5(jsonb_agg(to_jsonb(t) ORDER BY task_id)::text) FROM public.paid_generation_reservations t UNION ALL SELECT 'episodes',md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.episodes t UNION ALL SELECT 'decisions',md5(jsonb_agg(to_jsonb(t) ORDER BY workspace_id,candidate_id)::text) FROM local_identity.workspace_candidate_decisions t UNION ALL SELECT 'deliveries',md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM local_identity.workspace_deliveries t UNION ALL SELECT 'receipts',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY owner_id,idempotency_key),'[]'::jsonb)::text) FROM local_identity.command_receipts t)s`)).rows[0].snapshot;
  const before=await digest(),window={from:'2025-11-01',toExclusive:'2025-12-01'},summary=await readProductionMetrics(f.pool,f.owner,window);
  expect(summary.production).toEqual({episodesCreated:1,firstDeliveredEpisodes:1,completedDeliveryJobs:2});expect(summary.attempts.started).toBe(2);expect(summary.time).toMatchObject({recordedRunSlotSeconds:40,recordedRunUnionSeconds:30});expect(summary.money).toMatchObject({grossReservedCentsCreated:100,reservationsCreated:1,reportedPositiveCentsForStartedAttempts:7,unpricedGenerationAttemptsStarted:1,supplierPaidCents:null});expect(summary.candidates.retainedDecisionRecords).toBe(1);
  const repeat=await readProductionMetrics(f.pool,f.owner,window);expect({...repeat,observedAt:summary.observedAt}).toEqual(summary);
  const other=await readProductionMetrics(f.pool,f.other,window);expect(other.production.episodesCreated).toBe(1);expect(other.money.reportedPositiveCentsForStartedAttempts).toBe(999);expect(other.money.grossReservedCentsCreated).toBe(0);
  expect((await readProductionMetrics(f.pool,f.owner,{...window,includeTestEpisodes:true})).money.reportedPositiveCentsForStartedAttempts).toBe(106);
  const worker=f.workerPool();try{await expect(readProductionMetrics(worker,f.owner,window)).rejects.toThrow();}finally{await worker.end();}
  await expect(readProductionMetrics(f.pool,randomUUID(),window)).rejects.toThrow('统计必须使用对应 Owner 的只读事务');
  await expect(ownerTransaction(f.pool,f.owner,true,c=>c.query("UPDATE public.tasks SET model='must-not-write' WHERE id=$1",[media]))).rejects.toMatchObject({code:'25006'});
  expect(await digest()).toEqual(before);
  // Old first delivery must remain outside this month's production count.
  const oldDelivery=await task(f.episode,'prepare_publish_package',0,'2025-10-30T00:00:00Z','2025-10-31T15:59:59Z');
  await f.c.query("INSERT INTO local_identity.workspace_deliveries(id,workspace_id,episode_id,export_id,task_id,created_at) VALUES($1,$2,$3,$4,$1,'2025-10-30T00:00:00Z')",[oldDelivery,w.id,f.episode,exportId]);
  const boundary='2025-11-30T16:00:00Z',boundaryTask=await task(f.episode,'generate_narration',500,boundary,'2025-11-30T16:00:10Z');
  await f.c.query("INSERT INTO public.task_runs(task_id,attempt,task_package,status,started_at,completed_at,actual_cost_cents) VALUES($1,0,'{}','completed',$2,'2025-11-30T16:00:10Z',500)",[boundaryTask,boundary]);
  await f.c.query("INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents,created_at) VALUES($1,$2,'narration',500,$3)",[boundaryTask,account,boundary]);
  const ending=await task(f.episode,'generate_narration',0,'2025-11-30T15:59:50Z',boundary);
  await f.c.query("INSERT INTO public.task_runs(task_id,attempt,task_package,status,started_at,completed_at) VALUES($1,0,'{}','completed','2025-11-30T15:59:50Z',$2)",[ending,boundary]);
  const lastDelivery=await task(f.episode,'prepare_publish_package',0,'2025-11-30T15:59:50Z',boundary);
  await f.c.query("INSERT INTO local_identity.workspace_deliveries(id,workspace_id,episode_id,export_id,task_id,created_at) VALUES($1,$2,$3,$4,$1,'2025-11-30T15:59:50Z')",[lastDelivery,w.id,f.episode,exportId]);
  const boundaryBefore=await digest(),boundarySummary=await readProductionMetrics(f.pool,f.owner,window);
  expect(boundarySummary.production).toEqual({episodesCreated:1,firstDeliveredEpisodes:0,completedDeliveryJobs:2});
  expect(boundarySummary.attempts).toMatchObject({started:3,finished:2});expect(boundarySummary.time).toMatchObject({recordedRunSlotSeconds:50,recordedRunUnionSeconds:40});
  expect(boundarySummary.money).toMatchObject({grossReservedCentsCreated:100,reportedPositiveCentsForStartedAttempts:7});expect(await digest()).toEqual(boundaryBefore);
  if(process.env.LOOP_METRICS_EVIDENCE)await writeFile(join(process.env.LOOP_METRICS_EVIDENCE,'synthetic-summary.json'),JSON.stringify(summary,null,2));
 }finally{await f.close();}
},120000);
