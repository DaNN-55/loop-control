// @vitest-environment node
import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {secondBatchWorkspaceFixture} from './secondBatchWorkspace.fixture';
import {registeredAdapters} from '../worker/registeredAdapters';
it.skipIf(process.env.LOOP_SECOND_BATCH_BROWSER!=='1')('second batch script, image and local audio flow through actual Owner HTTP',async()=>{
 const f=await secondBatchWorkspaceFixture();let vite:import('vite').ViteDevServer|undefined;
 const evidence=join(process.cwd(),'.scratch/second-batch-20261109'),entry=join(evidence,'entry.tsx'),calls:Array<{command:string;data:any}>=[];
 try{
  await mkdir(evidence,{recursive:true});await rm(join(evidence,'browser-done.json'),{force:true});
  await f.c.query("UPDATE public.episodes SET main_script_revision_id=null,stage='waiting_input' WHERE id=$1",[f.episode]);await f.c.query('UPDATE public.production_material_revisions SET is_main_script=false WHERE id=$1',[f.script]);
  const image=join(evidence,'local-image.png'),music=join(evidence,'local-music.mp3');
  execFileSync('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=green:s=360x640','-frames:v','1',image]);
  execFileSync('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','sine=frequency=330:duration=12','-c:a','libmp3lame',music]);
  await writeFile(entry,`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ProductionWorkspacePanel}from'/src/local-app/ProductionWorkspacePanel';import{localCommand}from'/src/local-app/client';import '/src/styles.css';import '/src/ui/impeccable/foundation.css';import '/src/ui/impeccable/production.css';import '/src/ui/impeccable/scroll-layout.css';document.documentElement.dataset.interface='impeccable';function App(){const[script,setScript]=useState<string|null>(null),[materials,setMaterials]=useState<any[]>([]);async function command(name:string,data:any){const value:any=await localCommand(name,data,undefined,'episode-commands');if(name==='importMaterial'){setMaterials(rows=>[...rows.filter(m=>m.id!==value.id),value]);if(data.isMainScript)setScript(value.id);}return value;}return <main className="dan-ui product-ui" style={{height:'100vh',padding:24,display:'flex',flexDirection:'column',boxSizing:'border-box',overflow:'auto'}}><ProductionWorkspacePanel episodeId=${JSON.stringify(f.episode)} title="第二批体验验收" scriptRevisionId={script} stage={script?'script_approved':'waiting_input'} materials={materials} command={command} onLegacy={()=>{}}/></main>;}createRoot(document.getElementById('root')!).render(<App/>);`);
  const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
  const choice=registeredAdapters.productionChoices().find(c=>c.capability==='video'&&c.provider==='bailian')!,catalog={groups:[{capability:'video',services:[{...choice,id:'controlled-wan',connectionVersionId:'controlled-wan',connectionName:'受控万相目录',executable:true,models:['wan2.6-i2v','wan2.6-i2v-flash']}]}]};
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>{req.setHeader('origin',f.origin);req.setHeader('cookie','loop_owner_session='+f.token);});}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'second-batch-browser',configureServer(s){s.middlewares.use(async(req,res,next)=>{
   if(req.method==='GET'&&req.url==='/api/local/connections'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({serviceCatalog:catalog}));return;}
   if(req.method!=='POST'||req.url!=='/api/local/episode-commands'){next();return;}
   let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);calls.push({command:value.command,data:{...value.data,contentBase64:undefined}});
   if(['prepareWorkspaceCall','confirmWorkspaceCall','requestWorkspaceVisualCandidate'].includes(value.command))throw Error('Browser flow must not request generation');
   const response=await fetch(f.origin+req.url,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':String(req.headers['x-csrf-token']??'')},body});res.setHeader('Content-Type','application/json');res.statusCode=response.status;res.end(await response.text());
  });s.middlewares.use('/__second_batch',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__second_batch','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>第二批验收</title><div id="root"></div><script type="module" src="/.scratch/second-batch-20261109/entry.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  const address=vite.httpServer!.address() as {port:number};await writeFile(join(evidence,'browser.json'),JSON.stringify({url:`http://127.0.0.1:${address.port}/__second_batch`,image,music}));
  let done=false;for(let i=0;i<600;i++){try{done=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8')).passed===true;if(done)break;}catch{}await pause(1000);}expect(done).toBe(true);
  const used=(await f.c.query('SELECT bindings,project_path FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0],project=JSON.parse(await readFile(join(f.assetRoot,used.project_path),'utf8'));expect(project.timelines.flatMap((t:any)=>t.items).find((i:any)=>i.id===used.bindings[0].itemId).kind).toBe('image');
  expect(calls.filter(c=>c.command==='prepareWorkspaceAudio')).toHaveLength(1);expect(calls.some(c=>c.command==='adoptWorkspaceAudio')).toBe(false);
  expect((await f.c.query('SELECT count(*) FROM local_identity.workspace_audio_preparations WHERE episode_id=$1 AND material_revision_id IS NOT NULL AND task_id IS NULL',[f.episode])).rows[0].count).toBe('1');
  await writeFile(join(evidence,'browser-result.json'),JSON.stringify({passed:true,paidCalls:0,calls},null,2));
 }finally{await vite?.close();await f.close();await rm(entry,{force:true});}
},660000);
