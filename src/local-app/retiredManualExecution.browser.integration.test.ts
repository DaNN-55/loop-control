// @vitest-environment node
import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {embeddedStudioFixture} from './embeddedStudio.fixture';

it.skipIf(process.env.LOOP_RETIREMENT_BROWSER!=='1')('real browser keeps a live Owner catalog usable through slow and failed connections, retries, refresh and retired HTTP',async()=>{
 const f=await embeddedStudioFixture(),exec=promisify(execFile),session='retirement-fix-'+randomUUID(),output=process.env.LOOP_ACCEPTANCE_OUTPUT!;
 let vite:ViteDevServer|undefined,mode:'held'|'failed'|'healthy'='held',release:()=>void=()=>{},reads=0;
 const browser=async(...args:string[])=>(await exec('agent-browser',['--session',session,...args],{timeout:40000,maxBuffer:2_000_000})).stdout;
 try{
  await mkdir(output,{recursive:true});
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},optimizeDeps:{entries:[]},plugins:[react(),{name:'retirement-browser',configureServer(s){
   s.middlewares.use('/api/local/connections',(_req,res)=>{reads++;const send=()=>{if(res.writableEnded||res.destroyed)return;res.setHeader('Content-Type','application/json');res.statusCode=mode==='failed'?503:200;res.end(JSON.stringify(mode==='failed'?{error:'隔离连接读取故障'}:{connections:[],versions:[]}));};if(mode==='held')release=send;else send();});
   s.middlewares.use('/__retirement',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__retirement','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});
  }}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  await browser('open',`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__retirement`);
  await browser('wait','--text','登录控制台');await browser('find','label','邮箱','fill',f.email);await browser('find','label','密码','fill',f.password);await browser('find','role','button','click','--name','使用密码登录','--exact');
  await browser('wait','--fn',"!!document.querySelector('[aria-label=主导航]')");expect(reads).toBeGreaterThan(0);
  await writeFile(join(output,'slow-connections-snapshot.txt'),await browser('snapshot'));
  mode='failed';release();await browser('wait','--text','重新读取连接');
  expect(await browser('eval',"!!document.querySelector('[aria-label=主导航]')")).toContain('true');
  for(const width of [1440,390]){await browser('set','viewport',String(width),'1000');await browser('screenshot',join(output,`connection-failure-${width}.png`),'--full');expect(await browser('eval','document.documentElement.scrollWidth<=innerWidth')).toContain('true');}
  mode='healthy';await browser('find','role','button','click','--name','重新读取连接','--exact');await browser('wait','--fn',"!document.body.textContent.includes('隔离连接读取故障')");
  const retired=await browser('eval',`(async()=>{const session=await(await fetch('/api/local/session')).json();const response=await fetch('/api/local/episode-commands',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({command:'planMedia',idempotencyKey:crypto.randomUUID(),data:{episodeId:${JSON.stringify(f.episode)}}})});return {status:response.status,error:(await response.json()).error};})()`);
  expect(retired).toContain('410');await writeFile(join(output,'retired-http.txt'),retired);
  await browser('reload');await browser('wait','--fn',"!!document.querySelector('[aria-label=主导航]')");await writeFile(join(output,'final-snapshot.txt'),await browser('snapshot'));await writeFile(join(output,'errors.txt'),await browser('errors'));
 }finally{mode='healthy';release();await browser('close').catch(()=>{});await vite?.close();await f.close();}
},120000);
