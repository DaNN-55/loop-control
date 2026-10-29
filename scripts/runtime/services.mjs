import {Client} from 'pg';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,existsSync,renameSync,statSync,openSync,closeSync,fstatSync,readSync} from 'node:fs';
import {join} from 'node:path';
import {once} from 'node:events';
import {root,projectRoot,readSettings,runtimeContext,writePrivateFile,assertPrivatePath} from './environment.mjs';
import {inspectRecordedService} from '../local-service-record.mjs';
import {hydrateDeploymentSecrets} from './keychain.mjs';

export async function ensureServices(){
 const d=hydrateDeploymentSecrets(readSettings()),c=runtimeContext();
 try{c.docker(['info','--format','{{.ServerVersion}}']);}
 catch{execFileSync('colima',['start','loop-control','--activate=false','--cpus','2','--memory','2','--disk','20','--port-forwarder','none'],{stdio:'pipe',timeout:240000});}
 c.assertDatabase();
 const info=JSON.parse(c.docker(['inspect',c.container]))[0];
 if(!info.State.Running)c.docker(['start',c.container]);

 let databaseError;
 const describe=error=>`${error?.code?`[${error.code}] `:''}${error?.message??error??'unknown error'}`.replaceAll(d.database.password,'<REDACTED>');
 const fatalDatabaseError=()=>['28P01','28000','3D000','42501','DATABASE_IDENTITY_MISMATCH'].includes(databaseError?.code);
 const unavailable=()=>Error(`Daily PostgreSQL unavailable on 127.0.0.1:${d.database.port}: ${describe(databaseError)}`);
 async function databaseReady(){
  const connection=new Client({...d.database,connectionTimeoutMillis:3000});
  try{
   await connection.connect();
   const result=await connection.query('SELECT current_database() db,session_user role');
   if(result.rows[0]?.db!==d.database.database||result.rows[0]?.role!=='loop_app')throw Object.assign(Error('Daily database identity mismatch'),{code:'DATABASE_IDENTITY_MISMATCH'});
   databaseError=undefined;return true;
  }catch(error){databaseError=error;return false;}
  finally{await connection.end();}
 }
 function listenerAddresses(){
  let output;
  try{output=execFileSync('/usr/sbin/lsof',['-nP','-iTCP:'+d.database.port,'-sTCP:LISTEN','-Fn'],{encoding:'utf8'});}
  catch(error){if(error.status===1&&!String(error.stdout??'').trim()&&!String(error.stderr??'').trim())return [];throw error;}
  const addresses=output.split('\n').filter(line=>line.startsWith('n'));
  if(addresses.some(line=>line!=='n127.0.0.1:'+d.database.port&&line!=='n[::1]:'+d.database.port))throw Error('PostgreSQL must listen on loopback only');
  return addresses;
 }
 async function waitForDatabase(){
  const deadline=Date.now()+15000;
  do{
   if(await databaseReady())return true;
   if(fatalDatabaseError())throw unavailable();
   if(Date.now()>=deadline)break;
   await new Promise(resolve=>setTimeout(resolve,250));
  }while(Date.now()<deadline);
  return false;
 }

 if(!await databaseReady()){
  if(fatalDatabaseError())throw unavailable();
  const sshConfig=join(process.env.HOME,'.colima/_lima/colima-loop-control/ssh.config'),record=join(root,'tunnel.json');
  const valid=value=>inspectRecordedService({pid:value.pid,port:String(d.database.port),commandIdentity:sshConfig},projectRoot).valid;
  if(existsSync(record)){
   const value=JSON.parse(readFileSync(record));
   if(!valid(value)){
    let active=true;try{process.kill(value.pid,0);}catch(error){if(error.code==='ESRCH')active=false;else throw error;}
    if(active)throw Error('Recorded database tunnel is alive but does not match');
    renameSync(record,record+'.stale-'+Date.now());
   }
  }
  let child,ownedRecord,sshFailure;
  try{
   // Colima can already own this port while PostgreSQL is still starting.
   // Verify that connection before creating a second, competing forwarder.
   if(!listenerAddresses().length&&!existsSync(record)){
    const logPath=join(root,'tunnel-private.log');assertPrivatePath(logPath);
    const log=openSync(logPath,'a',0o600),offset=fstatSync(log).size;
    try{child=spawn('ssh',['-F',sshConfig,'-S','none','-o','ControlPersist=no','-o','ControlMaster=no','-o','ControlPath=none','-o','ExitOnForwardFailure=yes','-N','-L',`127.0.0.1:${d.database.port}:127.0.0.1:${d.database.port}`,'lima-colima-loop-control'],{cwd:projectRoot,detached:true,stdio:['ignore','ignore',log]});}
    finally{closeSync(log);}
    try{
     await once(child,'spawn');
     const value={pid:child.pid,port:d.database.port,projectRoot};
     for(let attempt=0;attempt<100;attempt++){
      if(valid(value)){ownedRecord=value;break;}
      if(child.exitCode!==null||child.signalCode)break;
      await new Promise(resolve=>setTimeout(resolve,100));
     }
    }catch(error){sshFailure=describe(error);}
    if(!ownedRecord){
     if(child.exitCode===null)child.kill();
     const fd=openSync(logPath,'r');
     try{const size=fstatSync(fd).size,length=Math.min(4096,Math.max(0,size-offset)),buffer=Buffer.alloc(length);readSync(fd,buffer,0,length,Math.max(offset,size-length));sshFailure=buffer.toString('utf8').trim()||sshFailure||'SSH exited before listening';}
     finally{closeSync(fd);}
     // The automatic forwarder may have won the port after our initial check.
     if(!listenerAddresses().length)throw Error(`Daily PostgreSQL forwarding unavailable: ${sshFailure}; ${describe(databaseError)}`);
    }
   }
   if(!await waitForDatabase())throw unavailable();
   if(ownedRecord){writePrivateFile(record,JSON.stringify(ownedRecord)+'\n',{exclusive:true});child.unref();}
  }catch(error){if(ownedRecord&&child.exitCode===null)child.kill();throw error;}
 }
 if(!listenerAddresses().length)throw Error('Daily PostgreSQL listener disappeared');
 const mount=join(root,'volume');
 if(statSync(mount).dev===statSync(root).dev)execFileSync('/usr/bin/hdiutil',['attach','-nobrowse','-mountpoint',mount,join(root,'media.sparseimage')],{stdio:'pipe'});
 c.sql('SELECT 1');
}
