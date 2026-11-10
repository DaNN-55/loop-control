// Run from repo root; prints a loopback-only URL. No database or API proxy.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const script='/docs/verification/state-machines-20261110/browser-fixture.tsx';
const server=await createServer({configFile:false,envFile:false,optimizeDeps:{entries:[script.slice(1)]},plugins:[react(),{name:'state-machine-fixture',configureServer(server){server.middlewares.use('/__state-machines',async(_request,response)=>{response.setHeader('Content-Type','text/html');response.end(await server.transformIndexHtml('/__state-machines',`<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>调用确认隔离验证</title><div id="root"></div><script type="module" src="${script}"></script></html>`));});}}],server:{host:'127.0.0.1',port:5173,strictPort:true},cacheDir:'.scratch/state-machines-20261110/vite-cache'});
await server.listen();
console.log(`http://127.0.0.1:${server.httpServer.address().port}/__state-machines`);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void server.close().then(()=>process.exit(0)));
