// Isolated localhost Owner acceptance. No daily writes or real paid calls.
import {createServer as net} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {nativeFrontendBoundary} from '../../../src/local-app/frontendBoundary';
import {formalWorkflowFixture} from '../../../src/local-app/formalWorkflow.fixture';
import {workspaceTestMedia} from '../../../src/local-app/workspaceTestMedia.fixture';
import {productionScriptTemplate} from '../../../src/reviews/productionScript';
const socket=net();socket.listen(0,'localhost');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
let handler:Awaited<ReturnType<typeof formalWorkflowFixture>>['handler']|undefined;
const cache=await mkdtemp('/private/tmp/t13-vite-');
const server=await createServer({configFile:false,root:process.cwd(),cacheDir:join(cache,'cache'),envFile:false,plugins:[react(),nativeFrontendBoundary(process.cwd()),{name:'isolated-t13-owner',configureServer(vite){vite.middlewares.use((q,r,next)=>{if(q.url?.startsWith('/api/local/')||q.url?.startsWith('/_local-artifact')){if(handler)void handler(q,r);else{r.statusCode=503;r.end('Fixture initializing');}}else next();});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'localhost',port,strictPort:true,open:false}});
await server.listen();
let f:Awaited<ReturnType<typeof formalWorkflowFixture>>|undefined,timer:ReturnType<typeof setInterval>|undefined,busy=false,closing=false;
async function close(){if(closing)return;closing=true;clearInterval(timer);await server.close();await f?.close();await rm(cache,{recursive:true,force:true});process.exit(0);}
try{
 const guidance=process.env.LOOP_REVIEW_GUIDANCE==='1';f=await formalWorkflowFixture({controlled:true,blank:!guidance,origin:`http://localhost:${port}`,onBase:base=>{handler=base.handler;}});
 if(guidance){const fixture=f;const check=(r:any)=>{if(r.status!==200)throw Error(JSON.stringify(r));return r.body;};check(await fixture.send('start'));let w=check(await fixture.send('prepareWorkspace',{expectedScriptRevisionId:fixture.main}));const send=async(command:string,data:Record<string,unknown>={})=>{w=check(await fixture.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data}));return w;};await send('authorizeWorkspacePreparation',{enabled:true});check(await fixture.send('saveTtsSettings',{languageCode:'zh-CN',voice:'zh_female_vv_uranus_bigtts',speakingRate:1}));const clip=w.clips[0];const {defaultShotCaptionContract}=await import('../../../src/shotCaptions');await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',text:clip.text});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{clipId:clip.id});await fixture.controlled!.execute(w.narration[0].taskId);await send('refreshWorkspaceNarration');}
 const fixture=f;timer=setInterval(()=>{if(busy||closing)return;busy=true;void(async()=>{const tasks=(await fixture.c.query("SELECT id FROM public.tasks WHERE episode_id=$1 AND status='ready' AND task_type IN ('generate_narration','generate_a_roll','generate_b_roll') ORDER BY created_at",[fixture.newEpisode])).rows;for(const task of tasks)await fixture.controlled!.execute(task.id,false,2);})().catch(error=>console.error('Controlled worker:',error.message)).finally(()=>{busy=false;});},500);
 const script=join(cache,'formal-script.md');await writeFile(script,productionScriptTemplate);
 const info={pid:process.pid,origin:fixture.origin,episode:fixture.newEpisode,database:fixture.database,assetRoot:fixture.assetRoot,root:fixture.root,mountPath:fixture.mountPath,email:fixture.email,password:fixture.password,token:fixture.token,script,image:workspaceTestMedia('still-striped.png'),video:workspaceTestMedia('landscape-red-blue.mp4'),portrait:workspaceTestMedia('portrait-green.mp4')};
 await writeFile(process.env.LOOP_REVIEW_UI_INFO??'/private/tmp/t13-ui-fixture.json',JSON.stringify(info,null,2),{mode:0o600});
 console.log(JSON.stringify({origin:info.origin,episode:info.episode,database:info.database,credentials:process.env.LOOP_REVIEW_UI_INFO??'/private/tmp/t13-ui-fixture.json'}));
 for(const signal of ['SIGINT','SIGTERM'] as const){process.removeAllListeners(signal);process.once(signal,()=>void close());}
}catch(error){await close();throw error;}
