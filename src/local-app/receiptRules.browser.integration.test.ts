// @vitest-environment node
import{it,expect}from'vitest';
import{createServer}from'vite';
import react from'@vitejs/plugin-react';
import{execFile}from'node:child_process';
import{promisify}from'node:util';
import{mkdir,readFile,writeFile}from'node:fs/promises';
import{join,resolve}from'node:path';
import{LocalConnections}from'./connections';
import{narrationFixture}from'./workspaceNarration.fixture';
const run=promisify(execFile);
it.skipIf(process.env.LOOP_RECEIPT_BROWSER_ACCEPTANCE!=='1')('24 actual browser queries original speech, warns before a new paid request and leaves it unadopted',async()=>{
 const f=await narrationFixture(undefined,undefined,false,false,{connections:pool=>new LocalConnections(pool,{mode:'keychain',async get(){throw Error('No actual credential access permitted');},async putImmutable(){throw Error('No actual credential write permitted');}},{mode:'live',networkAvailable:true,workspaceSpeechFromConnections:true,async verify(){throw Error('No real probe permitted');}})}),dir=resolve('docs/verification/receipt-rules-implementation-20261111/browser');await mkdir(dir,{recursive:true});
 const browser=async(...args:string[])=>(await run('agent-browser',['--session','loop-receipts-48-browser',...args],{timeout:30000,maxBuffer:2*1024*1024})).stdout;
 let vite:Awaited<ReturnType<typeof createServer>>|undefined;
 try{
  let w=await f.fillVisuals(f.made);const clip=w.clips[0];
  for(const[command,data]of [['saveWorkspaceNarration',{mode:'tts',...f.narrationSettings,text:'验证明确确认的新口播。'}],['confirmWorkspaceNarration',{}],['generateWorkspaceNarration',{reservationCents:100}]]as const){const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;}
  const original=w.narration[0].taskId;await writeFile(f.responseMode,'unknown');await f.execute(original,false);
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(q:any)=>q.setHeader('Origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:'.scratch/receipt-browser/cache',optimizeDeps:{entries:['src/local-app/main.tsx']},plugins:[react(),{name:'isolated-receipt-session',configureServer(server){server.middlewares.use('/__receipt_session',(_q,r)=>{r.setHeader('Set-Cookie',`loop_owner_session=${f.token}; Path=/; HttpOnly; SameSite=Strict`);r.writeHead(302,{Location:`/?view=operations&episode=${f.episode}&step=preparation`});r.end();});}}],server:{host:'127.0.0.1',port:5339,strictPort:true,proxy:{'/api':proxy,'/_local-artifact':proxy},fs:{deny:['.env','.env.*','**/.loop-control/**','**/.git/**']},watch:{ignored:['**/.loop-control/**','**/.scratch/**']}}});
  await vite.listen();await browser('set','viewport','1348','953');await browser('open','http://127.0.0.1:5339/__receipt_session');await browser('wait','--text','1 项待准备');await browser('find','role','tab','click','--name','字幕与口播');await browser('wait','--text','重新生成');
  await browser('screenshot',join(dir,'speech-unknown.png'));await browser('find','role','button','click','--name','重新生成');await browser('wait','--text','供应商可能对两次请求分别计费。');
  const snapshot=await browser('snapshot');await writeFile(join(dir,'risk-snapshot.txt'),snapshot);expect(snapshot).toContain('可能已产生费用');
  const jobs=async()=>Number((await f.c.query("SELECT count(*) n FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration'",[f.episode])).rows[0].n);
  expect(await jobs()).toBe(1);expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  await browser('screenshot',join(dir,'speech-explicit-risk.png'));await browser('find','role','button','click','--name','确认并提交本次调用');
  await browser('wait','--text','等待后台开始任务');expect(await jobs()).toBe(2);
  const latest=await f.read();expect(latest.narration[0].adoptedAudioTrackId).toBeNull();expect(latest.narration[0].generationTask.taskId).not.toBe(original);
  expect((await f.c.query('SELECT outcome FROM local_identity.workspace_narration_submissions WHERE task_id=$1',[original])).rows[0].outcome).toBe('started');expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  await writeFile(join(dir,'result.json'),JSON.stringify({passed:true,originalQueriedBeforeConfirmation:true,explicitDuplicateChargeWarning:true,newTaskOnlyAfterConfirm:true,originalReceiptPreserved:true,noAutomaticAdoption:true,providerPosts:1},null,2));
 }catch(error){await writeFile(join(dir,'failure.txt'),String(error)+'\n'+await browser('snapshot').catch(String));await browser('screenshot',join(dir,'failure.png')).catch(()=>{});throw error;}
 finally{await browser('close').catch(()=>{});await vite?.close();await f.close();}
},180000);
