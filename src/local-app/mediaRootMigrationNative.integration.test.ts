// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,realpath,rm,rename,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {prepareCollectionTargets,moveCollection} from './episodeCollection.fixture';
import {csrfFor} from './sessions';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
it.skipIf(!enabled)('a real SQLite project and original frozen references are inventoried through adoption and move lineage while an open Studio is a blocker',async()=>{
 const f=await productionWorkspaceFixture({migrations:['db/local/120-native-workspace-storage-locations.sql','db/local/125-global-media-root-plans.sql']}),target=await realpath(await mkdtemp('/private/tmp/loop-root-native-'));
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);w=r.body.productionWorkspace??r.body;return r.body;};
  await send('openWorkspaceStudio');await send('closeWorkspaceStudio');
  const {account,a,adoption}=await prepareCollectionTargets(f);await rename(join(f.assetRoot,f.episodeRelativePath),join(f.assetRoot,f.episodeRelativePath+'.offline'));
  const moved=await moveCollection(f,account,a.series_id);await rename(join(f.assetRoot,adoption.episodes[0].targetPrefix),join(f.assetRoot,adoption.episodes[0].targetPrefix+'.offline'));
  const planned=async()=>{const r=await fetch(f.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'planMigration',path:target,idempotencyKey:randomUUID()})}),plan=await r.json();expect(r.status,JSON.stringify(plan)).toBe(200);return plan;};
  await send('openWorkspaceStudio');const blocked=await planned();expect(blocked.manifest.blockers.some((b:{kind:string})=>b.kind==='studio')).toBe(true);await send('closeWorkspaceStudio');
  const frozen=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows,plan=await planned();expect(plan.manifest.conflicts).toEqual([]);expect(plan.manifest.blockers).toEqual([]);expect(plan.manifest.episodes[0].lineage).toHaveLength(2);expect(plan.manifest.episodes[0].location.relativePath).toBe(moved.episodes[0].targetPrefix);
  const sqlite=plan.manifest.files.find((file:{relativePath:string})=>file.relativePath.endsWith('.sqlite3'));expect(sqlite,JSON.stringify(plan.manifest.files.map((f:{relativePath:string})=>f.relativePath))).toBeTruthy();expect((await readFile(join(sqlite.sourceRoot,sqlite.relativePath))).subarray(0,16).toString()).toBe('SQLite format 3\u0000');
  expect(plan.manifest.references.some((r:{relativePath:string;physicalPath:string})=>r.relativePath===f.videoPath&&r.physicalPath.includes(moved.episodes[0].targetPrefix))).toBe(true);expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows).toEqual(frozen);
 }finally{await f.close();await rm(target,{recursive:true});}
},120000);
