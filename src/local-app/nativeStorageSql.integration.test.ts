// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('effective SQL120 guards use literal owned prefixes and retain fixed publish identities',async()=>{
 const f=await embeddedStudioFixture({episodeRelativePath:()=> '系列 [SQL]_100%/本期 空间',migrations:['db/local/118-visual-storage-locations.sql','db/local/119-audio-caption-storage-locations.sql','db/local/120-native-workspace-storage-locations.sql']});
 try{
  const signatures=['local_identity.scope_input_studio_task(uuid,text,jsonb)','public.generate_shot_review_video(uuid,uuid,jsonb,boolean,text)','public.request_review_render_revision(uuid,jsonb,text)','public.record_publish_input(uuid,text,text,text,bigint)','public.record_publish_package(uuid,text,text,bigint)','local_identity.queue_owned_final_render(uuid)'];
  const definitions=(await f.c.query('SELECT name,pg_get_functiondef(name::regprocedure) definition FROM unnest($1::text[]) name',[signatures])).rows;
  expect(definitions).toHaveLength(6);for(const [i,d] of definitions.entries())expect(d.definition).toContain(i<3?'owned_studio_frozen_reference':'episode_storage_location');
  const ref={relative_path:`${f.episodeRelativePath}/openchatcut-frozen/${randomUUID()}/project.json`,sha256:'a'.repeat(64),file_size:100};
  const owned=async(value:unknown)=>(await f.c.query('SELECT local_identity.owned_studio_frozen_reference($1,$2) allowed',[f.episode,value])).rows[0].allowed;
  expect(await owned(ref)).toBe(true);
  expect(await owned({...ref,relative_path:ref.relative_path.replace('_100%','X100anything')})).toBe(false);
  expect(await owned({...ref,relative_path:`episodes/${randomUUID()}/openchatcut-frozen/${randomUUID()}/project.json`})).toBe(false);
  const old={...ref,relative_path:`episodes/${f.episode}/openchatcut-frozen/${randomUUID()}/project.json`};expect(await owned(old)).toBe(false);
  await f.c.query("INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,'studio_frozen_project',$3,$4,$5)",[f.episode,f.task,old.relative_path,old.sha256,old.file_size]);
  expect(await owned(old)).toBe(true);expect(await owned({...old,sha256:'b'.repeat(64)})).toBe(false);
  await f.c.query("UPDATE public.episodes SET stage='qc_passed' WHERE id=$1",[f.episode]);await f.c.query('UPDATE local_identity.input_episodes SET delivery_enabled=true WHERE episode_id=$1',[f.episode]);
  const cover={artifactType:'cover',relativePath:`${f.episodeRelativePath}/publish-input/cover-v1.png`,sha256:'c'.repeat(64),fileSize:123},metadata={artifactType:'metadata',relativePath:`${f.episodeRelativePath}/publish-input/metadata-v1.json`,sha256:'d'.repeat(64),fileSize:234},pack={relativePath:`${f.episodeRelativePath}/publish-package/manifest.json`,sha256:'f'.repeat(64),fileSize:345};
  // SQL-only registration fixture; real files and Worker are exercised separately.
  for(const artifact of [cover,metadata,{artifactType:'final_render',relativePath:`${f.episodeRelativePath}/final.mp4`,sha256:'e'.repeat(64),fileSize:123},{artifactType:'final_qc_report',relativePath:`${f.episodeRelativePath}/report.json`,sha256:'e'.repeat(64),fileSize:123}])await f.c.query('INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,$4,$5,$6)',[f.episode,f.task,artifact.artifactType,artifact.relativePath,artifact.sha256,artifact.fileSize]);
  await f.c.query('SET SESSION AUTHORIZATION loop_app');await f.c.query("SELECT set_config('loop.owner_id',$1,false)",[f.owner]);
  const complete=(c=cover,m=metadata,p=pack)=>f.c.query('SELECT local_identity.complete_owned_publish($1,$2,$3,$4) result',[f.episode,c,m,p]);
  await expect(complete({...cover,sha256:'b'.repeat(64)})).rejects.toThrow('already fixed');
  await expect(complete({...cover,relativePath:cover.relativePath.replace('_100%','X100anything')})).rejects.toThrow('path is invalid');
  await expect(complete(cover,{...metadata,relativePath:`episodes/${f.episode}/publish-input/metadata-v1.json`})).rejects.toThrow('path is invalid');
  await expect(complete(cover,metadata,{...pack,relativePath:`episodes/${f.episode}/publish-package/manifest.json`})).rejects.toThrow('index is invalid');
  const result=(await complete()).rows[0].result;expect(result.relative_path).toBe(pack.relativePath);expect(result.sha256).toBe(pack.sha256);
  await f.c.query('SET SESSION AUTHORIZATION DEFAULT');
  expect((await f.c.query("SELECT stage FROM public.episodes WHERE id=$1",[f.episode])).rows[0].stage).toBe('production_completed');
  if(process.env.LOOP_T09_EVIDENCE){await mkdir(process.env.LOOP_T09_EVIDENCE,{recursive:true});await writeFile(join(process.env.LOOP_T09_EVIDENCE,'effective-sql120.json'),JSON.stringify(definitions,null,2));}
 }finally{await f.c.query('SET SESSION AUTHORIZATION DEFAULT');await f.close();}
},120000);
