// Owner-authorized T21 acceptance: real native PG/HTTP/files/CLI; offline controlled visual planner.
import assert from 'node:assert/strict';
import{normalizeShotCaptionContract,shotCaptionContractToDatabase}from'../../dist/worker/shotCaptions.js';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {hashPassword} from '../../dist/local-app/local-app/password.js';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
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
const run=join(root,'state/t21-20261024'),origin='http://127.0.0.1:55184',mode=process.argv[2];
const evidenceRun=process.argv[3]??'final-01';if(!/^[a-z0-9-]+$/.test(evidenceRun))throw Error('Invalid run label');
const record=(name,value)=>writeFileSync(join(run,evidenceRun+'-'+name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const save=(name,value)=>writeFileSync(join(run,name),JSON.stringify(value,null,2)+'\n',{mode:0o600}),load=name=>JSON.parse(readFileSync(join(run,name),'utf8'));
const event=(name,value={})=>appendFileSync(join(run,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),name,...value})+'\n',{mode:0o600});
const owner=()=>JSON.parse(readFileSync(join(root,'state/t13-owner.json'),'utf8'));
const checkReferences=async(_c,refs)=>{assert.equal(refs.length,0,'T21 permits no online references');};
async function prepare(){
 assertDatabase();assert(!existsSync(join(run,'fixture.json')));const pool=createLocalDatabase(configuration().database);let token;
 try{const o=owner();token=await establishSession(pool,o.email,o.password);const session=await lookupSession(pool,token);assert(session);
 const assetRoot=join(root,'media/t16-volume','t21-manual');mkdirSync(assetRoot,{mode:0o700,recursive:true});
 const policy={asset_root:assetRoot,positioning:'T21 OFFLINE alignment acceptance',allowed_tools:['read','write'],approval_gates:['script','visual','storyboard','qc'],budgets:{storyboard_planning_cents:100},a_roll:{execution_path:'manual'},b_roll:{execution_path:'manual'},narration:{execution_path:'manual'},soundtrack:{execution_path:'manual'}};
 const a=await executeConfiguration(pool,session,{command:'createAccount',idempotencyKey:randomUUID(),data:{name:'T21 OFFLINE alignment',slug:'t21-'+randomUUID(),timezone:'Asia/Shanghai',policy}},join(root,'media'),async()=>{});
 const setup=await ownerTransaction(pool,session.id,true,async c=>({h:(await c.query("SELECT * FROM public.prompt_versions WHERE account_id=$1 AND capability='storyboard_planning' AND is_active ORDER BY version DESC LIMIT 1",[a.id])).rows[0],revision:(await c.query('SELECT md5(policy::text) revision FROM public.account_blueprint_versions WHERE id=$1',[a.current_blueprint_version_id])).rows[0].revision}));
 policy.executors={storyboard_planning:{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',harness_id:setup.h.id,prompt_version:setup.h.slug}};
 await executeConfiguration(pool,session,{command:'updateBlueprint',idempotencyKey:randomUUID(),expectedRevision:setup.revision,data:{accountId:a.id,policy}},join(root,'media'),async()=>{});
 save('fixture.json',{ownerId:session.id,mountPath:join(root,'media/t16-volume'),accounts:[{accountId:a.id,assetRoot}],qualification:'NONE CREATED; offline planner fixture only',secretStore:'not used; prior substitute limitation retained'});
 }finally{if(token)await revokeSession(pool,token);await pool.end();}
}
async function serve(){
 const f=load('fixture.json'),pool=createLocalDatabase(configuration().database),connections=new LocalConnections(pool);mkdirSync(join(run,'home'),{recursive:true,mode:0o700});mkdirSync(join(run,'tmp'),{recursive:true,mode:0o700});
 pool.on('connect',c=>{if(!c.t21Recorded){const query=c.query.bind(c);c.query=async(...args)=>{try{return await query(...args);}catch(e){appendFileSync(join(run,'sql-errors-private.jsonl'),JSON.stringify({at:new Date().toISOString(),code:e.code,message:e.message,where:e.where})+'\n',{mode:0o600});throw e;}};c.t21Recorded=true;}});
 const worker=await startNativeWorkerService({projectRoot,applicationDatabase:((d)=>({host:d.host,port:d.port,database:d.database}))(configuration().database),database:JSON.parse(readFileSync(join(root,'worker-database.json'))),mediaRoot:join(root,'media'),mountPath:f.mountPath,minimumFreeBytes:0,concurrency:2,actualCostCents:0,studio:true,shotPreview:true,alignment:{python:'/opt/homebrew/bin/python3',cacheDirectory:join(f.accounts[0].assetRoot,'.cache/whisperx'),runnerSha256:createHash('sha256').update(readFileSync(join(projectRoot,'scripts/whisperx-align.py'))).digest('hex')},media:{mode:'controlled',modulePath:join(projectRoot,'scripts/local/media-controlled-ports.mjs')},visualCommand:[process.execPath,'--import',join(run,'network-guard.mjs'),join(projectRoot,'scripts/local/studio-offline-fixture.mjs')],environment:{OPENCHATCUT_ROOT:join(projectRoot,'.loop-control/stage-b/verified/OpenChatCut'),OPENCHATCUT_NODE:process.execPath,PATH:env.PATH,HOME:join(run,'home'),TMPDIR:join(run,'tmp'),NODE_OPTIONS:'--import '+join(run,'network-guard.mjs'),LOOP_N8N_STATE_DIR:join(run,'orchestration')},record:e=>event(e.name,e)});
 const episodes=new LocalEpisodeCommands(pool,join(root,'media'),{...worker,mountPath:f.mountPath,minimumFreeBytes:0,checkReferences});const handler=createLocalHandler({origin,pool,mediaRoot:join(root,'media'),connections,episodes});
 const vite=await createServer({configFile:false,root:projectRoot,cacheDir:join(run,'vite-cache'),plugins:[react(),{name:'t21-offline',async closeBundle(){await episodes.close();await worker.stop();await pool.end();event('stopped');},configureServer(server){server.middlewares.use((req,res,next)=>{if(!req.url?.startsWith('/api/')&&!req.url?.startsWith('/_'))return next();const end=res.end.bind(res);res.end=function(chunk,...args){if(req.method==='POST')event('http',{path:req.url,status:res.statusCode});if(req.url==='/api/local/catalog'&&res.statusCode===200&&chunk){const d=JSON.parse(String(chunk)),ids=f.accounts.map(a=>a.accountId);for(const k of ['accounts','blueprints','episodes','series','seriesVersions','promptVersions'])d[k]=d[k].filter(x=>ids.includes(k==='accounts'?x.id:x.account_id));return end(JSON.stringify(d),...args);}return end(chunk,...args);};void handler(req,res);});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port:55184,strictPort:true,fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.loop-control/**','**/n8n/worker.env*']},watch:{ignored:['**/.loop-control/**']}}});await vite.listen();save('runtime.json',{pid:process.pid,origin,projectRoot});event('listening',{origin});let stopping=false;async function stop(){if(stopping)return;stopping=true;await vite.close();process.exit(0);}process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
}


async function http(){
 const f=load('fixture.json'),a=f.accounts[0],r=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(owner())});assert.equal(r.status,200);
 const headers={Origin:origin,Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await r.json()).csrfToken,'Content-Type':'application/json'},calls=[];
 const post=async(command,data,key=randomUUID(),status=200)=>{const r=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers,body:JSON.stringify({command,data,idempotencyKey:key})}),v=await r.json();calls.push({command,status:r.status});save('http-progress-private.json',{calls});assert.equal(r.status,status,JSON.stringify(v));return v;};
 const detail=async id=>{const v=await(await fetch(origin+'/api/local/episodes/'+id,{headers})).json();for(const[k,p]of Object.entries(v.patches??{}))v.sections[k]=p.ids.map(id=>p.rows.find(r=>r.id===id));return v.sections;};
 const until=async(id,condition)=>{for(let i=0;i<900;i++){const d=await detail(id);if(condition(d))return d;await new Promise(r=>setTimeout(r,100));}record('timeout-private.json',await detail(id));throw Error('Own T21 fixture did not reach expected state');};
 const done=async(id,task)=>{const d=await until(id,d=>d.tasks.some(t=>t.id===task.id&&['completed','failed','blocked'].includes(t.status)));assert.equal(d.tasks.find(t=>t.id===task.id).status,'completed',JSON.stringify(d.tasks.find(t=>t.id===task.id).last_result));return d;};
 const logout=()=>fetch(origin+'/api/local/logout',{method:'POST',headers,body:'{}'});
 return{f,a,headers,calls,post,detail,until,done,logout};
}
async function seed(){
 const h=await http(),{f,a,post,until,done}=h;f.episodes??={};
 try{for(const kind of ['api','browser']){
 let item=f.episodes[kind];if(item?.seeded)continue;if(!item){const e=await post('create',{accountId:a.accountId,title:`T21 ${kind} Studio 离线验收`,isTest:true});item=f.episodes[kind]={id:e.id};save('fixture.json',f);await post('setAudioSourceMode',{episodeId:e.id,audioSourceMode:'source'});}
 const id=item.id,material=async(file,purpose,type,mime)=>post('importMaterial',{episodeId:id,sourceKind:'file',sourcePath:purpose+'-'+file,materialPurpose:purpose,materialType:type,mimeType:mime,isMainScript:false,contentBase64:readFileSync(join(run,file)).toString('base64')});
 if(!item.reviewPackageId){
  if((await h.detail(id)).episode.stage==='waiting_input'){
   await post('importMaterial',{episodeId:id,sourceKind:'paste',sourcePath:'script.md',materialPurpose:'main_script',materialType:'script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from('# T21\n## 正文\n这是本地字幕验收。').toString('base64')});
   await material('reference.png','visual_reference','image','image/png');await post('start',{episodeId:id});}
  let d=await until(id,d=>d.episode.stage==='visual_review');const vp=d.reviewPackages.find(p=>p.stage==='visual_review');await post('review',{episodeId:id,reviewPackageId:vp.id,toStage:'visual_approved',reason:'Offline synthetic visual approved.'});await post('planStoryboard',{episodeId:id});
  d=await until(id,d=>d.episode.stage==='storyboard_review');item.reviewPackageId=d.reviewPackages.find(p=>p.stage==='storyboard_review').id;save('fixture.json',f);await post('review',{episodeId:id,reviewPackageId:item.reviewPackageId,toStage:'storyboard_approved',reason:'Offline synthetic storyboard approved.'});
 }
 if(!item.materials){item.materials={a:(await material('source.mp4','a_roll','video','video/mp4')).id,b:(await material('source.mp4','b_roll','video','video/mp4')).id,bgm:(await material('bgm.mp3','background_music','audio','audio/mpeg')).id};save('fixture.json',f);}
 await post('saveAudioSelection',{episodeId:id,reviewPackageId:item.reviewPackageId,targetKind:'episode',targetId:id,audioKind:'bgm',cueId:null,materialRevisionId:item.materials.bgm});
 for(const[shotId,key]of[['shot-1','a'],['shot-2','b']]){
  const args={episodeId:id,reviewPackageId:item.reviewPackageId,shotId},captionContract=shotCaptionContractToDatabase(normalizeShotCaptionContract(undefined,{enabled:true,text:'这是本地字幕验收。',audioMode:'source'}));
  await post('saveMediaDraft',{...args,materialRevisionId:item.materials[key],clipSegments:[{start_seconds:0,end_seconds:4}],composition:{version:'shot-composition/v1',layout:'full',slots:[{id:'full',fit:'cover',focalPoint:{x:0.5,y:0.5},clipSegmentIndex:0}]},sourceVideoDurationSeconds:8,audioMode:'source',subtitleText:'这是本地字幕验收。',subtitlesEnabled:true,ttsText:'这是本地字幕验收。',captionContract,bgmDuckingLevel:'light',transitionMode:'cut'});
  await done(id,await post('generateClip',args));await done(id,await post('generateSourceAudio',args));
  await post('saveManualAlignment',{...args,cues:[{id:'manual-1',text:'这是本地字幕验收。',start_ms:100,end_ms:3450}]});await done(id,await post('generateSyncPreview',args));await post('confirmSyncPreview',{...args,deviationResolution:'none'});
 }
 const d=await h.detail(id);assert(d.shotPreparationDrafts.every(d=>d.confirmation_status==='confirmed'));assert(!d.tasks.some(t=>t.task_type==='generate_review_render'));item.seeded=true;save('fixture.json',f);record(kind+'-seed-private.json',d);
 }
 record('seed-result.json',{passed:true,episodes:Object.fromEntries(Object.entries(f.episodes).map(([kind,e])=>[kind,e.id])),calls:h.calls,reviewRenderNotCreatedBeforeExplicitAction:true,providerRequests:0,realWhisperXInference:false});console.log(JSON.stringify({passed:true,seeded:Object.keys(f.episodes),providerRequests:0}));
 }finally{await h.logout();}
}
try{assert(['prepare','serve','seed','openCheck','exercise','boundaries','inputRevision'].includes(mode));await({prepare,serve,seed,openCheck,exercise,boundaries,inputRevision})[mode]();}catch(e){event('failure',{phase:mode,code:e?.code??'assertion'});console.error(e);process.exitCode=1;}

async function openCheck(){
 const h=await http(),item=h.f.episodes.api;
 try{const d=await h.detail(item.id),p=d.reviewPackages.find(p=>p.id===item.reviewPackageId),source=d.artifacts.find(a=>a.id===p.artifact_id).relative_path;
 const opened=await h.post('openStudio',{episodeId:item.id,projectRelativePath:source});assert(opened.studioUrl,JSON.stringify(opened));
 const base=new URL(opened.studioUrl).origin,key='project:'+opened.workspace.projectId,r=await fetch(base+'/api/project-store/entry?key='+encodeURIComponent(key),{headers:{'Sec-Fetch-Site':'none'}}),entry=await r.json();assert(entry.found);
 save('studio-api-state.json',{episodeId:item.id,reviewPackageId:item.reviewPackageId,sourceProjectRelativePath:source,workspaceRelativePath:opened.workspace.relativePath,studioUrl:opened.studioUrl,projectId:opened.workspace.projectId});record('open-result.json',{status:200,opened,reviewTaskCount:(await h.detail(item.id)).tasks.filter(t=>t.task_type==='generate_review_render').length});record('editor-initial-private.json',entry);console.log(JSON.stringify({passed:true,projectVersion:entry.value.version,projectRootKeys:Object.keys(entry.value),captionLanes:entry.value.timelines[0].tracks.C1.captions.sourceEntries.length,studioOrigin:base}));
 }finally{await h.logout();}
}

async function editorProject(opened){
 const base=new URL(opened.studioUrl).origin,key='project:'+opened.workspace.projectId;
 const r=await fetch(base+'/api/project-store/entry?key='+encodeURIComponent(key),{headers:{'Sec-Fetch-Site':'none'}});assert.equal(r.status,200);const entry=await r.json();assert(entry.found);return{base,key,project:entry.value};
}
async function editCaption(opened,text){
 const {base,key,project:stored}=await editorProject(opened);
 const editorRoot=join(projectRoot,'.loop-control/stage-b/verified/OpenChatCut');
 const project=JSON.parse(execFileSync(process.execPath,['--import',join(editorRoot,'node_modules/tsx/dist/loader.mjs'),'--input-type=module','-e',`import{readFileSync}from'node:fs';import{runProjectMigrations}from${JSON.stringify(pathToFileURL(join(editorRoot,'src/persist/migrations/index.ts')).href)};process.stdout.write(JSON.stringify(runProjectMigrations(JSON.parse(readFileSync(0,'utf8'))).doc));`],{input:JSON.stringify(stored),encoding:'utf8',env:{PATH:env.PATH,HOME:join(run,'home'),NODE_OPTIONS:'--import '+join(run,'network-guard.mjs')}}));
 const canonical=JSON.stringify(project,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);let hash=0x811c9dc5;for(let i=0;i<canonical.length;i++){hash^=canonical.charCodeAt(i);hash=Math.imul(hash,0x01000193);}const expectedRevision=`v${project.version}-${(hash>>>0).toString(16).padStart(8,'0')}`,ownerId='t21-api-'+randomUUID(),headers={Origin:base,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'};
 const registration=await fetch(base+'/api/external-agent/register',{method:'POST',headers,body:JSON.stringify({projectId:opened.workspace.projectId,editorId:ownerId,baseRevision:expectedRevision,tools:[]})});const claim=await registration.json();assert.equal(registration.status,200,JSON.stringify({error:claim.error}));
 Object.values(project.timelines[0].tracks).find(t=>t.captions).captions.sourceEntries[0].words[0].text=text;
 const firstVoice=project.timelines[0].items.find(i=>i.id.startsWith('main-source-'));if(firstVoice)firstVoice.volume=0.8;
 const r=await fetch(base+'/api/project-store/project-document/write',{method:'POST',headers,body:JSON.stringify({operation:'project-document-write',key,value:project,expectedRevision,ownerId,ownershipEpoch:claim.ownershipEpoch})});const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));assert.notEqual(result.accepted,false,JSON.stringify(result));
 const saved=await editorProject(opened);assert.equal(Object.values(saved.project.timelines[0].tracks).find(t=>t.captions).captions.sourceEntries[0].words[0].text,text);return saved.project;
}
async function exercise(){
 const h=await http(),{f,a,post,done,detail}=h,item=f.episodes.api,id=item.id;
 try{
 const initial=await detail(id),rp=initial.reviewPackages.find(p=>p.id===item.reviewPackageId),source=initial.artifacts.find(a=>a.id===rp.artifact_id).relative_path;
 let opened=await post('openStudio',{episodeId:id,projectRelativePath:source});assert(opened.studioUrl,JSON.stringify(opened));
 const editedA=await editCaption(opened,'API离线字幕A');record('api-edit-A-private.json',editedA);
 const args={episodeId:id,reviewPackageId:item.reviewPackageId,sourceProjectRelativePath:source,workspaceRelativePath:opened.workspace.relativePath,acceptDurationRisk:false,riskReason:null},key=randomUUID();
 const [first,duplicate]=await Promise.all([post('generateReviewVideo',args,key),post('generateReviewVideo',args,key)]);assert.equal(first.id,duplicate.id);
 const same=await post('generateReviewVideo',args);assert.equal(same.id,first.id);
 const frozen=first.input_snapshot.review_render.adjustments.studio_project,frozenBytes=readFileSync(join(a.assetRoot,frozen.relative_path));assert.match(frozenBytes.toString(),/API离线字幕A/);
 await editCaption(opened,'仅工作版本B');assert.deepEqual(readFileSync(join(a.assetRoot,frozen.relative_path)),frozenBytes);
 let d=await done(id,first);assert.equal(d.episode.stage,'qc_review');const qc1=d.reviewPackages.filter(p=>p.stage==='qc_review'&&!p.invalidated_at).sort((a,b)=>b.revision_number-a.revision_number)[0];assert(qc1);record('api-qc1-private.json',d);
 const warning=await post('openStudio',{episodeId:id,projectRelativePath:qc1.context_snapshot.project_relative_path});assert(warning.replacementWarning?.studioHasChanges);assert(!warning.studioUrl);const workB=readFileSync(join(a.assetRoot,warning.workspace.relativePath));assert.match(workB.toString(),/仅工作版本B/);
 opened=await post('openStudio',{episodeId:id,projectRelativePath:qc1.context_snapshot.project_relative_path,replaceWorkspace:true});assert(opened.studioUrl);
 const restoredA=await editorProject(opened);assert.equal(Object.values(restoredA.project.timelines[0].tracks).find(t=>t.captions).captions.sourceEntries[0].words[0].text,'API离线字幕A');
 await editCaption(opened,'API审核修订C');
 const revisionArgs={episodeId:id,reviewPackageId:qc1.id,sourceProjectRelativePath:qc1.context_snapshot.project_relative_path,workspaceRelativePath:opened.workspace.relativePath,reason:'受控离线 Studio 合成修订'},revisionKey=randomUUID();
 const [second,revisionDuplicate]=await Promise.all([post('submitStudioRevision',revisionArgs,revisionKey),post('submitStudioRevision',revisionArgs,revisionKey)]);assert.equal(second.id,revisionDuplicate.id);assert.notEqual(second.id,first.id);
 d=await done(id,second);assert.equal(d.episode.stage,'qc_review');assert.deepEqual(readFileSync(join(a.assetRoot,frozen.relative_path)),frozenBytes);
 const frozen2=second.input_snapshot.review_render.adjustments.studio_project;assert.notEqual(frozen2.relative_path,frozen.relative_path);assert.match(readFileSync(join(a.assetRoot,frozen2.relative_path),'utf8'),/API审核修订C/);
 const qc2=d.reviewPackages.filter(p=>p.stage==='qc_review'&&!p.invalidated_at).sort((a,b)=>b.revision_number-a.revision_number)[0];assert(qc2.revision_number>qc1.revision_number);assert(d.reviewPackages.some(p=>p.id===qc1.id));
 save('api-exercise-state.json',{episodeId:id,reviewPackageId:item.reviewPackageId,sourceProjectRelativePath:source,firstTask:first.id,secondTask:second.id,firstQc:qc1.id,secondQc:qc2.id,frozen,frozen2,currentQcPath:qc2.context_snapshot.project_relative_path});
 record('api-final-private.json',d);record('http-result.json',{passed:true,realHttp:true,realNativePg:true,realWorkerCli:true,realOpenChatCutEditorAndRender:true,editorMutationMethod:'Controlled local editor API; browser UI accepted separately',firstTask:first.id,secondTask:second.id,firstQc:qc1.id,secondQc:qc2.id,duplicateCommandsOneTask:true,unchangedInputsDifferentKeyOneTask:true,workAndFrozenSeparated:true,replacementRequiresExplicitConsent:true,qcReopenStartsFromFrozenEditedProject:true,oldFrozenBytesUnchanged:true,calls:h.calls,providerRequests:0,realWhisperXInference:false});console.log(JSON.stringify({passed:true,firstTask:first.id,secondTask:second.id,providerRequests:0}));
 }finally{await h.logout();}
}
async function boundaries(){
 const h=await http(),state=load('api-exercise-state.json'),id=state.episodeId,checks={};
 const request=async(headers,data,expected)=>{const r=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers,body:JSON.stringify({command:'openStudio',data,idempotencyKey:randomUUID()})});assert.equal(r.status,expected);return r.status;};
 try{
 checks.anonymous=await request({Origin:origin,'Content-Type':'application/json'},{episodeId:id,projectRelativePath:state.currentQcPath},401);
 checks.csrf=await request({...h.headers,'X-CSRF-Token':'0'.repeat(64)},{episodeId:id,projectRelativePath:state.currentQcPath},403);
 checks.crossOrigin=await request({...h.headers,Origin:'http://127.0.0.1:55177'},{episodeId:id,projectRelativePath:state.currentQcPath},403);
 await h.post('openStudio',{episodeId:id,projectRelativePath:'episodes/'+h.f.episodes.browser.id+'/outside.json'},undefined,400);checks.crossEpisodePath=400;
 const d=await h.detail(id),oldQc=d.reviewPackages.find(p=>p.id===state.firstQc);await h.post('openStudio',{episodeId:id,projectRelativePath:oldQc.context_snapshot.project_relative_path},undefined,409);checks.staleQc=409;
 const opened=await h.post('openStudio',{episodeId:id,projectRelativePath:state.currentQcPath,replaceWorkspace:true});assert(opened.studioUrl);
 await h.post('submitStudioRevision',{episodeId:id,reviewPackageId:state.secondQc,sourceProjectRelativePath:state.currentQcPath,workspaceRelativePath:opened.workspace.relativePath,reason:''},undefined,400);checks.emptyReason=400;
 const frozenPath=join(h.a.assetRoot,state.frozen2.relative_path),bytes=readFileSync(frozenPath);
 try{writeFileSync(frozenPath,Buffer.concat([bytes,Buffer.from(' ')]));await h.post('openStudio',{episodeId:id,projectRelativePath:state.currentQcPath},undefined,409);checks.frozenFingerprint=409;}finally{writeFileSync(frozenPath,bytes);assert.deepEqual(readFileSync(frozenPath),bytes);}
 const originalId=randomUUID(),password=randomBytes(32).toString('hex'),email=`t21-${originalId}@example.invalid`,digest=await hashPassword(password);
 try{sql(`begin;insert into local_identity.owners(id,email) values('${originalId}','${email}');insert into local_identity.credentials(owner_id,password_digest) values('${originalId}','${JSON.stringify(digest)}');commit;`);
 const login=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const headers={Origin:origin,'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await login.json()).csrfToken};checks.crossOwner=await request(headers,{episodeId:id,projectRelativePath:state.currentQcPath},404);
 }finally{sql(`begin;delete from local_identity.sessions where owner_id='${originalId}';delete from local_identity.credentials where owner_id='${originalId}';delete from local_identity.owners where id='${originalId}';commit;`);}
 const after=await h.detail(id);assert.equal(after.tasks.filter(t=>t.task_type==='generate_review_render').length,2);assert.equal(after.episode.stage,'qc_review');
 record('boundary-result.json',{passed:true,checks,noNewTask:true,allModifiedTestBytesRestored:true,providerRequests:0});console.log(JSON.stringify({passed:true,checks}));
 }finally{await h.logout();}
}
async function inputRevision(){
 const h=await http(),state=load('api-exercise-state.json'),id=state.episodeId;
 try{
 const before=await h.detail(id),draft=before.shotPreparationDrafts.find(d=>d.shot_id==='shot-1');
 const frozen=readFileSync(join(h.a.assetRoot,state.frozen2.relative_path));
 await h.post('saveManualAlignment',{episodeId:id,reviewPackageId:state.reviewPackageId,shotId:'shot-1',cues:[{id:'manual-t21-revision',text:'这是本地字幕验收。',start_ms:100,end_ms:3200}]});
 const after=await h.detail(id),changed=after.shotPreparationDrafts.find(d=>d.shot_id==='shot-1');assert.notEqual(changed.preparation_input_fingerprint,draft.preparation_input_fingerprint);assert.notEqual(changed.current_preview_input_fingerprint,changed.preparation_input_fingerprint);assert.notEqual(changed.confirmation_status,'confirmed');
 await h.post('openStudio',{episodeId:id,projectRelativePath:state.sourceProjectRelativePath},undefined,409);
 assert.deepEqual(readFileSync(join(h.a.assetRoot,state.frozen2.relative_path)),frozen);assert.equal(after.tasks.filter(t=>t.task_type==='generate_review_render').length,2);
 record('input-revision-private.json',after);record('input-revision-result.json',{passed:true,realHttp:true,manualAlignmentChangesFingerprint:true,previewAndConfirmationInvalidated:true,unconfirmedWorkbenchStudio409:true,oldFrozenUnchanged:true,noNewReviewTask:true,apiFixtureIntentionallyRequiresNewPreview:true,providerRequests:0});console.log(JSON.stringify({passed:true,previewAndConfirmationInvalidated:true,oldFrozenUnchanged:true}));
 }finally{await h.logout();}
}
