// @vitest-environment node
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readdir,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import {buildOpenChatCutProject} from './openchatcutProject';
import {confirmedTtsRender} from './openchatcutProject.fixture';
import {closeOpenChatCutStudio,openOpenChatCutDraftStudio} from './openchatcutStudio';
const sdk=process.env.OPENCHATCUT_ROOT?.trim();
it.skipIf(!sdk)('reuses real program and Vite dependency output, releasing cache ownership on native shutdown',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loop-studio-program-')),episode=randomUUID(),cache=join(root,'program-cache');
 try{
  const project=buildOpenChatCutProject(confirmedTtsRender(),'loop-control-'+episode),asset=project.assets.find(a=>a.kind==='audio')!.src;
  await mkdir(dirname(join(root,asset)),{recursive:true});await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-y',join(root,asset)]);
  let previous:{bundleMtime:number;depsMtime:number;deps:string}|undefined;
  for(let visit=0;visit<2;visit++){
   const session=await openOpenChatCutDraftStudio(root,episode,project,[asset],'cache-reuse',{root:sdk,nodePath:process.execPath,environment:{PATH:process.env.PATH,HOME:process.env.HOME,LOOP_OPENCHATCUT_PROGRAM_CACHE_DIR:cache}});
   expect((await fetch(new URL('/src/Editor.tsx',session.studioUrl))).status).toBe(200);
   const version=(await readdir(cache)).find(name=>/^[a-f0-9]{64}$/.test(name))!,directory=join(cache,version),metadata=join(directory,'vite/deps/_metadata.json');
   await expect.poll(async()=>JSON.parse(await readFile(metadata,'utf8')).optimized.react,{timeout:15000}).toBeTruthy();
   const observed={bundleMtime:(await stat(join(directory,'render/index.html'))).mtimeMs,depsMtime:(await stat(metadata)).mtimeMs,deps:await readFile(metadata,'utf8')};
   await closeOpenChatCutStudio(episode);
   expect((await readdir(directory)).filter(name=>name.startsWith('.lease-')||name==='.vite-owner')).toEqual([]);
   if(previous)expect(observed).toEqual(previous);
   previous=observed;
  }
 }finally{await closeOpenChatCutStudio(episode);await rm(root,{recursive:true,force:true});}
},120000);
