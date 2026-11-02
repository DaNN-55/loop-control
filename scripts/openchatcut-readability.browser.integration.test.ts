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

// WCAG relative luminance, applied to actual computed opaque editor surfaces.
function contrastReadings(selectors:string[]){
 const luminance=(color:string)=>{const c=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 return selectors.map(selector=>{const e=document.querySelector(selector)!;let ancestor:Element|null=e,bg='';while(ancestor){bg=getComputedStyle(ancestor).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')break;ancestor=ancestor.parentElement;}
 const ink=getComputedStyle(e).color,a=luminance(ink),b=luminance(bg);return{selector,ink,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
}

it.skipIf(process.env.LOOP_NATIVE_READABILITY_ACCEPTANCE!=='1')('native embedded editing keeps exact values and readable text at compact sizes',async()=>{
 const f=await productionWorkspaceFixture(),evidence=process.env.LOOP_STORY_EVIDENCE!;
 const session='native-readability-'+f.episode,exec=promisify(execFile),extension=join(f.root,'zoom-extension');
 await mkdir(extension,{recursive:true});
 await writeFile(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Loop isolated native zoom acceptance',version:'1.0',permissions:['tabs'],host_permissions:['http://127.0.0.1/*'],background:{service_worker:'background.js'}}));
 await writeFile(join(extension,'background.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
 const browser=async(...args:string[])=>(await exec('agent-browser',['--session',session,'--extension',extension,...args],{timeout:40000,maxBuffer:8*1024*1024})).stdout;
 let app:ViteDevServer|undefined,socket:WebSocket|undefined;
 try{
  await mkdir(evidence,{recursive:true});
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const still=join(f.root,'preview.png');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=360x640','-frames:v','1',still]);
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'preview.png',mimeType:'image/png',contentBase64:(await readFile(still)).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
  const matched=await f.request('matchWorkspaceImage',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,materialRevisionId:image.body.id,usage:'still',durationSeconds:2,fit:'contain',focusX:0,focusY:0});expect(matched.status,JSON.stringify(matched.body)).toBe(200);w=await f.fillVisuals(matched.body);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);
  const studio=opened.body;w=studio.productionWorkspace??w;
  const code=`import{createRoot}from'react-dom/client';import{EmbeddedStudioHost}from'./EmbeddedStudioHost';import'../styles.css';import'../ui/impeccable/foundation.css';import'../ui/impeccable/production.css';import'./production-compact.css';createRoot(document.getElementById('root')).render(<div className="impeccable-app product-ui dan-ui"><main className="lc-production-workspace"><div className="local-episode-detail"><div data-compact-workflow><div className="production-workspace-body"><div><EmbeddedStudioHost episodeId=${JSON.stringify(f.episode)} title="原生键盘与语义验证" session={${JSON.stringify({...studio,sourcePath:w.project.relativePath})}} shots={${JSON.stringify(w.clips)}} onClose={()=>{}} onSave={async workspace=>workspace}/></div></div></div></div></main></div>);`;
  const entry=join(process.cwd(),'src/local-app/__nativeA11y.tsx');
  app=await createServer({root:process.cwd(),configFile:false,envFile:false,cacheDir:join(f.root,'a11y-vite'),plugins:[react(),{name:'native-readability-fixture',resolveId(id){if(id==='/__nativeA11y.tsx')return entry;},load(id){if(id===entry)return code;},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/__nativeA11y')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__nativeA11y','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><title>原生键盘隔离验收</title><div id="root"></div><script type="module" src="/__nativeA11y.tsx"></script></html>'));});}}],server:{host:'127.0.0.1',port:0}});await app.listen();
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
  const initialAxe=JSON.parse(await browser('a11y','--json'));await writeFile(join(evidence,'before-axe.json'),JSON.stringify(initialAxe,null,2));
  expect(initialAxe.data.violations.filter((v:any)=>v.id==='color-contrast'), 'required embedded text meets WCAG AA').toEqual([]);
  await browser('set','viewport','900','768');
  await browser('find','first','.workspace-shot-select','click');
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const compact=await evaluate(`(()=>{const r=e=>{const x=e.getBoundingClientRect();return {left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height}};return {viewport:{width:innerWidth,height:innerHeight},inspector:r(document.querySelector('.cc-inspector')),rows:[...document.querySelectorAll('.cc-insp-row')].map(e=>({row:r(e),children:[...e.children].map(r)})),timeline:r(document.querySelector('.cc-timeline-ruler'))}})()`);
  const hostCompact=JSON.parse(await browser('eval',`({iframe:document.querySelector('iframe').getBoundingClientRect().toJSON(),save:document.querySelector('.embedded-studio-save').getBoundingClientRect().toJSON(),height:innerHeight})`));
  await writeFile(join(evidence,'compact-900.json'),JSON.stringify({compact,hostCompact},null,2));await browser('screenshot',join(evidence,'compact-900.png'));
  expect(compact.inspector.width,'exact property values retain usable width').toBeGreaterThanOrEqual(240);
  for(const row of compact.rows)for(const child of row.children){expect(child.right,'property fields stay inside their row').toBeLessThanOrEqual(row.row.right+1);}
  expect(hostCompact.iframe.bottom,'native editing surface fits the compact viewport').toBeLessThanOrEqual(768);
  expect(hostCompact.iframe.top+compact.timeline.bottom,'timeline ruler reachable in the compact viewport').toBeLessThanOrEqual(768);
  const preciseLabel=await evaluate(`(()=>{const e=document.querySelector('.cc-insp-scalar');e.focus();return e.getAttribute('aria-label')})()`);expect(preciseLabel).toContain('缩放');
  await browser('press','Enter');await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  expect(await evaluate(`document.activeElement.className`)).toBe('cc-insp-number');await browser('keyboard','type','125');
  await writeFile(join(evidence,'precise-input.json'),JSON.stringify(await evaluate(`({label:document.activeElement.getAttribute('aria-label'),value:document.activeElement.value})`),null,2));
  await browser('press','Enter');await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  expect(await evaluate(`document.querySelector('.cc-insp-scalar').textContent`)).toBe('125%');
  await browser('find','role','button','click','--name','生成、版本与对齐','--exact');await browser('wait','--text','收起补充工具');
  await browser('screenshot',join(evidence,'compact-tools-900.png'));
  const supplemental=JSON.parse(await browser('eval','({save:document.querySelector(".embedded-studio-save").getBoundingClientRect().toJSON(),tools:document.querySelector(".embedded-studio-caption-panel").getBoundingClientRect().toJSON()})'));
  await writeFile(join(evidence,'compact-tools-900.json'),JSON.stringify(supplemental,null,2));expect(supplemental.tools.height).toBeGreaterThan(100);expect(supplemental.tools.width).toBeGreaterThan(240);expect(supplemental.save.bottom).toBeLessThanOrEqual(768);
  await browser('find','role','button','click','--name','收起补充工具','--exact');await browser('wait','--text','生成、版本与对齐');
  await browser('set','viewport','1440','600');
  const low=JSON.parse(await browser('eval','({frame:document.querySelector("iframe").getBoundingClientRect().toJSON(),height:innerHeight})'));await writeFile(join(evidence,'low-height.json'),JSON.stringify(low,null,2));expect(low.frame.bottom).toBeLessThanOrEqual(low.height);
  await browser('set','viewport','1440','1000');
  // Each skin uses its own actual palette, including the host's light/dark theme.
  const themeEvidence:any[]=[];
  for(const [name,theme] of [['石墨','dark'],['墨黑','dark'],['摩卡','dark'],['北极','dark'],['东京夜','dark'],['拿铁','light']]){
   await browser('eval',`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
   await evaluate(`document.querySelector('button[aria-label="皮肤"]').click();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
   await evaluate(`([...document.querySelectorAll('[role=menuitemradio]')].find(e=>e.textContent.includes(${JSON.stringify(name)}))).click()`);
   await browser('eval','Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))');
   const scan=JSON.parse(await browser('a11y','--json'));await writeFile(join(evidence,'axe-'+theme+'-'+name+'.json'),JSON.stringify(scan,null,2));
   if(name==='石墨')await browser('screenshot',join(evidence,'theme-dark.png'));
   const nativeInks=await evaluate('('+contrastReadings.toString()+')('+JSON.stringify(['button[aria-label="导出 MP4"]','.cc-main-tab:not(.selected)','.cc-insp-scope > span:nth-child(2)','.cc-ruler-head span','.cc-track-name-title','.cc-track-name-custom'])+')');
   const hostInks=JSON.parse(await browser('eval','('+contrastReadings.toString()+')('+JSON.stringify(['.embedded-studio [role=status]','.workspace-shot-select small'])+')'));
   for(const ink of [...nativeInks,...hostInks])expect(ink.ratio,`${name} ${ink.selector}`).toBeGreaterThanOrEqual(4.5);
   const disabled=await evaluate(`(()=>{const e=document.querySelector('.cc-insp-tabs button:disabled');return{disabled:e.disabled,opacity:getComputedStyle(e).opacity}})()`);expect(disabled.disabled).toBe(true);expect(Number(disabled.opacity)).toBeLessThan(1);
   themeEvidence.push({name,theme,nativeInks,hostInks,disabled,contrast:scan.data.violations.filter((v:any)=>v.id==='color-contrast')});
   expect(themeEvidence.at(-1).contrast,`readable required text in ${name}`).toEqual([]);
   await browser('press','Escape');
   if(name==='石墨'||name==='拿铁'){
    const frameBox=JSON.parse(await browser('eval','document.querySelector("iframe").getBoundingClientRect().toJSON()'));
    const exportBox=await evaluate(`document.querySelector('button[aria-label="导出 MP4"]').getBoundingClientRect().toJSON()`);
    await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:frameBox.left+exportBox.left+exportBox.width/2,y:frameBox.top+exportBox.top+exportBox.height/2});
    await evaluate(`document.querySelector('button[aria-label="导出 MP4"]').focus()`);
    const nativeState=await evaluate(`(()=>{const e=document.querySelector('button[aria-label="导出 MP4"]');return{hover:e.matches(':hover'),focus:e.matches(':focus-visible'),outline:getComputedStyle(e).outlineWidth}})()`);expect(nativeState.hover).toBe(true);expect(nativeState.focus).toBe(true);
    const stateScan=JSON.parse(await browser('a11y','--json'));expect(stateScan.data.violations.filter((v:any)=>v.id==='color-contrast')).toEqual([]);
    const hostSelector='.workspace-shot-row:first-child .workspace-shot-select';await browser('hover',hostSelector);await browser('focus',hostSelector);await browser('press','Shift+Tab');await browser('press','Tab');
    await browser('eval','Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))');
    const hostState=JSON.parse(await browser('eval',`(()=>{const e=document.querySelector('${hostSelector}');return{hover:e.matches(':hover'),focus:e.matches(':focus-visible'),selected:e.getAttribute('aria-pressed'),outline:getComputedStyle(e).outlineWidth}})()`));await writeFile(join(evidence,'host-state-'+theme+'.json'),JSON.stringify(hostState,null,2));expect(hostState.hover).toBe(true);expect(hostState.focus).toBe(true);expect(hostState.selected).toBe('true');
    const hostStateInks=JSON.parse(await browser('eval','('+contrastReadings.toString()+')('+JSON.stringify(['.workspace-shot-select small'])+')'));expect(hostStateInks[0].ratio).toBeGreaterThanOrEqual(4.5);
    await writeFile(join(evidence,'states-'+theme+'.json'),JSON.stringify({nativeState,hostState,hostStateInks,axe:stateScan},null,2));
   }
  }
  await writeFile(join(evidence,'themes.json'),JSON.stringify(themeEvidence,null,2));
  // chrome.tabs.setZoom changes browser zoom in this disposable profile. It is
  // neither CSS zoom nor the CDP visual/pinch scale factor.
  const workerEval=async(target:any,expression:string)=>{const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise<void>((r,j)=>{ws.onopen=()=>r();ws.onerror=j;});try{return await new Promise<any>((r,j)=>{ws.onmessage=event=>{const v=JSON.parse(String(event.data));if(v.id!==1)return;if(v.error||v.result.exceptionDetails)j(Error(JSON.stringify(v)));else r(v.result.result.value);};ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});}finally{ws.close();}};
  const workers=await(await fetch(cdpUrl.replace('ws://','http://').replace(/\/devtools\/browser\/.*/, '/json/list'))).json();
  let zoomWorker:any;for(const candidate of workers.filter((t:any)=>t.type==='service_worker'&&t.url.endsWith('/background.js'))){if(await workerEval(candidate,'chrome.runtime.getManifest().name')==='Loop isolated native zoom acceptance'){zoomWorker=candidate;break;}}expect(zoomWorker,'private zoom extension loaded').toBeTruthy();
  const setZoom=(factor:number)=>workerEval(zoomWorker,`(async()=>{const tab=(await chrome.tabs.query({})).find(t=>t.url?.includes('/__nativeA11y'));await chrome.tabs.setZoom(tab.id,${factor});return{factor:await chrome.tabs.getZoom(tab.id),tabId:tab.id}})()`);
  const windowInfo=await cdp('Browser.getWindowForTarget');await cdp('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{width:1440,height:1000,windowState:'normal'}});await cdp('Emulation.clearDeviceMetricsOverride');
  const unzoomed=JSON.parse(await browser('eval','({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})'));
  const actualZoom=await setZoom(2);
  await browser('find','role','button','click','--name','专注剪辑','--exact');
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const zoomed=JSON.parse(await browser('eval','({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,cssZoom:getComputedStyle(document.documentElement).zoom,save:document.querySelector(".embedded-studio-save").getBoundingClientRect().toJSON(),frame:document.querySelector("iframe").getBoundingClientRect().toJSON()})'));
  await writeFile(join(evidence,'browser-zoom-200.json'),JSON.stringify({actualZoom,unzoomed,zoomed,workerUrl:zoomWorker.url,native:await evaluate('({width:innerWidth,height:innerHeight,inspector:document.querySelector(".cc-inspector").getBoundingClientRect().toJSON(),timeline:document.querySelector(".cc-timeline-ruler").getBoundingClientRect().toJSON()})')},null,2));await browser('screenshot',join(evidence,'browser-zoom-200.png'));
  expect(actualZoom.factor).toBe(2);expect(zoomed.dpr).toBeGreaterThan(unzoomed.dpr);expect(zoomed.width).toBeLessThan(unzoomed.width);expect(zoomed.cssZoom).toBe('1');expect(zoomed.save.bottom).toBeLessThanOrEqual(zoomed.height);expect(zoomed.frame.bottom).toBeLessThanOrEqual(zoomed.height);
  await setZoom(1);await browser('find','role','button','click','--name','专注剪辑','--exact');
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
  expect(axe.success).toBe(true);expect(axe.data.axeVersion).toBeTruthy();const violations=axe.data.violations;expect(violations.filter((v:any)=>v.id==='color-contrast')).toEqual([]);expect(violations.filter((v:any)=>['aria-required-attr','image-alt','label-title-only','nested-interactive'].includes(v.id))).toEqual([]);

  expect(await browser('eval',`document.querySelector('iframe').inert`)).toContain('false');
  await writeFile(join(evidence,'native-readability-snapshot.txt'),await browser('snapshot'));
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:studio.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace??saved.body;
  const doc=await editStudioDocument(studio.studioUrl,w.project.projectId,()=>{});expect(doc.timelines[0].items.find((i:any)=>i.kind==='image')?.transform?.scale).toBe(1.25);expect(doc.timelines[0].items.some((i:any)=>i.kind==='audio'&&i.name==='Simple Whoosh')).toBe(true);
  await writeFile(join(evidence,'native-readability-dom.json'),JSON.stringify({dividers,zoom,sound,items:doc.timelines[0].items},null,2));
  await browser('close');
  expect((await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(200);
  const reopened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopened.status,JSON.stringify(reopened.body)).toBe(200);
  const reopenedDoc=await editStudioDocument(reopened.body.studioUrl,w.project.projectId,()=>{});expect(reopenedDoc.timelines[0].items.find((i:any)=>i.kind==='image')?.transform?.scale).toBe(1.25);expect(reopenedDoc.timelines[0].items.some((i:any)=>i.kind==='audio'&&i.name==='Simple Whoosh')).toBe(true);
  await writeFile(join(evidence,'reopened-sound.json'),JSON.stringify(reopenedDoc.timelines[0].items.filter((i:any)=>i.kind==='audio'),null,2));

 }catch(error){await writeFile(join(evidence,'browser-failure.txt'),String(error)+'\n'+await browser('snapshot').catch(()=>'')+'\n'+await browser('errors').catch(()=>''));throw error;}
 finally{socket?.close();await browser('close').catch(()=>{});await app?.close();await f.close();}
},240000);
