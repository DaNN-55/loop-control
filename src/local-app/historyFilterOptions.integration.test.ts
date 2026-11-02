// @vitest-environment node
import {randomBytes,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {productionWorkspaceMigrations} from './productionWorkspace.fixture';
import {readHistory} from './history';
import {readHistoryEpisodes} from './historyEpisodes';
it('counts history scopes and source categories before search and pagination within the Owner boundary',async()=>{
 const f=await nativeWorkspaceFixture({migrations:productionWorkspaceMigrations});
 try{
  const source=randomBytes(32).toString('hex'),otherSource=randomBytes(32).toString('hex');
  await f.c.query("INSERT INTO local_identity.history_sources(id,owner_id,kind,label) VALUES($1,$2,'ordinary-template-configuration','模板'),($3,$4,'media','素材')",[source,f.owner,otherSource,f.other]);
  for(let n=0;n<32;n++){
   const episode=randomUUID(),sha=randomBytes(32).toString('hex');
   await f.c.query("INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES('public.episodes',$1,$2,$3,$4)",[{id:episode},sha,f.owner,{id:episode,title:'留存 '+n}]);
   await f.c.query("INSERT INTO local_identity.history_files(source_id,logical_path,sha256,bytes,kind) VALUES($1,$2,$3,1,'text')",[source,'episodes/'+episode+'/script.md',sha]);
   if(n===31)await f.c.query('INSERT INTO local_identity.history_episode_preferences(owner_id,episode_id,archived_at) VALUES($1,$2,now())',[f.owner,episode]);
  }
  const first=await readHistoryEpisodes(f.pool,f.owner,new URLSearchParams());expect(first.items).toHaveLength(30);expect(first.scopeCounts).toEqual({active:31,archived:1});
  const queries:Record<string,string>[]=[{page:'2'},{q:'无匹配'},{state:'archived'}];
  for(const params of queries)expect((await readHistoryEpisodes(f.pool,f.owner,new URLSearchParams(params))).scopeCounts).toEqual(first.scopeCounts);
  expect((await readHistoryEpisodes(f.pool,f.other,new URLSearchParams())).scopeCounts).toEqual({active:0,archived:0});
  const sources=await readHistory(f.pool,f.owner,new URLSearchParams({sourcesQ:'无匹配'}));expect(sources.sources).toEqual([]);expect(sources.categoryCounts).toEqual({business:0,configuration:1,diagnostics:0});
  expect((await readHistory(f.pool,f.other,new URLSearchParams())).categoryCounts).toEqual({business:1,configuration:0,diagnostics:0});
 }finally{await f.close();}
},60000);
