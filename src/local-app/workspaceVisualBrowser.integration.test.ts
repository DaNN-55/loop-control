// @vitest-environment node
import {it} from 'vitest';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {writeFile,access} from 'node:fs/promises';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';

it.skipIf(process.env.LOOP_VISUAL_BROWSER!=='1')('isolated browser fixture uses real app, HTTP, database and controlled image Worker',async()=>{
 const {f,ref}=await workspaceImageGenerationFixture();
 const proxy={target:f.origin,changeOrigin:true,configure(proxy:any){proxy.on('proxyReq',(req:any)=>req.setHeader('Origin',f.origin));}};
 const app=await createServer({configFile:false,root:process.cwd(),envFile:false,plugins:[react(),{name:'isolated-browser-title',transformIndexHtml:(html:string)=>html.replace(/<title>.*?<\/title>/,'<title>隔离验证 · Loop Control</title>')}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port:5196,strictPort:true,proxy:{'/api':proxy,'/_':proxy}}});
 try{
 await app.listen();
 await writeFile('/tmp/loop-visual-browser.json',JSON.stringify({origin:'http://localhost:5196',database:f.database,episode:f.episode,email:f.email,password:f.password,reference:ref.body.id,upload:ref.body.storage_path,assetRoot:f.assetRoot}));
 const deadline=Date.now()+20*60*1000;
 while(Date.now()<deadline){
  if(await access('/tmp/loop-visual-browser-done').then(()=>true,()=>false))break;
  const w=await f.read();for(const t of w.visualTasks??[])if(t.status==='ready'&&t.kind==='image')await f.execute(t.taskId);
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 await writeFile('/tmp/loop-visual-browser-result.json',JSON.stringify(await f.read()));
 }finally{await app.close();await f.close();}
},1500000);
