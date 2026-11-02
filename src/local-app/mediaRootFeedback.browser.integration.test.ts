// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
import {csrfFor} from './sessions';
const exec=promisify(execFile);

it.skipIf(process.env.LOOP_STORAGE_FEEDBACK_ACCEPTANCE!=='1')('storage feedback retries, confirms, cancels and resumes the same real migration independently of personal preferences',async()=>{
 if(!process.env.LOOP_TEST_CONTEXT_MODULE||!process.env.LOOP_STORAGE_FEEDBACK_EVIDENCE)throw Error('Explicit isolated context and evidence required');
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE),context=runtimeContext();context.assertDatabase();if(context.dailyRuntime!==false)throw Error('Daily runtime forbidden');
 const output=process.env.LOOP_STORAGE_FEEDBACK_EVIDENCE;await mkdir(output,{recursive:true});
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/121-restored-media-deployment.sql','db/local/125-global-media-root-plans.sql','db/local/126-global-media-root-execution.sql']}),{f,source,target,runtimeRoot}=fixture;
 let vite:ViteDevServer|undefined;const session='loop-ticket27-'+randomUUID();
 const browser=async(...args:string[])=>(await exec('agent-browser',['--session',session,...args],{timeout:25000,maxBuffer:4*1024*1024})).stdout;
 const click=(name:string)=>browser('find','role','button','click','--name',name,'--exact'),text=(value:string)=>browser('wait','--text',value);
 try{
  await writeFile(join(f.assetRoot,f.episodeRelativePath,'large.bin'),Buffer.alloc(4*1024*1024,27));
  const original=await readFile(join(f.assetRoot,f.videoPath));
  let runtime=await fixture.launch('root-progress-pause'),failReads=true;const requests:{method:string;url:string;status?:number}[]=[];
  const proxy={target:runtime.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',runtime.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(runtimeRoot,'vite-feedback-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'storage-feedback',configureServer(s){s.middlewares.use((req,res,next)=>{
   if(req.url==='/api/local/media-root'){requests.push({method:req.method??'GET',url:req.url});if(req.method==='GET'&&failReads){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'存储读取暂时失败，请重试。'}));return;}}
   if(req.url==='/__ticket27'){void s.transformIndexHtml('/__ticket27','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>存储迁移反馈验收</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html);});return;}next();
  });}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
  const url=`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__ticket27`;await writeFile(join(output,'url.txt'),url);
  const call=async(command?:string,data:Record<string,unknown>={})=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:command?'POST':'GET',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},...(command?{body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})}:{})});return{status:r.status,body:await r.json()};};
  const settings=async()=>{await click('所有者设置');await browser('find','role','menuitem','click','--name','个人偏好','--exact');await text('存储位置');};
  const capture=async(name:string)=>{const dims=JSON.parse(await browser('eval','(()=>{const e=document.querySelector("[role=dialog][aria-label=个人偏好]"),r=e.getBoundingClientRect();return{width:innerWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:innerHeight,scroll:e.scrollWidth,client:e.clientWidth,footer:e.querySelector("footer").getBoundingClientRect().bottom,footerTop:e.querySelector("footer").getBoundingClientRect().top}})()'));expect(dims.left).toBeGreaterThanOrEqual(0);expect(dims.right).toBeLessThanOrEqual(dims.width);expect(dims.bottom).toBeLessThanOrEqual(dims.height);expect(dims.scroll).toBeLessThanOrEqual(dims.client);expect(dims.footer).toBeLessThanOrEqual(dims.height);expect(dims.footerTop).toBeGreaterThan(0);await browser('screenshot',join(output,name));return dims;};
  await browser('open',url);await browser('set','viewport','1280','900');await text('登录控制台');await browser('find','label','邮箱','fill',f.email);await browser('find','label','密码','fill',f.password);await click('使用密码登录');await text('工作台');await settings();await text('存储读取暂时失败，请重试。');
  await browser('find','label','显示名称','fill','独立存储反馈');await click('保存偏好');await text('已保存');await capture('00-read-failed-1280.png');failReads=false;await click('重新读取存储位置');await text(source);await text('已保存');
  await click('更换存储位置');await browser('find','label','新位置','fill',target);await click('检查迁移计划');await text('迁移计划已检查，尚未开始迁移。');
  expect(await browser('eval','document.querySelector(".media-root-plan .media-root-actions button:last-child")?.disabled')).toContain('true');
  const dimensions=[await capture('01-plan-1280.png')];await browser('set','viewport','820','768');dimensions.push(await capture('02-plan-820.png'));await browser('set','viewport','820','600');await browser('scroll','down','800','--selector','.owner-preferences-card');expect(Number(await browser('eval','document.querySelector(".owner-preferences-card").scrollTop'))).toBeGreaterThan(0);dimensions.push(await capture('02-plan-820-low-height.png'));await browser('scroll','up','1000','--selector','.owner-preferences-card');expect(Number(await browser('eval','document.querySelector(".owner-preferences-card").scrollTop'))).toBe(0);await browser('set','viewport','820','768');
  await click('取消');await text('已回滚未完成迁移');expect((await call()).body.path).toBe(source);
  await click('检查迁移计划');await text('迁移计划已检查');await browser('find','role','checkbox','check','--name','确认迁移完成后使用新位置，原文件保留','--exact');
  const plan=(await call()).body.migration;expect(plan.manifest.canExecute).toBe(true);const manifestSha=plan.manifestSha256;
  await f.c.query("CREATE FUNCTION public.fail_ticket27_cutover() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='committed' THEN RAISE EXCEPTION '切换登记未完成，请继续迁移或回滚。' USING ERRCODE='55000';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_ticket27_cutover BEFORE UPDATE OF status ON local_identity.media_root_migrations FOR EACH ROW EXECUTE FUNCTION public.fail_ticket27_cutover()");
  await click('开始迁移');await browser('wait','--fn','Number(document.querySelector("progress")?.value)>0');await capture('03-progress-820.png');
  const copying=(await call()).body;expect(copying.executing).toBe(true);expect(copying.migration.progress.copiedBytes).toBeGreaterThan(0);expect(copying.migration.progress.copiedBytes).toBeLessThan(plan.manifest.totalBytes);
  await browser('reload');await text('工作台');await settings();await text('正在迁移');await browser('wait','--fn','Number(document.querySelector("progress")?.value)>0');
  await fixture.crash();runtime=await fixture.launch();proxy.target=runtime.origin;await browser('reload');await text('工作台');await settings();await text('迁移已中断');await capture('04-interrupted-820.png');
  await click('继续迁移');await text('迁移未完成');await text('迁移目录、挂载、权限或空间已变化；原位置保留，请恢复或回滚本计划。');const failed=(await call()).body;expect(failed.migration).toMatchObject({id:plan.id,status:'failed',manifestSha256:manifestSha});await writeFile(join(output,'failed-state.json'),JSON.stringify(failed,null,2));await capture('05-failed-820.png');
  await f.c.query('DROP TRIGGER fail_ticket27_cutover ON local_identity.media_root_migrations;DROP FUNCTION public.fail_ticket27_cutover()');await click('继续迁移');await text('媒体根迁移完成，服务已使用新位置。');await capture('06-completed-820.png');
  const completed=(await call()).body;expect(completed).toMatchObject({path:target,migration:{id:plan.id,status:'completed',manifestSha256:manifestSha}});expect(completed.migration.progress.copiedBytes).toBe(plan.manifest.totalBytes);
  expect(await readFile(join(target,relative(source,f.assetRoot),f.videoPath))).toEqual(original);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(original);
  const preferences=await fetch(runtime.origin+'/api/local/preferences',{headers:{Cookie:'loop_owner_session='+f.token}});expect((await preferences.json()).displayName).toBe('独立存储反馈');
  await writeFile(join(output,'result.json'),JSON.stringify({planId:plan.id,manifestSha,dimensions,requests,copyingBytes:copying.migration.progress.copiedBytes,totalBytes:plan.manifest.totalBytes,completedBytes:completed.migration.progress.copiedBytes,sha256:createHash('sha256').update(original).digest('hex'),sourcePreserved:true,retriedRead:true,cancelled:true,reloadedCopy:true,restartedSamePlan:true,failedThenResumed:true,personalPreferencePersisted:true,paidCalls:0},null,2));
 }catch(error){await browser('screenshot',join(output,'failure.png')).catch(()=>{});await writeFile(join(output,'failure-snapshot.txt'),await browser('snapshot').catch(()=>''));throw error;}
 finally{await browser('close').catch(()=>{});await vite?.close();await writeFile(join(runtimeRoot,'progress-resume'),'resume').catch(()=>{});await fixture.close();}
},240000);
