// Disposable PostgreSQL and SDK copy; never reads the daily deployment or secrets.
import {execFileSync} from 'node:child_process';
import {mkdtemp,cp,symlink,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {adaptBusinessSchema} from '../../../scripts/storage/schema-import.mjs';
const root=await mkdtemp('/private/tmp/loop-state56-'),runId=randomBytes(6).toString('hex'),container='loop-state56-'+runId;
const image='sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929';
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,DOCKER_HOST:'unix://'+join(process.env.HOME,'.colima/loop-control/docker.sock')};
const call=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
const label='state56-'+runId;let started=false,closed=false;
async function close(){if(closed)return;closed=true;if(started){const meta=JSON.parse(call(['inspect',container]))[0];if(meta.Config.Labels?.['com.loop-control.test']!==label)throw Error('Cleanup identity mismatch');call(['stop','--time','5',container]);}await rm(root,{recursive:true,force:true});console.log('Owned cluster and SDK copy removed');}
try{
 const sdk=join(process.cwd(),'.loop-control/local/OpenChatCut'),sdkCopy=join(root,'OpenChatCut');
 await cp(sdk,sdkCopy,{recursive:true,filter:path=>!path.slice(sdk.length).split('/').some(p=>['node_modules','.git','.data','dist','.vite','data'].includes(p))});
 await symlink(join(sdk,'node_modules'),join(sdkCopy,'node_modules'),'dir');
 call(['run','--detach','--rm','--network','none','--name',container,'--label','com.loop-control.test='+label,'--tmpfs','/var/lib/postgresql/data','--env','POSTGRES_HOST_AUTH_METHOD=trust',image]);started=true;
 for(let n=0;n<200;n++){try{if(!call(['logs',container]).includes('PostgreSQL init process complete'))throw Error();call(['exec',container,'pg_isready','-U','postgres']);break;}catch{if(n===199)throw Error('PostgreSQL readiness timeout');await new Promise(r=>setTimeout(r,100));}}
 const sql=(q,db='loop_story_baseline')=>call(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q);
 sql('CREATE ROLE loop_app LOGIN; CREATE ROLE loop_worker LOGIN; CREATE ROLE loop_owner; CREATE ROLE loop_anonymous; CREATE DATABASE loop_story_baseline TEMPLATE template0;','postgres');
 sql('BEGIN;\n'+await readFile('db/local/identity.sql','utf8')+'\n'+adaptBusinessSchema(await readFile('db/local/c-baseline.sql','utf8')).sql+'\nSET search_path=public;\n'+await readFile('db/local/read-access.sql','utf8')+'\nCREATE TABLE local_identity.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL);\nCOMMIT;');
 for(const name of (await readdir('db/local')).filter(n=>/^\d{3}-[a-z0-9-]+\.sql$/.test(n)).sort()){const body=await readFile(join('db/local',name),'utf8');sql(`BEGIN;\n${body}\nINSERT INTO local_identity.schema_migrations VALUES('${name}','${createHash('sha256').update(body).digest('hex')}');COMMIT;`);}
 const context=join(root,'context.mjs');
 await writeFile(context,`import{execFileSync}from'node:child_process';
const container=${JSON.stringify(container)},image=${JSON.stringify(image)},label=${JSON.stringify(label)},env=${JSON.stringify(env)};
const call=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
export function runtimeContext(){
 const assertDatabase=()=>{const m=JSON.parse(call(['inspect',container]))[0];if(m.Image!==image||m.Config.Labels?.['com.loop-control.test']!==label||m.HostConfig.NetworkMode!=='none'||m.Mounts.some(x=>x.Type==='volume'))throw Error('Isolated cluster identity mismatch');};
 const docker=(args,input)=>{assertDatabase();if(args[0]!=='exec'||!args.includes(container))throw Error('Only owned container exec permitted');return call(args,input);};
 const sql=(q,db='loop_story_baseline')=>{if(db==='postgres'){if(!/^(CREATE DATABASE loop_[a-z0-9_]+ TEMPLATE template0|DROP DATABASE loop_[a-z0-9_]+ WITH\\s*\\(FORCE\\)|SELECT count\\(\\*\\) FROM pg_database WHERE datname='loop_[a-z0-9_]+')\\s*;?$/i.test(q.trim()))throw Error('Cluster operation outside scope');}else if(!/^(loop_story_baseline|loop_[a-z0-9_]+_[a-f0-9]{12}(?:_[a-z]+)?)$/.test(db))throw Error('Database outside scope');return docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q).trim();};
 return{container,database:'loop_story_baseline',env,docker,sql,assertDatabase,dailyRuntime:false};}
`,{mode:0o600});
 await writeFile('docs/verification/state-machines-56-20261111/isolation.json',JSON.stringify({root,context,sdk:sdkCopy,container,image,network:'none',dailyData:false},null,2)+'\n');
 console.log('READY '+root);
 const keepAlive=setInterval(()=>{},1000);
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(keepAlive);void close().then(()=>process.exit(0));});
}catch(error){await close();throw error;}
