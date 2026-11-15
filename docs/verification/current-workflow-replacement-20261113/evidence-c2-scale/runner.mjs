// A disposable source snapshot and PostgreSQL cluster; never loads daily deployment/secrets.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,cp,symlink,readFile,readdir,writeFile,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {loadSchemaCatalog,freshSchemaTransaction} from "/Volumes/Ebuget 1T/loop-workflow-private-backup-20261114-5bk8z1hx/goal-context/d-source-restore-qwmi44pa/resume-0dp7g1rj/c2-scale-iykjt256/source/src/local-app/schemaMigrations.ts";

const project="/Volumes/Ebuget 1T/loop-workflow-private-backup-20261114-5bk8z1hx/goal-context/d-source-restore-qwmi44pa/resume-0dp7g1rj/c2-scale-iykjt256/source";
const root="/Volumes/Ebuget 1T/loop-workflow-private-backup-20261114-5bk8z1hx/goal-context/d-source-restore-qwmi44pa/resume-0dp7g1rj/c2-scale-iykjt256",source=project,evidence=join(root,'evidence');
const runId=randomBytes(6).toString('hex'),container='loop-story-e2e-'+runId;
const compatibilityRoot=process.env.LOOP_TEST_COMPAT_RELEASES_ROOT?await realpath(process.env.LOOP_TEST_COMPAT_RELEASES_ROOT):undefined;
const image='sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929';
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,
 DOCKER_HOST:process.env.DOCKER_HOST??'unix://'+join(process.env.HOME,'.colima/loop-control/docker.sock')};
