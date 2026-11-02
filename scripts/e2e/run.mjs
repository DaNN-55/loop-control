// A disposable source snapshot and PostgreSQL cluster; never loads daily deployment/secrets.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,cp,symlink,readFile,readdir,writeFile,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {adaptBusinessSchema} from '../storage/schema-import.mjs';

const project=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
const root=await mkdtemp('/private/tmp/loop-story-e2e-'),source=join(root,'source'),evidence=join(root,'evidence');
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
 for(const entry of ['src','scripts','db','public','index.html','package.json','package-lock.json','vite.config.ts',...(await readdir(project)).filter(n=>/^tsconfig.*\.json$/.test(n))]){
  await cp(join(project,entry),join(source,entry),{recursive:true});
 }
 // Existing default parser regression reads these six versioned input scripts.
 const scripts='docs/production-tests/rizhao-jinshan-20261028/scripts';
 await mkdir(dirname(join(source,scripts)),{recursive:true});await cp(join(project,scripts),join(source,scripts),{recursive:true});
 await symlink(join(project,'node_modules'),join(source,'node_modules'),'dir');
 for(const name of (await readdir(source)).filter(n=>/^tsconfig.*\.json$/.test(n))){const path=join(source,name),config=JSON.parse(await readFile(path,'utf8'));if(config.compilerOptions?.tsBuildInfoFile){config.compilerOptions.tsBuildInfoFile=join(root,name+'.tsbuildinfo');await writeFile(path,JSON.stringify(config,null,2));}}
 const sdk=process.env.LOOP_TEST_OPENCHATCUT_ROOT??join(project,'.loop-control/local/OpenChatCut'),sdkCopy=join(root,'OpenChatCut');
 await cp(sdk,sdkCopy,{recursive:true,filter:path=>!path.slice(sdk.length).split('/').some(p=>['node_modules','.git','.data','dist','.vite','data'].includes(p))});
 await symlink(join(sdk,'node_modules'),join(sdkCopy,'node_modules'),'dir');
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
 const migrations=(await readdir(join(source,'db/local'))).filter(n=>/^\d{3}-[a-z0-9-]+\.sql$/.test(n)).sort();
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
 const result=await run(join(project,'node_modules/.bin/vitest'),['run','src/local-app/storyE2e.integration.test.ts','--maxWorkers=1','--fileParallelism=false','--reporter=default','--reporter=json','--outputFile='+join(evidence,'vitest.json'),...process.argv.slice(2)],{env:{LOOP_STORY_E2E:'1',LOOP_TEST_CONTEXT_MODULE:context,LOOP_TEST_OPENCHATCUT_ROOT:sdkCopy,OPENCHATCUT_ROOT:sdkCopy,LOOP_STORY_EVIDENCE:evidence}});
 await writeFile(join(evidence,'tests.log'),result.output);passed=result.code===0;
}catch(error){await writeFile(join(evidence,'runner-error.txt'),String(error.stack??error));console.error(String(error));}
finally{
 if(created){const meta=JSON.parse(docker(['inspect',container]))[0];if(meta.Config.Labels?.['com.loop-control.test']!=='story-e2e-'+runId)throw Error('Cleanup identity mismatch');docker(['stop','--time','5',container]);}
 await writeFile(join(evidence,'run.json'),JSON.stringify({passed,source,evidence,container,containerRemoved:created?!JSON.parse(docker(['ps','-a','--filter','name=^/'+container+'$','--format','json'])||'null'):true,paidCalls:0,paidCostCny:0,maxVideoSeconds:8},null,2));
}
process.exitCode=passed?0:1;
