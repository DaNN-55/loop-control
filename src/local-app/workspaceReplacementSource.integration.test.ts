// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('registers verified replacement source audio without a task and rejects foreign owners, shots and fingerprints',async()=>{
 const f=await productionWorkspaceFixture();try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status,JSON.stringify(made.body)).toBe(200);const w=made.body;
  const uploaded=await f.request('importMaterial',{materialType:'audio',materialPurpose:'general_reference',sourceKind:'file',sourcePath:'derived-video-audio/replacement.mp3',mimeType:'audio/mpeg',contentBase64:(await readFile(join(f.assetRoot,f.episodeRelativePath,'voice.mp3'))).toString('base64'),isMainScript:false});expect(uploaded.status).toBe(200);
  const material=uploaded.body,args=[w.id,w.clips[0].shotId,material.id,material.sha256,material.file_size,2,f.videoPath,f.files[0].sha256,0,30];
  async function call(owner:string,values:unknown[]){const client=await f.pool.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);const result=await client.query('SELECT local_identity.register_workspace_replacement_source($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id',values);await client.query('COMMIT');return result.rows[0].id;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  const count=(await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n;
  const id=await call(f.owner,args);expect(await call(f.owner,args)).toBe(id);
  expect((await f.c.query('SELECT track_kind,source_task_id,relative_path,sha256,file_size FROM public.audio_tracks WHERE id=$1',[id])).rows[0]).toMatchObject({track_kind:'source',source_task_id:null,relative_path:material.storage_path,sha256:material.sha256,file_size:String(material.file_size)});
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(count);
  await expect(call(f.other,args)).rejects.toMatchObject({code:'42501'});
  for(const patch of [{1:'foreign-shot'},{3:'0'.repeat(64)},{4:Number(material.file_size)+1},{5:0},{7:'0'.repeat(64)},{8:-1},{9:0}]){const bad=[...args];for(const[index,value]of Object.entries(patch))bad[Number(index)]=value;await expect(call(f.owner,bad)).rejects.toMatchObject({code:'22023'});}
  const grants=(await f.c.query("SELECT has_function_privilege('loop_worker','local_identity.register_workspace_replacement_source(uuid,text,uuid,text,bigint,numeric,text,text,numeric,numeric)','EXECUTE') worker,has_function_privilege('loop_anonymous','local_identity.register_workspace_replacement_source(uuid,text,uuid,text,bigint,numeric,text,text,numeric,numeric)','EXECUTE') anonymous")).rows[0];expect(grants).toEqual({worker:false,anonymous:false});
 }finally{await f.close();}
},120000);
