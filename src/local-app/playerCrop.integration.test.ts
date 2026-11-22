// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {workspaceAudioMedia} from './workspaceAudioMedia.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('saves exact audio/video source windows through Owner commands and restores after restart',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});let vite:import('vite').ViteDevServer|undefined;
 try{
  const read=async()=>{const r=await fetch(f.origin+'/api/local/episodes/'+f.episode+'/workspace',{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return (await r.json()).workspace;};
  const media=await workspaceAudioMedia(f.root),sourceBytes=await readFile(media.bgm),hash=createHash('sha256').update(sourceBytes).digest('hex');
  let result=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(result.status,JSON.stringify(result.body)).toBe(200);let w=result.body;w=await f.fillVisuals(w);
  const send=async(name:string,data={})=>{const result=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});if(result.status===200)w=result.body;return result;};
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'crop-tone.mp3',contentBase64:sourceBytes.toString('base64'),materialType:'audio',mimeType:'audio/mpeg',isMainScript:false,materialPurpose:'sound_effect'});expect(imported.status).toBe(200);
  result=await send('prepareWorkspaceAudio',{kind:'sfx',materialRevisionId:imported.body.id,description:'裁剪验收音效',durationSeconds:1,anchor:'shot',shotId:w.clips[0].shotId,offsetSeconds:0});expect(result.status,JSON.stringify(result.body)).toBe(200);
  result=await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations[0].id});expect(result.status,JSON.stringify(result.body)).toBe(200);
  const soundId=w.audio.mix.sounds[0].itemId,visualId=w.clips[0].itemId,shotId=w.clips[0].shotId;
  const document=async()=>JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  result=await send('mixWorkspaceAudio',{edit:{kind:'sound',workspaceId:w.id,itemId:soundId,gainDb:-9,duckDepthDb:5,placement:{anchor:'shot',shotId,offsetSeconds:.5,sourceInSeconds:1.5,durationSeconds:2}}});expect(result.status,JSON.stringify(result.body)).toBe(200);
  let doc=await document(),timeline=doc.timelines.find((t:any)=>t.items.some((i:any)=>i.id===soundId)),sound=timeline.items.find((i:any)=>i.id===soundId);
  expect(sound).toMatchObject({srcInFrame:45,durationInFrames:60,startFrame:15});
  const oldHash=w.project.sha256;result=await send('mixWorkspaceAudio',{edit:{kind:'sound',workspaceId:w.id,itemId:soundId,gainDb:-9,duckDepthDb:5,placement:{anchor:'shot',shotId,offsetSeconds:0,sourceInSeconds:7.5,durationSeconds:2}}});expect(result.status).toBe(409);expect((await read()).project.sha256).toBe(oldHash);
  const caption=defaultShotCaptionContract(w.clips[0].text,'independent');caption.cues=[{id:'short-proof',text:caption.text,startMs:0,endMs:500}];result=await send('saveWorkspaceCaptions',{clipId:w.clips[0].id,captionContract:caption});expect(result.status,JSON.stringify(result.body)).toBe(200);
  result=await send('editWorkspaceStructure',{operation:{kind:'trim',itemId:visualId,sourceInFrame:15,sourceOutFrame:45,keepDuration:false}});expect(result.status,JSON.stringify(result.body)).toBe(200);
  doc=await document();expect(doc.timelines.flatMap((t:any)=>t.items).find((i:any)=>i.id===visualId)).toMatchObject({srcInFrame:15,durationInFrames:30});
  await f.restart();w=await read();doc=await document();expect(doc.timelines.flatMap((t:any)=>t.items).find((i:any)=>i.id===soundId)).toMatchObject({srcInFrame:45,durationInFrames:60,startFrame:15});expect(doc.timelines.flatMap((t:any)=>t.items).find((i:any)=>i.id===visualId)).toMatchObject({srcInFrame:15,durationInFrames:30});expect(createHash('sha256').update(await readFile(media.bgm)).digest('hex')).toBe(hash);
  if(process.env.LOOP_CROP_BROWSER==='1'){
   const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
   const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>{req.setHeader('origin',f.origin);req.setHeader('cookie','loop_owner_session='+f.token);});}};
   vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),optimizeDeps:{entries:['docs/verification/player-a-crop-20261122/fixture.html']},plugins:[react(),{name:'isolated-crop',configureServer(s){s.middlewares.use('/__crop/state',async(_req,res)=>{w=await read();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({workspace:w,project:await document()}));});s.middlewares.use('/__crop/command',async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body),r=await f.request(input.name,input.data);res.statusCode=r.status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(r.body));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
   const evidence=join(process.cwd(),'docs/verification/player-a-crop-20261122');await rm(join(evidence,'browser-done.json'),{force:true});await writeFile(join(evidence,'browser-url.txt'),`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/docs/verification/player-a-crop-20261122/fixture.html`);
   let browserResult:any;for(let n=0;n<480;n++){try{browserResult=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8'));break;}catch{}await pause(500);if(n===479)throw Error('Browser verification timed out');}
   w=await read();doc=await document();const proof={sound:doc.timelines.flatMap((t:any)=>t.items).find((i:any)=>i.id===soundId),video:doc.timelines.flatMap((t:any)=>t.items).find((i:any)=>i.id===visualId)};expect(browserResult.passed).toBe(true);expect(proof.sound).toMatchObject({srcInFrame:Math.round(browserResult.audio.start*30),durationInFrames:Math.round((browserResult.audio.end-browserResult.audio.start)*30)});expect(proof.video).toMatchObject({srcInFrame:Math.round(browserResult.video.start*30),durationInFrames:Math.round((browserResult.video.end-browserResult.video.start)*30)});await writeFile(join(evidence,'native-window-proof.json'),JSON.stringify(proof,null,2));
  }
 }finally{await vite?.close();await f.close();}
},360000);
