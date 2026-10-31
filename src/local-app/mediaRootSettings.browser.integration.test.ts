// @vitest-environment node
import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,unlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
const exec=promisify(execFile);
it.skipIf(process.env.LOOP_MEDIA_ROOT_BROWSER!=='1')('formal Owner storage settings initialize, copy and open the real root, preserve errors and read the same location after reload',async()=>{
 const fixture=await nativeMediaRootFixture(),{f,source,target,configFile}=fixture;let vite:ViteDevServer|undefined;
 const runtime=await fixture.launch(),session='media-root-'+randomUUID(),entryPath='src/local-app/.media-root-entry-'+randomUUID()+'.tsx';
 const browser=async(...args:string[])=>(await exec('agent-browser',['--session',session,...args],{timeout:40000,maxBuffer:2_000_000})).stdout;
 const baselineAppPath='src/local-app/.media-root-baseline-'+randomUUID()+'.tsx',baselineEntryPath=entryPath.replace('.tsx','-baseline.tsx');
 const output=process.env.LOOP_ACCEPTANCE_OUTPUT??join(f.root,'browser-evidence');await mkdir(output,{recursive:true});
 try{
 const proxy={target:runtime.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',runtime.origin));}};
 await writeFile(baselineAppPath,(await exec('git',['show','47c90f20:src/local-app/LocalCatalogApp.tsx'])).stdout);
 await writeFile(entryPath,"import {createRoot} from 'react-dom/client';import {LocalCatalogApp} from './LocalCatalogApp';import '/src/styles.css';import '/src/ui/impeccable/foundation.css';import '/src/ui/impeccable/configuration.css';import '/src/ui/impeccable/maintenance.css';import '/src/ui/impeccable/production.css';import '/src/ui/impeccable/scroll-layout.css';createRoot(document.getElementById('root')).render(<LocalCatalogApp/>);");
 await writeFile(baselineEntryPath,(await readFile(entryPath,'utf8')).replace("'./LocalCatalogApp'",JSON.stringify('./'+baselineAppPath.split('/').at(-1)!.replace('.tsx',''))));
 vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'media-root-fixture',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!['/__media-root','/__media-root-baseline'].includes(req.url??'')){next();return;}const selectedEntry=req.url==='/__media-root-baseline'?baselineEntryPath:entryPath;res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__media-root',`<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本机存储隔离验收</title><div id="root"></div><script type="module" src="/${selectedEntry}"></script>`));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();const origin=`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}`;
 await browser('open',origin+'/__media-root');
 await browser('wait','--text','登录控制台');await browser('find','label','邮箱','fill',f.email);await browser('find','label','密码','fill',f.password);await browser('find','role','button','click','--name','使用密码登录','--exact');await browser('wait','--text','工作台');
 const accountNavigation=(await browser('snapshot','-i')).includes('button \"账号蓝图\"')?'账号蓝图':'账号';await browser('find','role','button','click','--name',accountNavigation,'--exact');
 const openSettings=async()=>{await browser('find','role','button','click','--name','所有者设置','--exact');await browser('find','role','menuitem','click','--name','本机存储','--exact');await browser('wait','--text','媒体根目录');};
 await openSettings();await browser('wait','--fn',"document.querySelector('[aria-label=\"初始化位置\"]') !== null");expect(await browser('eval',"document.querySelector('[aria-label=\"初始化位置\"]').value")).toContain(source);
 await browser('find','label','初始化位置','fill',fixture.runtimeRoot);await browser('find','role','button','click','--name','初始化媒体根','--exact');await browser('wait','--text','不能与源位置');expect(await browser('eval',"document.querySelector('[aria-label=\"初始化位置\"]').value")).toContain(fixture.runtimeRoot);
 await browser('find','label','初始化位置','fill',target);await browser('find','role','button','click','--name','初始化媒体根','--exact');await browser('wait','--text','媒体根已初始化，服务已重新加载。');expect(JSON.parse(await readFile(configFile,'utf8')).mediaRoot).toBe(target);
 await browser('find','role','button','click','--name','复制媒体根路径','--exact');await browser('wait','--text','路径已复制。');
 await browser('find','role','button','click','--name','打开文件夹','--exact');await browser('wait','--text','已打开媒体根文件夹。');
 const widths:Array<{width:number;documentWidth:number;dialogWidth:number}>=[];
 for(const [width,height] of [[1440,1000],[1100,850],[390,844]]){await browser('set','viewport',String(width),String(height));await browser('screenshot',join(output,`media-root-${width}.png`));const metrics=JSON.parse(await browser('eval',`(()=>{const dialog=document.querySelector('[aria-label="本机存储"][role=dialog]'),box=dialog.getBoundingClientRect();return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,dialogWidth:dialog.scrollWidth,dialogClientWidth:dialog.clientWidth,left:box.left,right:box.right};})()`));expect(metrics.dialogWidth).toBeLessThanOrEqual(metrics.dialogClientWidth);expect(metrics.left).toBeGreaterThanOrEqual(0);expect(metrics.right).toBeLessThanOrEqual(width);widths.push(metrics);}

 await browser('press','Escape');await browser('wait','--fn',"document.querySelector('[aria-label=\"本机存储\"][role=dialog]')===null");expect(await browser('eval',"document.activeElement?.getAttribute('aria-label')")).toContain('所有者设置');
 await browser('reload');await browser('wait','--text','工作台');await openSettings();await browser('wait','--fn',`document.querySelector('[aria-label="初始化位置"]')?.value===${JSON.stringify(target)}`);await writeFile(join(output,'browser-snapshot.txt'),await browser('snapshot'));
 await browser('open',origin+'/__media-root-baseline');await browser('wait','--text','工作台');await browser('find','role','button','click','--name','账号蓝图','--exact');await browser('set','viewport','390','844');const baselineWidth=Number((await browser('eval','document.documentElement.scrollWidth')).trim());await browser('screenshot',join(output,'before-feature-account-390.png'));expect(widths.find(item=>item.width===390)!.documentWidth).toBeLessThanOrEqual(baselineWidth);
 await writeFile(join(output,'browser-result.json'),JSON.stringify({formalOwnerPage:true,nativeProcess:runtime.pid,root:target,clipboardWriteCompleted:true,clipboardReadback:"unverified: isolated browser denied read permission; see retained failure logs",nativeFolderOpened:true,errorPreserved:true,widths,beforeFeatureAccountWidth390:baselineWidth,refreshReadback:true},null,2));
 }catch(error){await writeFile(join(output,'browser-failure-snapshot.txt'),await browser('snapshot').catch(()=>''));await writeFile(join(output,'browser-failure-errors.txt'),await browser('errors').catch(()=>''));throw error;}finally{await browser('close').catch(()=>{});await vite?.close();await unlink(entryPath).catch(()=>{});await unlink(baselineAppPath).catch(()=>{});await unlink(baselineEntryPath).catch(()=>{});await fixture.close();}
},240000);
