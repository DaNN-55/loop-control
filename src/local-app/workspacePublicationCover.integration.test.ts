// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('persists upload and actual decoded-frame covers with safe identity, byte downloads, refresh and replacement failures',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const endpoint=`episodes/${f.episode}/publication`,bytes=await readFile(workspaceTestMedia('still-striped.png'));
  const upload=await f.post(endpoint,'cover',{expectedRevision:0,kind:'upload',name:'上传封面.png',base64:bytes.toString('base64')});expect(upload.status,JSON.stringify(upload.body)).toBe(200);expect(upload.body.cover.file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  const initial=upload.body;
  const file=await fetch(f.origin+'/_local-artifact?'+new URLSearchParams({episode:f.episode,path:initial.cover.file.relativePath,sha256:initial.cover.file.sha256}),{headers:{Cookie:'loop_owner_session='+f.token}});expect(file.status).toBe(200);expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
  for(const [name,base64]of [['empty.png',''],['wrong.jpg',bytes.toString('base64')],['broken.png',Buffer.from('fake image').toString('base64')]])expect((await f.post(endpoint,'cover',{expectedRevision:1,kind:'upload',name,base64})).status).toBe(400);
  await f.restart();const read=async()=>{const r=await fetch(f.origin+'/api/local/'+endpoint,{headers:{Cookie:'loop_owner_session='+f.token}});return r.json();};expect((await read()).cover).toEqual(initial.cover);
  for(const clip of w.clips){const r=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});expect(r.status).toBe(200);w=r.body;}
  w=(await f.request('exportWorkspace',{workspaceId:w.id,expectedRevision:w.revision})).body;expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');const video=w.exports[0];
  const selected=await f.post(endpoint,'cover',{expectedRevision:1,kind:'frame',exportId:video.id,videoSha256:video.artifact.sha256,timeSeconds:0.5});expect(selected.status,JSON.stringify(selected.body)).toBe(200);expect(selected.body.cover.source).toEqual({kind:'frame',exportId:video.id,videoSha256:video.artifact.sha256,timeSeconds:0.5});
  expect((await readFile(join(f.assetRoot,selected.body.cover.file.relativePath))).subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  expect((await f.post(endpoint,'cover',{expectedRevision:2,kind:'frame',exportId:video.id,videoSha256:video.artifact.sha256,timeSeconds:999999})).status).toBe(400);expect((await read()).cover).toEqual(selected.body.cover);
  const material=await f.request('importMaterial',{sourceKind:'file',sourcePath:'existing.png',materialType:'image',materialPurpose:'cover',mimeType:'image/png',isMainScript:false,contentBase64:bytes.toString('base64')});expect(material.status,JSON.stringify(material.body)).toBe(200);
  const record=(await f.c.query("SELECT id,sha256 FROM public.production_material_revisions WHERE episode_id=$1 AND material_purpose='cover'",[f.episode])).rows[0];
  const existing=await f.post(endpoint,'cover',{expectedRevision:2,kind:'existing',source:{version:'workspace-cover-source/v1',kind:'material',id:record.id,sha256:record.sha256}});expect(existing.status,JSON.stringify(existing.body)).toBe(200);expect(existing.body.cover.source.kind).toBe('existing');expect(existing.body.cover.file.sha256).toBe(record.sha256);
  expect((await f.post(endpoint,'cover',{expectedRevision:0,kind:'upload',name:'封面.png',base64:bytes.toString('base64')})).status).toBe(409);
 }finally{await f.close();}
},120000);
