// @vitest-environment node
import {it,expect} from 'vitest';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {retirementFixture} from './retirementAcceptance.fixture';
import {deletionFixtureFingerprint} from './deletionFingerprint.fixture';
const enabled=process.env.LOOP_ACCOUNT_DELETION_ACCEPTANCE==='1';
it.skipIf(!enabled)('retires history HTTP and commands while current catalog, search, connection and cleanup APIs remain available',async()=>{
 const f=await retirementFixture();try{
  const headers={Cookie:'loop_owner_session='+f.token},before=await deletionFixtureFingerprint(f.root),records=(await f.c.query('SELECT count(*)::int n FROM local_identity.command_receipts')).rows[0].n;
  for(const path of ['history','history-episodes','history-file?sha='+'a'.repeat(64),'history-management','history-episode-management'])expect((await fetch(f.origin+'/api/local/'+path,{headers})).status,path).toBe(404);
  for(const endpoint of ['history-management','history-episode-management']){const rejected=await f.postCurrent(endpoint,'preview',{sourceId:'a'.repeat(64)});expect(rejected.status).toBe(405);expect(rejected.body.error).toBe('该本地命令尚未开放。');}
  for(const command of ['planHistoryDeletion','deleteHistoryEpisode'])expect((await f.postCurrent('episode-lifecycle',command,{episodeId:f.episode})).status).toBe(400);
  for(const path of ['catalog?view=episodes','workspace-search?q=Studio','connections','deletion-cleanups'])expect((await fetch(f.origin+'/api/local/'+path,{headers})).status,path).toBe(200);
  expect(await deletionFixtureFingerprint(f.root)).toEqual(before);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.command_receipts')).rows[0].n).toBe(records);
 }finally{await f.close();}
},300000);
it.skipIf(!enabled)('finishes existing history receipts, preserves new references and changed files, and retains Owner isolation',async()=>{
 const f=await retirementFixture();try{
  const [exclusive,referenced,changed]=f.receipts;
  expect((await f.postCurrent('episode-lifecycle','retryDeletionCleanup',{deletionKey:exclusive.key},f.otherToken)).status).toBe(404);
  const done=await f.postCurrent('episode-lifecycle','retryDeletionCleanup',{deletionKey:exclusive.key});expect(done.status,JSON.stringify(done.body)).toBe(200);expect(done.body.cleanupPending).toBe(false);expect(existsSync(exclusive.path)).toBe(false);expect((await f.postCurrent('episode-lifecycle','retryDeletionCleanup',{deletionKey:exclusive.key})).body.cleanupPending).toBe(false);
  const keep=await f.postCurrent('episode-lifecycle','retryDeletionCleanup',{deletionKey:referenced.key});expect(keep.status,JSON.stringify(keep.body)).toBe(200);expect(keep.body.cleanupPending).toBe(false);expect((await readFile(referenced.path)).toString()).toBe(referenced.content);
  const pending=await f.postCurrent('episode-lifecycle','retryDeletionCleanup',{deletionKey:changed.key});expect(pending.status).toBe(200);expect(pending.body.cleanupPending).toBe(true);expect((await readFile(changed.path)).toString()).toBe('changed legacy file');expect(pending.body.message).toContain('历史文件已变化');
  const visible=await fetch(f.origin+'/api/local/deletion-cleanups',{headers:{Cookie:'loop_owner_session='+f.token}});expect((await visible.json()).map((x:any)=>x.cleanupKey)).toEqual([changed.key]);
 }finally{await f.close();}
},300000);
