// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,writeFile,readFile,rm,rename,copyFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {storyE2eFixture} from './storyE2e.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {inspectMediaRoot} from './mediaRootSettings';

/** Holds a genuinely isolated app while an external agent-browser session performs business UI actions. */
it.skipIf(process.env.LOOP_STORYBOARD_BROWSER!=='1')('novice prepares, edits and delivers an order through the formal interface',async()=>{
 const evidence=process.env.LOOP_STORYBOARD_EVIDENCE;if(!evidence)throw Error('Explicit private evidence directory required');await mkdir(evidence,{recursive:true,mode:0o700});
 const f=await storyE2eFixture({blank:true,scriptOnly:true});let vite:import('vite').ViteDevServer|undefined;
 const runId=randomUUID(),session='storyboard-novice-'+runId.slice(0,8),processed=new Set<string>(),alignmentWorker=f.workerPool();
 const signal=async(name:string,data:unknown)=>{const file=join(evidence,name),temporary=file+'.tmp';await writeFile(temporary,JSON.stringify(data,null,2),{mode:0o600});await rename(temporary,file);};
 try{
  const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},optimizeDeps:{entries:['src/local-app/main.tsx']},plugins:[react(),{name:'novice-formal',configureServer(s){s.middlewares.use('/__novice',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__novice','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>分镜台零基础验收</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  try{await copyFile(join(evidence,'voice.mp3'),f.files.voice);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const scriptPath=join(f.root,'零基础演示.md'),script=productionScriptTemplate.replace('填写本段完整口播。','你好，欢迎看看这把黄色雨伞。').replace('填写已上传图片的素材名称','无');await writeFile(scriptPath,script);
  await signal('browser.json',{runId,session,url:`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__novice?view=episodes&episode=${f.episode}&step=script`,email:f.email,password:f.password,episode:f.episode,account:f.account,files:{...f.files,script:scriptPath},backend:f.origin,fixtureRoot:f.root});
  await signal('ready.json',{runId,session,episode:f.episode,frontend:(vite.httpServer!.address() as {port:number}).port,backend:f.origin,privateDatabase:f.database});console.log('Private novice browser fixture ready');
  let done=false;
  for(let n=0;n<7200;n++){
   try{await readFile(join(evidence,'finish.json'));done=true;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   try{await readFile(join(evidence,'stop.json'));break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   try{await readFile(join(evidence,'restart.json'));await rm(join(evidence,'restart.json'));await f.restart();await signal('restarted.json',{at:Date.now()});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   const tasks=(await f.c.query("SELECT id,task_type FROM public.tasks WHERE episode_id=$1 AND status='ready' ORDER BY created_at",[f.episode])).rows;
   for(const task of tasks){if(processed.has(task.id))continue;processed.add(task.id);try{
    let result;
    if(task.task_type==='align_shot_captions'){
     const cacheDirectory=await realpath(join(process.cwd(),'.loop-control/local/volume/media/whisperx-models'));
     const alignment={python:join(process.cwd(),'scripts/runtime/offline-python'),cacheDirectory,cacheBinding:await inspectMediaRoot(cacheDirectory),runnerSha256:createHash('sha256').update(await readFile('scripts/whisperx-align.py')).digest('hex')};
     const claimed=(await nativeWorkerPort(alignmentWorker).rpc('claim_next_worker_task',{p_task_id:task.id,p_worker_capacity:1}) as any[])[0];expect(claimed?.task_id).toBe(task.id);
     result=await runWorkspaceDeliveryProcess(f,claimed,{mountPath:f.volume.mountPath,alignment});
    }else result=await f.execute(task.id);
    await signal(task.id+'-worker.json',{task,result,lastResult:(await f.c.query('SELECT last_result FROM public.tasks WHERE id=$1',[task.id])).rows[0]});
   }catch(error){await signal(task.id+'-worker.json',{task,error:String(error)});}}
   const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});if(response.ok)await signal('workspace.json',(await response.json()).workspace);
   await pause(500);
  }
  const workspace=JSON.parse(await readFile(join(evidence,'workspace.json'),'utf8'));await signal('final-state.json',{done,workspace,taskCount:processed.size});
  if(done){expect(workspace.exports?.[0]?.confirmed).toBe(true);expect(workspace.deliveries?.some((d:any)=>d.verified)).toBe(true);}
  else throw Error('Private novice acceptance stopped before completion');
 }finally{
  await vite?.close();await alignmentWorker.end();await f.close();await rm(join(evidence,'browser.json'),{force:true});await signal('fixture-cleanup.json',{closed:true,runId});
 }
},3_700_000);
