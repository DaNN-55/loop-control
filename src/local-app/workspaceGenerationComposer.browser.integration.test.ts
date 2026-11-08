// @vitest-environment node
import {it,expect} from 'vitest';
import {writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {workspaceAudioFixture} from './workspaceAudio.fixture';
import {LocalConnections} from './connections';
import {createLocalHandler} from './localRoute';

it.skipIf(process.env.LOOP_COMPOSER_BROWSER!=='1')('formal composer and sound controls preserve drafts and require explicit adoption through Owner HTTP',async()=>{
 const evidence=process.env.LOOP_COMPOSER_EVIDENCE!;if(!evidence)throw Error('Isolated evidence directory required');
 const f=await workspaceAudioFixture({videoConfiguration:true,migrations:['db/local/151-workspace-sound-candidates.sql']});let app:ViteDevServer|undefined;
 const entry=join(process.cwd(),'src/local-app/__generationComposerBrowser.tsx');
 try{
  await mkdir(evidence,{recursive:true});await rm(join(evidence,'browser-done.json'),{force:true});await f.authorize();
  const version=randomUUID(),connection=randomUUID(),secret=randomUUID();await f.c.query('BEGIN');
  await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'openai','openai_images','隔离图片连接',$2,$3,'https://api.openai.com/v1')",[connection,f.owner,version]);
  await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'openai','openai_images','https://api.openai.com/v1',$3)",[version,connection,secret]);
  await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,f.owner,secret]);
  await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[version,f.owner]);
  await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[version,f.owner]);
  await f.c.query('COMMIT');
  const selection={capability:'music_sound',provider:'freesound',adapter:'freesound_preview',connectionVersionId:(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='freesound_preview'")).rows[0].id};
  const saved=await f.request('saveWorkspaceAudioDefaults',{workspaceId:f.made.id,expectedRevision:f.made.revision,selection});expect(saved.status).toBe(200);
  await writeFile(join(f.root,'controlled-soundtrack.mjs'),`import{readFileSync}from'node:fs';export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-browser'},fetcher:async(input)=>new URL(String(input)).hostname==='freesound.org'?Response.json({results:[1,2,3].map(id=>({id,name:'Bell '+id,username:'fixture',license:'https://creativecommons.org/publicdomain/zero/1.0/',url:'https://freesound.org/people/fixture/sounds/'+id+'/',duration:8,previews:{'preview-hq-mp3':'https://cdn.freesound.org/previews/'+id+'/'+id+'.mp3'}}))}):new Response(readFileSync(${JSON.stringify(f.media.bgm)}),{headers:{'content-type':'audio/mpeg'}})};}`);
  await writeFile(entry,`import{createRoot}from'react-dom/client';import{ProductionWorkspacePanel}from'./ProductionWorkspacePanel';import{localRequest,localCommand}from'./client';import'../styles.css';import'../ui/impeccable/foundation.css';import'../ui/impeccable/production.css';async function start(){await localRequest('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({email:f.email,password:f.password})})});const materials=await localRequest('episodes/'+${JSON.stringify(f.episode)});createRoot(document.getElementById('root')!).render(<main className="impeccable-app dan-ui product-ui" style={{padding:20,maxWidth:1440,margin:'auto',height:'100dvh',display:'flex',flexDirection:'column',boxSizing:'border-box'}}><ProductionWorkspacePanel episodeId=${JSON.stringify(f.episode)} title="生成输入框 · 隔离验收" scriptRevisionId=${JSON.stringify(f.script)} materials={materials.sections.materialRevisions??[]} command={(name,data)=>localCommand(name,data,undefined,'episode-commands')} onLegacy={()=>{}}/></main>);}void start();`);
  const connections=new LocalConnections(f.pool,{mode:'keychain',async putImmutable(){throw Error('No secret writes');},async get(id){return 'controlled-'+id;}},{mode:'live',networkAvailable:true,async verify(){throw Error('No live provider');}});let handler:ReturnType<typeof createLocalHandler>;
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  app=await createServer({configFile:false,root:process.cwd(),envFile:false,cacheDir:join(f.root,'vite-cache'),plugins:[react(),{name:'composer-browser',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]==='/api/local/connections'){void handler(req,res);return;}next();});server.middlewares.use('/__composer',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__composer','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>生成输入框验收</title><div id="root"></div><script type="module" src="/src/local-app/__generationComposerBrowser.tsx"></script></html>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await app.listen();const port=(app.httpServer!.address() as {port:number}).port;
  handler=createLocalHandler({pool:f.pool,origin:`http://127.0.0.1:${port}`,mediaRoot:f.root,connections});
  await writeFile(join(evidence,'browser.json'),JSON.stringify({url:`http://127.0.0.1:${port}/__composer`,workspaceId:f.made.id,episodeId:f.episode}));
  let done=false;for(let i=0;i<840;i++){try{done=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8')).passed===true;if(done)break;}catch{}const w=await f.read();for(const p of w.audio?.preparations??[])if(p.status==='ready')await f.executeAudio(p.taskId);await pause(1000);}expect(done,'Browser must finish actual composer and audio verification').toBe(true);
  const w=await f.read();expect(w.audio.defaults.settings.query).toBe('calm ambient');expect(w.audio.preparations.filter((p:any)=>p.kind==='sfx'&&p.status==='completed')).toHaveLength(3);expect(w.audio.mix.sounds.filter((s:any)=>s.kind==='sfx')).toHaveLength(1);
  await writeFile(join(evidence,'browser-persistence.json'),JSON.stringify({musicSettings:w.audio.defaults.settings,candidates:w.audio.preparations.map((p:any)=>({id:p.id,sourceId:p.source?.sourceId,adoptedItemId:p.adoptedItemId})),sounds:w.audio.mix.sounds},null,2));
 }finally{await app?.close();await f.close();await rm(entry,{force:true});}
},900000);
