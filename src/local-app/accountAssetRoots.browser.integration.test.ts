// @vitest-environment node
import {it} from 'vitest';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer as portServer} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
it.skipIf(process.env.LOOP_ACCOUNT_ROOT_BROWSER!=='1')('renders the actual account directory controls against an isolated Owner server',async()=>{
 const f=await embeddedStudioFixture();const entry='src/local-app/t07-browser-entry.tsx';let vite:any;
 try{
 const newRoot=join(f.root,'browser-account');await mkdir(newRoot);
 await writeFile(entry,"import {createRoot} from 'react-dom/client';import {LocalCatalogApp} from './LocalCatalogApp';import '../styles.css';import '../ui/impeccable/foundation.css';import '../ui/impeccable/configuration.css';import '../ui/impeccable/maintenance.css';import '../ui/impeccable/production.css';import '../ui/impeccable/scroll-layout.css';createRoot(document.getElementById('root')!).render(<LocalCatalogApp/>);");
 const listener=portServer();await new Promise<void>(done=>listener.listen(0,'127.0.0.1',done));const port=(listener.address() as {port:number}).port;await new Promise<void>(done=>listener.close(()=>done()));
 const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
 const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
 vite=await createServer({configFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'t07-fixture',configureServer(s:any){s.middlewares.use('/__t07',async(_req:any,res:any)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__t07','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T07 账号目录</title><div id="root"></div><script type="module" src="/src/local-app/t07-browser-entry.tsx"></script>'));});}}],server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
 await writeFile('/private/tmp/loop-control-166-20261031/T07-browser.json',JSON.stringify({url:`http://127.0.0.1:${port}/__t07`,email:f.email,password:f.password,newRoot,assetRoot:f.assetRoot}));
 for(let i=0;i<180;i++){try{await readFile('/private/tmp/loop-control-166-20261031/T07-browser-done');break;}catch{}await pause(1000);}
 }finally{await vite?.close();await unlink(entry).catch(()=>{});await f.close();}
},300000);
