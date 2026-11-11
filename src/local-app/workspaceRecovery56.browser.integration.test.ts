// @vitest-environment node
import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {readWorkspaceCaption} from '../workspaceCaptions';

it.skipIf(process.env.LOOP_STATE56_ACCEPTANCE!=='1')('resumes caption and upload operations through real Owner HTTP, PostgreSQL and the Studio document store',async()=>{
 const f=await productionWorkspaceFixture(),evidence=process.env.LOOP_STORY_EVIDENCE!;
 const cli=promisify(execFile),sessionName='state56-'+f.episode;
 const browser=async(...args:string[])=>(await cli('agent-browser',['--session',sessionName,...args],{env:{...process.env,AGENT_BROWSER_ALLOWED_DOMAINS:'127.0.0.1,localhost'},maxBuffer:4*1024*1024})).stdout;
 let app:ViteDevServer|undefined,mode='captions',fault='',faulted=false;
 const commands:Array<{name:string;key:string;forwarded:boolean;status:number}>=[];
 const get=async(path:string)=>{const response=await fetch(f.origin+'/api/local/'+path,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);return response.json();};
 const read=async()=>(await get(`episodes/${f.episode}/workspace`)).workspace;
 let w:any,studio:any;
 const send=async(name:string,data:Record<string,unknown>={})=>{const result=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(result.status,JSON.stringify(result.body)).toBe(200);return result.body;};
 const captionText=async()=>{const native=JSON.parse(await readFile(join(f.assetRoot,(await read()).project.relativePath),'utf8'));return readWorkspaceCaption(native,w.clips[0].itemId)!.contract.text;};
 try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status,JSON.stringify(made.body)).toBe(200);w=await f.fillVisuals(made.body);
  const contract=defaultShotCaptionContract('原字幕','independent');contract.cues=[{id:'manual',text:'原字幕',startMs:0,endMs:900}];w=await send('saveWorkspaceCaptions',{clipId:w.clips[0].id,captionContract:contract});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;studio={studioUrl:opened.studioUrl,workspace:opened.workspace,sourcePath:w.project.relativePath};
  app=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'recovery-vite'),plugins:[react(),{name:'state56-real-boundary',configureServer(server){server.middlewares.use(async(req,res,next)=>{
   try{
    const url=new URL(req.url!,'http://fixture');
    if(url.pathname==='/__recovery'){mode=url.searchParams.get('mode')??'captions';res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__recovery','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>真实恢复验收</title><div id="root"></div><script type="module" src="/docs/verification/state-machines-56-20261111/browser-fixture.tsx"></script></html>'));return;}
    if(url.pathname==='/__blank'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>验收空白页</title>');return;}
    if(url.pathname==='/__state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({initial:await read(),session:studio,ownerId:f.owner,mode}));return;}
    if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/_local-artifact')){next();return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):null,name=body?.command??'',row={name,key:body?.idempotencyKey??'',forwarded:false,status:0};if(name)commands.push(row);
    if(!faulted&&(fault==='before-caption'&&name==='saveWorkspaceCaptions'||fault==='before-candidate'&&name==='registerWorkspaceVisualCandidate'||fault==='global-list'&&req.method==='GET'&&url.pathname.endsWith('/storyboard-planning')||fault==='account-list'&&req.method==='GET'&&url.pathname.endsWith('/workspace'))){faulted=true;row.status=503;res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'验收注入：读写暂时中断'}));return;}
    const response=await fetch(f.origin+req.url,{method:req.method,headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json',...(req.headers['x-csrf-token']?{'X-CSRF-Token':String(req.headers['x-csrf-token'])}:{})},...(raw?{body:raw}:{})});
    const bytes=Buffer.from(await response.arrayBuffer());row.forwarded=true;row.status=response.status;
    if(fault==='account-after-create'&&name==='createPromptVersion'&&response.ok){fault='account-list';faulted=false;}
    if(fault==='global-after-create'&&name==='createGlobalPromptVersion'&&response.ok){fault='global-list';faulted=false;}
    if(!faulted&&fault==='after-caption'&&name==='saveWorkspaceCaptions'&&response.ok){faulted=true;res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'验收注入：提交回执丢失'}));return;}
    res.statusCode=response.status;for(const key of ['content-type','cache-control']){const value=response.headers.get(key);if(value)res.setHeader(key,value);}res.end(bytes);
   }catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}
  });}}],optimizeDeps:{entries:['docs/verification/state-machines-56-20261111/browser-fixture.tsx']},server:{host:'127.0.0.1',port:0}});await app.listen();
  const base=`http://127.0.0.1:${(app.httpServer!.address() as {port:number}).port}/__recovery`;
  const open=async(next:string)=>{await browser('open',base+'?mode='+next);};
  // agent-browser cannot address this cross-origin OOPIF. Only open the host inspector
  // with its documented notification; all writable state and edit RPCs remain real.
  const nativePanel=async()=>{
   await browser('wait','iframe[title="OpenChatCut 剪辑工程"]');
   await browser('wait','--fn',"!!document.querySelector('iframe') && !document.querySelector('iframe').hasAttribute('inert')");
   await browser('eval',`(()=>{const frame=document.querySelector('iframe'),u=new URL(frame.src);window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,origin:u.origin,data:{type:'loop-control:caption-alignment-requested',channel:u.searchParams.get('lcChannel'),projectId:u.searchParams.get('lcProject')}}));})()`);
   await browser('wait','[aria-label="字幕正文"]');
  };
  fault='before-caption';faulted=false;await open('captions');await nativePanel();
  await browser('fill','[aria-label="字幕正文"]','真实保存后继续');await browser('find','role','button','click','--name','保存字幕');await browser('wait','--text','验收注入：读写暂时中断');
  expect(await captionText()).toBe('真实保存后继续');
  const savesBefore=commands.filter(c=>c.name==='saveWorkspaceStudio').length;
  await writeFile(join(evidence,'native-caption-interrupted.txt'),await browser('snapshot'));
  await browser('find','role','button','click','--name','继续保存字幕');await expect.poll(()=>commands.filter(c=>c.name==='saveWorkspaceCaptions').at(-1)?.status).toBe(200);await browser('wait','--fn',"!document.body.innerText.includes('继续保存字幕')");
  expect(commands.filter(c=>c.name==='saveWorkspaceStudio')).toHaveLength(savesBefore);expect(await captionText()).toBe('真实保存后继续');
  const attempts=commands.filter(c=>c.name==='saveWorkspaceCaptions');expect(attempts).toHaveLength(2);expect(attempts[0].key).toBe(attempts[1].key);expect(attempts.map(c=>c.forwarded)).toEqual([false,true]);
  await browser('open',base.replace('/__recovery','/__blank'));w=await read();w=await send('closeWorkspaceStudio');await f.restart();
  const reopened=await send('openWorkspaceStudio');w=reopened.productionWorkspace;studio={studioUrl:reopened.studioUrl,workspace:reopened.workspace,sourcePath:w.project.relativePath};
  const nativeResponse=await fetch(new URL('/api/project-store/entry?key='+encodeURIComponent('project:'+w.project.projectId),studio.studioUrl),{headers:{'Sec-Fetch-Site':'none'}});expect(nativeResponse.status).toBe(200);expect(readWorkspaceCaption((await nativeResponse.json()).value,w.clips[0].itemId)!.contract.text).toBe('真实保存后继续');
  await f.closeStudio();await f.restart();w=await read();
  // Non-native save commits a new SHA; the retry must reach the stored command receipt.
  fault='after-caption';faulted=false;await open('plain');await browser('wait','[aria-label="字幕正文"]');await browser('fill','[aria-label="字幕正文"]','真实未知回执');await browser('find','role','button','click','--name','保存字幕');await browser('wait','--text','验收注入：提交回执丢失');
  const committed=await read();expect(await captionText()).toBe('真实未知回执');const beforeUnknownRetry=commands.length;await browser('find','role','button','click','--name','继续保存字幕');await expect.poll(()=>commands.filter(c=>c.name==='saveWorkspaceCaptions').at(-1)?.status).toBe(200);await browser('wait','--fn',"!document.body.innerText.includes('继续保存字幕')");await expect.poll(()=>commands.slice(beforeUnknownRetry).some(c=>c.name==='saveWorkspaceCaptions'&&c.status===200)).toBe(true);expect((await read()).revision).toBe(committed.revision);
  const unknown=commands.filter(c=>c.name==='saveWorkspaceCaptions').slice(-2);expect(unknown[0].key).toBe(unknown[1].key);expect(unknown.map(c=>c.status)).toEqual([200,200]);
  fault='before-candidate';faulted=false;await open('uploads');await browser('wait','--fn',"!!document.querySelector('[aria-label=上传图片素材]')");
  const image=join(f.root,'recovery.png');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=red:size=32x32','-frames:v','1',image]);
  await browser('upload','[aria-label="上传图片素材"]',image);await browser('wait','--text','素材已导入');
  await browser('find','role','button','click','--name','关闭素材面板');await browser('find','role','button','click','--name','重开素材面板');await browser('find','role','button','click','--name','重试未完成项');await expect.poll(()=>commands.filter(c=>c.name==='registerWorkspaceVisualCandidate').at(-1)?.status).toBe(200);await browser('wait','--fn',"!document.body.innerText.includes('重试未完成项')");
  const uploads=commands.filter(c=>c.name==='importMaterial');expect(uploads).toHaveLength(1);
  const candidates=commands.filter(c=>c.name==='registerWorkspaceVisualCandidate');expect(candidates).toHaveLength(2);expect(candidates[0].key).toBe(candidates[1].key);expect((await read()).visualCandidates.filter((c:any)=>c.kind==='image')).toHaveLength(1);
  fault='global-after-create';faulted=false;await open('global');await browser('wait','[name="name"]');
  await browser('fill','[name="name"]','真实全局规划');await browser('fill','[name="summary"]','保留事实');await browser('fill','[name="instructions"]','按原文规划分镜');await browser('find','role','button','click','--name','保存新版本');await browser('wait','--text','列表读取未完成');
  for(const width of [1440,390]){await browser('set','viewport',String(width),'1000');await browser('screenshot',join(evidence,`planning-interrupted-${width}.png`));}
  await browser('find','role','button','click','--name','重新读取版本');await browser('wait','--text','新版本已登记并选中');await browser('find','role','button','click','--name','保存默认设置');await browser('wait','--text','已保存全局默认设置');
  const global=await get('storyboard-planning');expect(global.planningSelection.revision).toBe(1);expect(global.planningSelection.promptVersions).toHaveLength(1);expect(commands.filter(c=>c.name==='createGlobalPromptVersion')).toHaveLength(1);
  for(const width of [1440,390]){await browser('set','viewport',String(width),'1000');await browser('screenshot',join(evidence,`planning-${width}.png`));const layout=JSON.parse(await browser('eval','({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})'));await writeFile(join(evidence,`planning-layout-${width}.json`),JSON.stringify(layout,null,2)+'\n');expect(layout.scrollWidth).toBe(width);}
  const originalPlanning=(await get(`episodes/${f.episode}/workspace`)).planningSelection;
  fault='account-after-create';faulted=false;await open('planning');await browser('wait','[aria-label="分镜规划 Prompt Harness"]');
  await browser('click','[aria-label="分镜规划 Prompt Harness"]');await browser('find','role','button','click','--name','管理版本');await browser('find','role','button','click','--name','登记新版本');
  await browser('fill','[aria-label="版本名称"]','真实本期规划');await browser('fill','[aria-label="版本摘要"]','保留事实');await browser('fill','[aria-label="Harness 内容"]','按原文规划');await browser('find','role','button','click','--name','保存新版本');await browser('wait','--text','版本已登记，列表读取失败');
  await browser('screenshot',join(evidence,'account-harness-interrupted.png'));await browser('find','role','button','click','--name','保存新版本');await browser('wait','--fn',"!document.querySelector('[aria-label=版本名称]')");await browser('find','role','button','click','--name','返回分镜配置');await browser('find','role','button','click','--name','保存规划选择');await browser('wait','--text','已保存规划配置');
  const planning=(await get(`episodes/${f.episode}/workspace`)).planningSelection;expect(planning.revision).toBe(1);expect(planning.promptVersions).toHaveLength(originalPlanning.promptVersions.length+1);expect(planning.promptVersions.filter((h:any)=>h.name==='真实本期规划')).toHaveLength(1);expect(commands.filter(c=>c.name==='createPromptVersion')).toHaveLength(1);
  await writeFile(join(evidence,'recovery-boundaries.json'),JSON.stringify({passed:true,episodePlanningRevision:planning.revision,accountHarnessCount:planning.promptVersions.length,globalPlanningRevision:global.planningSelection.revision,globalHarnessCount:global.planningSelection.promptVersions.length,inspectorEntry:'host notification injected; native edit and persistence unmocked',nativeSaves:savesBefore,registrationAttempts:attempts,unknownAttempts:unknown,imports:uploads,candidates,captionAfterRestart:'真实保存后继续',unknownRevision:committed.revision},null,2)+'\n');
 }catch(error){await writeFile(join(evidence,'browser-failure.txt'),await browser('snapshot').catch(String));await browser('screenshot',join(evidence,'browser-failure.png')).catch(()=>{});throw error;}finally{await browser('close').catch(()=>{});await app?.close();await f.close();}
},300_000);
