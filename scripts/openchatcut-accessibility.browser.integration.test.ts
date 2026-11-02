// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {productionWorkspaceFixture} from '../src/local-app/productionWorkspace.fixture';
import {editStudioDocument} from '../src/local-app/studioDocument.fixture';

it.skipIf(process.env.LOOP_NATIVE_A11Y_ACCEPTANCE!=='1')('native embedded menus and media controls expose keyboard and accessible semantics',async()=>{
 const f=await productionWorkspaceFixture(),evidence=process.env.LOOP_STORY_EVIDENCE!;
 const session='native-a11y-'+f.episode,exec=promisify(execFile);
 const browser=async(...args:string[])=>(await exec('agent-browser',['--session',session,...args],{timeout:40000,maxBuffer:8*1024*1024})).stdout;
 let app:ViteDevServer|undefined,socket:WebSocket|undefined;
 try{
  await mkdir(evidence,{recursive:true});
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const still=join(f.root,'preview.png');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=360x640','-frames:v','1',still]);
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'preview.png',mimeType:'image/png',contentBase64:(await readFile(still)).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
  const matched=await f.request('matchWorkspaceImage',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,materialRevisionId:image.body.id,usage:'still',durationSeconds:2,fit:'contain',focusX:0,focusY:0});expect(matched.status,JSON.stringify(matched.body)).toBe(200);w=await f.fillVisuals(matched.body);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);
  const studio=opened.body;w=studio.productionWorkspace??w;
  const code=`import{createRoot}from'react-dom/client';import{EmbeddedStudioHost}from'./EmbeddedStudioHost';import'../styles.css';import'../ui/impeccable/foundation.css';import'../ui/impeccable/production.css';createRoot(document.getElementById('root')).render(<EmbeddedStudioHost episodeId=${JSON.stringify(f.episode)} title="原生键盘与语义验证" session={${JSON.stringify({...studio,sourcePath:w.project.relativePath})}} shots={${JSON.stringify(w.clips)}} onClose={()=>{}} onSave={async workspace=>workspace}/>);`;
  const entry=join(process.cwd(),'src/local-app/__nativeA11y.tsx');
  app=await createServer({root:process.cwd(),configFile:false,envFile:false,cacheDir:join(f.root,'a11y-vite'),plugins:[react(),{name:'native-a11y-fixture',resolveId(id){if(id==='/__nativeA11y.tsx')return entry;},load(id){if(id===entry)return code;},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/__nativeA11y')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__nativeA11y','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><title>原生键盘隔离验收</title><div id="root"></div><script type="module" src="/__nativeA11y.tsx"></script></html>'));});}}],server:{host:'127.0.0.1',port:0}});await app.listen();
  await browser('open',`http://127.0.0.1:${(app.httpServer!.address() as {port:number}).port}/__nativeA11y`);await browser('set','viewport','1440','1000');await browser('wait','--text','编辑器已连接');
  // CDP evaluates the actual cross-origin iframe DOM; browser press delivers trusted keyboard input.
  const cdpUrl=(await browser('get','cdp-url')).trim().replace(/^"|"$/g,'');
  const targets=await(await fetch(cdpUrl.replace('ws://','http://').replace(/\/devtools\/browser\/.*/, '/json/list'))).json();
  const target=targets.find((t:any)=>t.type==='page'&&t.url.includes('/__nativeA11y'));expect(target).toBeTruthy();
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise<void>((resolve,reject)=>{socket!.onopen=()=>resolve();socket!.onerror=reject;});
  let nextId=0;const pending=new Map<number,{resolve:(x:any)=>void;reject:(e:Error)=>void}>(),contexts:any[]=[];
  socket.onmessage=event=>{const v=JSON.parse(String(event.data));if(v.method==='Runtime.executionContextCreated')contexts.push(v.params.context);const p=pending.get(v.id);if(p){pending.delete(v.id);v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}};
  const cdp=(method:string,params:any={})=>new Promise<any>((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket!.send(JSON.stringify({id,method,params}));});
  await cdp('Runtime.enable');await cdp('Page.enable');
  const tree=await cdp('Page.getFrameTree');const nativeFrame=tree.frameTree.childFrames.find((x:any)=>x.frame.url.startsWith(new URL(studio.studioUrl).origin)).frame.id;
  const ctx=contexts.find(c=>c.auxData?.frameId===nativeFrame&&c.auxData?.isDefault);expect(ctx).toBeTruthy();
  const evaluate=async(expression:string)=>{const result=await cdp('Runtime.evaluate',{expression,contextId:ctx.id,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  await evaluate(`document.querySelector('button[aria-label="皮肤"]').focus()`);await browser('press','Enter');
  await evaluate(`document.querySelector('[role=menuitemradio]').focus()`);await browser('press','Escape');
  await writeFile(join(evidence,'menu-escape.json'),JSON.stringify(await evaluate(`({open:!!document.querySelector('[role=menu][aria-label="皮肤"]'),focus:document.activeElement?.getAttribute('aria-label')})`),null,2));
  expect(await evaluate(`!!document.querySelector('[role=menu][aria-label="皮肤"]')`),'Escape closes the normal embedded skin menu').toBe(false);
  expect(await evaluate(`document.activeElement.getAttribute('aria-label')`)).toBe('皮肤');
  await browser('press','ArrowDown');expect(await evaluate(`document.activeElement.getAttribute('role')`)).toBe('menuitemradio');
  const first=await evaluate('document.activeElement.textContent');await browser('press','ArrowDown');expect(await evaluate('document.activeElement.textContent')).not.toBe(first);
  await browser('press','Home');expect(await evaluate('document.activeElement.textContent')).toBe(first);await browser('press','End');const last=await evaluate('document.activeElement.textContent');await browser('press','Enter');await browser('press','Escape');
  await browser('press','ArrowUp');expect(await evaluate('document.activeElement.textContent')).toBe(last);await browser('press','Escape');
  const hostBefore=await browser('eval',`document.querySelector('.embedded-studio').className`);await browser('press','ArrowDown');await browser('press','Tab');expect(await evaluate(`!!document.querySelector('[role=menu][aria-label="皮肤"]')`)).toBe(false);expect(await browser('eval',`document.querySelector('.embedded-studio').className`)).toBe(hostBefore);
  const dividers=await evaluate(`[...document.querySelectorAll('.cc-panel-divider')].map(e=>({name:e.getAttribute('aria-label'),orientation:e.getAttribute('aria-orientation'),value:e.getAttribute('aria-valuenow'),min:e.getAttribute('aria-valuemin'),max:e.getAttribute('aria-valuemax')}))`);
  expect(dividers).toHaveLength(2);for(const d of dividers){expect(d.name).not.toBe('拖动调整大小');expect(Number(d.value)).toBeGreaterThan(Number(d.min));expect(Number(d.value)).toBeLessThan(Number(d.max));}
  await evaluate(`document.querySelector('.cc-panel-divider[aria-orientation=vertical]').focus()`);const before=Number(await evaluate(`document.activeElement.getAttribute('aria-valuenow')`));await browser('press','ArrowRight');await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);expect(Number(await evaluate(`document.activeElement.getAttribute('aria-valuenow')`))).toBeGreaterThan(before);
  const zoom=await evaluate(`(()=>{const e=document.querySelector('.cc-timeline-zoom');e.focus();return{label:e.getAttribute('aria-label'),value:Number(e.value)}})()`);expect(zoom.label).toBe('缩放时间轴');await browser('press','ArrowRight');expect(await evaluate(`Number(document.querySelector('.cc-timeline-zoom').value)`)).toBeGreaterThan(zoom.value);
  // The preview uses the actual media asset name, not an invented visual description.
  expect(await evaluate(`document.querySelectorAll('.cc-preview-workspace img[alt]').length`)).toBeGreaterThan(0);
  expect(await evaluate(`document.querySelectorAll('.cc-preview-workspace img:not([alt])').length`)).toBe(0);
  await evaluate(`([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='资源库')).click()`);
  await evaluate(`([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='音效')).click()`);
  const sound=await evaluate(`(()=>{const list=document.querySelector('.cc-sound-list'),row=list?.querySelector('.cc-sound-row');return{list:list?.getAttribute('role'),row:row?.getAttribute('role'),buttons:row?.querySelectorAll('button').length}})()`);
  expect(sound).toEqual({list:'list',row:'listitem',buttons:2});
  await evaluate(`document.querySelector('.cc-sound-glyph').focus()`);await browser('press','Enter');expect(await evaluate(`document.querySelector('.cc-sound-glyph').getAttribute('aria-label')`)).toContain('暂停');await browser('press','Enter');
  await evaluate(`document.querySelector('.cc-sound-add').focus()`);await browser('press','Enter');
  // Flush the same native host bridge, then use the real Owner save/reopen boundary.
  await browser('find','role','button','click','--name','保存工作版本','--exact');await browser('wait','--text','工作版本已保存');
  expect(await browser('eval',`document.querySelector('iframe').inert`)).toContain('false');
  await browser('screenshot',join(evidence,'native-a11y.png'));const axe=JSON.parse(await browser('a11y','--json'));await writeFile(join(evidence,'axe.json'),JSON.stringify(axe,null,2));
  expect(axe.success).toBe(true);expect(axe.data.axeVersion).toBeTruthy();const violations=axe.data.violations;expect(violations.filter((v:any)=>['aria-required-attr','image-alt','label-title-only','nested-interactive'].includes(v.id))).toEqual([]);

  expect(await browser('eval',`document.querySelector('iframe').inert`)).toContain('false');
  await writeFile(join(evidence,'native-a11y-snapshot.txt'),await browser('snapshot'));
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:studio.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace??saved.body;
  const doc=await editStudioDocument(studio.studioUrl,w.project.projectId,()=>{});expect(doc.timelines[0].items.some((i:any)=>i.kind==='audio'&&i.name==='Simple Whoosh')).toBe(true);
  await writeFile(join(evidence,'native-a11y-dom.json'),JSON.stringify({dividers,zoom,sound,items:doc.timelines[0].items},null,2));
  await browser('close');
  expect((await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(200);
  const reopened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopened.status,JSON.stringify(reopened.body)).toBe(200);
  const reopenedDoc=await editStudioDocument(reopened.body.studioUrl,w.project.projectId,()=>{});expect(reopenedDoc.timelines[0].items.some((i:any)=>i.kind==='audio'&&i.name==='Simple Whoosh')).toBe(true);
  await writeFile(join(evidence,'reopened-sound.json'),JSON.stringify(reopenedDoc.timelines[0].items.filter((i:any)=>i.kind==='audio'),null,2));

 }catch(error){await writeFile(join(evidence,'browser-failure.txt'),String(error)+'\n'+await browser('snapshot').catch(()=>'')+'\n'+await browser('errors').catch(()=>''));throw error;}
 finally{socket?.close();await browser('close').catch(()=>{});await app?.close();await f.close();}
},240000);
