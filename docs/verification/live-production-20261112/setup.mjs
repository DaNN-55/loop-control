// Isolated real-API acceptance deployment. Never writes to the daily database.
import {readFile,writeFile,mkdir,readdir,cp,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {join} from 'node:path';
import {Pool} from 'pg';
import {adaptBusinessSchema} from '../../../scripts/storage/schema-import.mjs';
const projectRoot=process.cwd(),privateRoot=join(projectRoot,'.scratch/live-production');
const dailyRoot='/Users/dan/Programs/loop-control';
const {runtimeContext,readSettings}=await import(join(dailyRoot,'scripts/runtime/environment.mjs'));
const daily=runtimeContext(),settings=readSettings();
const name='loop-live-acceptance-20261112',volume=name+'-data',image=settings.postgres.image;
const env={...process.env,DOCKER_HOST:daily.env.DOCKER_HOST};
const docker=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:128*1024*1024});
await mkdir(privateRoot,{recursive:true,mode:0o700});
const exists=JSON.parse(docker(['ps','-a','--filter','name=^/'+name+'$','--format','json'])||'null');
if(exists)throw Error('Owned runtime already exists; use server.mjs, do not reinitialize');
docker(['run','-d','--name',name,'--label','com.loop-control.test=live-production-20261112','-p','127.0.0.1:55439:5432','-v',volume+':/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
let ready=false;
for(let i=0;i<150;i++){try{if(!docker(['logs',name]).includes('PostgreSQL init process complete'))throw Error();docker(['exec',name,'pg_isready','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}
if(!ready)throw Error('Isolated database not ready');
const sql=(q,db='loop_live_acceptance')=>docker(['exec','-i',name,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q);
sql('CREATE ROLE loop_app LOGIN; CREATE ROLE loop_worker LOGIN; CREATE ROLE loop_owner; CREATE ROLE loop_anonymous; CREATE DATABASE loop_live_acceptance TEMPLATE template0;','postgres');
sql('BEGIN;\n'+await readFile('db/local/identity.sql','utf8')+'\n'+adaptBusinessSchema(await readFile('db/local/c-baseline.sql','utf8')).sql+'\nSET search_path=public;\n'+await readFile('db/local/read-access.sql','utf8')+'\nCREATE TABLE local_identity.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL); COMMIT;');
for(const file of (await readdir('db/local')).filter(n=>/^\d{3}-[a-z0-9-]+\.sql$/.test(n)).sort()){
 const body=await readFile(join('db/local',file),'utf8');
 sql(`BEGIN;\n${body}\nINSERT INTO local_identity.schema_migrations VALUES('${file}','${createHash('sha256').update(body).digest('hex')}');COMMIT;`);
}
const db={host:'127.0.0.1',port:55439,database:'loop_live_acceptance',password:'isolated-acceptance-only'};
const pool=new Pool({...db,user:'postgres'}),owner=randomUUID(),password='acceptance-'+randomBytes(20).toString('hex');
const {hashPassword}=await import(join(projectRoot,'dist/local-app/local-app/password.js'));
await pool.query('INSERT INTO local_identity.owners(id,email) VALUES($1,$2)',[owner,'acceptance-20261112@example.invalid']);
await pool.query('INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES($1,$2)',[owner,await hashPassword(password)]);
// Copy only existing connection configuration and qualification evidence, never business data or secret values.
const rows=JSON.parse(daily.sql(`SELECT coalesce(json_agg(json_build_object('connection',row_to_json(c),'version',row_to_json(v),'binding',row_to_json(b),'qualification',row_to_json(q),'models',row_to_json(m),'verifications',(SELECT coalesce(json_agg(e),'[]') FROM public.external_connection_verifications e WHERE e.connection_version_id=v.id),'evidence',(SELECT coalesce(json_agg(e),'[]') FROM local_identity.connection_probe_evidence e WHERE e.version_id=v.id))),'[]') FROM public.external_connections c JOIN public.external_connection_versions v ON v.id=c.current_version_id JOIN local_identity.connection_bindings b ON b.version_id=v.id LEFT JOIN local_identity.connection_qualifications q ON q.version_id=v.id LEFT JOIN local_identity.connection_model_settings m ON m.connection_id=c.id WHERE c.provider IN ('minimax','kling','volcengine','volcengine_tts','freesound','pexels','openai')`));
async function insert(table,row){if(!row)return;const entries=Object.entries(row).map(([k,v])=>[k,['owner_id','created_by'].includes(k)?owner:v]);await pool.query(`INSERT INTO ${table} (${entries.map(([k])=>'"'+k+'"').join(',')}) VALUES (${entries.map((_,i)=>'$'+(i+1)).join(',')})`,entries.map(([,v])=>v));}
await pool.query('BEGIN');
for(const row of rows){await insert('public.external_connections',row.connection);await insert('public.external_connection_versions',row.version);await insert('local_identity.connection_bindings',row.binding);await insert('local_identity.connection_qualifications',row.qualification);await insert('local_identity.connection_model_settings',row.models);for(const e of row.verifications)await insert('public.external_connection_verifications',e);for(const e of row.evidence)await insert('local_identity.connection_probe_evidence',e);}
await pool.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1)');
await pool.query('COMMIT');await pool.end();
const mediaRoot='/Volumes/Ebuget 1T/Loop-Control-Acceptance-20261112';
await mkdir(mediaRoot,{recursive:true,mode:0o700});await mkdir(join(privateRoot,'state'),{recursive:true,mode:0o700});
const sdk=join(privateRoot,'OpenChatCut'),original=settings.openChatCut.root;
await cp(original,sdk,{recursive:true,filter:path=>!path.slice(original.length).split('/').some(p=>['node_modules','.git','.data','dist','.vite','data'].includes(p))});
await symlink(join(original,'node_modules'),join(sdk,'node_modules'),'dir');
const config={purpose:'local-daily',projectRoot,runtimeRoot:join(projectRoot,'.loop-control/local'),home:process.env.HOME,port:5217,mediaRoot,stateDirectory:join(privateRoot,'state'),backupRoot:join(privateRoot,'backups'),database:{...db,user:'loop_app'},workerDatabase:{...db,user:'loop_worker'},storageOwnerId:owner,automaticBackups:false,controlledNotifications:true,connections:settings.connections,prepareKeychainAccess:true,openChatCut:{...settings.openChatCut,root:sdk,port:5218},worker:{...settings.worker,mountPath:'/Volumes/Ebuget 1T',concurrency:1,visualCommand:[process.execPath,join(projectRoot,'scripts/runtime/codex.mjs')]}};
await mkdir(config.runtimeRoot,{recursive:true,mode:0o700});
await writeFile(join(privateRoot,'deployment.json'),JSON.stringify(config,null,2),{mode:0o600});
await writeFile(join(privateRoot,'login.json'),JSON.stringify({email:'acceptance-20261112@example.invalid',password,owner}),{mode:0o600});
await writeFile('docs/verification/live-production-20261112/resources.json',JSON.stringify({branch:'codex/live-production-acceptance-20261112',container:name,volume,port:5217,studioPort:5218,mediaRoot,privateRoot,dailyBusinessDataCopied:false,credentialValuesCopied:false,connectionCount:rows.length},null,2));
console.log(JSON.stringify({ready:true,connectionCount:rows.length,mediaRoot,port:5217}));
