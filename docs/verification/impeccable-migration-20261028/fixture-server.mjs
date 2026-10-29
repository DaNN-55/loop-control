// Isolated UI-only server. No application middleware, identity, database or Provider.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {readFile} from 'node:fs/promises';
const mediaRoot=new URL('./media/',import.meta.url);
const server=await createServer({configFile:false,plugins:[react(),{name:'isolated-fixture-media',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url,'http://127.0.0.1:5191');if(url.pathname!=='/_local-artifact')return next();
 const relative=url.searchParams.get('path')??'';
 if(!relative.startsWith('fixture/')){res.statusCode=404;return res.end();}
 const cover=url.searchParams.has('thumbnail')||relative.endsWith('.svg');
 if(!cover&&!relative.endsWith('.mp4')){res.statusCode=404;return res.end();}
 const bytes=await readFile(new URL(cover?'cover.svg':'synthetic-preview.mp4',mediaRoot));res.setHeader('Content-Type',cover?'image/svg+xml':'video/mp4');res.setHeader('Cache-Control','no-store');res.setHeader('Accept-Ranges','bytes');
 const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
 if(match){const start=Number(match[1]),end=Math.min(match[2]?Number(match[2]):bytes.length-1,bytes.length-1);if(start>=bytes.length||end<start){res.statusCode=416;return res.end();}res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${bytes.length}`);res.setHeader('Content-Length',end-start+1);return res.end(bytes.subarray(start,end+1));}
 res.setHeader('Content-Length',bytes.length);res.end(bytes);
});}}],server:{host:'127.0.0.1',port:5191,strictPort:true},appType:'mpa'});
await server.listen();server.printUrls();
