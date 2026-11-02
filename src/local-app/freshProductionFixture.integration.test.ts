// @vitest-environment node
import {expect,it} from 'vitest';
import {lstat} from 'node:fs/promises';
import {freshProductionFixture} from './freshProduction.fixture';
import type {FixtureSetupPoint} from './nativeWorkspace.fixture';
const enabled=process.env.LOOP_FORMAL_ACCEPTANCE==='1';
async function context(){const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE??new URL('../../scripts/runtime/environment.mjs',import.meta.url).href);return runtimeContext();}
async function released(point:FixtureSetupPoint){
 if(point.database){const c=await context();expect(c.sql(`SELECT count(*) FROM pg_database WHERE datname='${point.database}'`,'postgres')).toBe('0');}
 if(point.root)await expect(lstat(point.root)).rejects.toMatchObject({code:'ENOENT'});
 if(point.mountPath)await expect(lstat(point.mountPath)).rejects.toMatchObject({code:'ENOENT'});
 if(point.origin)await expect(fetch(point.origin+'/api/local/session',{signal:AbortSignal.timeout(1000)})).rejects.toThrow();
}

it.skipIf(!enabled)('the new-order scenario has one real order and no legacy reviews, tasks, media or workspaces',async()=>{
 let point:FixtureSetupPoint={stage:'volume'};
 const f=await freshProductionFixture({blank:true,onSetup:value=>{point={...point,...value};}});
 try{
  expect((await f.c.query('SELECT id,stage,main_script_revision_id FROM public.episodes')).rows).toEqual([{id:f.newEpisode,stage:'waiting_input',main_script_revision_id:null}]);
  for(const table of ['public.tasks','public.artifacts','public.approvals','public.review_packages','public.production_material_revisions','local_identity.production_workspaces'])expect((await f.c.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,table).toBe(0);
  expect((await fetch(f.origin+'/api/local/session',{headers:{Cookie:'loop_owner_session='+f.token}})).status).toBe(200);
 }finally{await f.close();}
 await released(point);
},120000);

it.skipIf(!enabled).each(['volume','database','directory','server','account','episode','script'] as const)('a failure after acquiring %s releases the real test database, files, HTTP listener and private volume',async stage=>{
 let point:FixtureSetupPoint={stage:'volume'},unexpected:Awaited<ReturnType<typeof freshProductionFixture>>|undefined;
 const failure=Error('controlled setup failure: '+stage);
 try{
  await expect(freshProductionFixture({onSetup:value=>{point={...point,...value};if(value.stage===stage)throw failure;}}).then(value=>{unexpected=value;return value;})).rejects.toBe(failure);
 }finally{await unexpected?.close();}
 await released(point);
},120000);

it.skipIf(!enabled)('a real PostgreSQL client release failure does not skip database, listener or volume cleanup',async()=>{
 let point:FixtureSetupPoint={stage:'volume'};
 const f=await freshProductionFixture({blank:true,onSetup:value=>{point={...point,...value};}}),release=f.c.release.bind(f.c),failure=Error('controlled client release failure');
 f.c.release=()=>{release();throw failure;};
 await expect(f.close()).rejects.toMatchObject({errors:[{errors:[failure]}]});
 await released(point);
},120000);
