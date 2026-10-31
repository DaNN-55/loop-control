// @vitest-environment node
import {it,expect} from 'vitest';
import {writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
it.skipIf(process.env.LOOP_T01_BROWSER!=='1')('formal list and detail expose the server-resolved full production folder on desktop and narrow windows',async()=>{
 const f=await embeddedStudioFixture();let vite:import('vite').ViteDevServer|undefined;
 try{
  const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'t01-fixture',configureServer(s){s.middlewares.use('/__t01',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__t01','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T01 生产单文件夹</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  const directory=process.env.LOOP_T01_BROWSER_EVIDENCE!;if(!directory)throw Error('Explicit isolated browser evidence directory required');await mkdir(directory,{recursive:true});await rm(join(directory,'browser-done.json'),{force:true});
  const address=vite.httpServer!.address() as {port:number};await writeFile(join(directory,'browser.json'),JSON.stringify({url:`http://127.0.0.1:${address.port}/__t01`,email:f.email,password:f.password,path:join(f.assetRoot,'episodes',f.episode),episodeId:f.episode}));
  await writeFile(join(directory,'browser-session.json'),JSON.stringify({origin:f.origin,path:join(f.assetRoot,'episodes',f.episode),episodeId:f.episode}));
  let done=false;for(let i=0;i<300;i++){try{done=JSON.parse(await readFile(join(directory,'browser-done.json'),'utf8')).passed===true;if(done)break;}catch{}await pause(1000);}expect(done,'External real browser must finish desktop and narrow checks').toBe(true);
 }finally{await vite?.close();await f.close();if(process.env.LOOP_T01_BROWSER_EVIDENCE)await rm(join(process.env.LOOP_T01_BROWSER_EVIDENCE,'browser.json'),{force:true});}
},360000);
