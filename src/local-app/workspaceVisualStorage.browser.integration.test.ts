// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,lstat,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {LocalConnections} from './connections';
import {createLocalHandler} from './localRoute';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';
it.skipIf(process.env.LOOP_T07_BROWSER!=='1')('formal visual page generates and adopts actual registered-location image candidates through Owner HTTP',async()=>{
 const {f,ref,submissions}=await workspaceImageGenerationFixture(['db/local/110-episode-storage-locations.sql','db/local/118-visual-storage-locations.sql']);let vite:import('vite').ViteDevServer|undefined;
 const evidence=process.env.LOOP_T07_BROWSER_EVIDENCE!;if(!evidence)throw Error('Explicit isolated evidence directory required');
 try{
 const prefix='系列 browser/生产单 browser',directory=join(f.assetRoot,prefix);await mkdir(directory,{recursive:true});const identity=await lstat(directory,{bigint:true});await f.c.query('UPDATE local_identity.episode_asset_locations SET directory_relative_path=$2,directory_device_id=$3,directory_inode_id=$4,layout_version=2 WHERE episode_id=$1',[f.episode,prefix,String(identity.dev),String(identity.ino)]);
 const connections=new LocalConnections(f.pool,{mode:'keychain',async putImmutable(){throw Error('No secret writes in visual acceptance');},async get(id){return 'controlled-'+id;}},{mode:'live',networkAvailable:true,async verify(){throw Error('No live Provider verification in visual acceptance');}});
 let catalogHandler:ReturnType<typeof createLocalHandler>;
 const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
 vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'t07-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]==='/api/local/connections'){void catalogHandler(req,res);return;}next();});s.middlewares.use('/__t07',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__t07','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T07 视觉素材</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();await mkdir(evidence,{recursive:true});await rm(join(evidence,'browser-done.json'),{force:true});const address=vite.httpServer!.address() as {port:number};catalogHandler=createLocalHandler({pool:f.pool,origin:`http://127.0.0.1:${address.port}`,mediaRoot:f.root,connections});
 await writeFile(join(evidence,'browser.json'),JSON.stringify({url:`http://127.0.0.1:${address.port}/__t07`,email:f.email,password:f.password,path:directory,episodeId:f.episode,reference:ref.body.id}));
 let done=false;for(let i=0;i<480;i++){try{done=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8')).passed===true;if(done)break;}catch{}const w=await f.read();for(const task of w.visualTasks??[])if(task.status==='ready'&&task.kind==='image')await f.execute(task.taskId);await pause(1000);}expect(done,'External browser must finish generation/preview/adoption').toBe(true);
 const w=await f.read();expect(w.visualCandidates.some((v:any)=>v.status==='adopted'&&v.relativePath.startsWith(prefix+'/native-tasks/'))).toBe(true);expect((await readFile(submissions,'utf8')).trim().split('\n')).toHaveLength(1);await writeFile(join(evidence,'result.json'),JSON.stringify({workspace:w,submissions:(await readFile(submissions,'utf8')).trim().split('\n').map(line=>JSON.parse(line))},null,2));
 }finally{await vite?.close();await f.close();await rm(join(evidence,'browser.json'),{force:true});}
},540000);
