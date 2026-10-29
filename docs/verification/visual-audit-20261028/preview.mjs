import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="#ede9fe"/><text x="360" y="640" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#5b21b6">SYNTHETIC PREVIEW</text></svg>';
const server=await createServer({root,configFile:false,envFile:false,plugins:[react(),{name:'visual-audit-synthetic-media',configureServer(server){server.middlewares.use('/_local-artifact',async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.end();return;}
  const path=new URL(req.url,'http://fixture.test').searchParams.get('path')??'';
  const extension=path.endsWith('.mp4')?'.mp4':path.endsWith('.wav')?'.wav':null;
  if(extension){res.setHeader('Content-Type',extension==='.mp4'?'video/mp4':'audio/wav');res.end(await readFile(new URL('./media/sample'+extension,import.meta.url)));return;}
  res.setHeader('Content-Type','image/svg+xml');res.end(svg);
});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port:5189,strictPort:true,fs:{strict:true,allow:[root],deny:['.env','.env.*','**/.git/**','**/.loop-control/**']}}});
await server.listen();server.printUrls();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await server.close();process.exit(0);});
