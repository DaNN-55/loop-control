// Owner-authorized T19 acceptance: real native PG/HTTP/files/CLI; offline controlled visual planner.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {root,projectRoot,configuration,assertDatabase,sql,env} from './environment.mjs';
import {createLocalDatabase} from '../../dist/local-app/local-app/catalog.js';
import {createLocalHandler} from '../../dist/local-app/local-app/localRoute.js';
import {LocalEpisodeCommands} from '../../dist/local-app/local-app/episodeCommands.js';
import {LocalConnections} from '../../dist/local-app/local-app/connections.js';
import {startNativeWorkerService} from '../../dist/local-app/local-app/localWorkerService.js';
import {ownerTransaction} from '../../dist/local-app/local-app/ownerTransaction.js';
import {executeConfiguration} from '../../dist/local-app/local-app/configurationCommands.js';
import {establishSession,lookupSession,revokeSession} from '../../dist/local-app/local-app/sessions.js';
const run=join(root,'state/t19-20261024'),origin='http://127.0.0.1:55182',mode=process.argv[2];
const save=(name,value)=>writeFileSync(join(run,name),JSON.stringify(value,null,2)+'\n',{mode:0o600}),load=name=>JSON.parse(readFileSync(join(run,name),'utf8'));
const event=(name,value={})=>appendFileSync(join(run,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),name,...value})+'\n',{mode:0o600});
const owner=()=>JSON.parse(readFileSync(join(root,'state/t13-owner.json'),'utf8'));
const checkReferences=async(c,refs)=>{for(const id of refs){const v=(await c.query('SELECT * FROM local_identity.connection_version($1)',[id])).rows[0];const f=load('fixture.json');assert(f.accounts.some(a=>a.versionId===id));assert(v?.is_current&&!v.revoked_at);assert((await c.query('SELECT public.connection_version_is_verified($1) ok',[id])).rows[0].ok);}};
async function prepare(){
 assertDatabase();assert(!existsSync(join(run,'fixture.json')));const pool=createLocalDatabase(configuration().database);let token;const accounts=[];
 try{const o=owner();token=await establishSession(pool,o.email,o.password);const session=await lookupSession(pool,token);assert(session);
 for(const provider of ['openai','cloudflare','pexels','freesound']){
  const existing=await ownerTransaction(pool,session.id,true,async c=>(await c.query('SELECT id,current_version_id FROM public.external_connections WHERE created_by=$1 AND name=$2',[session.id,'T19 CONTROLLED METADATA ONLY '+provider])).rows[0]);const connectionId=existing?.id??randomUUID(),versionId=existing?.current_version_id??randomUUID(),secretRef=randomUUID(),intent=randomUUID();
  if(!existing)await ownerTransaction(pool,session.id,false,async c=>{await c.query('INSERT INTO local_identity.connection_intents(owner_id,idempotency_key,metadata,connection_id,version_id,secret_ref,store_mode) VALUES($1,$2,$3,$4,$5,$6,$7)',[session.id,intent,{command:'create',provider,adapter:({openai:'openai_images',cloudflare:'workers_ai_images',pexels:'pexels_video',freesound:'freesound_preview'})[provider],name:'T19 CONTROLLED METADATA ONLY '+provider},connectionId,versionId,secretRef,'keychain']);await c.query('SELECT local_identity.apply_connection_intent($1)',[intent]);await c.query("SELECT local_identity.record_connection_probe($1,'live','verified')",[versionId]);});
  // Fixture qualification above is fabricated metadata, not live verification.
  const assetRoot=join(root,'media/t16-volume','t19-'+provider);mkdirSync(assetRoot,{mode:0o700,recursive:true});const key={openai:'static_visual',cloudflare:'static_visual',pexels:'b_roll',freesound:'soundtrack'}[provider],adapter={openai:'openai_images',cloudflare:'workers_ai_images',pexels:'pexels_video',freesound:'freesound_preview'}[provider],model={openai:'gpt-image-1',cloudflare:'@cf/black-forest-labs/flux-1-schnell',pexels:'pexels-video-v1',freesound:'freesound-preview-v1'}[provider];const policy={asset_root:assetRoot,positioning:'T19 CONTROLLED OFFLINE '+provider,allowed_tools:['read','write'],approval_gates:['script','visual','storyboard','qc'],budgets:{storyboard_planning_cents:100},[key]:{execution_path:'external',credential_ref:versionId,max_attempts:1,budget_cents:100,allowed_tools:['read','write'],executor:{provider,adapter,model,prompt_version:({static_visual:'static-visual-v1',b_roll:'b-roll-v1',soundtrack:'soundtrack-v1'})[key]}}};
  const account=await executeConfiguration(pool,session,{command:'createAccount',idempotencyKey:randomUUID(),data:{name:'T19 CONTROLLED '+provider,slug:'t19-'+randomUUID(),timezone:'Asia/Shanghai',policy:{...policy,[key]:undefined}}},join(root,'media'),async()=>{});
  const setup=await ownerTransaction(pool,session.id,true,async c=>({h:(await c.query("SELECT * FROM public.prompt_versions WHERE account_id=$1 AND capability='storyboard_planning' AND is_active ORDER BY version DESC LIMIT 1",[account.id])).rows[0],revision:(await c.query('SELECT md5(policy::text) revision FROM public.account_blueprint_versions WHERE id=$1',[account.current_blueprint_version_id])).rows[0].revision}));policy.executors={storyboard_planning:{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',harness_id:setup.h.id,prompt_version:setup.h.slug}};
  await executeConfiguration(pool,session,{command:'updateBlueprint',idempotencyKey:randomUUID(),expectedRevision:setup.revision,data:{accountId:account.id,policy}},join(root,'media'),async()=>{});
  sql(`insert into public.audit_events(account_id,event_type,payload) values('${account.id}','t19_controlled_qualification_fixture','{"not_live_verification":true,"secret_store":"substitute","provider":"${provider}"}')`);
  accounts.push({accountId:account.id,provider,connectionId,versionId,assetRoot});
 }
 for(const kind of ['manual','local','disabled']){
 const assetRoot=join(root,'media/t16-volume','t19-'+kind);mkdirSync(assetRoot,{recursive:true,mode:0o700});const media=kind==='manual'?{a_roll:{execution_path:'manual'},b_roll:{execution_path:'manual'},narration:{execution_path:'manual'},soundtrack:{execution_path:'manual'}}:kind==='local'?Object.fromEntries(['a_roll','b_roll'].map(k=>[k,{execution_path:'local',max_attempts:1,budget_cents:0,allowed_tools:['read','write'],executor:{provider:'openchatcut',adapter:'openchatcut_card_video',model:'openchatcut@0.2.14',prompt_version:'card-video-v1'}}])):{};
 const policy={asset_root:assetRoot,positioning:'T19 '+kind,allowed_tools:['read','write'],approval_gates:['script','visual','storyboard','qc'],budgets:{storyboard_planning_cents:100},...media};
 const a=await executeConfiguration(pool,session,{command:'createAccount',idempotencyKey:randomUUID(),data:{name:'T19 '+kind,slug:'t19-'+randomUUID(),timezone:'Asia/Shanghai',policy}},join(root,'media'),async()=>{});
 const h=await ownerTransaction(pool,session.id,true,async c=>(await c.query("SELECT * FROM public.prompt_versions WHERE account_id=$1 AND capability='storyboard_planning' AND is_active ORDER BY version DESC LIMIT 1",[a.id])).rows[0]);
 const revision=await ownerTransaction(pool,session.id,true,async c=>(await c.query('SELECT md5(policy::text) revision FROM public.account_blueprint_versions WHERE id=$1',[a.current_blueprint_version_id])).rows[0].revision);
 policy.executors={storyboard_planning:{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',harness_id:h.id,prompt_version:h.slug}};
 await executeConfiguration(pool,session,{command:'updateBlueprint',idempotencyKey:randomUUID(),expectedRevision:revision,data:{accountId:a.id,policy}},join(root,'media'),async()=>{});accounts.push({accountId:a.id,provider:kind,assetRoot});
 }
 save('fixture.json',{ownerId:session.id,mountPath:join(root,'media/t16-volume'),accounts,qualification:'CONTROLLED SEEDED METADATA ONLY; NOT LIVE',secretStore:'substitute; no Keychain created'});
 }finally{if(token)await revokeSession(pool,token);await pool.end();}
}
async function serve(){
 const f=load('fixture.json'),pool=createLocalDatabase(configuration().database),connections=new LocalConnections(pool);mkdirSync(join(run,'home'),{recursive:true,mode:0o700});mkdirSync(join(run,'tmp'),{recursive:true,mode:0o700});
 const worker=await startNativeWorkerService({projectRoot,applicationDatabase:((d)=>({host:d.host,port:d.port,database:d.database}))(configuration().database),database:JSON.parse(readFileSync(join(root,'worker-database.json'))),mediaRoot:join(root,'media'),mountPath:f.mountPath,minimumFreeBytes:0,concurrency:2,actualCostCents:0,media:{mode:'controlled',modulePath:join(projectRoot,'scripts/local/media-controlled-ports.mjs')},visualCommand:[process.execPath,'--import',join(run,'network-guard.mjs'),join(projectRoot,'scripts/local/media-offline-fixture.mjs')],environment:{OPENCHATCUT_ROOT:join(projectRoot,'.loop-control/stage-b/verified/OpenChatCut'),OPENCHATCUT_NODE:process.execPath,PATH:env.PATH,HOME:join(run,'home'),TMPDIR:join(run,'tmp'),NODE_OPTIONS:'--import '+join(run,'network-guard.mjs'),LOOP_N8N_STATE_DIR:join(run,'orchestration')},record:e=>event(e.name,e)});
 const episodes=new LocalEpisodeCommands(pool,join(root,'media'),{...worker,mountPath:f.mountPath,minimumFreeBytes:0,checkReferences});const handler=createLocalHandler({origin,pool,mediaRoot:join(root,'media'),connections,episodes});
 const vite=await createServer({configFile:false,root:projectRoot,cacheDir:join(run,'vite-cache'),plugins:[react(),{name:'t19-offline',async closeBundle(){await worker.stop();await pool.end();event('stopped');},configureServer(server){server.middlewares.use((req,res,next)=>{if(!req.url?.startsWith('/api/')&&!req.url?.startsWith('/_'))return next();const end=res.end.bind(res);res.end=function(chunk,...args){if(req.method==='POST')event('http',{path:req.url,status:res.statusCode});if(req.url==='/api/local/catalog'&&res.statusCode===200&&chunk){const d=JSON.parse(String(chunk)),ids=f.accounts.map(a=>a.accountId);for(const k of ['accounts','blueprints','episodes','series','seriesVersions','promptVersions'])d[k]=d[k].filter(x=>ids.includes(k==='accounts'?x.id:x.account_id));return end(JSON.stringify(d),...args);}return end(chunk,...args);};void handler(req,res);});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port:55182,strictPort:true,fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.loop-control/**','**/n8n/worker.env*']},watch:{ignored:['**/.loop-control/**']}}});await vite.listen();save('runtime.json',{pid:process.pid,origin,projectRoot});event('listening',{origin});
}

async function test(){
 const f=load('fixture.json'),r=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(owner())});assert.equal(r.status,200);const headers={Origin:origin,Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await r.json()).csrfToken,'Content-Type':'application/json'},calls=[],results=[];
 const post=async(command,data,key=randomUUID(),status=200)=>{const r=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers,body:JSON.stringify({command,data,idempotencyKey:key})}),v=await r.json();calls.push({command,status:r.status});assert.equal(r.status,status,JSON.stringify(v));return v;};
 const detail=async id=>{const v=await(await fetch(origin+'/api/local/episodes/'+id,{headers})).json();for(const[k,p]of Object.entries(v.patches??{}))v.sections[k]=p.ids.map(id=>p.rows.find(r=>r.id===id));return v.sections;};
 async function until(id,condition){for(let i=0;i<900;i++){const d=await detail(id);if(condition(d))return d;await new Promise(r=>setTimeout(r,100));}throw Error('Own T19 fixture did not reach expected state');}
 const material=async(e,file,purpose,type,mime)=>post('importMaterial',{episodeId:e.id,sourceKind:'file',sourcePath:purpose+'-'+file,materialPurpose:purpose,materialType:type,mimeType:mime,isMainScript:false,contentBase64:readFileSync(join(run,file)).toString('base64')});
 try{for(const a of f.accounts){
 const e=await post('create',{accountId:a.accountId,title:'T19 '+a.provider,isTest:true});a.episodeId=e.id;save('fixture.json',f);if(a.provider==='manual')await post('setAudioSourceMode',{episodeId:e.id,audioSourceMode:'source'});
 await post('importMaterial',{episodeId:e.id,sourceKind:'paste',sourcePath:'script.md',materialPurpose:'main_script',materialType:'script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from('# T19\n## 正文\n受控离线素材验收。').toString('base64')});
 await material(e,'reference.png','visual_reference','image','image/png');await post('start',{episodeId:e.id});const visual=await until(e.id,d=>['visual_review','visual_draft'].includes(d.episode.stage)&&d.tasks.some(t=>t.task_type==='prepare_visual_brief'&&['completed','failed','blocked'].includes(t.status)));assert.equal(visual.episode.stage,'visual_review',JSON.stringify(visual.tasks.map(t=>({type:t.task_type,status:t.status,result:t.last_result}))));
 const vp=visual.reviewPackages.find(p=>p.stage==='visual_review');await post('review',{episodeId:e.id,reviewPackageId:vp.id,toStage:'visual_approved',reason:'Synthetic visual approved.'});await post('planStoryboard',{episodeId:e.id});const d=await until(e.id,d=>d.episode.stage==='storyboard_review'),p=d.reviewPackages.find(p=>p.stage==='storyboard_review');a.reviewPackageId=p.id;save('fixture.json',f);await post('review',{episodeId:e.id,reviewPackageId:p.id,toStage:'storyboard_approved',reason:'Synthetic storyboard approved.'});
 if(a.provider==='manual'){
  const ma=await material(e,'source.mp4','a_roll','video','video/mp4'),mb=await material(e,'source.mp4','b_roll','video','video/mp4'),bgm=await material(e,'tone.mp3','background_music','audio','audio/mpeg'),sfx=await material(e,'tone.mp3','sound_effect','audio','audio/mpeg'),n=await material(e,'tone.mp3','narration','audio','audio/mpeg');a.materials={ma:ma.id,mb:mb.id,bgm:bgm.id,sfx:sfx.id,n:n.id};save('fixture.json',f);
  const bind=(kind,id,targetId)=>({episodeId:e.id,storyboardReviewPackageId:p.id,kind,materialRevisionId:id,targetId,...(['a_roll','b_roll'].includes(kind)?{clipStartSeconds:0,clipEndSeconds:4}:{})});
  const key=randomUUID(),one=await Promise.all([post('registerManualMedia',bind('a_roll',ma.id,'shot-1'),key),post('registerManualMedia',bind('a_roll',ma.id,'shot-1'),key)]);assert.equal(one[0].id,one[1].id);
  const replacement=await post('registerManualMedia',{...bind('a_roll',ma.id,'shot-1'),replace:true,clipStartSeconds:1,clipEndSeconds:5});assert.notEqual(replacement.id,one[0].id);
  await post('registerManualMedia',bind('b_roll',mb.id,'shot-2'));
  // Different immutable audio filenames are needed: one source cannot bind to multiple targets.
  for(const[k,id,t]of[['bgm',bgm.id,'bgm-1'],['sfx',sfx.id,'sfx-1'],['narration',n.id,'shot-1']])await post('registerManualMedia',bind(k,id,t));
  await post('saveAudioSelection',{episodeId:e.id,reviewPackageId:p.id,targetKind:'episode',targetId:e.id,audioKind:'bgm',materialRevisionId:bgm.id,cueId:null});
  await post('saveAudioSelection',{episodeId:e.id,reviewPackageId:p.id,targetKind:'shot',targetId:'shot-2',audioKind:'sfx',cueId:'sfx-1'});
  await post('planMedia',{episodeId:e.id,reviewPackageId:p.id});await until(e.id,d=>d.tasks.some(t=>t.task_type==='extract_embedded_audio')&&d.tasks.filter(t=>t.task_type==='extract_embedded_audio').every(t=>t.status==='completed'));
  const after=await detail(e.id);assert.equal(after.tasks.find(t=>t.id===one[0].id).status,'superseded');assert(after.audioTracks.some(t=>t.source_material_revision_id===bgm.id));assert.equal(after.taskRuns.filter(t=>after.tasks.some(x=>x.id===t.task_id&&x.provider==='manual_upload')).length,0);
  results.push({provider:a.provider,episodeId:e.id,duplicateOneTask:true,replacementTaskId:replacement.id,oldTaskPreserved:true,existingTrackBound:true});
 }else{
  const args={episodeId:e.id,reviewPackageId:p.id},key=randomUUID();await Promise.all([post('planMedia',args,key),post('planMedia',args,key)]);
  const target={pexels:'generate_b_roll',freesound:'generate_soundtrack',local:'generate_a_roll'}[a.provider];
  if(target){const done=await until(e.id,d=>d.tasks.some(t=>t.task_type===target)&&d.tasks.filter(t=>['generate_a_roll','generate_b_roll','generate_soundtrack'].includes(t.task_type)).every(t=>['completed','failed','blocked'].includes(t.status)));const tasks=done.tasks.filter(t=>['generate_a_roll','generate_b_roll','generate_soundtrack'].includes(t.task_type));assert(tasks.length);for(const t of tasks)assert.equal(t.status,'completed',JSON.stringify({id:t.id,result:t.last_result}));}
  const after=await detail(e.id);if(a.provider==='disabled')assert(!after.tasks.some(t=>['generate_a_roll','generate_b_roll','generate_soundtrack'].includes(t.task_type)));
  results.push({provider:a.provider,episodeId:e.id,media:after.tasks.filter(t=>['generate_a_roll','generate_b_roll','generate_soundtrack'].includes(t.task_type)).map(t=>({id:t.id,type:t.task_type,status:t.status}))});
 }
 const end=await detail(e.id);for(const artifact of end.artifacts){const bytes=readFileSync(join(a.assetRoot,artifact.relative_path));assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);assert.equal(bytes.length,Number(artifact.file_size));const res=await fetch(origin+`/_local-artifact?episode=${e.id}&path=${encodeURIComponent(artifact.relative_path)}&sha256=${artifact.sha256}`,{headers});assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),bytes);}
 save(a.provider+'-snapshot-private.json',end);
 }
 save('http-result.json',{passed:true,results,calls,realHttp:true,realNativePg:true,realWorkerCli:true,allIndexedFilesAndPreviewResponsesMatch:true,providerRequests:0,controlledQualifications:true,secretStore:'substitute, not real Keychain'});console.log({passed:true,families:results.map(r=>r.provider)});
 }finally{await fetch(origin+'/api/local/logout',{method:'POST',headers,body:'{}'});}
}
try{assert(['prepare','serve','test'].includes(mode));await({prepare,serve,test})[mode]();}catch(e){event('failure',{phase:mode,code:e?.code??'assertion'});console.error(e);process.exitCode=1;}
