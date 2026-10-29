// Dedicated controlled acceptance environment; no daily rows, credentials or paid Provider.
import {createServer as createNetServer} from 'node:net';
import {once} from 'node:events';
import {writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {narrationFixture} from '../../../src/local-app/workspaceNarration.fixture';
const socket=createNetServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
let handler:Awaited<ReturnType<typeof narrationFixture>>['handler']|undefined;
const diagnosticCase=process.env.LOOP_T08_PANEL_CASE??'original';
const diagnostic={name:'candidate-performance-variable',enforce:'pre' as const,transform(code:string,id:string){if(diagnosticCase==='bounded-row'&&id.split('?')[0].endsWith('/src/local-app/embedded-studio.css'))return code+'\n.embedded-studio-body{grid-template-rows:minmax(0,1fr)}.embedded-studio-body>aside{min-height:0}';if(!id.split('?')[0].endsWith('/src/local-app/WorkspaceCandidatesPanel.tsx'))return;return diagnosticCase==='no-audio'?code.replace(/<audio controls.*?\/>/g,'<span>试听（诊断省略）</span>'):diagnosticCase==='no-style'?code.replace("import './workspace-candidates.css';",''):undefined;}};
const server=await createServer({configFile:false,root:process.cwd(),envFile:false,plugins:[diagnostic,react(),{name:'isolated-candidate-owner-api',configureServer(vite){vite.middlewares.use((q,r,next)=>{if(handler&&(q.url?.startsWith('/api/local/')||q.url?.startsWith('/_local-artifact')))void handler(q,r);else next();});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port,strictPort:true,open:false}});
await server.listen();
const f=await narrationFixture(`http://127.0.0.1:${port}`,base=>{handler=base.handler;});
let closing=false,busy=false;let timer:ReturnType<typeof setInterval>;
async function close(){if(closing)return;closing=true;clearInterval(timer);await server.close();await f.close();process.exit(0);}
try{
 await f.authorize();let w=f.made;const clip=w.clips[0];let base={workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id};
 await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'第一版原始口播。'});await f.request('confirmWorkspaceNarration',base);let q=await f.request('generateWorkspaceNarration',base);await f.execute(q.body.narration[0].taskId);w=(await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision})).body;
 const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'striped.png',mimeType:'image/png',contentBase64:(await readFile('/private/tmp/loop-152-orchestration/media/still-striped.png')).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
 for(const c of w.clips){const matched=await f.request('matchWorkspaceImage',{workspaceId:w.id,expectedRevision:w.revision,clipId:c.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:c.id===clip.id?2.4:2,fit:'contain',focusX:0,focusY:0});if(matched.status!==200)throw Error(JSON.stringify(matched));w=matched.body;}
 timer=setInterval(()=>{if(busy||closing)return;busy=true;void(async()=>{try{const task=(await f.c.query("SELECT id FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration' AND status='ready' ORDER BY created_at LIMIT 1",[f.episode])).rows[0];if(task)await f.execute(task.id);}catch(e){console.error(e);}finally{busy=false;}})();},200);
 const info={diagnosticCase,pid:process.pid,origin:f.origin,episode:f.episode,email:f.email,password:f.password,database:f.database,assetRoot:f.assetRoot,root:f.root,token:f.token,workspaceId:w.id};await writeFile('/private/tmp/t08-ui-fixture.json',JSON.stringify(info,null,2),{mode:0o600});console.log(JSON.stringify({...info,password:'[synthetic credentials omitted]',token:'[synthetic session omitted]'}));
 for(const signal of ['SIGINT','SIGTERM'] as const){process.removeAllListeners(signal);process.once(signal,()=>void close());}
}catch(error){await close();throw error;}
