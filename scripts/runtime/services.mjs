import{Client}from'pg';
import{spawn,execFileSync}from'node:child_process';import{readFileSync,existsSync,renameSync,statSync}from'node:fs';import{join}from'node:path';import{once}from'node:events';
import{root,projectRoot,readSettings,runtimeContext,writePrivateFile}from'./environment.mjs';import{inspectRecordedService}from'../local-service-record.mjs';
export async function ensureServices(){const d=readSettings();let c=runtimeContext();
 try{c.docker(['info','--format','{{.ServerVersion}}']);}catch{execFileSync('colima',['start','loop-control','--activate=false','--cpus','2','--memory','2','--disk','20','--port-forwarder','none'],{stdio:'pipe',timeout:240000});}
 c.assertDatabase();const info=JSON.parse(c.docker(['inspect',c.container]))[0];if(!info.State.Running)c.docker(['start',c.container]);
 const connection=new Client({...d.database,connectionTimeoutMillis:3000});let managed=false;try{await connection.connect();const r=await connection.query('SELECT current_database() db,session_user role');managed=r.rows[0]?.db===d.database.database&&r.rows[0]?.role==='loop_app';}catch{}finally{await connection.end();}
 if(!managed){
 const sshConfig=join(process.env.HOME,'.colima/_lima/colima-loop-control/ssh.config'),record=join(root,'tunnel.json');
 const valid=r=>inspectRecordedService({pid:r.pid,port:String(d.database.port),commandIdentity:sshConfig},projectRoot).valid;
 if(existsSync(record)){const r=JSON.parse(readFileSync(record));if(!valid(r)){let active=true;try{process.kill(r.pid,0);}catch(e){if(e.code==='ESRCH')active=false;else throw e;}if(active)throw Error('Recorded database tunnel is alive but does not match');renameSync(record,record+'.stale-'+Date.now());}}
 if(!existsSync(record)){
  const child=spawn('ssh',['-F',sshConfig,'-S','none','-o','ControlPersist=no','-o','ControlMaster=no','-o','ControlPath=none','-o','ExitOnForwardFailure=yes','-N','-L',`127.0.0.1:${d.database.port}:127.0.0.1:${d.database.port}`,'lima-colima-loop-control'],{cwd:projectRoot,detached:true,stdio:'ignore'});await once(child,'spawn');const r={pid:child.pid,port:d.database.port,projectRoot};let ready=false;
  for(let i=0;i<100;i++){if(valid(r)){ready=true;break;}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}if(!ready){child.kill();throw Error('Daily PostgreSQL forwarding unavailable');}writePrivateFile(record,JSON.stringify(r)+'\n',{exclusive:true});child.unref();
 }
 }
 const listeners=execFileSync('/usr/sbin/lsof',['-nP','-iTCP:'+d.database.port,'-sTCP:LISTEN','-Fn'],{encoding:'utf8'}).split('\n').filter(l=>l.startsWith('n'));if(!listeners.length||listeners.some(l=>l!=='n127.0.0.1:'+d.database.port&&l!=='n[::1]:'+d.database.port))throw Error('PostgreSQL must listen on loopback only');
 const mount=join(root,'volume');if(statSync(mount).dev===statSync(root).dev)execFileSync('/usr/bin/hdiutil',['attach','-nobrowse','-mountpoint',mount,join(root,'media.sparseimage')],{stdio:'pipe'});
 c.sql('SELECT 1');
}
