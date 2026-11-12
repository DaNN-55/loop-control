// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retired planning archives retain exact values and are read-only within Owner RLS',async()=>{
 const f=await nativeWorkspaceFixture();try{
  const id=randomUUID(),instructions='只保留历史规划指令';
  await f.c.query('INSERT INTO local_identity.historical_planning_defaults(owner_id,selection,revision) VALUES($1,$2,7)',[f.owner,{provider:'codex',adapter:'codex',model:'historical-model',harnessId:id}]);
  await f.c.query("INSERT INTO local_identity.historical_planning_harnesses(id,owner_id,version,slug,name,summary,instructions,content_hash,created_at) VALUES($1,$2,1,'archived-harness','历史测试','保留原值',$3,$4,'2026-10-01T01:02:03.123456Z')",[id,f.owner,instructions,createHash('sha256').update(instructions).digest('hex')]);
  for(const table of ['historical_planning_defaults','historical_planning_harnesses']){
   const before=(await f.c.query(`SELECT to_jsonb(t) value FROM local_identity.${table} t`)).rows;
   expect((await ownerTransaction(f.pool,f.owner,true,c=>c.query(`SELECT to_jsonb(t) value FROM local_identity.${table} t`))).rows).toEqual(before);
   expect((await ownerTransaction(f.pool,f.other,true,c=>c.query(`SELECT * FROM local_identity.${table}`))).rows).toEqual([]);
   await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query(`DELETE FROM local_identity.${table}`))).rejects.toMatchObject({code:'42501'});
   expect((await f.c.query(`SELECT to_jsonb(t) value FROM local_identity.${table} t`)).rows).toEqual(before);
  }
  expect((await f.c.query("SELECT to_regclass('local_identity.storyboard_planning_defaults') old_defaults,to_regclass('local_identity.storyboard_planning_harnesses') old_harnesses")).rows[0]).toEqual({old_defaults:null,old_harnesses:null});
 }finally{await f.close();}
},120000);
