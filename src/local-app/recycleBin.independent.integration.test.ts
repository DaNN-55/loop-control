// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';

const enabled=process.env.LOOP_RECYCLE_ACCEPTANCE==='1';
const fixture=()=>productionWorkspaceFixture({migrations:['db/local/160-episode-recycle-bin.sql']});

it.skipIf(!enabled)('independent recycle: foreign Owner, CSRF and Origin cannot recycle or restore; membership preserves the original graph',async()=>{
 const f=await fixture();
 try{
  const send=(command:string,data:Record<string,unknown>={},options:Parameters<typeof f.post>[3]={})=>f.post('recycle-bin',command,{episodeId:f.episode,...data},options);
  const before=(await f.c.query('SELECT id,account_id,stage,main_script_revision_id,archived_at FROM public.episodes WHERE id=$1',[f.episode])).rows[0];
  const script=await readFile(join(f.assetRoot,f.episodeRelativePath,'script.md'));
  expect((await send('recycleEpisode',{}, {token:f.otherToken})).status).toBe(404);
  expect((await send('recycleEpisode',{}, {csrf:false})).status).toBe(403);
  expect((await send('recycleEpisode',{}, {origin:'https://foreign.example.invalid'})).status).toBe(403);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.episode_recycle_bin')).rows[0].n).toBe(0);
  const moved=await send('recycleEpisode');expect(moved.status,JSON.stringify(moved.body)).toBe(200);
  const revision=moved.body.revision;
  expect((await send('restoreRecycledEpisode',{revision},{token:f.otherToken})).status).toBe(404);
  expect((await ownerTransaction(f.pool,f.other,true,c=>c.query('SELECT episode_id FROM local_identity.episode_recycle_bin'))).rows).toEqual([]);
  expect((await f.c.query('SELECT id,account_id,stage,main_script_revision_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0]).toEqual({id:before.id,account_id:before.account_id,stage:before.stage,main_script_revision_id:before.main_script_revision_id});
  await f.restart();
  const restored=await send('restoreRecycledEpisode',{revision});expect(restored.status,JSON.stringify(restored.body)).toBe(200);
  expect((await f.c.query('SELECT id,account_id,stage,main_script_revision_id,archived_at FROM public.episodes WHERE id=$1',[f.episode])).rows[0]).toEqual(before);
  expect(await readFile(join(f.assetRoot,f.episodeRelativePath,'script.md'))).toEqual(script);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('independent recycle: edited files reject restore and permanent-delete planning without losing membership or bytes',async()=>{
 const f=await fixture();
 try{
  const send=(command:string,data:Record<string,unknown>={})=>f.post('recycle-bin',command,{episodeId:f.episode,...data});
  const path=join(f.assetRoot,f.episodeRelativePath,'script.md'),original=await readFile(path);
  const moved=await send('recycleEpisode');expect(moved.status,JSON.stringify(moved.body)).toBe(200);
  const revision=moved.body.revision;
  const changed=Buffer.from('用户在回收期间改过的脚本，必须保留。');await writeFile(path,changed);
  expect((await send('restoreRecycledEpisode',{revision})).status).toBe(409);
  expect((await send('planRecyclePurge',{revision})).status).toBe(409);
  expect(await readFile(path)).toEqual(changed);
  expect((await f.c.query('SELECT revision FROM local_identity.episode_recycle_bin WHERE episode_id=$1',[f.episode])).rows[0].revision).toBe(revision);
  await writeFile(path,original);
  const restored=await send('restoreRecycledEpisode',{revision});expect(restored.status,JSON.stringify(restored.body)).toBe(200);
  expect(await readFile(path)).toEqual(original);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('independent recycle: capacity is validated at HTTP boundary and stale settings never overwrite the saved limit',async()=>{
 const f=await fixture();
 try{
  const send=(limitBytes:unknown,expectedRevision:unknown)=>f.post('recycle-bin','saveRecycleLimit',{limitBytes,expectedRevision});
  for(const value of [0,99_999_999,1_000_000_000_001,1.5,'5000000000'])expect((await send(value,1)).status).toBe(400);
  const saved=await send(6_000_000_000,1);expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  expect((await send(7_000_000_000,1)).status).toBe(409);
  const settings=(await f.c.query('SELECT limit_bytes,revision FROM local_identity.recycle_bin_settings WHERE owner_id=$1',[f.owner])).rows[0];
  expect(Number(settings.limit_bytes)).toBe(6_000_000_000);expect(Number(settings.revision)).toBe(saved.body.settingsRevision);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.episode_recycle_bin')).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);
