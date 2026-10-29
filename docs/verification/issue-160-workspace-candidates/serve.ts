// Dedicated controlled acceptance environment; no daily rows, credentials or paid Provider.
import {createServer as createNetServer} from 'node:net';
import {once} from 'node:events';
import {writeFile,readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {workspaceTestMedia} from '../../../src/local-app/workspaceTestMedia.fixture';
import {workspaceAudioFixture} from '../../../src/local-app/workspaceAudio.fixture';
const socket=createNetServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
let handler:Awaited<ReturnType<typeof workspaceAudioFixture>>['handler']|undefined;
const cacheRoot=await mkdtemp('/private/tmp/t08-host-vite-');
const diagnosticCase=process.env.LOOP_T08_PANEL_CASE??'original';
const diagnostic={name:'candidate-performance-variable',enforce:'pre' as const,transform(code:string,id:string){if(diagnosticCase==='bounded-row'&&id.split('?')[0].endsWith('/src/local-app/embedded-studio.css'))return code+'\n.embedded-studio-body{grid-template-rows:minmax(0,1fr)}.embedded-studio-body>aside{min-height:0}';if(!id.split('?')[0].endsWith('/src/local-app/WorkspaceCandidatesPanel.tsx'))return;return diagnosticCase==='no-audio'?code.replace(/<audio controls.*?\/>/g,'<span>试听（诊断省略）</span>'):diagnosticCase==='no-style'?code.replace("import './workspace-candidates.css';",''):undefined;}};
const server=await createServer({configFile:false,cacheDir:join(cacheRoot,'cache'),root:process.cwd(),envFile:false,plugins:[diagnostic,react(),{name:'isolated-candidate-owner-api',configureServer(vite){vite.middlewares.use((q,r,next)=>{if(handler&&(q.url?.startsWith('/api/local/')||q.url?.startsWith('/_local-artifact')))void handler(q,r);else next();});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port,strictPort:true,open:false}});
await server.listen();
const f=await workspaceAudioFixture({origin:`http://127.0.0.1:${port}`,onBase:base=>{handler=base.handler;}});
let closing=false,busy=false;let timer:ReturnType<typeof setInterval>;
async function close(){if(closing)return;closing=true;clearInterval(timer);await server.close();await f.close();await rm(cacheRoot,{recursive:true,force:true});process.exit(0);}
try{
 await f.authorize();let w=f.made;const clip=w.clips[0];let base={workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id};
 await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'第一版原始口播。'});await f.request('confirmWorkspaceNarration',base);let q=await f.request('generateWorkspaceNarration',base);await f.execute(q.body.narration[0].taskId);w=(await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision})).body;
 async function send(name:string,data={}){const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});if(r.status!==200)throw Error(name+':'+JSON.stringify(r.body));w=r.body;return w;}
 const video=await f.request('importMaterial',{materialType:'video',sourceKind:'file',sourcePath:'source.mp4',mimeType:'video/mp4',contentBase64:(await readFile(f.media.video)).toString('base64'),isMainScript:false,materialPurpose:'a_roll'});if(video.status!==200)throw Error(JSON.stringify(video));await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:video.body.id});await send('saveWorkspaceVideoRanges',{shotId:clip.shotId,ranges:[{clipId:clip.id,materialRevisionId:video.body.id,sourceInFrame:0,durationInFrames:72,durationLocked:false}]});
 const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'striped.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});await send('matchWorkspaceImage',{clipId:w.clips[1].id,materialRevisionId:image.body.id,usage:'still',durationSeconds:2,fit:'contain',focusX:0,focusY:0});
 for(const [kind,path,duration,offset] of [['bgm',f.media.bgm,4,0],['sfx',f.media.sfx,.4,1]] as const){const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:kind+'.mp3',contentBase64:(await readFile(path)).toString('base64'),materialType:'audio',mimeType:'audio/mpeg',isMainScript:false,materialPurpose:kind==='bgm'?'background_music':'sound_effect'});if(imported.status!==200)throw Error(JSON.stringify(imported));await send('prepareWorkspaceAudio',{kind,materialRevisionId:imported.body.id,description:kind,durationSeconds:duration,anchor:'absolute',offsetSeconds:offset});await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations[0].id});}
 const music=w.audio.mix.sounds.find((s:any)=>s.kind==='bgm');await send('mixWorkspaceAudio',{edit:{kind:'sound',workspaceId:w.id,itemId:music.itemId,gainDb:-18,duckDepthDb:14}});await send('prepareWorkspaceAudio',{kind:'source',shotId:clip.shotId,sourceItemId:clip.itemId});const source=w.audio.preparations[0];await f.executeAudio(source.taskId);await send('adoptWorkspaceAudio',{preparationId:source.id});
 timer=setInterval(()=>{if(busy||closing)return;busy=true;void(async()=>{try{const task=(await f.c.query("SELECT id FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration' AND status='ready' ORDER BY created_at LIMIT 1",[f.episode])).rows[0];if(task)await f.execute(task.id);}catch(e){console.error(e);}finally{busy=false;}})();},200);
 const info={diagnosticCase,pid:process.pid,origin:f.origin,episode:f.episode,email:f.email,password:f.password,database:f.database,assetRoot:f.assetRoot,root:f.root,token:f.token,workspaceId:w.id};await writeFile('/private/tmp/t08-ui-fixture.json',JSON.stringify(info,null,2),{mode:0o600});console.log(JSON.stringify({...info,password:'[synthetic credentials omitted]',token:'[synthetic session omitted]'}));
 for(const signal of ['SIGINT','SIGTERM'] as const){process.removeAllListeners(signal);process.once(signal,()=>void close());}
}catch(error){await close();throw error;}
