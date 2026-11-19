// @vitest-environment node
import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,unlink,lstat,realpath,chmod,statfs} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';

const enabled=process.env.LOOP_ACCOUNT_NAVIGATION_BROWSER==='1';
const exec=promisify(execFile);
type Kind='app'|'native';

/** No enabled invocation may fall back to the daily deployment reader. */
async function isolatedHarness(kind:Kind){
 const contextFile=process.env.LOOP_TEST_CONTEXT_MODULE;
 if(!contextFile||!/^\/private\/tmp\/loop-account-navigation-[^/]+\/runtime-context\.mjs$/.test(contextFile))throw Error('Run this acceptance only through its private PostgreSQL runner.');
 const {runtimeContext}=await import(contextFile),context=runtimeContext();
 if(!context.isolatedFixtureNative||context.dailyRuntime!==false)throw Error('A private native runtime context is required.');
 context.assertDatabase();
 const sdk=await realpath(process.env.LOOP_TEST_OPENCHATCUT_ROOT!);
 if(sdk!==join(dirname(contextFile),'OpenChatCut'))throw Error('The SDK must be the runner-owned source copy.');
 const output=join(process.env.LOOP_ACCOUNT_NAVIGATION_EVIDENCE!,kind);
 await mkdir(output,{recursive:true});
 const session=process.env.LOOP_ACCOUNT_NAVIGATION_SESSION+'-'+kind;
 if(!/^account-navigation-[a-f0-9]+-(?:app|native)$/.test(session))throw Error('A private browser session is required.');
 await writeFile(join(output,'browser.json'),JSON.stringify({version:'account-navigation-handshake/v1',kind,session,output}),{mode:0o600});
 const checks:string[]=[];
 let phase='fixture initialization',vite:ViteDevServer|undefined;
 const entry='src/local-app/.account-navigation-'+randomUUID()+'.tsx';
 const fixture=await nativeMediaRootFixture({newInstall:true}),{f}=fixture;
 const browser=async(...args:string[])=>(await exec('agent-browser',['--config',join(dirname(contextFile),'browser-config.json'),'--session',session,'--download-path',output,...args],{timeout:180000,maxBuffer:4_000_000,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'60000'}})).stdout.trim();
 const evaluate=async<T>(script:string):Promise<T>=>JSON.parse(await browser('eval','-b',Buffer.from(script).toString('base64')));
 const click=async(name:string)=>{await browser('find','role','button','click','--name',name,'--exact');};
 const step=(value:string)=>{phase=value;console.log('['+kind+'] '+phase);writeFileSync(join(output,'progress.json'),JSON.stringify({phase,checks},null,2));};
 const check=(value:string)=>{checks.push(value);console.log('['+kind+'] verified: '+value);writeFileSync(join(output,'progress.json'),JSON.stringify({phase,checks},null,2));};
 async function report(passed:boolean,error?:unknown){
  const message=error instanceof Error?error.message:String(error??'');
  const result={passed,phase,checks,kind,session,paidProviderCalls:0,dailyDeploymentRead:false,...(error?{error:message.replaceAll(f.password,'[synthetic password]')}:{})};
  await writeFile(join(output,'phase-result.json'),JSON.stringify(result,null,2));
  const reportDir=join(process.cwd(),'docs/verification/account-navigation-simplification-20261119');
  await mkdir(reportDir,{recursive:true});
  await writeFile(join(reportDir,kind==='app'?'BROWSER_APP.md':'BROWSER_NATIVE.md'),`# ${kind==='app'?'正式界面':'独立剪辑'}隔离浏览器验证\n\n结果：${passed?'通过':'未通过'}。阶段：${phase}。\n\n${checks.map(value=>'- 已验证：'+value).join('\n')}\n\n${error?'失败：'+result.error+'\n\n':''}证据目录：${output}\n\n未调用付费生成，未读取日常 deployment 或 Keychain 秘密。${kind==='app'?'本报告不包含原生剪辑导出；参见 BROWSER_NATIVE.md。':''}\n`);
 }
 async function close(){
  await browser('close').catch(()=>{});
  await vite?.close();await unlink(entry).catch(()=>{});await fixture.close();
 }
 try{
  const config=JSON.parse(await readFile(fixture.configFile,'utf8'));
  config.stateDirectory=join(dirname(contextFile),'technical-state-'+kind);await mkdir(config.stateDirectory,{recursive:true,mode:0o700});
  let node=process.execPath;
  if(kind==='native'){
   const wrapper=join(output,'node-observer.zsh'),quote=(value:string)=>"'"+value.replaceAll("'", "'\"'\"'")+"'";
   await writeFile(wrapper,'#!/bin/zsh\nexec '+quote(process.execPath)+' "$@" > >(tee -a '+quote(join(output,'sdk-stdout.log'))+') 2> >(tee -a '+quote(join(output,'sdk-stderr.log'))+' >&2)\n',{mode:0o700});await chmod(wrapper,0o700);node=wrapper;
  }
  config.openChatCut={root:sdk,node,port:0};
  config.worker.studio=true;config.worker.media={mode:'local'};
  await writeFile(fixture.configFile,JSON.stringify(config),{mode:0o600});
  const runtime=await fixture.launch();
  // Native startup binds a valid default root. This scenario explicitly starts
  // before the first Owner has bound storage; only this disposable DB changes.
  await f.c.query('DELETE FROM local_identity.sessions WHERE owner_id<>$1',[f.owner]);
  await f.c.query('DELETE FROM local_identity.credentials WHERE owner_id<>$1',[f.owner]);
  await f.c.query('DELETE FROM local_identity.media_root_binding');
  const proxy={target:runtime.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(request:any)=>request.setHeader('origin',runtime.origin));}};
  await writeFile(entry,"import './main';");
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},optimizeDeps:{entries:[entry]},plugins:[react({exclude:[/node_modules/,/vite-cache/]}),{name:'account-navigation-acceptance',configureServer(server){server.middlewares.use('/__account-navigation',async(_request,response)=>{response.setHeader('Content-Type','text/html');response.end(await server.transformIndexHtml('/__account-navigation',`<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>账号导航隔离验证</title><div id="root"></div><script type="module" src="/${entry}"></script>`));});}}],server:{host:'127.0.0.1',port:0,hmr:false,proxy:{'/api':proxy,'/_local-artifact':proxy}}});
  await vite.listen();
  const appUrl=`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__account-navigation`;
  await browser('open',appUrl);await browser('set','viewport','1440','1000');
  await browser('wait','--text','登录控制台');
  await browser('find','label','邮箱','fill',f.email);await browser('find','label','密码','fill',f.password);await click('使用密码登录');
  await browser('wait','--text','创建内容账号');
  return {fixture,f,output,session,browser,evaluate,click,step,check,report,close,checks,appUrl};
 }catch(error){await report(false,error);await close();throw error;}
}

