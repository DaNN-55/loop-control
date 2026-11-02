// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner upload rejects disguised media before it becomes available and retains existing files',async()=>{
 const f=await embeddedStudioFixture();
 try{
  const directory=join(f.assetRoot,f.episodeRelativePath),kept=join(directory,'owner-existing.png');
  await writeFile(kept,'Existing owner data must remain');
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'disguised.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:Buffer.from('This is text, not a PNG.').toString('base64')});
  expect(imported.status,JSON.stringify(imported.body)).toBe(400);
  expect(JSON.stringify(imported.body)).toContain('disguised.png');
  const response=await fetch(f.origin+`/api/local/episodes/${f.episode}`,{headers:{Cookie:'loop_owner_session='+f.token}});
  expect(response.status).toBe(200);
  expect((await response.json()).sections.materialRevisions).toEqual([]);
  expect(await readdir(join(directory,'materials'))).toEqual([]);
  expect(await readFile(kept,'utf8')).toBe('Existing owner data must remain');
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner can import genuine media without browser MIME metadata',async()=>{
 const f=await embeddedStudioFixture();
 try{
  const bytes=await readFile(workspaceTestMedia('still-striped.png'));
  const result=await f.request('importMaterial',{sourceKind:'file',sourcePath:'camera.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'',isMainScript:false,contentBase64:bytes.toString('base64')});
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body.mime_type).toBe('image/png');
  expect((await readFile(join(f.assetRoot,result.body.storage_path))).equals(bytes)).toBe(true);
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Media acceptance rejects empty, mislabeled, corrupt, oversized and foreign uploads through Owner HTTP',async()=>{
 const f=await embeddedStudioFixture();
 try{
  const png=await readFile(workspaceTestMedia('still-striped.png')),video=await readFile(workspaceTestMedia('landscape-red-blue.mp4'));
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const wrapped=join(f.root,'png-stream.mkv');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-i',workspaceTestMedia('still-striped.png'),'-c:v','png','-threads','1',wrapped]);
  const base={sourceKind:'file',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false};
  for(const [name,bytes,overrides] of [
   ['empty.png',Buffer.alloc(0),{}],
   ['renamed.jpg',png,{mimeType:'image/jpeg'}],
   ['corrupt.png',png.subarray(0,100),{}],
   ['wrong-mime.png',png,{mimeType:'image/jpeg'}],
   ['video-as-image.png',video,{}],
   ['png-inside-video.png',await readFile(wrapped),{}],
   ['wrong-purpose.png',png,{materialPurpose:'narration'}],
  ] as Array<[string,Buffer,Record<string,unknown>]>) {
   const result=await f.request('importMaterial',{...base,sourcePath:name,contentBase64:bytes.toString('base64'),...overrides});
   expect(result.status,JSON.stringify(result.body)).toBe(400);expect(JSON.stringify(result.body)).toContain(name);
  }
  const foreign=await f.request('importMaterial',{...base,sourcePath:'foreign.png',contentBase64:png.toString('base64')},{token:f.otherToken});expect(foreign.status).toBe(404);
  const absent=await f.request('importMaterial',{...base,episodeId:'11111111-1111-4111-8111-111111111111',sourcePath:'absent.png',contentBase64:png.toString('base64')});expect(absent.status).toBe(404);
  const directory=join(f.assetRoot,f.episodeRelativePath),oversized=join(directory,'input','oversized.png');
  const {open}=await import('node:fs/promises');const file=await open(oversized,'wx');try{await file.truncate(100*1024*1024+1);}finally{await file.close();}
  const large=await f.request('importMaterial',{...base,sourceKind:'directory',sourcePath:'oversized.png'});expect(large.status).toBe(400);expect(JSON.stringify(large.body)).toContain('oversized.png');
  expect(await readdir(join(directory,'materials'))).toEqual([]);
  const response=await fetch(f.origin+`/api/local/episodes/${f.episode}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await response.json()).sections.materialRevisions).toEqual([]);
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Media acceptance keeps genuine still, video, audio and reference documents usable',async()=>{
 const f=await embeddedStudioFixture();
 try{
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),exec=promisify(execFile);
  const source=workspaceTestMedia('still-striped.png');
  const media:Array<[string,string,string,string,Buffer]>=[];
  for(const [extension,mime] of [['jpg','image/jpeg'],['bmp','image/bmp']] as const){const path=join(f.root,'valid.'+extension);await exec('ffmpeg',['-nostdin','-v','error','-i',source,'-frames:v','1',path]);media.push(['valid.'+extension,'image','visual_reference',mime,await readFile(path)]);}
  media.push(['valid.webp','image','visual_reference','image/webp',Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64')]);
  media.push(['valid.png','image','cover','image/png',await readFile(source)],['valid.mp4','video','a_roll','video/mp4',await readFile(workspaceTestMedia('landscape-red-blue.mp4'))],['valid.mp3','audio','background_music','audio/mpeg',await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))],['note.md','script','supplemental_script','text/markdown',Buffer.from('# Supplemental reference')],['reference.pdf','reference','general_reference','application/pdf',Buffer.from('%PDF-1.4\nExisting reference document contract')]);
  const ids:string[]=[];
  for(const [name,materialType,materialPurpose,mimeType,bytes] of media){const result=await f.request('importMaterial',{sourceKind:'file',sourcePath:name,materialType,materialPurpose,mimeType,isMainScript:false,contentBase64:bytes.toString('base64')});expect(result.status,name+JSON.stringify(result.body)).toBe(200);ids.push(result.body.id);const download=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(result.body.storage_path)}&sha256=${result.body.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(download.status).toBe(200);expect(Buffer.from(await download.arrayBuffer()).equals(bytes)).toBe(true);}
  const response=await fetch(f.origin+`/api/local/episodes/${f.episode}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await response.json()).sections.materialRevisions.map((m:{id:string})=>m.id).sort()).toEqual(ids.sort());
 }finally{await f.close();}
},300000);
