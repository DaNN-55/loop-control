// Isolated Owner/real Studio acceptance; synthetic credentials, no daily mutations.
import {createServer as net} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {productionWorkspaceFixture} from '../../../src/local-app/productionWorkspace.fixture';
import {workspaceTestMedia} from '../../../src/local-app/workspaceTestMedia.fixture';
const socket=net();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(r=>socket.close(()=>r()));
let handler:Awaited<ReturnType<typeof productionWorkspaceFixture>>['handler']|undefined;
const cache=await mkdtemp('/private/tmp/t09-vite-');
const server=await createServer({configFile:false,root:process.cwd(),cacheDir:join(cache,'cache'),envFile:false,plugins:[react(),{name:'isolated-t09-owner',configureServer(vite){vite.middlewares.use((q,r,next)=>{if(handler&&(q.url?.startsWith('/api/local/')||q.url?.startsWith('/_local-artifact')))void handler(q,r);else next();});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port,strictPort:true,open:false}});
await server.listen();const f=await productionWorkspaceFixture({origin:`http://127.0.0.1:${port}`});handler=f.handler;
let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
for(const clip of w.clips){const r=await f.request('matchWorkspaceMaterial',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,materialRevisionId:f.material});if(r.status!==200)throw Error(JSON.stringify(r));w=r.body;}
const changed=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'appearance',itemId:w.clips[0].itemId,focusX:17}});if(changed.status!==200)throw Error(JSON.stringify(changed));w=changed.body;
const image=workspaceTestMedia('still-striped.png');
const info={origin:f.origin,episode:f.episode,email:f.email,password:f.password,database:f.database,assetRoot:f.assetRoot,root:f.root,token:f.token,workspaceId:w.id,image,video:join(f.assetRoot,f.videoPath),project:join(f.assetRoot,w.project.relativePath)};
await writeFile('/private/tmp/t09-ui-fixture.json',JSON.stringify(info),{mode:0o600});console.log(JSON.stringify({origin:f.origin,episode:f.episode,database:f.database}));
let closing=false;async function close(){if(closing)return;closing=true;await server.close();await f.close();await rm(cache,{recursive:true,force:true});process.exit(0);}for(const s of ['SIGINT','SIGTERM'] as const){process.removeAllListeners(s);process.once(s,()=>void close());}
