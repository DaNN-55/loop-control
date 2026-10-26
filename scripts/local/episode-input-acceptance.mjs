// Owner-authorized T16 acceptance: real native PG/HTTP/files/CLI; offline controlled visual planner.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync} from 'node:fs';
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
const run=join(root,'state/t16-20261024'),origin='http://127.0.0.1:55179',mode=process.argv[2];
const save=(name,value)=>writeFileSync(join(run,name),JSON.stringify(value,null,2)+'\n',{mode:0o600}),load=name=>JSON.parse(readFileSync(join(run,name),'utf8'));
const event=(name,value={})=>appendFileSync(join(run,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),name,...value})+'\n',{mode:0o600});
const owner=()=>JSON.parse(readFileSync(join(root,'state/t13-owner.json'),'utf8'));
async function prepare(){
 assertDatabase();assert(!existsSync(join(run,'fixture.json')));const mountPath=join(root,'media/t16-volume');assert.notEqual(statSync(mountPath).dev,statSync(join(mountPath,'..')).dev);
 const pool=createLocalDatabase(configuration().database);let token;
 try{
  const o=owner();token=await establishSession(pool,o.email,o.password);assert(token);const session=await lookupSession(pool,token);assert(session);
  const asset=join(mountPath,'account');mkdirSync(asset,{mode:0o700});const policy={positioning:'T16 isolated input acceptance',asset_root:asset,allowed_tools:['read','write'],approval_gates:['script','visual','storyboard','qc']};
  const account=await executeConfiguration(pool,session,{command:'createAccount',idempotencyKey:randomUUID(),data:{name:'T16 isolated input',slug:'t16-'+randomUUID(),timezone:'Asia/Shanghai',policy}},join(root,'media'));
  save('prepared-account.json',{accountId:account.id,ownerId:session.id,blueprintId:account.current_blueprint_version_id,assetRoot:asset,mountPath,policy});
  const setup=await ownerTransaction(pool,session.id,true,async c=>({h:(await c.query("SELECT * FROM public.prompt_versions WHERE account_id=$1 AND capability='storyboard_planning' AND is_active ORDER BY version DESC LIMIT 1",[account.id])).rows[0],revision:(await c.query('SELECT md5(policy::text) revision FROM public.account_blueprint_versions WHERE id=$1',[account.current_blueprint_version_id])).rows[0].revision}));
  assert(setup.h);policy.executors={storyboard_planning:{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',harness_id:setup.h.id,prompt_version:setup.h.slug}};
  await executeConfiguration(pool,session,{command:'updateBlueprint',idempotencyKey:randomUUID(),expectedRevision:setup.revision,data:{accountId:account.id,policy}},join(root,'media'));
  const series=await executeConfiguration(pool,session,{command:'createSeries',idempotencyKey:randomUUID(),data:{accountId:account.id,name:'T16 frozen series',rules:{format:'T16 original baseline'}}},join(root,'media'));
  save('fixture.json',{accountId:account.id,ownerId:session.id,blueprintId:account.current_blueprint_version_id,seriesId:series.series_id,seriesVersionId:series.id,assetRoot:asset,mountPath,policy});event('prepared',{accountId:account.id});
 }finally{if(token)await revokeSession(pool,token);await pool.end();}
}
async function serve(){
 assertDatabase();const f=load('fixture.json'),pool=createLocalDatabase(configuration().database),connections=new LocalConnections(pool);mkdirSync(join(run,'home'),{recursive:true,mode:0o700});mkdirSync(join(run,'tmp'),{recursive:true,mode:0o700});
 const worker=await startNativeWorkerService({projectRoot,applicationDatabase:((d)=>({host:d.host,port:d.port,database:d.database}))(configuration().database),database:JSON.parse(readFileSync(join(root,'worker-database.json'))),mediaRoot:join(root,'media'),mountPath:f.mountPath,minimumFreeBytes:0,concurrency:2,actualCostCents:0,visualCommand:[process.execPath,'--import',join(run,'network-guard.mjs'),join(run,'fixture-visual.mjs')],environment:{PATH:env.PATH,HOME:join(run,'home'),TMPDIR:join(run,'tmp'),NODE_OPTIONS:'--import '+join(run,'network-guard.mjs'),LOOP_N8N_STATE_DIR:join(run,'orchestration')},record:e=>event(e.name,e)});
 const episodes=new LocalEpisodeCommands(pool,join(root,'media'),{...worker,wake:episodeId=>{if(existsSync(join(run,'suppress-wake')))event('wake-suppressed',{episodeId});else worker.wake(episodeId);},mountPath:f.mountPath,minimumFreeBytes:0,checkReferences:(c,refs)=>connections.assertBlueprintReferences(c,refs)});
 const handler=createLocalHandler({origin,pool,mediaRoot:join(root,'media'),connections,episodes});
 const vite=await createServer({configFile:false,root:projectRoot,cacheDir:join(run,'vite-cache'),plugins:[react(),{name:'t16-isolated-input',async closeBundle(){await worker.stop();await pool.end();event('stopped');},configureServer(server){server.middlewares.use((req,res,next)=>{if(!req.url?.startsWith('/api/')&&!req.url?.startsWith('/_'))return next();const end=res.end.bind(res);res.end=function(chunk,...args){
  if(req.method==='POST')event('http',{path:req.url,status:res.statusCode});
  if(req.url==='/api/local/catalog'&&res.statusCode===200&&chunk){const d=JSON.parse(String(chunk));d.accounts=d.accounts.filter(a=>a.id===f.accountId);d.blueprints=d.blueprints.filter(b=>b.account_id===f.accountId);d.episodes=d.episodes.filter(e=>e.account_id===f.accountId);d.series=d.series.filter(s=>s.account_id===f.accountId);d.seriesVersions=d.seriesVersions.filter(s=>s.account_id===f.accountId);d.promptVersions=d.promptVersions.filter(s=>s.account_id===f.accountId);return end(JSON.stringify(d),...args);}return end(chunk,...args);};void handler(req,res);});}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port:55179,strictPort:true,fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.loop-control/**','**/n8n/worker.env*']},watch:{ignored:['**/.loop-control/**']}}});
 process.on('SIGUSR2',()=>save('scheduler-status.json',worker.status()));
 await vite.listen();save('runtime.json',{pid:process.pid,origin,projectRoot});event('listening',{origin});
}
async function test(){
 const f=load('fixture.json'),o=owner(),r=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(o)});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0],{csrfToken}=await r.json(),headers={Origin:origin,Cookie:cookie,'X-CSRF-Token':csrfToken,'Content-Type':'application/json'};
 const calls=[];async function post(command,data,key=randomUUID(),status=200,path='episode-commands',extra={}){const r=await fetch(origin+'/api/local/'+path,{method:'POST',headers,body:JSON.stringify({command,data,idempotencyKey:key,...extra})}),value=await r.json();calls.push({command,status:r.status});assert.equal(r.status,status,JSON.stringify(value));return value;}
 async function detail(id){const value=await(await fetch(origin+'/api/local/episodes/'+id,{headers})).json();const sections=value.sections;for(const [key,p]of Object.entries(value.patches??{}))sections[key]=p.ids.map(id=>p.rows.find(r=>r.id===id));return sections;}
 try{
  assert.equal((await fetch(origin+'/api/local/catalog')).status,401);assert.equal((await fetch(origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
  await post('create',{accountId:randomUUID(),title:'not owned'},randomUUID(),404);
  const beforeCatalog=await(await fetch(origin+'/api/local/catalog',{headers})).json(),beforePolicy=beforeCatalog.blueprints.find(b=>b.id===f.blueprintId).policy;
  const key=randomUUID(),created=await Promise.all(Array.from({length:4},()=>post('create',{accountId:f.accountId,title:'T16 HTTP controlled visual',seriesVersionId:f.seriesVersionId,isTest:true},key)));assert.equal(new Set(created.map(e=>e.id)).size,1);const e=created[0];save('http-episode.json',{episodeId:e.id});
  const script={episodeId:e.id,sourceKind:'file',sourcePath:'main.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from('# T16 synthetic script\n\n## 正文\nA supplied visual reference covers this synthetic scene.\n').toString('base64')};
  const uploadKey=randomUUID(),uploaded=await Promise.all(Array.from({length:3},()=>post('importMaterial',script,uploadKey)));assert.equal(new Set(uploaded.map(m=>m.id)).size,1);
  await post('importMaterial',{...script,sourcePath:'../escape.md',isMainScript:false,materialPurpose:'visual_reference'},randomUUID(),400);
  const image=await post('importMaterial',{episodeId:e.id,sourceKind:'file',sourcePath:'reference.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCZkAAAAASUVORK5CYII='});
  const catalog=await(await fetch(origin+'/api/local/catalog',{headers})).json(),blueprint=catalog.blueprints.find(b=>b.id===f.blueprintId);
  await post('updateBlueprint',{accountId:f.accountId,policy:{...blueprint.policy,positioning:'T16 changed current blueprint '+randomUUID()}},randomUUID(),200,'configuration',{expectedRevision:catalog.blueprintRevisions[f.blueprintId]});
  await post('createSeriesVersion',{seriesId:f.seriesId,rules:{format:'T16 later baseline'}},randomUUID(),200,'configuration');
  const frozen=await detail(e.id);assert.deepEqual(frozen.blueprint.policy,beforePolicy);assert.notEqual(frozen.blueprint.id,f.blueprintId);assert.equal(frozen.seriesVersion.id,f.seriesVersionId);
  const startedKey=randomUUID();await Promise.all(Array.from({length:3},()=>post('start',{episodeId:e.id},startedKey)));
  let snapshot;for(let i=0;i<150;i++){snapshot=await detail(e.id);if(snapshot.episode.stage==='visual_review'||snapshot.tasks.some(t=>['blocked','failed'].includes(t.status)))break;await new Promise(r=>setTimeout(r,200));}
  assert.equal(snapshot.episode.stage,'visual_review',JSON.stringify({stage:snapshot.episode.stage,tasks:snapshot.tasks}));assert.equal(snapshot.tasks.length,1);assert.equal(snapshot.tasks[0].status,'completed');assert.equal(snapshot.tasks[0].last_result.preflight.version,'worker-preflight/v2');assert.equal(snapshot.taskRuns.length,1);assert.equal(snapshot.artifacts.length,1);assert.equal(snapshot.materialRevisions.length,2);
  const frozenTaskInput=sql(`select input_snapshot from public.tasks where id='${snapshot.tasks[0].id}'`);
  await post('importMaterial',{...script,sourcePath:'late-main.md'},randomUUID(),409);
  await post('importMaterial',{...script,sourcePath:'late-reference.txt',materialType:'reference',materialPurpose:'general_reference',mimeType:'text/plain',isMainScript:false,contentBase64:Buffer.from('Supplementary input after preparation.').toString('base64')});
  assert.equal(sql(`select input_snapshot from public.tasks where id='${snapshot.tasks[0].id}'`),frozenTaskInput);
  const artifact=snapshot.artifacts[0],bytes=readFileSync(join(f.assetRoot,artifact.relative_path));assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);assert.equal(bytes.length,Number(artifact.file_size));
  const file=await fetch(origin+`/_local-artifact?episode=${e.id}&path=${encodeURIComponent(artifact.relative_path)}&sha256=${artifact.sha256}`,{headers});assert.equal(file.status,200);assert.equal(await file.text(),bytes.toString());
  const p=snapshot.reviewPackages.find(p=>p.stage==='visual_review'&&!p.invalidated_at);assert(p);await post('review',{episodeId:e.id,toStage:'visual_approved',reason:'stale package',reviewPackageId:randomUUID()},randomUUID(),409);
  const reviewKey=randomUUID(),review={episodeId:e.id,toStage:'visual_approved',reason:'Owner approves this controlled offline fixture.',reviewPackageId:p.id};await Promise.all([post('review',review,reviewKey),post('review',review,reviewKey)]);
  const final=await detail(e.id);assert.equal(final.episode.stage,'visual_approved');assert.equal(final.artifacts[0].id,artifact.id);
  save('http-result.json',{at:new Date().toISOString(),realHttp:true,realNativePostgres:true,realWorkerCliSubprocess:true,visualPlanner:'controlled offline fixture, not online AI',providerRequests:0,created4OneEpisode:true,upload3OneRevision:true,start3OneTask:true,review2OneDecision:true,blueprintAndSeriesFrozen:true,materialsApproved:true,lateSupplementAllowedWithFrozenTask:true,confirmedMainReplacement409:true,currentPreflightVersion:"worker-preflight/v2",artifactVerified:{id:artifact.id,sha256:artifact.sha256,bytes:bytes.length},finalStage:final.episode.stage,episodeId:e.id,taskId:snapshot.tasks[0].id,reviewPackageId:p.id,calls,passed:true});save('http-final-snapshot.json',final);console.log({passed:true,episodeId:e.id,taskId:snapshot.tasks[0].id});
 }finally{await fetch(origin+'/api/local/logout',{method:'POST',headers,body:'{}'});}
}
try{assert(['prepare','serve','test'].includes(mode));await({prepare,serve,test})[mode]();}catch(e){event('failure',{phase:mode,code:e?.code??'assertion',detail:mode==='test'?String(e.message).slice(0,500):'Inspect private diagnostics.'});console.error(e);process.exitCode=1;}
