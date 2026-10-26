// Owner-authorized T20 acceptance: real native PG/HTTP/files/CLI; offline controlled visual planner.
import assert from 'node:assert/strict';
import{normalizeShotCaptionContract,shotCaptionContractToDatabase}from'../../dist/worker/shotCaptions.js';
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
const run=join(root,'state/t20-20261024'),origin='http://127.0.0.1:55183',mode=process.argv[2];
const evidenceRun=process.argv[3]??'final-01';if(!/^[a-z0-9-]+$/.test(evidenceRun))throw Error('Invalid run label');
const record=(name,value)=>writeFileSync(join(run,evidenceRun+'-'+name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const save=(name,value)=>writeFileSync(join(run,name),JSON.stringify(value,null,2)+'\n',{mode:0o600}),load=name=>JSON.parse(readFileSync(join(run,name),'utf8'));
const event=(name,value={})=>appendFileSync(join(run,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),name,...value})+'\n',{mode:0o600});
const owner=()=>JSON.parse(readFileSync(join(root,'state/t13-owner.json'),'utf8'));
const checkReferences=async(_c,refs)=>{assert.equal(refs.length,0,'T20 permits no online references');};
async function prepare(){
 assertDatabase();assert(!existsSync(join(run,'fixture.json')));const pool=createLocalDatabase(configuration().database);let token;
 try{const o=owner();token=await establishSession(pool,o.email,o.password);const session=await lookupSession(pool,token);assert(session);
 const assetRoot=join(root,'media/t16-volume','t20-manual');mkdirSync(assetRoot,{mode:0o700,recursive:true});
 const policy={asset_root:assetRoot,positioning:'T20 OFFLINE alignment acceptance',allowed_tools:['read','write'],approval_gates:['script','visual','storyboard','qc'],budgets:{storyboard_planning_cents:100},a_roll:{execution_path:'manual'},b_roll:{execution_path:'manual'},narration:{execution_path:'manual'},soundtrack:{execution_path:'manual'}};
 const a=await executeConfiguration(pool,session,{command:'createAccount',idempotencyKey:randomUUID(),data:{name:'T20 OFFLINE alignment',slug:'t20-'+randomUUID(),timezone:'Asia/Shanghai',policy}},join(root,'media'),async()=>{});
 const setup=await ownerTransaction(pool,session.id,true,async c=>({h:(await c.query("SELECT * FROM public.prompt_versions WHERE account_id=$1 AND capability='storyboard_planning' AND is_active ORDER BY version DESC LIMIT 1",[a.id])).rows[0],revision:(await c.query('SELECT md5(policy::text) revision FROM public.account_blueprint_versions WHERE id=$1',[a.current_blueprint_version_id])).rows[0].revision}));
 policy.executors={storyboard_planning:{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',harness_id:setup.h.id,prompt_version:setup.h.slug}};
 await executeConfiguration(pool,session,{command:'updateBlueprint',idempotencyKey:randomUUID(),expectedRevision:setup.revision,data:{accountId:a.id,policy}},join(root,'media'),async()=>{});
 save('fixture.json',{ownerId:session.id,mountPath:join(root,'media/t16-volume'),accounts:[{accountId:a.id,assetRoot}],qualification:'NONE CREATED; offline planner fixture only',secretStore:'not used; prior substitute limitation retained'});
 }finally{if(token)await revokeSession(pool,token);await pool.end();}
}
async function serve(){
 const f=load('fixture.json'),pool=createLocalDatabase(configuration().database),connections=new LocalConnections(pool);mkdirSync(join(run,'home'),{recursive:true,mode:0o700});mkdirSync(join(run,'tmp'),{recursive:true,mode:0o700});
 const worker=await startNativeWorkerService({projectRoot,applicationDatabase:((d)=>({host:d.host,port:d.port,database:d.database}))(configuration().database),database:JSON.parse(readFileSync(join(root,'worker-database.json'))),mediaRoot:join(root,'media'),mountPath:f.mountPath,minimumFreeBytes:0,concurrency:2,actualCostCents:0,shotPreview:true,alignment:{python:'/opt/homebrew/bin/python3',cacheDirectory:join(f.accounts[0].assetRoot,'.cache/whisperx'),runnerSha256:createHash('sha256').update(readFileSync(join(projectRoot,'scripts/whisperx-align.py'))).digest('hex')},media:{mode:'controlled',modulePath:join(projectRoot,'scripts/local/media-controlled-ports.mjs')},visualCommand:[process.execPath,'--import',join(run,'network-guard.mjs'),join(projectRoot,'scripts/local/alignment-offline-fixture.mjs')],environment:{OPENCHATCUT_ROOT:join(projectRoot,'.loop-control/stage-b/verified/OpenChatCut'),OPENCHATCUT_NODE:process.execPath,PATH:env.PATH,HOME:join(run,'home'),TMPDIR:join(run,'tmp'),NODE_OPTIONS:'--import '+join(run,'network-guard.mjs'),LOOP_N8N_STATE_DIR:join(run,'orchestration')},record:e=>event(e.name,e)});
 const episodes=new LocalEpisodeCommands(pool,join(root,'media'),{...worker,mountPath:f.mountPath,minimumFreeBytes:0,checkReferences});const handler=createLocalHandler({origin,pool,mediaRoot:join(root,'media'),connections,episodes});
 const vite=await createServer({configFile:false,root:projectRoot,cacheDir:join(run,'vite-cache'),plugins:[react(),{name:'t20-offline',async closeBundle(){await worker.stop();await pool.end();event('stopped');},configureServer(server){server.middlewares.use((req,res,next)=>{if(!req.url?.startsWith('/api/')&&!req.url?.startsWith('/_'))return next();const end=res.end.bind(res);res.end=function(chunk,...args){if(req.method==='POST')event('http',{path:req.url,status:res.statusCode});if(req.url==='/api/local/catalog'&&res.statusCode===200&&chunk){const d=JSON.parse(String(chunk)),ids=f.accounts.map(a=>a.accountId);for(const k of ['accounts','blueprints','episodes','series','seriesVersions','promptVersions'])d[k]=d[k].filter(x=>ids.includes(k==='accounts'?x.id:x.account_id));return end(JSON.stringify(d),...args);}return end(chunk,...args);};void handler(req,res);});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port:55183,strictPort:true,fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.loop-control/**','**/n8n/worker.env*']},watch:{ignored:['**/.loop-control/**']}}});await vite.listen();save('runtime.json',{pid:process.pid,origin,projectRoot});event('listening',{origin});
}


// TEST_BODY
async function test(){
 assert(!existsSync(join(run,evidenceRun+'-http-result.json')));assert(!existsSync(join(run,evidenceRun+'-missing-model-private.json')));
 const f=load('fixture.json'),a=f.accounts[0],r=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(owner())});assert.equal(r.status,200);
 const headers={Origin:origin,Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await r.json()).csrfToken,'Content-Type':'application/json'},calls=[];
 const post=async(command,data,key=randomUUID(),status=200)=>{const r=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers,body:JSON.stringify({command,data,idempotencyKey:key})}),v=await r.json();calls.push({command,status:r.status});save('http-progress-private.json',{calls});assert.equal(r.status,status,JSON.stringify(v));return v;};
 const detail=async()=>{const v=await(await fetch(origin+'/api/local/episodes/'+a.episodeId,{headers})).json();for(const[k,p]of Object.entries(v.patches??{}))v.sections[k]=p.ids.map(id=>p.rows.find(r=>r.id===id));return v.sections;};
 async function until(condition){for(let i=0;i<900;i++){const d=await detail();if(condition(d))return d;await new Promise(r=>setTimeout(r,100));}save('timeout-snapshot-private.json',await detail());throw Error('T20 fixture did not reach expected state');}
 const material=async(file,purpose,type,mime)=>post('importMaterial',{episodeId:a.episodeId,sourceKind:'file',sourcePath:purpose+'-'+file,materialPurpose:purpose,materialType:type,mimeType:mime,isMainScript:false,contentBase64:readFileSync(join(run,file)).toString('base64')});
 try{
 if(!a.episodeId){
 const e=await post('create',{accountId:a.accountId,title:'T20 本地原声字幕同步验收',isTest:true});a.episodeId=e.id;save('fixture.json',f);
 await post('setAudioSourceMode',{episodeId:e.id,audioSourceMode:'source'});
 await post('importMaterial',{episodeId:e.id,sourceKind:'paste',sourcePath:'script.md',materialPurpose:'main_script',materialType:'script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from('# T20\n## 正文\n这是本地字幕验收。').toString('base64')});
 await material('reference.png','visual_reference','image','image/png');await post('start',{episodeId:e.id});
 const visual=await until(d=>d.episode.stage==='visual_review'),vp=visual.reviewPackages.find(p=>p.stage==='visual_review');
 await post('review',{episodeId:e.id,reviewPackageId:vp.id,toStage:'visual_approved',reason:'Offline synthetic visual approved.'});await post('planStoryboard',{episodeId:e.id});
 const d=await until(d=>d.episode.stage==='storyboard_review'),p=d.reviewPackages.find(p=>p.stage==='storyboard_review');a.reviewPackageId=p.id;save('fixture.json',f);
 await post('review',{episodeId:e.id,reviewPackageId:p.id,toStage:'storyboard_approved',reason:'Offline synthetic storyboard approved.'});
 a.sourceMaterialId=(await material('source.mp4','a_roll','video','video/mp4')).id;save('fixture.json',f);
 }
 const args={episodeId:a.episodeId,reviewPackageId:a.reviewPackageId,shotId:'shot-1'};
 if(!(await detail()).shotPreparationDrafts.some(d=>d.shot_id==='shot-1'&&d.current_video_artifact_id)){
 await post('saveMediaDraft',{...args,materialRevisionId:a.sourceMaterialId,clipSegments:[{start_seconds:0,end_seconds:4}],composition:{version:'shot-composition/v1',layout:'full',slots:[{id:'full',fit:'cover',focalPoint:{x:0.5,y:0.5},clipSegmentIndex:0}]},sourceVideoDurationSeconds:8,audioMode:'source',subtitleText:'这是本地字幕验收。',subtitlesEnabled:true,ttsText:'这是本地字幕验收。',bgmDuckingLevel:'off',transitionMode:'cut'});
 const clip=await post('generateClip',args);await until(d=>d.tasks.some(t=>t.id===clip.id&&['completed','failed','blocked'].includes(t.status)));
 }
 const captionContract=shotCaptionContractToDatabase(normalizeShotCaptionContract(undefined,{enabled:true,text:'这是本地字幕验收。',audioMode:'source'}));
 await post('saveTtsDraft',{...args,audioMode:'source',subtitleText:'这是本地字幕验收。',subtitlesEnabled:true,ttsText:'这是本地字幕验收。',captionContract});
 const key=randomUUID(),extract=await Promise.all([post('generateSourceAudio',args,key),post('generateSourceAudio',args,key)]);assert.equal(extract[0].id,extract[1].id);
 let d=await until(d=>d.tasks.some(t=>t.id===extract[0].id&&['completed','failed','blocked'].includes(t.status)));assert.equal(d.tasks.find(t=>t.id===extract[0].id).status,'completed',JSON.stringify(d.tasks.find(t=>t.id===extract[0].id).last_result));
 let draft=d.shotPreparationDrafts.find(d=>d.shot_id==='shot-1');assert(draft.current_audio_track_id);assert.equal(draft.audio_mode,'source');
 const reused=await post('generateSourceAudio',args);assert.equal(reused.id,extract[0].id);
 const alignment=await post('requestAlignment',{...args,localOnly:true});d=await until(d=>d.tasks.some(t=>t.id===alignment.id&&['completed','failed','blocked'].includes(t.status)));const blocked=d.tasks.find(t=>t.id===alignment.id);assert.equal(blocked.status,'blocked',JSON.stringify(blocked.last_result));record('missing-model-private.json',{task:blocked,runs:d.taskRuns.filter(r=>r.task_id===alignment.id)});
 assert.match(JSON.stringify(blocked.last_result),/unavailable|不可用|未安装/);assert(!d.artifacts.some(x=>x.producer_task_id===alignment.id));
 await post('saveManualAlignment',{...args,cues:[{id:'manual-1',text:'这是本地字幕验收。',start_ms:0,end_ms:9000}]},randomUUID(),400);
 const cues=[{id:'manual-1',text:'这是本地字幕验收。',start_ms:100,end_ms:3450}];await post('saveManualAlignment',{...args,cues});
 const preview=await post('generateSyncPreview',args);d=await until(d=>d.tasks.some(t=>t.id===preview.id&&['completed','failed','blocked'].includes(t.status)));const task=d.tasks.find(t=>t.id===preview.id);assert.equal(task.status,'completed',JSON.stringify(task.last_result));
 draft=d.shotPreparationDrafts.find(d=>d.shot_id==='shot-1');assert(draft.current_preview_artifact_id);assert(draft.current_preview_project_artifact_id);
 await post('confirmSyncPreview',{...args,deviationResolution:'none'});d=await detail();assert(d.shotPreparationDrafts.find(d=>d.shot_id==='shot-1').confirmed_at);
 const same=await post('generateSyncPreview',args);assert.equal(same.id,preview.id);
 for(const artifact of d.artifacts){const bytes=readFileSync(join(a.assetRoot,artifact.relative_path));assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);assert.equal(bytes.length,Number(artifact.file_size));const res=await fetch(origin+`/_local-artifact?episode=${a.episodeId}&path=${encodeURIComponent(artifact.relative_path)}&sha256=${artifact.sha256}`,{headers});assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),bytes);}
 record('snapshot-private.json',d);record('http-result.json',{passed:true,calls,episodeId:a.episodeId,sourceAudioTask:extract[0].id,missingModelTask:alignment.id,previewTask:preview.id,realHttp:true,realNativePg:true,realWorkerCli:true,manualCueConfirmed:true,allArtifactResponsesMatch:true,providerRequests:0,realWhisperXInference:false});console.log(JSON.stringify({passed:true,episodeId:a.episodeId,providerRequests:0,realWhisperXInference:false}));
 }finally{await fetch(origin+'/api/local/logout',{method:'POST',headers,body:'{}'});}
}
try{assert(['prepare','serve','test'].includes(mode));await({prepare,serve,test})[mode]();}catch(e){event('failure',{phase:mode,code:e?.code??'assertion'});console.error(e);process.exitCode=1;}
