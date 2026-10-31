// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,rename,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {ownerTransaction} from './ownerTransaction';
import {episodeFileIO} from './episodeFiles';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
it.skipIf(!enabled)('Owner moves an order from A to B without changing its frozen creative series or original material reference',async()=>{
 const volume=await workspaceAudioVolume(),f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath},migrations:['db/local/123-legacy-storage-adoption.sql','db/local/124-episode-collection-moves.sql']});
 try{
  const post=async(route:string,command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/'+route,{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const a=await post('configuration','createSeries',{accountId:account,name:'系列 A',rules:{positioning:'原始创作规则'}}),b=await post('configuration','createSeries',{accountId:account,name:'系列 B',rules:{positioning:'另一套规则'}});
  expect(a.status,JSON.stringify(a.body)).toBe(200);expect(b.status,JSON.stringify(b.body)).toBe(200);
  const created=await post('episode-commands','create',{accountId:account,title:'往返收纳',seriesVersionId:a.body.id});expect(created.status,JSON.stringify(created.body)).toBe(200);const episode=created.body.id;
  const script=productionScriptTemplate;
  const imported=await post('episode-commands','importMaterial',{episodeId:episode,sourceKind:'file',sourcePath:'main.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(script).toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  const old=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[episode])).rows[0],original=await readFile(join(old.asset_root,imported.body.storage_path));
  const before=(await f.c.query('SELECT to_jsonb(e) value FROM public.episodes e WHERE id=$1',[episode])).rows;
  const plan=await post('account-commands','planEpisodeCollectionMove',{episodeId:episode,seriesId:b.body.series_id});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.conflicts).toEqual([]);
  const result=await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:plan.body.id});if(result.status!==200)console.error((await f.c.query('SELECT error FROM local_identity.account_directory_migrations WHERE id=$1',[plan.body.id])).rows);expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.status).toBe('completed');
  const location=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[episode])).rows[0];expect(location.storage_series_id).toBe(b.body.series_id);expect(location.directory_relative_path).not.toBe(old.directory_relative_path);expect((await lstat(join(old.asset_root,old.directory_relative_path))).ino.toString()).toBe(old.directory_inode_id);
  expect((await f.c.query('SELECT to_jsonb(e) value FROM public.episodes e WHERE id=$1',[episode])).rows).toEqual(before);
  await rename(join(old.asset_root,old.directory_relative_path),join(old.asset_root,old.directory_relative_path+'.offline'));await f.restart();
  const preview=await fetch(f.origin+'/_local-artifact?episode='+episode+'&path='+encodeURIComponent(imported.body.storage_path)+'&sha256='+imported.body.sha256,{headers:{Cookie:'loop_owner_session='+f.token}});expect(preview.status).toBe(200);expect(Buffer.from(await preview.arrayBuffer())).toEqual(original);
  const listed=await fetch(f.origin+'/api/local/catalog?view=episodes&accountId='+account+'&seriesId='+b.body.series_id,{headers:{Cookie:'loop_owner_session='+f.token}});expect(listed.status).toBe(200);expect((await listed.json()).episodes.map((e:{id:string})=>e.id)).toContain(episode);
  const positions=[old.directory_relative_path,location.directory_relative_path];
  for(const seriesId of [null,a.body.series_id,b.body.series_id]){
   const planned=await post('account-commands','planEpisodeCollectionMove',{episodeId:episode,seriesId});expect(planned.status,JSON.stringify(planned.body)).toBe(200);expect(planned.body.conflicts).toEqual([]);
   const moved=await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:planned.body.id});expect(moved.status,JSON.stringify(moved.body)).toBe(200);
   const current=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[episode])).rows[0];expect(current.storage_series_id).toBe(seriesId);expect(positions).not.toContain(current.directory_relative_path);positions.push(current.directory_relative_path);
   const previous=positions.at(-2)!;await rename(join(old.asset_root,previous),join(old.asset_root,previous+'.offline'));await f.restart();
   const response=await fetch(f.origin+'/_local-artifact?episode='+episode+'&path='+encodeURIComponent(imported.body.storage_path)+'&sha256='+imported.body.sha256,{headers:{Cookie:'loop_owner_session='+f.token,Range:'bytes=0-31'}});expect(response.status).toBe(206);expect(Buffer.from(await response.arrayBuffer())).toEqual(original.subarray(0,32));
   const catalog=await fetch(f.origin+'/api/local/catalog?view=episodes&accountId='+account+'&seriesId='+(seriesId??'unassigned'),{headers:{Cookie:'loop_owner_session='+f.token}});expect(catalog.status).toBe(200);const body=await catalog.json();expect(body.episodes.map((e:{id:string})=>e.id)).toContain(episode);expect(body.collections[episode].seriesId).toBe(seriesId);
   expect((await f.c.query('SELECT to_jsonb(e) value FROM public.episodes e WHERE id=$1',[episode])).rows).toEqual(before);
   expect((await f.c.query('SELECT local_identity.episode_current_reference($1,$2) path',[episode,imported.body.storage_path])).rows[0].path).toBe(current.directory_relative_path+imported.body.storage_path.slice(old.directory_relative_path.length));
   await ownerTransaction(f.pool,f.owner,true,async c=>{const io=await episodeFileIO(c,current.asset_root,episode);expect(await io.assertFrozenDirectory(old.directory_relative_path,{deviceId:old.directory_device_id,inodeId:old.directory_inode_id},old.asset_root)).toBe(join(current.asset_root,current.directory_relative_path));});
   expect((await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:plan.body.id})).status).toBe(200);
  }
 }finally{await f.close();await volume.close();}
},120000);
