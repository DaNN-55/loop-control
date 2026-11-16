// @vitest-environment node
import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {narrationFixture} from './workspaceNarration.fixture';
it.skipIf(process.env.LOOP_FIRST_BATCH_BROWSER!=='1')('first batch controls use real isolated Owner data',async()=>{
 const f=await narrationFixture(undefined,undefined,false,true);let vite:import('vite').ViteDevServer|undefined;
 const evidence=join(process.cwd(),'.scratch/first-batch-20261109'),entry=join(evidence,'entry.tsx');
 try{
  await mkdir(evidence,{recursive:true});await rm(join(evidence,'browser-done.json'),{force:true});
  const board=JSON.parse(await readFile(join(f.assetRoot,f.boardPath),'utf8'));for(const shot of board.shots)shot.durationSeconds=5;
  const bytes=Buffer.from(JSON.stringify(board));await writeFile(join(f.assetRoot,f.boardPath),bytes);
  await f.c.query('UPDATE public.artifacts SET sha256=$2,file_size=$3 WHERE episode_id=$1 AND relative_path=$4',[f.episode,createHash('sha256').update(bytes).digest('hex'),bytes.length,f.boardPath]);
  await f.c.query('UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1',[f.board,{worker_result:{storyboard:board}}]);
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;expect(w.id).toBeTruthy();
  const image=join(f.root,'still.png');execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=green:s=360x640','-frames:v','1',image]);
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'first-batch-still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(image)).toString('base64')});expect(imported.status).toBe(200);
  for(const clip of [...w.clips]){
   w=(await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:clip.itemId,materialRevisionId:imported.body.id,usage:'still',durationSeconds:5})).body;
   const candidate=w.visualCandidates.find((v:any)=>v.targetItemId===clip.itemId&&v.status==='available');
   const prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target',imageUsage:'still'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
   const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;
  }
  w=(await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,materialRevisionId:f.material,usage:'video'})).body;
  await f.authorize();const base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  expect((await f.request('saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'核对本次请求。'})).status).toBe(200);
  expect((await f.request('confirmWorkspaceNarration',base)).status).toBe(200);
  w=(await f.request('generateWorkspaceNarration',{...base,reservationCents:100})).body;await writeFile(f.responseMode,'unknown');await f.execute(w.narration[0].taskId);
  await writeFile(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{ProductionWorkspacePanel}from'/src/local-app/ProductionWorkspacePanel';import{localCommand}from'/src/local-app/client';import '/src/styles.css';import '/src/ui/impeccable/foundation.css';import '/src/ui/impeccable/production.css';import '/src/ui/impeccable/scroll-layout.css';document.documentElement.dataset.interface='impeccable';createRoot(document.getElementById('root')!).render(<main className="dan-ui product-ui" style={{height:'100vh',padding:24,display:'flex',flexDirection:'column',boxSizing:'border-box',overflow:'auto'}}><ProductionWorkspacePanel episodeId=${JSON.stringify(f.episode)} title="第一批体验验收" scriptRevisionId=${JSON.stringify(f.script)} boardId=${JSON.stringify(f.board)} materials={[]} command={(name,data)=>localCommand(name,data,undefined,'episode-commands')} onLegacy={()=>{}}/></main>);`);
  const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>{req.setHeader('origin',f.origin);req.setHeader('cookie','loop_owner_session='+f.token);});}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'first-batch-acceptance',configureServer(s){s.middlewares.use('/__first_batch',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__first_batch','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>第一批验收</title><div id="root"></div><script type="module" src="/.scratch/first-batch-20261109/entry.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  const address=vite.httpServer!.address() as {port:number};await writeFile(join(evidence,'browser.json'),JSON.stringify({url:`http://127.0.0.1:${address.port}/__first_batch`}));
  let done=false;for(let i=0;i<600;i++){try{done=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8')).passed===true;if(done)break;}catch{}await pause(1000);}expect(done).toBe(true);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  await writeFile(join(evidence,'browser-result.json'),JSON.stringify({passed:true,isolated:true,providerCalls:0,controlledSubmissions:1}));
 }finally{await vite?.close();await f.close();await rm(entry,{force:true});}
},660000);
