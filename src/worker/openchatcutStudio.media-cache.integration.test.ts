// @vitest-environment node
import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {link,lstat,mkdir,mkdtemp,readFile,readdir,realpath,rm,symlink,unlink,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,extname,join} from 'node:path';
import {promisify} from 'node:util';
import {expect,it,vi} from 'vitest';
import {buildOpenChatCutProject} from './openchatcutProject';
import {confirmedTtsRender} from './openchatcutProject.fixture';
import {closeOpenChatCutStudio,openOpenChatCutDraftStudio} from './openchatcutStudio';

const sdk=process.env.OPENCHATCUT_ROOT?.trim();
if(!sdk)throw Error('Studio media-cache integration requires OPENCHATCUT_ROOT.');
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const fixedTime=new Date('2026-10-01T00:00:00.000Z');

async function mediaFixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'loop-control-studio-media-cache-'))),episodeId=randomUUID();
 const project=buildOpenChatCutProject(confirmedTtsRender(),`loop-control-${episodeId}`),runtime={root:sdk,nodePath:process.execPath};
 const sourceRelativePath=project.assets.find(asset=>asset.kind==='audio')!.src,source=join(root,sourceRelativePath);
 const targetName=createHash('sha256').update(sourceRelativePath).digest('hex').slice(0,20)+extname(sourceRelativePath).toLowerCase();
 const destination=join(root,`episodes/${episodeId}/openchatcut-work/current/runtime/media/uploads`,targetName);
 try{
  await mkdir(dirname(source),{recursive:true});
  await promisify(execFile)('ffmpeg',['-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-y',source]);
  const original=await readFile(source),sourceSha=sha(original);
  const validate=vi.fn(async()=>{expect(sha(await readFile(source))).toBe(sourceSha);});
  return{root,episodeId,source,destination,original,validate,open:()=>openOpenChatCutDraftStudio(root,episodeId,project,[sourceRelativePath],'same-input',runtime,validate),close:()=>closeOpenChatCutStudio(episodeId),cleanup:async()=>{await closeOpenChatCutStudio(episodeId);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};
 }catch(error){await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});throw error;}
}

async function waveform(studioUrl:string,destination:string){
 const url=new URL('/api/waveform',studioUrl);url.searchParams.set('src','/media/uploads/'+basename(destination));
 const response=await fetch(url,{headers:{'Sec-Fetch-Site':'none'}});
 expect(response.status,await response.clone().text()).toBe(200);
 return response.json();
}

it('keeps the real SDK waveform cache key and copied-source mtime across close/reopen when bytes match',async()=>{
 const f=await mediaFixture();
 try{
  const first=await f.open();await utimes(f.destination,fixedTime,fixedTime);
  const before=await lstat(f.destination),body=await waveform(first.studioUrl!,f.destination),preview=join(dirname(f.destination),'.preview');
  const cacheBefore=(await readdir(preview)).filter(name=>name.endsWith('.peaks.json')).sort();
  expect(cacheBefore).toHaveLength(1);
  await f.close();const reopened=await f.open();const after=await lstat(f.destination);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(await waveform(reopened.studioUrl!,f.destination)).toEqual(body);
  expect((await readdir(preview)).filter(name=>name.endsWith('.peaks.json')).sort()).toEqual(cacheBefore);
  expect(f.validate).toHaveBeenCalledTimes(4);
  console.info(JSON.stringify({name:'studio-waveform-reopen-cache',mtimeBefore:before.mtimeMs,mtimeAfter:after.mtimeMs,cacheKeyBefore:cacheBefore[0],cacheKeyAfter:(await readdir(preview)).find(name=>name.endsWith('.peaks.json'))}));
 }finally{await f.cleanup();}
},120_000);

it('repairs different copied bytes even when source and destination have equal size and mtime',async()=>{
 const f=await mediaFixture();
 try{
  await f.open();await f.close();
  const corrupted=Buffer.from(f.original);corrupted[corrupted.length-1]^=1;await writeFile(f.destination,corrupted);
  await utimes(f.source,fixedTime,fixedTime);await utimes(f.destination,fixedTime,fixedTime);
  expect((await lstat(f.source)).size).toBe((await lstat(f.destination)).size);
  expect((await lstat(f.source)).mtimeMs).toBe((await lstat(f.destination)).mtimeMs);
  expect(sha(await readFile(f.destination))).not.toBe(sha(f.original));
  await f.open();expect(await readFile(f.destination)).toEqual(f.original);
  expect(f.validate).toHaveBeenCalledTimes(4);
 }finally{await f.cleanup();}
},120_000);

it.each(['symlink','hardlink'] as const)('still rejects an existing %s media copy before considering content equality',async kind=>{
 const f=await mediaFixture();
 try{
  await f.open();await f.close();await unlink(f.destination);
  if(kind==='symlink')await symlink(f.source,f.destination);else await link(f.source,f.destination);
  await expect(f.open()).rejects.toThrow(kind==='symlink'?'符号链接':'安全普通文件');
  expect(await readFile(f.source)).toEqual(f.original);
 }finally{await f.cleanup();}
},120_000);
