// @vitest-environment node
import {it,expect} from 'vitest';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

it.skipIf(process.env.LOOP_INTENT_BROWSER!=='1')('browser saves and reopens shot sound intent through the actual Owner HTTP workspace and native editor',async()=>{
 const f=await productionWorkspaceFixture(),evidence=process.env.LOOP_STORY_EVIDENCE!;let app:Awaited<ReturnType<typeof createServer>>|undefined;
 try{
  const w=await f.fillVisuals((await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body);
  const entry=join(process.cwd(),'src/local-app/__soundIntentBrowser.tsx');
  await writeFile(entry,`import{createRoot}from'react-dom/client';import{ProductionWorkspacePanel}from'./ProductionWorkspacePanel';import{localRequest,localCommand}from'./client';import'../styles.css';import'../ui/impeccable/foundation.css';import'../ui/impeccable/production.css';async function start(){await localRequest('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({email:f.email,password:f.password})})});createRoot(document.getElementById('root')!).render(<main className="impeccable-app dan-ui product-ui" style={{padding:20,maxWidth:1440,margin:'auto',height:'100dvh',display:'flex',flexDirection:'column',boxSizing:'border-box'}}><ProductionWorkspacePanel episodeId=${JSON.stringify(f.episode)} title="隔离验证 · 音效意图" scriptRevisionId=${JSON.stringify(f.script)} materials={[]} command={(name,data)=>localCommand(name,data,undefined,'episode-commands')} onLegacy={()=>{}}/></main>);}void start();`);
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  app=await createServer({configFile:false,root:process.cwd(),envFile:false,cacheDir:join(f.root,'vite-cache'),plugins:[react(),{name:'sound-intent-browser',configureServer(server){server.middlewares.use('/__sound-intent',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__sound-intent','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>音效意图验证</title><div id="root"></div><script type="module" src="/src/local-app/__soundIntentBrowser.tsx"></script></html>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await app.listen();
  await writeFile(join(evidence,'browser.json'),JSON.stringify({url:`http://127.0.0.1:${(app.httpServer!.address() as {port:number}).port}/__sound-intent`,episodeId:f.episode,workspaceId:w.id}));
  let done=false;for(let i=0;i<240;i++){try{done=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8')).passed===true;if(done)break;}catch{}await pause(1000);}expect(done,'Browser must finish save, switch, reload and native display verification').toBe(true);
  const restored=(await(await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;
  expect(restored.clips.find((c:any)=>c.shotId===w.clips[0].shotId).soundIntent).toBe('开门时一声轻响，落在切镜点。');expect(restored.audio.preparations).toHaveLength(0);
  await writeFile(join(evidence,'browser-persistence.json'),JSON.stringify({shots:restored.clips.map((c:any)=>({shotId:c.shotId,soundIntent:c.soundIntent})),audioPreparations:restored.audio.preparations.length}));
 }finally{await app?.close();await f.close();}
},300000);
