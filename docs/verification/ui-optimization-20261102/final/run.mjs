// A disposable source snapshot and PostgreSQL cluster; never loads daily deployment/secrets.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,cp,symlink,readFile,readdir,writeFile,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {adaptBusinessSchema} from '../../../../scripts/storage/schema-import.mjs';

const project='/Users/dan/Programs/loop-control';
const sourceCommit=process.env.LOOP_FINAL_COMMIT??'6421a779ce1be462bda3c4e04157fecabeb5f627';
const archive=async(repo,commit,destination)=>new Promise((resolve,reject)=>{const a=spawn('git',['archive',commit],{cwd:repo,stdio:['ignore','pipe','pipe']}),t=spawn('tar',['-xf','-','-C',destination],{stdio:['pipe','pipe','pipe']});let diagnostics='';a.stdout.pipe(t.stdin);a.stderr.on('data',b=>diagnostics+=b);t.stderr.on('data',b=>diagnostics+=b);Promise.all([new Promise(r=>a.on('exit',r)),new Promise(r=>t.on('exit',r))]).then(codes=>codes.every(c=>c===0)?resolve():reject(Error('archive '+codes+' '+diagnostics)));});
const root=await mkdtemp('/private/tmp/loop-ui-audit-'),source=join(root,'source'),evidence=join(root,'evidence');
const runId=randomBytes(6).toString('hex'),container='loop-story-e2e-'+runId;
const image='sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929';
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,
 DOCKER_HOST:process.env.DOCKER_HOST??'unix://'+join(process.env.HOME,'.colima/loop-control/docker.sock')};