async function initializeStorage(h:Awaited<ReturnType<typeof isolatedHarness>>){
 h.step('new-install storage initialization');
 await h.click('创建内容账号');await h.browser('wait','--text','初始化位置');
 await h.browser('find','label','素材保存目录','fill',h.fixture.target);await h.click('初始化');
 await h.browser('wait','--text','媒体根已初始化，服务已重新加载。');
 expect(JSON.parse(await readFile(h.fixture.configFile,'utf8')).mediaRoot).toBe(h.fixture.target);
 h.check('新安装先初始化私有媒体根，配置已切换到明确选择的位置');
}

it.skipIf(!enabled||process.env.LOOP_ACCOUNT_NAVIGATION_PHASE==='native')('formal app supports new-install account, production order, optional rules and compact settings/navigation',async()=>{
 const h=await isolatedHarness('app');
 try{
  await initializeStorage(h);h.step('continue from initialized storage to account creation');await h.click('继续创建内容账号');await h.browser('wait','--text','新建账号');
  h.step('create account using its name only');
  expect(await h.browser('snapshot','-i')).not.toContain('textbox "账号标识"');
  await h.browser('find','label','账号名称','fill','导航验收账号');await h.click('创建账号');
  await h.browser('wait','--fn',"!!document.querySelector('[aria-label=\"工作标题（可留空）\"]')");
  const account=(await h.f.c.query('SELECT a.*,d.actual_root FROM public.accounts a JOIN local_identity.account_asset_directories d ON d.account_id=a.id')).rows[0];
  expect(account.name).toBe('导航验收账号');expect(account.timezone).toBe('Asia/Shanghai');expect(account.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  expect((await lstat(account.actual_root)).isDirectory()).toBe(true);h.check('只填名称创建账号，自动稳定标识、上海时区和真实账号目录');
  h.step('create the first order directly after creating its account');
  await writeFile(join(h.output,'created-account.json'),JSON.stringify({id:account.id,name:account.name,slug:account.slug,timezone:account.timezone,currentBlueprintVersionId:account.current_blueprint_version_id,actualRoot:account.actual_root},null,2));
  await h.browser('find','label','工作标题（可留空）','fill','名称创建后的首张生产单');
  await h.browser('wait','--fn',"!!document.querySelector('form[aria-label=\"新建生产单\"] button[type=submit]:not(:disabled)')");await h.click('创建生产单');
  await h.browser('wait','--fn',"!!document.querySelector('[aria-label=\"关闭生产单详情\"]')");
  const episode=(await h.f.c.query('SELECT id,blueprint_version_id FROM public.episodes WHERE account_id=$1',[account.id])).rows[0];
  expect(episode).toBeTruthy();await h.click('关闭生产单详情');h.check('创建账号后直接继续新建真实生产单');
  h.step('save four optional account rules without confirmation');
  await h.click('账号');await h.click('导航验收账号');await h.browser('wait','--text','通用规则');await h.click('修改');
  for(const[label,value]of [['内容定位','给初学者看的五秒生活片段'],['说话方式','平实简短'],['画面风格','自然光纪实'],['内容禁区','不使用未经授权的肖像']])await h.browser('find','label',label,'fill',value);
  await h.click('保存通用规则');await h.browser('wait','--fn',"!!document.querySelector('.account-blueprint-form.is-locked')");
  const saved=(await h.f.c.query('SELECT b.policy,a.current_blueprint_version_id FROM public.accounts a JOIN public.account_blueprint_versions b ON b.id=a.current_blueprint_version_id WHERE a.id=$1',[account.id])).rows[0];
  expect(JSON.stringify(saved.policy)).toContain('自然光纪实');expect(saved.current_blueprint_version_id).not.toBe(episode.blueprint_version_id);
  expect((await h.f.c.query('SELECT blueprint_version_id FROM public.episodes WHERE id=$1',[episode.id])).rows[0].blueprint_version_id).toBe(episode.blueprint_version_id);
  h.check('四类选填规则普通保存；旧生产单保持冻结版本');
  h.step('verify five settings groups and persisted appearance');
  await h.click('设置');await h.browser('wait','--text','制作服务');
  expect(await h.evaluate<string[]>("Array.from(document.querySelectorAll('.owner-settings-pages button'),b=>b.textContent.trim())")).toEqual(['制作服务','文件存储','界面与通知','登录与安全','维护工具']);
  await h.browser('screenshot',join(h.output,'settings-1440.png'));
  await h.click('界面与通知');await h.browser('select','select[aria-label=外观]','dark');await h.click('保存偏好');
  await h.browser('wait','--fn',"document.querySelector('.owner-preferences-dialog [data-state=\"saved\"]') !== null");
  await h.browser('reload');await h.browser('wait','--fn',"document.querySelector('.app-shell')?.dataset.theme === 'dark'");h.check('设置仅五个主分组，深色偏好保存并刷新保留');
  // Settings pages themselves are intentionally session-local; reopen directly.
  if(!await h.evaluate<boolean>("!!document.querySelector('.owner-settings-dialog')"))await h.click('设置');
  await h.click('文件存储');await h.browser('wait','--text','更换位置');
  expect(await h.evaluate<boolean>("!!document.querySelector('.media-root-location-form')")).toBe(false);h.check('文件存储默认只显示当前路径与操作，迁移表单收起');
  await h.browser('press','Escape');await h.browser('wait','--fn',"!document.querySelector('.owner-settings-dialog')");
  await h.click('生产单');await h.browser('wait','--text','名称创建后的首张生产单');
  h.step('verify list preview, secondary filters and recycle entry');
  expect(await h.evaluate<boolean>("!!document.querySelector('aside.production-preview')")).toBe(true);
  expect(await h.browser('snapshot','-i')).not.toContain('columnheader "花费（元）"');
  await h.browser('screenshot',join(h.output,'app-1440.png'));
  await h.click('显示统计');await h.browser('wait','--fn',"Array.from(document.querySelectorAll('.episode-table th')).some(e=>e.textContent.includes('花费（元）'))");
  await h.click('隐藏统计');await h.browser('wait','--fn',"!Array.from(document.querySelectorAll('.episode-table th')).some(e=>e.textContent.includes('花费（元）'))");h.check('显示统计可明确展开与收起花费、后台用时、生成次数');
  await h.browser('find','label','搜索标题或编号','fill','名称创建后的首张生产单');await h.browser('press','Enter');
  await h.browser('wait','--fn',"new URLSearchParams(location.search).get('q') === '名称创建后的首张生产单'");
  await h.click('筛选');expect(await h.browser('snapshot','-i')).toContain('制作阶段');
  await h.click('回收站');await h.browser('wait','--text','回收站');await h.browser('press','Escape');
  h.check('统一生产单列表有默认预览、显式搜索、按需筛选和回收站入口');
  h.step('verify native mobile preview dialog and focus return');
  await h.browser('set','viewport','390','844');await h.browser('focus','.episode-table tbody tr');
  await h.browser('click','.episode-table tbody tr td:nth-child(2)');
  await h.browser('wait','dialog.production-preview-dialog[open]');
  expect(await h.evaluate<boolean>("document.querySelector('dialog.production-preview-dialog')?.open === true")).toBe(true);
  await h.browser('screenshot',join(h.output,'preview-390.png'));await h.browser('press','Escape');
  await h.browser('wait','--fn',"!document.querySelector('dialog.production-preview-dialog[open]')");
  await writeFile(join(h.output,'focus-return.json'),JSON.stringify(await h.evaluate("({tag:document.activeElement?.tagName,tabIndex:document.activeElement?.tabIndex,label:document.activeElement?.getAttribute('aria-label'),row:document.activeElement?.closest('.episode-row')?.dataset.previewId})"),null,2));
  expect(await h.evaluate<boolean>("document.activeElement instanceof HTMLElement && document.activeElement.isConnected && document.activeElement.tabIndex>=0 && !document.activeElement.closest('dialog') && document.activeElement.getBoundingClientRect().width>0")).toBe(true);
  h.check('390px点行打开原生预览dialog，Escape关闭并返回可达焦点');
  h.step('verify responsive layout and keyboard access');
  for(const[width,height]of [[1440,1000],[390,844],[320,800]]){
   await h.browser('set','viewport',String(width),String(height));await h.browser('press','Tab');
   expect(await h.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
   await writeFile(join(h.output,`layout-${width}.json`),JSON.stringify(await h.evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,focus:document.activeElement?.getAttribute('aria-label')||document.activeElement?.textContent?.trim()})"),null,2));
  }
  h.check('1440/390/320px页面无横向溢出，键盘Tab可聚焦控件');
  expect((await h.f.c.query('SELECT count(*)::int n FROM public.external_connections')).rows[0].n).toBe(0);
  await writeFile(join(h.output,'final-snapshot.txt'),await h.browser('snapshot'));await h.report(true);
 }catch(error){await writeFile(join(h.output,'failure-snapshot.txt'),await h.browser('snapshot').catch(()=>''));await writeFile(join(h.output,'failure-browser-errors.txt'),await h.browser('errors').catch(()=>''));await h.report(false,error);throw error;}
 finally{await h.close();}
},360000);

it.skipIf(!enabled||!['all','native'].includes(process.env.LOOP_ACCOUNT_NAVIGATION_PHASE??''))('independent native editor opens a new tab, imports, splits, autosaves/reopens and exports a real MP4 without an account',async()=>{
 const h=await isolatedHarness('native');
 try{
  await initializeStorage(h);
  // No account is needed: leave the first-use settings without creating one.
  await h.browser('press','Escape');await h.browser('wait','--fn',"!document.querySelector('.owner-settings-dialog')");
  h.step('open independent editor in a separate tab at its native home');
  await writeFile(join(h.output,'media-space-before.json'),JSON.stringify(await statfs(h.fixture.target),null,2));
  await h.click('独立剪辑');
  let nativeTab='';
  await expect.poll(async()=>{const tabs=await h.browser('tab');await writeFile(join(h.output,'tabs.txt'),tabs);nativeTab=tabs.split('\n').flatMap(line=>{const match=line.match(/\b(t\d+)\b.*?(http:\/\/127\.0\.0\.1:\d+\S*)/);return match&&new URL(match[2]).port!==new URL(h.appUrl).port?[match[1]]:[];}).at(-1)??'';return nativeTab;},{timeout:60000}).not.toBe('');
  expect((await h.browser('tab')).match(/\bt\d+\b/g)?.length).toBe(2);
  await h.browser('tab',nativeTab);const sdkUrl=await h.evaluate<string>('location.href');
  expect(new URL(sdkUrl).port).not.toBe(new URL(h.appUrl).port);
  await h.browser('wait','--load','domcontentloaded');
  const html=await fetch(sdkUrl);await writeFile(join(h.output,'native-bootstrap.html'),await html.text());expect(html.status).toBe(200);
  await writeFile(join(h.output,'native-bootstrap.json'),JSON.stringify(await h.evaluate("({url:location.href,title:document.title,ready:document.readyState,html:document.documentElement.outerHTML.slice(0,4000)})"),null,2));
  await h.browser('eval',"localStorage.setItem('cc.locale','zh')");await h.browser('reload');await h.browser('wait','--text','新建工程');
  expect(await h.evaluate<string>('location.hash')).not.toContain('/editor/');
  expect((await h.f.c.query('SELECT count(*)::int n FROM public.accounts')).rows[0].n).toBe(0);h.check('零账号时左下独立剪辑打开独立新标签页原生工程首页');
  h.step('create a native project and upload a genuine five-second MP4');
  const input=join(h.output,'five-seconds.mp4');
  await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',input]);
  await h.click('＋ 新建工程');await h.browser('wait','.cc-topbar');
  const projectUrl=await h.evaluate<string>('location.href');
  await h.browser('upload','.cc-media-pool input[type=file][multiple]',input);
  await h.browser('wait','[data-cc-media-asset-id]');
  await expect.poll(()=>h.evaluate<boolean>("!!document.querySelector('[data-cc-media-asset-id]')?.querySelector('img,video[poster]')"),{timeout:10000}).toBe(true);
  const readback=await h.evaluate<{src:string;status:number;type:string|null;dataUrl:string}>("(async()=>{const a=document.querySelector('[data-cc-media-asset-id]'),v=a.querySelector('video[poster],img'),src=new URL(v.tagName==='VIDEO'?v.poster:v.src,location.href).searchParams.get('src'),r=await fetch(src),blob=await r.blob(),dataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});return{src,status:r.status,type:r.headers.get('content-type'),dataUrl};})()");
  const actualBytes=Buffer.from(readback.dataUrl.split(',')[1],'base64'),readbackPath=join(h.output,'uploaded-http-readback.mp4');await writeFile(readbackPath,actualBytes);
  const expectedBytes=await readFile(input),hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(h.output,'asset-http.json'),JSON.stringify({src:readback.src,status:readback.status,type:readback.type,bytes:actualBytes.length,sha256:hash(actualBytes),expectedSha256:hash(expectedBytes)},null,2));
  expect(readback.status).toBe(200);expect(readback.type).toContain('video/');expect(hash(actualBytes)).toBe(hash(expectedBytes));
  await writeFile(join(h.output,'asset-ffprobe.json'),(await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',readbackPath])).stdout);
  await h.click('管理 five-seconds.mp4');await writeFile(join(h.output,'asset-menu.txt'),await h.browser('snapshot','-i'));
  await h.browser('find','role','menuitem','click','--name','添加 five-seconds.mp4 到时间线','--exact');
  await expect.poll(()=>h.evaluate<number>("document.querySelectorAll('[data-timeline-clip][data-clip-kind=video]').length"),{timeout:10000}).toBe(1);h.check('原生新工程上传并加入真实5秒MP4');
  h.step('split the timeline through the native blade tool');
  await h.click('刀片模式 (B)：点击片段在该处切分');
  const point=await h.evaluate<{x:number;y:number}>("(()=>{const r=document.querySelector('[data-timeline-clip][data-clip-kind=video]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()");
  await h.browser('mouse','move',String(point.x),String(point.y));await h.browser('mouse','down','left');await h.browser('mouse','up','left');
  await h.browser('wait','--fn',"document.querySelectorAll('[data-timeline-clip][data-clip-kind=video]').length === 2");h.check('原生刀片工具把时间线实际切成两段');
  h.step('verify native autosave by returning to the library and reopening');
  await h.click('返回工程列表');await h.browser('wait','--text','新建工程');
  await h.browser('reload');await h.browser('wait','--text','新建工程');
  // This navigation uses the exact URL observed when the user created the project.
  await h.browser('open',projectUrl);await h.browser('wait','--fn',"document.querySelectorAll('[data-timeline-clip][data-clip-kind=video]').length === 2");
  h.check('返回工程库、刷新后重开同一工程，自动保存的两段时间线仍在');
  await h.browser('screenshot',join(h.output,'native-timeline.png'));
  h.step('export through the native MP4 workflow and inspect the actual file');
  await h.click('导出 MP4');await h.browser('wait','.cc-export-cta');
  const exported=join(h.output,'native-export.mp4');await h.browser('download','.cc-export-cta',exported);
  expect((await lstat(exported)).size).toBeGreaterThan(1000);
  const probe=JSON.parse((await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',exported])).stdout);
  expect(probe.streams.some((stream:any)=>stream.codec_type==='video'&&stream.width>0&&stream.height>0)).toBe(true);
  expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(4.8);expect(Number(probe.format.duration)).toBeLessThanOrEqual(5.3);
  await writeFile(join(h.output,'ffprobe.json'),JSON.stringify(probe,null,2));
  expect((await h.f.c.query('SELECT count(*)::int n FROM public.accounts')).rows[0].n).toBe(0);
  h.check('原生实际MP4导出，ffprobe确认视频流与约5秒时长；仍无账号/生产单');
  await writeFile(join(h.output,'final-snapshot.txt'),await h.browser('snapshot'));await h.report(true);
 }catch(error){await writeFile(join(h.output,'failure-snapshot.txt'),await h.browser('snapshot').catch(()=>''));await writeFile(join(h.output,'failure-browser-errors.txt'),await h.browser('errors').catch(()=>''));await h.report(false,error);if(process.env.LOOP_ACCOUNT_NAVIGATION_KEEP_FAILED==='1'){console.log('[native] preserved for investigation: '+h.output);await writeFile(join(h.output,'paused.json'),JSON.stringify({session:h.session,output:h.output}));const until=Date.now()+180000;while(Date.now()<until){if(await lstat(join(h.output,'resume-cleanup')).then(()=>true,()=>false))break;await new Promise(resolve=>setTimeout(resolve,1000));}}throw error;}
 finally{await h.close();}
},600000);
