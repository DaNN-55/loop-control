import {saveHistoricalPlanFixture} from './historicalSavedPlan.fixture';
// @vitest-environment node
import {expect,it} from 'vitest';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {historicalProductionScriptV2} from '../reviews/productionScript.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('keeps the saved v2 plan readable as an immutable snapshot after the current script becomes v3',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:historicalProductionScriptV2});
 try{
  const saved=await saveHistoricalPlanFixture(f);expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  const get=async(token=f.token)=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/saved-plan`,{headers:{Cookie:'loop_owner_session='+token}});return{status:r.status,body:await r.json()};};
  const original=await get();expect(original.status).toBe(200);expect(original.body.plan).toEqual(saved.body.plan);
  const revised=await f.send('reconfirmScript',{expectedScriptRevisionId:f.main,text:productionScriptTemplate,reason:'保存计划保留原版，当前主脚本改用v3'});expect(revised.status,JSON.stringify(revised.body)).toBe(200);
  const record=async()=> (await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.newEpisode])).rows[0].value;
  const before=await record(),read=await get();expect(read.status).toBe(200);expect(read.body.plan).toEqual(saved.body.plan);
  expect(read.body).toMatchObject({readOnly:true,enabled:false,savedScriptRevisionId:f.main,currentScriptRevisionId:revised.body.id,scriptMatchesCurrent:false});
  expect(read.body.planSha256).toMatch(/^[a-f0-9]{64}$/);expect(read.body.planSha256).toBe(original.body.planSha256);
  expect((await get(f.otherToken)).status).toBe(404);expect((await get()).body).toEqual(read.body);expect(await record()).toEqual(before);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('shows the saved declaration without restoring old enablement or treating it as verified executable input',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:historicalProductionScriptV2});
 let file:string|undefined,original:Buffer|undefined;
 try{
  const saved=await saveHistoricalPlanFixture(f);expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect((await f.send('start')).status).toBe(200);
  // Represents an original enabled record; the empty retired scanner cannot run it.
  await f.c.query('UPDATE local_identity.script_productions SET enabled=true,authorized_at=clock_timestamp() WHERE episode_id=$1',[f.newEpisode]);
  const record=async()=> (await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.newEpisode])).rows[0].value;
  const before=await record(),source=(await f.c.query('SELECT storage_path FROM public.production_material_revisions WHERE id=$1',[f.main])).rows[0];
  file=join(f.assetRoot,source.storage_path);original=await readFile(file);await writeFile(file,'A changed source must not become trusted because its plan can be read.');
  const response=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/saved-plan`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const read=await response.json();
  expect(read.plan).toEqual(saved.body.plan);expect(read).toMatchObject({readOnly:true,enabled:false,savedEnabled:true,sourceVerification:'not_checked'});expect(await record()).toEqual(before);
  const rejected=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(rejected.status,JSON.stringify(rejected.body)).toBe(409);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_preparation_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);expect(await record()).toEqual(before);
 }finally{if(file&&original)await writeFile(file,original);await f.close();}
},120000);
