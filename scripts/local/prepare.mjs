import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {root,projectRoot,container,label,docker,sql,env,assertDatabase,databasePort,appPort,ensurePrivateDirectory,writePrivateFile} from './environment.mjs';
import {hostHome} from '../isolation/environment.mjs';
import {inspectRecordedService} from '../local-service-record.mjs';
for(const dir of ['state','logs','home'])ensurePrivateDirectory(join(root,dir));
const names=docker(['ps','-a','--format','{{.Names}}']).split('\n');
if(!names.includes(container))docker(['run','--detach','--name',container,'--label',`com.loop-control.isolation=${label}`,'--publish',`127.0.0.1:${databasePort}:5432`,'--env','POSTGRES_HOST_AUTH_METHOD=trust','--volume','loop-control-stage-d-data:/var/lib/postgresql/data','postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929']);
assertDatabase();
for(let i=0;i<100;i++){try{sql('select 1','postgres');break;}catch{if(i===99)throw Error('Native DB not ready');await new Promise(r=>setTimeout(r,100));}}
if(!existsSync(join(root,'config.json'))){
 const password=randomBytes(32).toString('hex');
 if(sql("select count(*) from pg_roles where rolname in ('loop_app','loop_owner','loop_worker','loop_anonymous')",'postgres')!=='0')throw Error('Unrecorded roles; inspect before retry');
 sql(`create role loop_owner nologin; create role loop_worker nologin; create role loop_anonymous nologin; create role loop_app login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole;`,'postgres');
 // Container-local administration uses its Unix socket. TCP always authenticates.
 docker(['exec','-i',container,'sh','-c','cat > /var/lib/postgresql/data/pg_hba.conf'], 'local all all trust\nhost all all 0.0.0.0/0 scram-sha-256\nhost all all ::/0 scram-sha-256\n');
 sql('select pg_reload_conf()','postgres');
 writePrivateFile(join(root,'config.json'),JSON.stringify({projectRoot,port:appPort,database:{host:'127.0.0.1',port:databasePort,database:'loop_imported',user:'loop_app',password}})+'\n',{exclusive:true});
}
const sshConfig=join(hostHome,'.colima/_lima/colima-loop-stage-a/ssh.config');
const recordPath=join(root,'state/tunnel.json');
const valid=r=>inspectRecordedService({pid:r.pid,port:String(databasePort),commandIdentity:sshConfig},projectRoot).valid;
if(existsSync(recordPath)){if(!valid(JSON.parse(readFileSync(recordPath))))throw Error('Native tunnel identity mismatch');}
else{
 const child=spawn('ssh',['-F',sshConfig,'-o','ControlMaster=no','-o','ControlPath=none','-o','ExitOnForwardFailure=yes','-N','-L',`127.0.0.1:${databasePort}:127.0.0.1:${databasePort}`,'lima-colima-loop-stage-a'],{env,cwd:projectRoot,detached:true,stdio:'ignore'});await once(child,'spawn');
 const record={pid:child.pid,projectRoot,port:databasePort};
 for(let i=0;i<60;i++){if(valid(record)){writePrivateFile(recordPath,JSON.stringify(record)+'\n',{exclusive:true});child.unref();break;}await new Promise(r=>setTimeout(r,100));}
 if(!valid(record)){child.kill();throw Error('Native tunnel not ready');}
}
console.log(JSON.stringify({nativePostgres:true,container,databasePort,appPort}));
