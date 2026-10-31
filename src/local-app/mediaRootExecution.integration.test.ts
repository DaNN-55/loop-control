// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner executes the saved global plan and a fresh native process reads every original artifact from the new root',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/121-restored-media-deployment.sql','db/local/125-global-media-root-plans.sql','db/local/126-global-media-root-execution.sql']}),{f,source,target,configFile}=fixture;
 try{
  let runtime=await fixture.launch();const firstPid=runtime.pid;
  const call=async(command?:string,data:Record<string,unknown>={})=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:command?'POST':'GET',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},...(command?{body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})}:{})});return{status:r.status,body:await r.json()};};
  const original=await readFile(join(f.assetRoot,f.videoPath)),frozen=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows;
  const planned=await call('planMigration',{path:target});expect(planned.status,JSON.stringify(planned.body)).toBe(200);expect(planned.body.manifest.canExecute).toBe(true);
  const newer=await call('planMigration',{path:target});expect(newer.status).toBe(200);expect(newer.body.id).not.toBe(planned.body.id);expect((await call()).body.migration.id).toBe(newer.body.id);
  const executed=await call('executeMigration',{migrationId:planned.body.id});expect(executed.status,JSON.stringify(executed.body)).toBe(200);expect(executed.body.status).toBe('completed');
  const state=(await call()).body;expect(state).toMatchObject({path:target,status:'ready',migration:{id:planned.body.id,status:'completed',manifestSha256:planned.body.manifestSha256,manifest:planned.body.manifest}});
  expect(await readFile(join(target,relative(source,f.assetRoot),f.videoPath))).toEqual(original);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(original);
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows).toEqual(frozen);expect(JSON.parse(await readFile(configFile,'utf8')).mediaRoot).toBe(target);
  await fixture.stop();runtime=await fixture.launch();expect(runtime.pid).not.toBe(firstPid);expect((await call()).body.path).toBe(target);
  const file=f.files[0],artifact=await fetch(runtime.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(file.relativePath)}&sha256=${file.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token,Range:'bytes=0-15'}});expect(artifact.status).toBe(206);expect(Buffer.from(await artifact.arrayBuffer())).toEqual((await readFile(join(f.assetRoot,file.relativePath))).subarray(0,16));
 }finally{await fixture.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('completed root publication permits a later legitimate collection move and fresh native startup',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/121-restored-media-deployment.sql','db/local/125-global-media-root-plans.sql','db/local/126-global-media-root-execution.sql']}),{f,target}=fixture;
 try{
  const {prepareCollectionTargets,collectionOwnerPost}=await import('./episodeCollection.fixture');const {account,a}=await prepareCollectionTargets(f);
  let runtime=await fixture.launch();const call=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})});return{status:r.status,body:await r.json()};};
  const plan=await call('planMigration',{path:target});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.manifest.canExecute).toBe(true);const executed=await call('executeMigration',{migrationId:plan.body.id});expect(executed.status,JSON.stringify(executed.body)).toBe(200);
  const post=collectionOwnerPost({...f,origin:runtime.origin}),move=await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId:a.series_id});expect(move.status,JSON.stringify(move.body)).toBe(200);expect((await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:move.body.id})).status).toBe(200);
  await fixture.stop();runtime=await fixture.launch();
  const artifact=await fetch(runtime.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(f.files[0].relativePath)}&sha256=${f.files[0].sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(artifact.status).toBe(200);
 }finally{await fixture.close();}
},180000);
