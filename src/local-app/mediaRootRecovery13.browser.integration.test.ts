// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
import {prepareCollectionTargets} from './episodeCollection.fixture';
const exec=promisify(execFile),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
it.skipIf(process.env.LOOP_STATE13_ACCEPTANCE!=='1')('real Owner storage UI reopens a copying plan, retries disconnected reads, resumes a failed cutover and serves the same media after restart',async()=>{
 const output=process.env.LOOP_STATE13_EVIDENCE;if(!output)throw Error('An explicit owned evidence directory is required');await mkdir(output,{recursive:true});
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/120-native-workspace-storage-locations.sql','db/local/121-restored-media-deployment.sql','db/local/125-global-media-root-plans.sql','db/local/126-global-media-root-execution.sql']});
 const {f,target,runtimeRoot}=fixture,session='state13-'+randomUUID();let vite:ViteDevServer|undefined,disconnected=false;
 const browser=async(...args:string[])=>(await exec('agent-browser',['--session',session,...args],{timeout:30000,maxBuffer:4*1024*1024})).stdout;
 const click=(name:string)=>browser('find','role','button','click','--name',name,'--exact');
 const text=(value:string)=>browser('wait','--text',value);
 const capture=async(name:string)=>{await browser('wait','--fn','document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).every(a=>a.playState!=="running")');await browser('screenshot',join(output,name));};
 try{
  await prepareCollectionTargets(f);
  const old=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0];
  const oldDirectory=join(old.asset_root,old.directory_relative_path),video=await readFile(join(oldDirectory,'shot.mp4'));
  await writeFile(join(oldDirectory,'large.bin'),Buffer.alloc(4*1024*1024,13));
  const frozen=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows;
  await f.c.query("CREATE FUNCTION public.fail_state13_cutover() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='committed' THEN RAISE EXCEPTION '验收：切换登记未完成，请继续同一计划。' USING ERRCODE='55000';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_state13_cutover BEFORE UPDATE OF status ON local_identity.media_root_migrations FOR EACH ROW EXECUTE FUNCTION public.fail_state13_cutover()");
  let runtime=await fixture.launch('root-progress-pause');const firstPid=runtime.pid;
  const proxy={target:runtime.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',runtime.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(runtimeRoot,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'state13-real-owner',configureServer(server){server.middlewares.use(async(req,res,next)=>{
   if(req.url?.startsWith('/api/local/media-root')&&req.method==='GET'&&disconnected){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'验收：进度读取连接已断开'}));return;}
   if(req.url?.startsWith('/__state13')){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__state13','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>存储恢复隔离验收</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script></html>'));return;}next();
  });}}],optimizeDeps:{entries:['src/local-app/main.tsx']},server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});
  await vite.listen();const url=`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__state13`;
  const state=async()=>{const r=await fetch(runtime.origin+'/api/local/media-root',{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return r.json();};
  const settings=async()=>{await click('所有者设置');await browser('find','role','menuitem','click','--name','个人偏好','--exact');await text('存储位置');await browser('wait','--fn','[...document.querySelectorAll("button")].some(b=>b.getAttribute("aria-label")==="更换存储位置")');};
  await browser('open',url);await browser('set','viewport','1440','1000');await text('登录控制台');await browser('find','label','邮箱','fill',f.email);await browser('find','label','密码','fill',f.password);await click('使用密码登录');await text('内容工作台');await settings();
  await click('更换存储位置');await browser('find','label','新位置','fill',target);await click('检查迁移计划');await text('迁移计划已检查');
  const planned=(await state()).migration;expect(planned.status).toBe('planned');expect(planned.manifest.canExecute,JSON.stringify(planned.manifest.conflicts)).toBe(true);
  await capture('13-plan-wide.png');await browser('find','role','checkbox','click','--name','确认迁移完成后使用新位置，原文件保留');await click('开始迁移');
  let paused=false;for(let i=0;i<200;i++){try{await readFile(join(runtimeRoot,'progress-paused.json'));paused=true;break;}catch{}await new Promise(resolve=>setTimeout(resolve,25));}expect(paused).toBe(true);
  await text('正在迁移');await capture('13-copying-wide.png');await click('关闭个人偏好');await settings();await text('正在迁移');expect((await state()).migration.id).toBe(planned.id);
  await browser('reload');await text('内容工作台');await settings();await text('正在迁移');await browser('set','viewport','390','900');await capture('13-copying-reopened-mobile.png');
  disconnected=true;await text('验收：进度读取连接已断开');expect((await state()).executing).toBe(true);await capture('13-disconnected-mobile.png');
  disconnected=false;await click('重新读取存储位置');await browser('wait','--fn','![...document.querySelectorAll("[role=alert]")].some(e=>e.textContent.includes("进度读取连接已断开"))');await text('正在迁移');
  await writeFile(join(runtimeRoot,'progress-resume'),'resume');await text('迁移未完成');const failed=(await state()).migration;expect(failed.id).toBe(planned.id);expect(failed.status).toBe('failed');expect(failed.manifestSha256).toBe(planned.manifestSha256);await capture('13-cutover-failed-mobile.png');
  await f.c.query('DROP TRIGGER fail_state13_cutover ON local_identity.media_root_migrations;DROP FUNCTION public.fail_state13_cutover()');await click('继续迁移');await text('媒体根迁移完成');
  const completed=await state();expect(completed.path).toBe(target);expect(completed.migration.id).toBe(planned.id);expect(completed.migration.status).toBe('completed');expect(completed.migration.manifestSha256).toBe(planned.manifestSha256);await capture('13-completed-mobile.png');
  const location=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0];expect(location.asset_root.startsWith(target)).toBe(true);expect(sha(await readFile(join(location.asset_root,location.directory_relative_path,'shot.mp4')))).toBe(sha(video));expect(sha(await readFile(join(oldDirectory,'shot.mp4')))).toBe(sha(video));
  await rename(oldDirectory,oldDirectory+'.offline-after-copy');await browser('open','about:blank');await fixture.stop();runtime=await fixture.launch();proxy.target=runtime.origin;expect(runtime.pid).not.toBe(firstPid);
  await browser('open',url);await text('内容工作台');await settings();await text(target);expect((await state()).migration.status).toBe('completed');await capture('13-restarted-mobile.png');
  const artifact=await fetch(runtime.origin+'/_local-artifact?episode='+f.episode+'&path='+encodeURIComponent(f.videoPath)+'&sha256='+sha(video),{headers:{Cookie:'loop_owner_session='+f.token}});expect(artifact.status).toBe(200);expect(sha(new Uint8Array(await artifact.arrayBuffer()))).toBe(sha(video));expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows).toEqual(frozen);
  const size=JSON.parse(await browser('eval','({width:innerWidth,scroll:document.documentElement.scrollWidth})'));expect(size.scroll).toBeLessThanOrEqual(size.width);
  await writeFile(join(output,'13-result.json'),JSON.stringify({firstPid,restartedPid:runtime.pid,planId:planned.id,manifestSha256:planned.manifestSha256,sourceSha256:sha(video),completedPath:target,reopenedWhileCopying:true,reloadedWhileCopying:true,disconnectedReadRecovered:true,failedCutoverResumedSamePlan:true,oldSourceOfflineAfterCopy:true,ownerArtifactSha256Matches:true,tasksUnchanged:true,size},null,2)+'\n');
 }catch(error){await browser('screenshot',join(output,'13-failure.png')).catch(()=>{});await writeFile(join(output,'13-failure-snapshot.txt'),await browser('snapshot').catch(()=>''));throw error;}
 finally{disconnected=false;await writeFile(join(runtimeRoot,'progress-resume'),'resume').catch(()=>{});await browser('close').catch(()=>{});await vite?.close();await fixture.close();}
},300000);
