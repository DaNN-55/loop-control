// @vitest-environment node
import {it,expect} from 'vitest';
import {writeFile,mkdir,readFile,rm,copyFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
it.skipIf(process.env.LOOP_T10_BROWSER!=='1')('formal archive and exact deletion confirmation preserve manual files on desktop and narrow views',async()=>{
 const f=await embeddedStudioFixture();let vite:import('vite').ViteDevServer|undefined;
 try{
  const relativePath='系列 中文 %_[] #?/本期 stable',path=join(f.assetRoot,relativePath);await mkdir(path,{recursive:true});const identity=await lstat(path,{bigint:true});
  await f.c.query('UPDATE local_identity.episode_asset_locations SET directory_relative_path=$2,directory_device_id=$3,directory_inode_id=$4,layout_version=2 WHERE episode_id=$1',[f.episode,relativePath,String(identity.dev),String(identity.ino)]);
  const owned=join(path,'owned.mp4'),manual=join(path,'手动保留.txt');await copyFile(join(f.assetRoot,f.videoPath),owned);await writeFile(manual,'manual browser preservation bytes');
  await f.c.query("INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,'render',$3,$4,$5)",[f.episode,f.task,relativePath+'/owned.mp4',f.files[0].sha256,f.files[0].fileSize]);
  const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'t10-fixture',configureServer(s){s.middlewares.use('/__t10',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__t10','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T10 精确删除</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  const evidence=process.env.LOOP_T10_BROWSER_EVIDENCE!;if(!evidence)throw Error('Explicit isolated evidence directory required');await mkdir(evidence,{recursive:true});await rm(join(evidence,'browser-done.json'),{force:true});const address=vite.httpServer!.address() as {port:number};
  await writeFile(join(evidence,'browser.json'),JSON.stringify({url:`http://127.0.0.1:${address.port}/__t10`,email:f.email,password:f.password,path,owned,manual,episodeId:f.episode}));
  let done=false;for(let i=0;i<600;i++){try{done=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8')).passed===true;if(done)break;}catch{}await pause(1000);}expect(done,'External formal browser must confirm archive/cancel/delete checks').toBe(true);
  expect(await readFile(manual,'utf8')).toBe('manual browser preservation bytes');
 }finally{await vite?.close();await f.close();if(process.env.LOOP_T10_BROWSER_EVIDENCE)await rm(join(process.env.LOOP_T10_BROWSER_EVIDENCE,'browser.json'),{force:true});}
},660000);
