// @vitest-environment node
import {it,expect} from 'vitest';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {narrationFixture} from './workspaceNarration.fixture';
const run=promisify(execFile),enabled=process.env.LOOP_WORKFLOW_BROWSER_ACCEPTANCE==='1';

it.skipIf(!enabled)('48/7/21/22: real browser disables speech without discarding the unknown request and sees the unblocked catalog after refresh',async()=>{
 const f=await narrationFixture(),dir=resolve('docs/verification/workflow-rules-implementation-20261111/browser');await mkdir(dir,{recursive:true});
 const browser=async(...args:string[])=>(await run('agent-browser',['--session','loop-workflow48-root',...args],{timeout:30000,maxBuffer:2*1024*1024})).stdout;
 let vite:Awaited<ReturnType<typeof createServer>>|undefined;
 try{
  await f.authorize();let w=await f.fillVisuals(f.made),clip=w.clips[0];
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
  await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',...f.narrationSettings,text:'浏览器验证：当前不使用这段口播。'});
  await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{clipId:clip.id,reservationCents:100});
  await writeFile(f.responseMode,'unknown');await f.execute(w.narration[0].taskId);
  const proxy={target:f.origin,changeOrigin:true,configure(proxy:any){proxy.on('proxyReq',(request:any)=>request.setHeader('Origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:'.scratch/workflow48-browser/cache',optimizeDeps:{entries:['src/local-app/main.tsx']},plugins:[react(),{name:'isolated-workflow-session',configureServer(server){server.middlewares.use('/__workflow_session',(_request,response)=>{response.setHeader('Set-Cookie',`loop_owner_session=${f.token}; Path=/; HttpOnly; SameSite=Strict`);response.writeHead(302,{Location:`/?view=operations&episode=${f.episode}&step=preparation`});response.end();});}}],server:{host:'127.0.0.1',port:5226,strictPort:true,proxy:{'/api':proxy,'/_local-artifact':proxy},fs:{deny:['.env','.env.*','**/.loop-control/**','**/.git/**']},watch:{ignored:['**/.loop-control/**','**/.scratch/**']}}});
  await vite.listen();await browser('set','viewport','1348','953');await browser('open','http://127.0.0.1:5226/__workflow_session');
  await browser('wait','--text','分镜台');
  await browser('wait','--text','1 项待准备');
  await browser('find','role','tab','click','--name','字幕与口播');
  await browser('screenshot',join(dir,'speech-enabled.png'));
  await browser('find','role','switch','click','--name','启用口播');
  await browser('wait','--text','0 项待准备');
  expect((await f.read()).narration[0]).toMatchObject({enabled:false,generationTask:{submissionUnknown:true}});
  await browser('screenshot',join(dir,'speech-disabled.png'));
  await browser('reload');await browser('wait','--text','0 项待准备');
  await browser('open','http://127.0.0.1:5226/?view=operations');await browser('wait','--text','不阻塞当前制作');
  const snapshot=await browser('snapshot');await writeFile(join(dir,'catalog-snapshot.txt'),snapshot);
  expect(snapshot).toContain('不阻塞当前制作');
  await browser('screenshot',join(dir,'catalog-background-reminder.png'));
  await browser('set','viewport','375','900');await browser('screenshot',join(dir,'catalog-mobile.png'));
  const overflow=await browser('eval','document.documentElement.scrollWidth > innerWidth');expect(overflow.trim()).toBe('false');
  await writeFile(join(dir,'result.json'),JSON.stringify({passed:true,realOwnerHttp:true,realPostgres:true,controlledSupplier:true,disabledSurvivesRefresh:true,backgroundReminder:true,mobileOverflow:false},null,2));
 }catch(error){await writeFile(join(dir,'failure.txt'),String(error)+'\n'+await browser('snapshot').catch(String));await browser('screenshot',join(dir,'failure.png')).catch(()=>{});throw error;}
 finally{await browser('close').catch(()=>{});await vite?.close();await f.close();}
},240000);
