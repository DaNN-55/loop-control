// Dedicated schema-only PostgreSQL. Does not load deployment configuration or daily data.
import {execFileSync} from 'node:child_process';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {adaptBusinessSchema} from '/Users/dan/.codex/worktrees/maintenance-20261111/loop-control/scripts/storage/schema-import.mjs';

const project=process.cwd(),root='/tmp/loop-maint-step2-20261111/group6-environment';
const runId=randomBytes(6).toString('hex'),container='loop-maint2g6-' +runId,label='receipt-' +runId;
const image='sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929';
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,DOCKER_HOST:'unix://'+join(process.env.HOME,'.colima/loop-control/docker.sock')};
const docker=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
const imageInfo=JSON.parse(docker(['image','inspect',image]))[0];
if(imageInfo.Id!==image)throw Error('PostgreSQL image identity mismatch');
const assertIdentity=()=>{const m=JSON.parse(docker(['inspect',container]))[0];if(m.Image!==image||m.Config.Labels?.['com.loop-control.test']!==label||m.HostConfig.NetworkMode!=='none'||Object.keys(m.HostConfig.PortBindings??{}).length||m.Mounts.some(x=>x.Type==='volume'||x.Type==='bind')||!Object.hasOwn(m.HostConfig.Tmpfs??{},'/var/lib/postgresql/data'))throw Error('Dedicated cluster identity mismatch');};
let created=false;
try {
 docker(['run','--detach','--rm','--network','none','--name',container,'--label','com.loop-control.test='+label,'--tmpfs','/var/lib/postgresql/data','--env','POSTGRES_HOST_AUTH_METHOD=trust',image]);created=true;assertIdentity();
 let ready=false;
 for(let n=0;n<200;n++){try{if(!docker(['logs',container]).includes('PostgreSQL init process complete'))throw Error('Initializing');docker(['exec',container,'pg_isready','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!ready)throw Error('Dedicated PostgreSQL not ready');
 const sql=(q,db='loop_receipt_baseline')=>docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q);
 sql('CREATE ROLE loop_app LOGIN; CREATE ROLE loop_worker LOGIN; CREATE ROLE loop_owner; CREATE ROLE loop_anonymous; CREATE DATABASE loop_receipt_baseline TEMPLATE template0;','postgres');
 const identity=await readFile(join(project,'db/local/identity.sql'),'utf8');
 const baseline=adaptBusinessSchema(await readFile(join(project,'db/local/c-baseline.sql'),'utf8')).sql;
 const access=await readFile(join(project,'db/local/read-access.sql'),'utf8');
 sql('BEGIN;\n'+identity+'\n'+baseline+'\nSET search_path=public;\n'+access+'\nCREATE TABLE local_identity.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL);\nCOMMIT;');
 const migrations=(await readdir(join(project,'db/local'))).filter(n=>/^\d{3}-[a-z0-9-]+\.sql$/.test(n)&&Number(n.slice(0,3))<=160).sort();
 for(const name of migrations){const body=await readFile(join(project,'db/local',name),'utf8');sql(`BEGIN;\n${body}\nINSERT INTO local_identity.schema_migrations VALUES('${name}','${createHash('sha256').update(body).digest('hex')}');COMMIT;`);}
 const context=join(root,'runtime-context.mjs');
 await writeFile(context,`import{execFileSync}from'node:child_process';
const container=${JSON.stringify(container)},image=${JSON.stringify(image)},label=${JSON.stringify(label)},env=${JSON.stringify(env)};
const call=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
export function runtimeContext(){
 const assertDatabase=()=>{const m=JSON.parse(call(['inspect',container]))[0];if(m.Image!==image||m.Config.Labels?.['com.loop-control.test']!==label||m.HostConfig.NetworkMode!=='none'||Object.keys(m.HostConfig.PortBindings??{}).length||m.Mounts.some(x=>x.Type==='volume'||x.Type==='bind')||!Object.hasOwn(m.HostConfig.Tmpfs??{},'/var/lib/postgresql/data'))throw Error('Dedicated cluster identity mismatch');};
 const docker=(args,input)=>{assertDatabase();if(args[0]!=='exec'||!args.includes(container))throw Error('Only owned container exec permitted');return call(args,input);};
 const sql=(q,db='loop_receipt_baseline')=>{if(db==='postgres'){if(!/^(CREATE DATABASE loop_[a-z0-9_]+ TEMPLATE template0|DROP DATABASE loop_[a-z0-9_]+ WITH\\s*\\(FORCE\\)|SELECT count\\(\\*\\) FROM pg_database WHERE datname='loop_[a-z0-9_]+')\\s*;?$/i.test(q.trim()))throw Error('Cluster operation outside fixture scope');}else if(!/^(loop_receipt_baseline|loop_[a-z0-9_]+_[a-f0-9]{12}(?:_[a-z]+)?)$/.test(db))throw Error('Database outside fixture scope');return docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q).trim();};
 return{container,database:'loop_receipt_baseline',env,docker,sql,assertDatabase,dailyRuntime:false};
}
`,{mode:0o600});
 await writeFile(join(root,'run.json'),JSON.stringify({runId,container,label,image,context,database:'loop_receipt_baseline',network:'none',storage:'tmpfs',migrationCount:migrations.length,baselineLatestMigration:migrations.at(-1),baselineMaxVersion:160,createdAt:new Date().toISOString(),paidCalls:0,dailyTouched:false},null,2));
 console.log(JSON.stringify({container,context,migrationCount:migrations.length}));
} catch(error) {if(created){assertIdentity();docker(['stop','--time','5',container]);}throw error;}