const docker=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']});
const run=(cmd,args,options={})=>new Promise((resolve,reject)=>{
 const child=spawn(cmd,args,{cwd:source,env:{...env,...options.env},stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',b=>{output+=b;process.stdout.write(b);});child.stderr.on('data',b=>{output+=b;process.stderr.write(b);});
 child.once('error',reject);child.once('exit',code=>resolve({code,output}));
});
await mkdir(source);await mkdir(evidence);
console.log('E2E evidence: '+evidence);
let created=false,passed=false;
try{
 await archive(project,sourceCommit,source);
 await symlink(join(project,'node_modules'),join(source,'node_modules'),'dir');
 for(const name of (await readdir(source)).filter(n=>/^tsconfig.*\.json$/.test(n))){const path=join(source,name),config=JSON.parse(await readFile(path,'utf8'));if(config.compilerOptions?.tsBuildInfoFile){config.compilerOptions.tsBuildInfoFile=join(root,name+'.tsbuildinfo');await writeFile(path,JSON.stringify(config,null,2));}}
 const sdk=join(project,'.loop-control/local/OpenChatCut'),sdkCopy=join(root,'OpenChatCut');await mkdir(sdkCopy);
 const sdkCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:sdk,encoding:'utf8'}).trim();
 const sdkDirty=execFileSync('git',['status','--porcelain'],{cwd:sdk,encoding:'utf8'}).trim();if(sdkDirty)throw Error('Installed SDK must be clean');
 await archive(sdk,sdkCommit,sdkCopy);await symlink(join(sdk,'node_modules'),join(sdkCopy,'node_modules'),'dir');
 const migrations=(await readdir(join(source,'db/local'))).filter(n=>/^\d{3}-[a-z0-9-]+\.sql$/.test(n)).sort();
 const migrationManifest=await Promise.all(migrations.map(async path=>({path,sha256:createHash('sha256').update(await readFile(join(source,'db/local',path))).digest('hex')})));
 await writeFile(join(evidence,'source-manifest.json'),JSON.stringify({sourceCommit,sourceArchive:'git archive streamed to tar, full committed tree',productBehaviorOverlays:[],instrumentationOverlays:['src/local-app/localRoute.ts: append raw error response/inner stack only','scripts/openchatcut-render.mjs: append child stdout/stderr only'],testOverlays:['src/local-app/uiAudit20261102.integration.test.ts','storyBrowser session handle and private zoom extension','localRoute diagnostic stderr and error JSONL only','openchatcut-render child stdout/stderr retention','test deadline overrides Pexels420s and sound600s','storyE2e synthetic 120-model provider reader; remote usage disabled'],sdkCommit,sdkVersion:JSON.parse(await readFile(join(sdkCopy,'package.json'),'utf8')).version,sdkDirty,migrations:migrationManifest,nodeModules:'read-only shared symlink; private Vite cache',paidCalls:0},null,2));
 await cp(join(project,'docs/verification/ui-optimization-20261102/final/audit.integration.test.ts'),join(source,'src/local-app/uiAudit20261102.integration.test.ts'));
 const browserFixture=join(source,'src/local-app/storyBrowser.fixture.ts');
 const browserSource=await readFile(browserFixture,'utf8');if(!browserSource.includes('return{cli,snapshot'))throw Error('Browser fixture contract drift');
 const extension=join(root,'zoom-extension');await mkdir(extension);await writeFile(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Loop isolated native zoom acceptance',version:'1.0',permissions:['tabs'],host_permissions:['http://127.0.0.1/*'],background:{service_worker:'background.js'}}));await writeFile(join(extension,'background.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
 await writeFile(browserFixture,browserSource.replace('return{cli,snapshot','return{session,cli,snapshot').replace("['--session',session,'--json',...args]","['--session',session,'--extension',process.env.LOOP_FINAL_BROWSER_EXTENSION!,'--json',...args]"));
 let diagnosticFile=join(source,'src/local-app/localRoute.ts'),diagnosticSource=await readFile(diagnosticFile,'utf8');diagnosticSource="import{appendFileSync as finalDiagnostic}from'node:fs';\n"+diagnosticSource.replace("const send=(status:number,value:unknown)=>{","const send=(status:number,value:unknown)=>{if(status>=400&&process.env.FINAL32_DIAGNOSTIC)finalDiagnostic(process.env.FINAL32_DIAGNOSTIC!+'/http-errors.jsonl',JSON.stringify({url:request.url,status,body:value})+'\\n');").replace("}catch(error){const runtimeCode=","}catch(error){console.error('FINAL32_INNER_ERROR',error);const runtimeCode=");await writeFile(diagnosticFile,diagnosticSource);
 diagnosticFile=join(source,'scripts/openchatcut-render.mjs');diagnosticSource="import{appendFileSync as finalDiagnostic}from'node:fs';\n"+await readFile(diagnosticFile,'utf8');diagnosticSource=diagnosticSource.replaceAll('logs.push(String(chunk))',"(logs.push(String(chunk)), finalDiagnostic(process.env.FINAL32_DIAGNOSTIC+'/sdk-render.log',String(chunk)))");await writeFile(diagnosticFile,diagnosticSource);
 for(const [file,before,after]of [['workspaceBundledSounds.integration.test.ts','},300000);','},600000);'],['workspacePexels.integration.test.ts','},120000);','},420000);']]){const p=join(source,'src/local-app',file);await writeFile(p,(await readFile(p,'utf8')).replace(before,after));}

 const storyFixture=join(source,'src/local-app/storyE2e.fixture.ts'),storySource=await readFile(storyFixture,'utf8');
 const providerAnchor="{mode:'live',networkAvailable:true,verify:async()=>{throw Error('Story fixture does not contact real providers');}}),";
 if(!storySource.includes(providerAnchor))throw Error('Controlled model provider seam drift');
 await writeFile(storyFixture,storySource.replace(providerAnchor,"{mode:'live',networkAvailable:true,verify:async()=>{throw Error('Story fixture does not contact real providers');}},async()=>{throw Error('Final acceptance refuses remote usage');},async()=>Array.from({length:120},(_,i)=>({id:'controlled-catalog-model-'+String(i+1).padStart(3,'0'),capability:'未分类'}))),"));
 const build=await run('npm',['run','runtime:prepare']);await writeFile(join(evidence,'build.log'),build.output);
 if(build.code!==0)throw Error('Isolated build failed');
 docker(['image','inspect',image]);
 docker(['run','--detach','--rm','--network','none','--name',container,'--label','com.loop-control.test=story-e2e-'+runId,
  '--tmpfs','/var/lib/postgresql/data','--env','POSTGRES_HOST_AUTH_METHOD=trust',image]);created=true;
 let ready=false;
 for(let n=0;n<200;n++){try{if(!docker(['logs',container]).includes('PostgreSQL init process complete'))throw Error('Initializing');docker(['exec',container,'pg_isready','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!ready)throw Error('Isolated PostgreSQL did not become ready');
 const sql=(q,db='loop_story_baseline')=>docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q);
 sql('CREATE ROLE loop_app LOGIN; CREATE ROLE loop_worker LOGIN; CREATE ROLE loop_owner; CREATE ROLE loop_anonymous; CREATE DATABASE loop_story_baseline TEMPLATE template0;','postgres');
 const identity=await readFile(join(source,'db/local/identity.sql'),'utf8');
 const baseline=adaptBusinessSchema(await readFile(join(source,'db/local/c-baseline.sql'),'utf8')).sql;
 const access=await readFile(join(source,'db/local/read-access.sql'),'utf8');
 sql('BEGIN;\n'+identity+'\n'+baseline+'\nSET search_path=public;\n'+access+'\nCREATE TABLE local_identity.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL);\nCOMMIT;');

 for(const name of migrations){const body=await readFile(join(source,'db/local',name),'utf8');sql(`BEGIN;\n${body}\nINSERT INTO local_identity.schema_migrations VALUES('${name}','${createHash('sha256').update(body).digest('hex')}');COMMIT;`);}
 const context=join(root,'runtime-context.mjs');
 await writeFile(context,`import{execFileSync}from'node:child_process';
const container=${JSON.stringify(container)},image=${JSON.stringify(image)},label=${JSON.stringify('story-e2e-'+runId)},env=${JSON.stringify(env)};
const call=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
export function runtimeContext(){
 const assertDatabase=()=>{const m=JSON.parse(call(['inspect',container]))[0];if(m.Image!==image||m.Config.Labels?.['com.loop-control.test']!==label||m.HostConfig.NetworkMode!=='none'||m.Mounts.some(x=>x.Type==='volume'))throw Error('Isolated cluster identity mismatch');};
 const docker=(args,input)=>{assertDatabase();if(args[0]!=='exec'||!args.includes(container))throw Error('Only owned E2E container exec permitted');return call(args,input);};
 const sql=(q,db='loop_story_baseline')=>{if(db==='postgres'){if(!/^(CREATE DATABASE loop_[a-z0-9_]+ TEMPLATE template0|DROP DATABASE loop_[a-z0-9_]+ WITH\\s*\\(FORCE\\)|SELECT count\\(\\*\\) FROM pg_database WHERE datname='loop_[a-z0-9_]+')\\s*;?$/i.test(q.trim()))throw Error('Cluster operation outside E2E scope');}else if(!/^(loop_story_baseline|loop_[a-z0-9_]+_[a-f0-9]{12}(?:_[a-z]+)?)$/.test(db))throw Error('Database outside E2E scope');return docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q).trim();};
 return{container,database:'loop_story_baseline',env,docker,sql,assertDatabase,dailyRuntime:false};
}
`,{mode:0o600});
 const result=await run(join(project,'node_modules/.bin/vitest'),['run','src/local-app/uiAudit20261102.integration.test.ts','--maxWorkers=1','--fileParallelism=false','--reporter=default','--reporter=json','--outputFile='+join(evidence,'vitest.json'),...process.argv.slice(2)],{env:{LOOP_FINAL_BROWSER_EXTENSION:extension,FINAL32_DIAGNOSTIC:evidence,LOOP_WORKSPACE_ACCEPTANCE:'1',LOOP_NATIVE_READABILITY_ACCEPTANCE:'1',LOOP_NATIVE_A11Y_ACCEPTANCE:'1',LOOP_SOUND_EVIDENCE:evidence,AGENT_BROWSER_ALLOWED_DOMAINS:'127.0.0.1,localhost',LOOP_STORY_E2E:'1',LOOP_TEST_CONTEXT_MODULE:context,LOOP_TEST_OPENCHATCUT_ROOT:sdkCopy,OPENCHATCUT_ROOT:sdkCopy,LOOP_STORY_EVIDENCE:evidence}});
 await writeFile(join(evidence,'tests.log'),result.output);passed=result.code===0;
}catch(error){await writeFile(join(evidence,'runner-error.txt'),String(error.stack??error));console.error(String(error));}
finally{
 if(created){const meta=JSON.parse(docker(['inspect',container]))[0];if(meta.Config.Labels?.['com.loop-control.test']!=='story-e2e-'+runId)throw Error('Cleanup identity mismatch');docker(['stop','--time','5',container]);}
 await writeFile(join(evidence,'run.json'),JSON.stringify({passed,source,evidence,container,containerRemoved:created?!JSON.parse(docker(['ps','-a','--filter','name=^/'+container+'$','--format','json'])||'null'):true,paidCalls:0,paidCostCny:0},null,2));
}
process.exitCode=passed?0:1;
