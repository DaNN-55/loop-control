// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,writeFile,readFile,rm,rename,copyFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {storyE2eFixture} from './storyE2e.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {inspectMediaRoot} from './mediaRootSettings';

/** Holds a genuinely isolated app while an external agent-browser session performs business UI actions. */
it.skipIf(process.env.LOOP_STUDIO_HANDOFF_BROWSER!=='1')('novice moves between preparation and native editing before delivering the same project',async()=>{
 const evidence=process.env.LOOP_STUDIO_HANDOFF_EVIDENCE;if(!evidence)throw Error('Explicit private evidence directory required');await mkdir(evidence,{recursive:true,mode:0o700});
 const exec=promisify(execFile);
 const f=await storyE2eFixture({blank:true,scriptOnly:true});let vite:import('vite').ViteDevServer|undefined;
 const runId=randomUUID(),session='studio-handoff-novice-'+runId.slice(0,8),processed=new Set<string>(),alignmentWorker=f.workerPool();
 const signal=async(name:string,data:unknown)=>{const file=join(evidence,name),temporary=file+'.tmp';await writeFile(temporary,JSON.stringify(data,null,2),{mode:0o600});await rename(temporary,file);};
 try{
  const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},optimizeDeps:{entries:['src/local-app/main.tsx']},plugins:[react(),{name:'novice-formal',configureServer(s){s.middlewares.use('/__novice',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__novice','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>剪辑台完整流程验收</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});}}],server:{watch:{ignored:['**/.scratch/**']},host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  const phrase='你好，欢迎看看这把黄色雨伞。';
  try{await copyFile(join(evidence,'voice.mp3'),f.files.voice);}catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
   const aiff=join(f.root,'local-voice.aiff');
   await exec('/usr/bin/say',['-v','Tingting (中文（中国大陆）)','-r','170','-o',aiff,phrase]);
   await exec('ffmpeg',['-nostdin','-v','error','-y','-i',aiff,'-c:a','libmp3lame',f.files.voice]);
  }
  const extra={music:join(f.root,'平稳背景音乐.mp3'),effect:join(f.root,'提示音效.mp3'),originalVideo:join(f.root,'带原声的雨伞.mp4'),replacementVideo:join(f.root,'新原声雨伞.mp4'),silentVideo:join(f.root,'无原声雨伞.mp4')};
  await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','16','-c:a','libmp3lame',extra.music]);
  await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','1','-c:a','libmp3lame',extra.effect]);
  for(const [path,color,tone]of [[extra.originalVideo,'0x204c73',440],[extra.replacementVideo,'0x735720',990]] as const)await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`color=c=${color}:s=360x640:r=30`,'-f','lavfi','-i',`sine=frequency=${tone}:sample_rate=48000`,'-t','8','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',path]);
  await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=0x24735d:s=360x640:r=30','-t','8','-c:v','libx264','-pix_fmt','yuv420p',extra.silentVideo]);
  const secondShot=`### 段落 02

- 口播：把这份善意留给下一个人。
- 口播启用：关闭
- 字幕：关闭
- 画面提示：黄色伞柄与纸条特写，保持最后一刻。
- 画面来源：图片
- 素材名称：默认
- 视频提示词：固定镜头，纸条轻轻晃动。
- 音效素材：无
- 镜头时长（秒）：3
- 构图：full

`;
  const scriptPath=join(f.root,'零基础演示.md'),script=productionScriptTemplate.replace('填写本段完整口播。',phrase).replace('## 本期补充约束（可选）',secondShot+'## 本期补充约束（可选）');await writeFile(scriptPath,script);
  await signal('browser.json',{runId,session,url:`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__novice?view=episodes&episode=${f.episode}&step=script`,email:f.email,password:f.password,episode:f.episode,account:f.account,files:{...f.files,...extra,script:scriptPath},backend:f.origin,fixtureRoot:f.root});
  await signal('ready.json',{runId,session,episode:f.episode,frontend:(vite.httpServer!.address() as {port:number}).port,backend:f.origin,privateDatabase:f.database});console.log('Private studio handoff browser fixture ready');
  let done=false,smoke=false;
  for(let n=0;n<7200;n++){
   if(process.env.LOOP_STUDIO_HANDOFF_BROWSER_SMOKE==='1')try{await readFile(join(evidence,'smoke.json'));smoke=true;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   try{await readFile(join(evidence,'finish.json'));done=true;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   try{await readFile(join(evidence,'stop.json'));break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   try{await readFile(join(evidence,'restart.json'));await rm(join(evidence,'restart.json'));await f.restart();await signal('restarted.json',{at:Date.now()});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   const tasks=(await f.c.query("SELECT id,task_type FROM public.tasks WHERE episode_id=$1 AND status='ready' ORDER BY created_at",[f.episode])).rows;
   for(const task of tasks){if(processed.has(task.id))continue;processed.add(task.id);try{
    let result;
    if(task.task_type==='align_shot_captions'){
     const modelPath=process.env.LOOP_STUDIO_HANDOFF_MODELS,python=process.env.LOOP_STUDIO_HANDOFF_PYTHON;if(!modelPath||!python)throw Error('Explicit private Python wrapper and read-only model cache required');
     const cacheDirectory=await realpath(modelPath);
     const alignment={python,cacheDirectory,cacheBinding:await inspectMediaRoot(cacheDirectory),runnerSha256:createHash('sha256').update(await readFile('scripts/whisperx-align.py')).digest('hex')};
     const claimed=(await nativeWorkerPort(alignmentWorker).rpc('claim_next_worker_task',{p_task_id:task.id,p_worker_capacity:1}) as any[])[0];expect(claimed?.task_id).toBe(task.id);
     result=await runWorkspaceDeliveryProcess(f,claimed,{mountPath:f.volume.mountPath,alignment});
    }else result=await f.execute(task.id);
    await signal(task.id+'-worker.json',{task,result,lastResult:(await f.c.query('SELECT last_result FROM public.tasks WHERE id=$1',[task.id])).rows[0]});
   }catch(error){await signal(task.id+'-worker.json',{task,error:String(error)});}}
   const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});if(response.ok)await signal('workspace.json',(await response.json()).workspace);
   await pause(500);
  }
  const workspace=JSON.parse(await readFile(join(evidence,'workspace.json'),'utf8'));await signal('final-state.json',{done,smoke,workspace,taskCount:processed.size});
  if(done){expect(workspace.exports?.[0]?.confirmed).toBe(true);expect(workspace.deliveries?.some((d:any)=>d.verified)).toBe(true);}
  else if(smoke){expect(workspace.clips.length).toBe(2);expect(workspace.readiness.placeholders.length).toBe(2);expect(processed.size).toBe(0);}
  else throw Error('Private studio handoff acceptance stopped before completion');
 }finally{
  await vite?.close();await alignmentWorker.end();await f.close();await rm(join(evidence,'browser.json'),{force:true});await signal('fixture-cleanup.json',{closed:true,runId});
 }
},3_700_000);