const docker=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']});
const run=(cmd,args,options={})=>new Promise((resolve,reject)=>{
 const child=spawn(cmd,args,{cwd:source,env:{...env,...options.env},stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',b=>{output+=b;process.stdout.write(b);});child.stderr.on('data',b=>{output+=b;process.stderr.write(b);});
 child.once('error',reject);child.once('exit',code=>resolve({code,output}));
});
console.log('C2 evidence: '+evidence);
let created=false,passed=false;
try{
 const sdkCopy='/private/tmp/loop-story-e2e-7cUCjT/OpenChatCut';
 docker(['image','inspect',image]);
 docker(['run','--detach','--rm','--network','none','--name',container,'--label','com.loop-control.test=story-e2e-'+runId,
  '--tmpfs','/var/lib/postgresql/data','--env','POSTGRES_HOST_AUTH_METHOD=trust',image]);created=true;
 let ready=false;
 for(let n=0;n<200;n++){try{if(!docker(['logs',container]).includes('PostgreSQL init process complete'))throw Error('Initializing');docker(['exec',container,'pg_isready','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!ready)throw Error('Isolated PostgreSQL did not become ready');
 const sql=(q,db='loop_story_baseline')=>docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q);
 sql('CREATE ROLE loop_app LOGIN; CREATE ROLE loop_worker LOGIN; CREATE ROLE loop_owner; CREATE ROLE loop_anonymous; CREATE DATABASE loop_story_baseline TEMPLATE template0;','postgres');
 sql(freshSchemaTransaction(loadSchemaCatalog(source)));
 const context=join(root,'runtime-context.mjs');
 await writeFile(context,`import{execFileSync}from'node:child_process';
const container=${JSON.stringify(container)},image=${JSON.stringify(image)},label=${JSON.stringify('story-e2e-'+runId)},env=${JSON.stringify(env)};
const call=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
export function runtimeContext(){
 const assertDatabase=()=>{const m=JSON.parse(call(['inspect',container]))[0];if(m.Image!==image||m.Config.Labels?.['com.loop-control.test']!==label||m.HostConfig.NetworkMode!=='none'||m.Mounts.some(x=>x.Type==='volume'))throw Error('Isolated cluster identity mismatch');};
 const docker=(args,input)=>{assertDatabase();if(args[0]!=='exec'||!args.includes(container))throw Error('Only owned E2E container exec permitted');return call(args,input);};
 const sql=(q,db='loop_story_baseline')=>{if(db==='postgres'){if(!/^(CREATE DATABASE loop_[a-z0-9_]+ TEMPLATE template0|DROP DATABASE loop_[a-z0-9_]+ WITH\\s*\\(FORCE\\)|SELECT count\\(\\*\\) FROM pg_database WHERE datname='loop_[a-z0-9_]+')\\s*;?$/i.test(q.trim()))throw Error('Cluster operation outside E2E scope');}else if(!/^(loop_story_baseline|loop_[a-z0-9_]+_[a-f0-9]{12}(?:_[a-z]+)?)$/.test(db))throw Error('Database outside E2E scope');return docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q).trim();};
 return{container,database:'loop_story_baseline',env,docker,sql,assertDatabase,dailyRuntime:false,isolatedFixtureContainer:true};
}
`,{mode:0o600});
 const result=await run(join(project,'node_modules/.bin/vitest'),['run','src/local-app/productionScaleAcceptance.integration.test.ts','--maxWorkers=1','--fileParallelism=false','--reporter=default','--reporter=json','--outputFile='+join(evidence,'vitest.json'),...process.argv.slice(2)],{env:{LOOP_C2_SCALE_ACCEPTANCE:'1',LOOP_STORY_E2E:'1',LOOP_WORKSPACE_ACCEPTANCE:'1',LOOP_RUNTIME_VERSION_ACCEPTANCE:'1',LOOP_TEST_CONTEXT_MODULE:context,...(process.env.LOOP_WORKER_OUTCOME_ACCEPTANCE==='1'?{LOOP_WORKER_OUTCOME_RUNTIME:source}:{}),...(process.env.LOOP_METRICS_ACCEPTANCE==='1'?{LOOP_METRICS_TEST_CONTEXT:context}:{}),LOOP_TEST_OPENCHATCUT_ROOT:sdkCopy,OPENCHATCUT_ROOT:sdkCopy,LOOP_STORY_EVIDENCE:evidence,...(compatibilityRoot?{LOOP_TEST_COMPAT_RELEASES_ROOT:compatibilityRoot}:{}),...(process.env.LOOP_RECYCLE_ACCEPTANCE==='1'?{LOOP_RECYCLE_ACCEPTANCE:'1'}:{}),...(process.env.LOOP_EPISODE_DELETION_ACCEPTANCE==='1'?{LOOP_EPISODE_DELETION_ACCEPTANCE:'1'}:{}),...(process.env.LOOP_ACCOUNT_DELETION_ACCEPTANCE==='1'?{LOOP_ACCOUNT_DELETION_ACCEPTANCE:'1'}:{}),...(process.env.LOOP_CONNECTION_ACCEPTANCE==='1'?{LOOP_CONNECTION_ACCEPTANCE:'1'}:{}),...(process.env.LOOP_SECRET_ACCEPTANCE==='1'?{LOOP_SECRET_ACCEPTANCE:'1'}:{}),...(process.env.LOOP_LEGACY_EDIT_ACCEPTANCE==='1'?{LOOP_LEGACY_EDIT_ACCEPTANCE:'1'}:{}),...(process.env.LOOP_LEGACY_WORKSPACE_ACCEPTANCE==='1'?{LOOP_LEGACY_WORKSPACE_ACCEPTANCE:'1'}:{})}});
 await writeFile(join(evidence,'tests.log'),result.output);passed=result.code===0;
}catch(error){await writeFile(join(evidence,'runner-error.txt'),String(error.stack??error));console.error(String(error));}
finally{
 if(created){const meta=JSON.parse(docker(['inspect',container]))[0];if(meta.Config.Labels?.['com.loop-control.test']!=='story-e2e-'+runId)throw Error('Cleanup identity mismatch');docker(['stop','--time','5',container]);}
 await writeFile(join(evidence,'run.json'),JSON.stringify({passed,source,evidence,container,containerRemoved:created?!JSON.parse(docker(['ps','-a','--filter','name=^/'+container+'$','--format','json'])||'null'):true,paidCalls:0,paidCostCny:0,maxVideoSeconds:12},null,2));
}
process.exitCode=passed?0:1;
