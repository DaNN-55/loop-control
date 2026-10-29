// Explicit, temporary acceptance environment. Never reads deployment credentials.
import {createServer as createNetServer} from 'node:net';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {productionWorkspaceFixture} from '../../../src/local-app/productionWorkspace.fixture';
import {defaultShotCaptionContract} from '../../../src/shotCaptions';
const socket=createNetServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
const f=await productionWorkspaceFixture({origin:`http://127.0.0.1:${port}`,migrations:['db/local/093-workspace-export.sql'],runtime:{postReady:async()=>{throw Error('此 UI 验收仅使用手工时序，不运行本机模型。');}}});
const server=await createServer({configFile:false,root:process.cwd(),envFile:false,plugins:[react(),{name:'isolated-export-owner-api',configureServer(vite){vite.middlewares.use((request,response,next)=>{if(request.url?.startsWith('/api/local/')||request.url?.startsWith('/_local-artifact'))void f.handler(request,response);else next();});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port,strictPort:true,open:false}});
let closing=false;async function close(){if(closing)return;closing=true;await server.close();await f.close();process.exit(0);}
try{await server.listen();let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
 for(const clip of w.clips){const matched=await f.request('matchWorkspaceMaterial',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,materialRevisionId:f.material});if(matched.status!==200)throw Error(JSON.stringify(matched));w=matched.body;const saved=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});if(saved.status!==200)throw Error(JSON.stringify(saved));w=saved.body;}
 const rendered=await f.request('exportWorkspace',{workspaceId:w.id,expectedRevision:w.revision});if(rendered.status!==200||rendered.body.exports[0].status!=='ready')throw Error(JSON.stringify(rendered));w=rendered.body;
 const info={pid:process.pid,origin:f.origin,episode:f.episode,database:f.database,assetRoot:f.assetRoot,email:f.email,password:f.password,workspaceId:w.id};await writeFile('/private/tmp/t11-export-ui.json',JSON.stringify(info,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(info));
 // This dedicated fixture owns the Vite process; replace Vite's early exit
 // handlers so the isolated database/media cleanup completes before exit.
 for(const signal of ['SIGINT','SIGTERM'] as const){process.removeAllListeners(signal);process.once(signal,()=>void close());}
}catch(error){await close();throw error;}
