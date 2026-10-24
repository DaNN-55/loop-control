// Isolated native Worker login; password is only in the private config and psql stdin.
import {randomBytes} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {root,configuration,assertDatabase,sql,writePrivateFile} from './environment.mjs';
assertDatabase();const app=configuration(),path=join(root,'worker-database.json');
if(existsSync(path)){
 const c=JSON.parse(readFileSync(path));if(c.host!==app.database.host||c.port!==app.database.port||c.database!==app.database.database||c.user!=='loop_worker')throw Error('Worker configuration mismatch');
}else{
 if(sql("select rolcanlogin from pg_roles where rolname='loop_worker'",'postgres')!=='f')throw Error('Unrecorded Worker login; inspect before continuing');
 const password=randomBytes(32).toString('hex');
 writePrivateFile(path,JSON.stringify({...app.database,user:'loop_worker',password})+'\n',{exclusive:true});
 sql(`ALTER ROLE loop_worker LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,'postgres');
}
console.log(JSON.stringify({nativeWorkerPrepared:true,privateCredentials:true,cloudCredentialsRead:false}));
