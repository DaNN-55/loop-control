// Disposable PostgreSQL, no host ports, no network, no persistent volumes or daily schema/ledger.
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {adaptBusinessSchema} from '../../../scripts/storage/schema-import.mjs';
const root=process.cwd(),scratch=join(root,'.scratch/state-machines-followup345-20261110');
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,DOCKER_HOST:'unix://'+join(process.env.HOME,'.colima/loop-control/docker.sock')};
const docker=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
const image='sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929';
await mkdir(scratch,{recursive:true});
if(process.argv[2]==='stop'){
 const {container,label}=JSON.parse(await readFile(join(scratch,'cluster.json'),'utf8'));
 const data=JSON.parse(docker(['inspect',container]))[0];if(data.Config.Labels?.['com.loop-control.test']!==label)throw Error('Foreign cluster');
 docker(['stop','--time','5',container]);console.log('Owned isolated PostgreSQL stopped');
}else{
 const id=randomBytes(6).toString('hex'),container='loop-state-followup345-'+id,label='state-followup345-'+id;
 let created=false;
 try{
  docker(['run','--detach','--rm','--network','none','--name',container,'--label','com.loop-control.test='+label,'--tmpfs','/var/lib/postgresql/data','--env','POSTGRES_HOST_AUTH_METHOD=trust',image]);created=true;
  let ready=false;for(let i=0;i<200;i++){try{if(!docker(['logs',container]).includes('PostgreSQL init process complete'))throw Error();docker(['exec',container,'pg_isready','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}if(!ready)throw Error('Cluster not ready');
  const sql=(q,db='loop_state_baseline')=>docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q);
  sql('CREATE ROLE loop_app LOGIN;CREATE ROLE loop_worker LOGIN;CREATE ROLE loop_owner;CREATE ROLE loop_anonymous;CREATE DATABASE loop_state_baseline TEMPLATE template0;','postgres');
  const identity=await readFile(join(root,'db/local/identity.sql'),'utf8'),baseline=adaptBusinessSchema(await readFile(join(root,'db/local/c-baseline.sql'),'utf8')).sql,access=await readFile(join(root,'db/local/read-access.sql'),'utf8');
  sql('BEGIN;'+identity+'\n'+baseline+'\nSET search_path=public;'+access+'\nCREATE TABLE local_identity.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL);COMMIT;');
  const files=(await readdir(join(root,'db/local'))).filter(n=>/^\d{3}-[a-z0-9-]+\.sql$/.test(n)).sort();
  for(const name of files){const body=await readFile(join(root,'db/local',name),'utf8');sql(`BEGIN;\n${body}\nINSERT INTO local_identity.schema_migrations VALUES('${name}','${createHash('sha256').update(body).digest('hex')}');COMMIT;`);}
  const code=`import{execFileSync}from'node:child_process';const container=${JSON.stringify(container)},label=${JSON.stringify(label)},image=${JSON.stringify(image)},env=${JSON.stringify(env)};
const call=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
export function runtimeContext(){const assertDatabase=()=>{const c=JSON.parse(call(['inspect',container]))[0];if(c.Image!==image||c.Config.Labels?.['com.loop-control.test']!==label||c.HostConfig.NetworkMode!=='none'||c.Mounts.some(x=>x.Type==='volume'))throw Error('Isolated cluster mismatch');};
const docker=(args,input)=>{assertDatabase();if(args[0]!=='exec'||!args.includes(container))throw Error('Foreign container command');return call(args,input);};
const sql=(q,db='loop_state_baseline')=>{if(db==='postgres'){if(!/^(CREATE DATABASE loop_[a-z0-9_]+ TEMPLATE template0|DROP DATABASE loop_[a-z0-9_]+ WITH\\s*\\(FORCE\\)|SELECT count\\(\\*\\) FROM pg_database WHERE datname='loop_[a-z0-9_]+')\\s*;?$/i.test(q.trim()))throw Error('Foreign catalog command');}else if(!/^(loop_state_baseline|loop_[a-z0-9_]+_[a-f0-9]{12}(?:_[a-z]+)?)$/.test(db))throw Error('Foreign database');return docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q).trim();};return{container,database:'loop_state_baseline',env,docker,sql,assertDatabase,dailyRuntime:false};}`;
  await writeFile(join(scratch,'runtime-context.mjs'),code,{mode:0o600});await writeFile(join(scratch,'cluster.json'),JSON.stringify({container,label,image,migrations:files.length},null,2));
  console.log(JSON.stringify({container,migrations:files.length,network:'none',persistentVolumes:0,hostPorts:0}));
 }catch(error){if(created)docker(['stop','--time','5',container]);throw error;}
}
