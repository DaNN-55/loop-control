// One-off ADR-0047 adoption. All database commands use the identity-checked maintenance port.
import {readFileSync,writeFileSync,renameSync,openSync,fsyncSync,closeSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {loadSchemaCatalog,schemaMigrationPlan,migrationTransaction,verifySchemaLedger,restoredSchemaTable} from '../../src/local-app/schemaMigrations.ts';
import {securityInventorySql} from '../storage/security-inventory.mjs';

const lit=s=>"'"+String(s).replaceAll("'","''")+"'";
const ident=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Invalid adoption identifier');return '"'+s+'"';};
const digest=s=>createHash('sha256').update(s).digest('hex');
const check=(ok,message)=>{if(!ok)throw Error(message);};
// This controller adopts the approved 2026-11-13 checkpoint, never later forwards.
const adoptionCatalog=project=>{const catalog=loadSchemaCatalog(project);return {...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<=170)};};
function privatePath(path){
 const parent=dirname(path),s=lstatSync(parent);
 check(realpathSync(parent)===parent&&s.isDirectory()&&s.uid===process.getuid()&&(s.mode&0o077)===0,'Evidence directory must be canonical, private and owned');
 check(path===join(parent,basename(path)),'Noncanonical evidence file');
 if(existsSync(path)){const f=lstatSync(path);check(f.isFile()&&!f.isSymbolicLink()&&f.nlink===1&&f.uid===process.getuid()&&(f.mode&0o077)===0,'Evidence file must be private and owned');}
}
export function savePrivate(path,value){return savePrivateBytes(path,JSON.stringify(value,null,2)+'\n');}
export function savePrivateBytes(path,bytes){
 privatePath(path);
 const temp=path+'.next-'+randomUUID(),fd=openSync(temp,'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(temp,path);const dir=openSync(join(path,'..'),'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}
export function databaseMeta(c,name){
 return JSON.parse(c.sql(`SELECT row_to_json(d) FROM (SELECT oid::text,datname,pg_get_userbyid(datdba) owner,pg_encoding_to_char(encoding) encoding,datcollate,datctype,datlocprovider,datlocale,datcollversion,datconnlimit,datallowconn,datistemplate,datacl,(SELECT coalesce(jsonb_agg(jsonb_build_object('role',CASE WHEN setrole=0 THEN '' ELSE setrole::regrole::text END,'config',setconfig) ORDER BY setrole::regrole::text),'[]') FROM pg_db_role_setting WHERE setdatabase=pg_database.oid) settings FROM pg_database WHERE datname=${lit(name)}) d`,'postgres')||'null');
}
export function idleDatabase(c,name){
 const clients=JSON.parse(c.sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'role',usename,'application',application_name,'state',state)),'[]') FROM pg_stat_activity WHERE datname=${lit(name)}`,'postgres'));
 check(clients.length===0,'Database still has clients: '+name);return true;
}
function snapshotSql(project){
 const rowsSql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL timezone='UTC'; SET LOCAL search_path=pg_catalog; DO $$ DECLARE t record;v jsonb;r jsonb:='{}'; BEGIN FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('r','p') AND n.nspname IN('public','local_identity','loop_internal') AND c.relname<>'schema_migrations' ORDER BY 1,2 LOOP EXECUTE format('SELECT jsonb_build_object(''rows'',count(*),''md5'',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),''[]''::jsonb)::text)) FROM %I.%I t',t.nspname,t.relname) INTO v; r:=r||jsonb_build_object(t.nspname||'.'||t.relname,v); END LOOP; PERFORM set_config('loop.cutover_rows',r::text,true);END $$; SELECT current_setting('loop.cutover_rows'); COMMIT;`;
 const catalogSql='BEGIN READ ONLY;'+readFileSync(join(project,'docs/verification/clean-sql-preflight-20261112/catalog-fingerprint.sql'),'utf8').replaceAll('pg_get_constraintdef(k.oid)','pg_get_constraintdef(k.oid,true)')+'COMMIT;';
 const securitySql=securityInventorySql().replaceAll("in ('public','loop_internal')","in ('public','loop_internal','local_identity','extensions')").replace("select jsonb_build_object('count',count(*),'md5',md5(coalesce(jsonb_agg(to_jsonb(normalized) order by kind,identity),'[]'::jsonb)::text)) from normalized","select coalesce(jsonb_agg(to_jsonb(normalized) order by kind,identity),'[]'::jsonb) from normalized");
 const sequenceRowsSql=`BEGIN READ ONLY; DO $$ DECLARE t record;v jsonb;r jsonb:='{}';BEGIN FOR t IN SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN('public','local_identity','loop_internal') LOOP EXECUTE format('SELECT jsonb_build_object(''last_value'',last_value,''is_called'',is_called) FROM %I.%I',t.schemaname,t.sequencename) INTO v;r:=r||jsonb_build_object(t.schemaname||'.'||t.sequencename,v);END LOOP;PERFORM set_config('loop.cutover_sequences',r::text,true);END $$;SELECT current_setting('loop.cutover_sequences');COMMIT;`;
 const ledgerSql="BEGIN READ ONLY; SET LOCAL timezone='UTC'; SELECT jsonb_object_agg(version,to_jsonb(s)) FROM local_identity.schema_migrations s; COMMIT;";
 const rolesSql="SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,(SELECT rolconfig FROM pg_roles r WHERE r.oid=a.oid) rolconfig,md5(coalesce(rolpassword,'')) password_fingerprint FROM pg_authid a WHERE rolname LIKE 'loop_%')r),'members',(SELECT jsonb_agg(jsonb_build_object('role',roleid::regrole::text,'member',member::regrole::text,'admin',admin_option,'inherit',inherit_option,'set',set_option) ORDER BY roleid::regrole::text,member::regrole::text) FROM pg_auth_members WHERE roleid::regrole::text LIKE 'loop_%' OR member::regrole::text LIKE 'loop_%'))";
 return [rowsSql,catalogSql,securitySql,sequenceRowsSql,ledgerSql,rolesSql].join('\n');
}
function parseSnapshot(output){
 const lines=output.split('\n').filter(Boolean);check(lines.length===6,'Incomplete database snapshot');
 const [rows,catalog,security,sequenceRows,ledger,roles]=lines.map(line=>JSON.parse(line));return {rows,catalog,security,sequenceRows,ledger,roles};
}
export function databaseSnapshot(c,db,project){return parseSnapshot(c.sql(snapshotSql(project),db));}
export async function frozenDatabaseSnapshot(c,db,project){
 ident(db);check(typeof c.spawnTool==='function','A persistent maintenance connection is required');
 const child=c.spawnTool('psql',['-XqAt','-d',db,'-v','ON_ERROR_STOP=1']);let output='',stderr='',readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});let backend;
 child.stdout.on('data',data=>{output+=data;if(backend===undefined&&output.includes('\n')){const line=output.slice(0,output.indexOf('\n')).trim();if(!/^[1-9][0-9]*$/.test(line)){readyReject(Error('Audit connection identity missing'));return;}backend=Number(line);output=output.slice(output.indexOf('\n')+1);readyResolve(backend);}});
 child.stderr.on('data',data=>{stderr+=data;});
 const closed=new Promise((resolve,reject)=>{child.once('error',error=>{readyReject(error);reject(error);});child.once('close',code=>{if(backend===undefined)readyReject(Error('Audit connection failed'));resolve(code);});});
 child.stdin.on('error',()=>{});const timer=setTimeout(()=>child.kill(),30000);
 try{
  child.stdin.write('SELECT pg_backend_pid();\n');await ready;
  // PostgreSQL forbids disallowing one's own database: retain this audit session
  // and close admission from the separate identity-checked postgres connection.
  c.sql(`ALTER DATABASE ${ident(db)} ALLOW_CONNECTIONS false`,'postgres');
  const clients=JSON.parse(c.sql(`SELECT coalesce(jsonb_agg(pid),'[]') FROM pg_stat_activity WHERE datname=${lit(db)}`,'postgres'));
  check(clients.length===1&&clients[0]===backend,'Frozen audit has another database client');
  child.stdin.end(snapshotSql(project));check(await closed===0,'Frozen audit failed: '+stderr);return parseSnapshot(output);
 }finally{clearTimeout(timer);if(child.exitCode===null)child.kill();await closed.catch(()=>{});}
}

const normalizedRows=rows=>Object.fromEntries(Object.entries(rows).map(([k,v])=>[restoredSchemaTable(k),v]));
const normalizedCatalog=c=>Object.fromEntries(Object.entries(c).map(([k,v])=>[k,v.map(x=>JSON.stringify(x)).sort()]));
export function assertRestored(before,after){
 for(const k of ['rows','sequenceRows','ledger','roles','security'])check(isDeepStrictEqual(before[k],after[k]),'Restored '+k+' mismatch');
 check(isDeepStrictEqual(normalizedCatalog(before.catalog),normalizedCatalog(after.catalog)),'Restored catalog mismatch');
}
export function assertAdopted(before,after,project){
 check(isDeepStrictEqual(normalizedRows(before.rows),after.rows),'Adoption business/control rows changed');
 for(const k of ['sequenceRows','roles'])check(isDeepStrictEqual(before[k],after[k]),'Adoption '+k+' changed');
 for(const [key,value] of Object.entries(before.ledger))check(isDeepStrictEqual(value,after.ledger[key]),'Historical ledger changed: '+key);
 const catalog=adoptionCatalog(project),applied=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,v.sha256]));
 check(verifySchemaLedger(applied,catalog)==='clean-v2'&&schemaMigrationPlan(applied,catalog).length===0,'Adoption ledger incomplete');
 const sql=[catalog.upgrade,...catalog.current].map(f=>f.body).join('\n');
 const allowedFunctions=new Set([...sql.matchAll(/(?:CREATE OR REPLACE|DROP) FUNCTION\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi)].map(m=>m[1]));
 const historical=s=>/storyboard_planning_(defaults|harnesses)|historical_planning_(defaults|harnesses)/.test(s);
 const allow=(kind,obj)=>{
  if(kind==='functions')return allowedFunctions.has(obj.schema+'.'+obj.name)||historical(JSON.stringify(obj));
  if(kind==='triggers')return ['initialize_planning_selection','freeze_shared_planning_harness_before_insert','zy_freeze_native_planning_attempt_limit'].includes(obj.name);
  if(kind==='constraints'&&['external_connections_provider_adapter_check','episode_directory_relative_path'].includes(obj.name))return true;
  return historical(JSON.stringify(obj));
 };
 const changes={};
 for(const kind of Object.keys(before.catalog)){
  const old=new Set(before.catalog[kind].map(x=>JSON.stringify(x))),next=new Set(after.catalog[kind].map(x=>JSON.stringify(x)));
  const removed=before.catalog[kind].filter(x=>!next.has(JSON.stringify(x))),added=after.catalog[kind].filter(x=>!old.has(JSON.stringify(x)));
  check([...removed,...added].every(x=>allow(kind,x)),'Unapproved catalog change: '+kind+' '+JSON.stringify([...removed,...added].filter(x=>!allow(kind,x)).map(x=>x.schema?x.schema+'.'+x.name:x.name)));changes[kind]={removed:removed.length,added:added.length};
 }
 const removedFunctions=['local_identity.initialize_planning_selection','local_identity.legacy_planning_prefill','local_identity.freeze_native_planning_attempt_limit','public.freeze_shared_planning_harness'];
 const allowedSecurity=o=>historical(o.identity)||removedFunctions.some(n=>o.identity.startsWith(n+'('));
 check(isDeepStrictEqual(before.security.filter(x=>!allowedSecurity(x)),after.security.filter(x=>!allowedSecurity(x))),'Unapproved ACL change');
 return changes;
}
export function createCandidate(c,{source,candidate,project,dumpPath,evidence}){
 privatePath(dumpPath);idleDatabase(c,source);
 check(!databaseMeta(c,candidate),'Candidate already exists');const meta=databaseMeta(c,source);check(meta&&meta.owner==='postgres'&&!meta.datistemplate,'Unexpected source database');
 // Preserve database/role GUCs explicitly; non-default database ACL needs a separate mapping.
 check(meta.datacl===null&&meta.datlocprovider==='c'&&meta.datconnlimit===-1,'Non-default database properties require an explicit restore mapping');
 const before=databaseSnapshot(c,source,project);savePrivate(join(evidence,'source-snapshot.json'),before);
 const dumpFd=openSync(dumpPath,'wx',0o600);closeSync(dumpFd);
 c.execTool('pg_dump',['-d',source,'--format=custom','--file='+dumpPath]);
 assertRestored(before,databaseSnapshot(c,source,project));idleDatabase(c,source);
 c.sql(`CREATE DATABASE ${ident(candidate)} OWNER postgres TEMPLATE template0 ENCODING ${lit(meta.encoding)} LC_COLLATE ${lit(meta.datcollate)} LC_CTYPE ${lit(meta.datctype)} LOCALE_PROVIDER libc`,'postgres');
 c.execTool('pg_restore',['-d',candidate,'--exit-on-error',dumpPath]);
 for(const setting of meta.settings)for(const entry of setting.config){
  const index=entry.indexOf('='),key=entry.slice(0,index),value=entry.slice(index+1);
  check(index>0&&/^[a-z_][a-z0-9_.]*$/.test(key),'Invalid database setting');
  const statement=setting.role?`ALTER ROLE ${ident(setting.role)} IN DATABASE ${ident(candidate)}`:`ALTER DATABASE ${ident(candidate)}`;
  c.sql(statement+` SET "${key}" TO ${lit(value)}`,'postgres');
 }
 const restoredMeta=databaseMeta(c,candidate),withoutIdentity=({oid,datname,...v})=>v;
 check(isDeepStrictEqual(withoutIdentity(meta),withoutIdentity(restoredMeta)),'Restored database properties differ');
 const restored=databaseSnapshot(c,candidate,project);savePrivate(join(evidence,'restored-snapshot.json'),restored);assertRestored(before,restored);
 const catalog=adoptionCatalog(project),pending=schemaMigrationPlan(Object.fromEntries(Object.entries(restored.ledger).map(([k,v])=>[k,v.sha256])),catalog,true);
 check(pending.length===6&&pending[0].version==='clean-v2.sql'&&pending.at(-1).version==='170-retire-legacy-repair-and-dispatch.sql','Unexpected adoption plan');
 c.sql(migrationTransaction(pending),candidate);
 const after=databaseSnapshot(c,candidate,project);savePrivate(join(evidence,'adopted-snapshot.json'),after);const changes=assertAdopted(before,after,project);
 return {meta,target:databaseMeta(c,candidate),before,after,changes,migrations:pending.map(f=>f.version),dumpSha256:digest(readFileSync(dumpPath))};
}
export function swapController(c,path){
 privatePath(path);
 const s=JSON.parse(readFileSync(path));
 check(s.version===1&&s.source!==s.candidate&&s.source!==s.retained&&s.candidate!==s.retained,'Invalid swap journal');
 for(const key of ['source','candidate','retained'])ident(s[key]);
 check(/^\d+$/.test(s.sourceOid)&&/^\d+$/.test(s.targetOid)&&s.sourceOid!==s.targetOid,'Invalid swap OIDs');
 const step=(phase,query)=>{s.phase=phase;savePrivate(path,s);c.sql(query,'postgres');};
 const byOid=oid=>JSON.parse(c.sql(`SELECT row_to_json(d) FROM (SELECT oid::text,datname,datallowconn FROM pg_database WHERE oid=${Number(oid)})d`,'postgres')||'null');
 const pair=()=>{const a=byOid(s.sourceOid),b=byOid(s.targetOid);check(a&&b,'Swap databases missing');check([s.source,s.retained].includes(a.datname)&&[s.candidate,s.source].includes(b.datname),'Swap database name/OID mismatch');return[a,b];};
 return {state:s,swap({interruptAfterSourceRename=false}={}){
  check(s.phase!=='complete'&&s.phase!=='rolled-back'&&s.phase!=='consumers-started','Adoption already completed or rolled back');
  let [a,b]=pair();for(const n of [a.datname,b.datname])idleDatabase(c,n);
  if(b.datallowconn)step('freezing-candidate',`ALTER DATABASE ${ident(b.datname)} ALLOW_CONNECTIONS false`);
  if(a.datallowconn)step('freezing-source',`ALTER DATABASE ${ident(a.datname)} ALLOW_CONNECTIONS false`);
  for(const n of [a.datname,b.datname])idleDatabase(c,n);
  if(a.datname===s.source){step('renaming-source',`ALTER DATABASE ${ident(s.source)} RENAME TO ${ident(s.retained)}`);}
  if(interruptAfterSourceRename)throw Error('Injected interruption after source rename');
  [a,b]=pair();if(b.datname===s.candidate)step('renaming-candidate',`ALTER DATABASE ${ident(s.candidate)} RENAME TO ${ident(s.source)}`);
  [a,b]=pair();check(a.datname===s.retained&&!a.datallowconn&&b.datname===s.source&&!b.datallowconn,'Swap incomplete');step('enabling-target',`ALTER DATABASE ${ident(s.source)} ALLOW_CONNECTIONS true`);s.phase='complete';savePrivate(path,s);return s;
 },rollback(){
  check(s.phase!=='consumers-started'&&s.phase!=='rolled-back','Rollback requires stopped consumers and an unused target');
  let [a,b]=pair();for(const n of [a.datname,b.datname])idleDatabase(c,n);
  if(b.datname===s.source)step('rollback-target',`ALTER DATABASE ${ident(s.source)} RENAME TO ${ident(s.candidate)}`);
  [a,b]=pair();if(a.datname===s.retained)step('rollback-source',`ALTER DATABASE ${ident(s.retained)} RENAME TO ${ident(s.source)}`);
  step('rollback-connect',`ALTER DATABASE ${ident(s.source)} ALLOW_CONNECTIONS true`);step('rollback-candidate-connect',`ALTER DATABASE ${ident(s.candidate)} ALLOW_CONNECTIONS true`);s.phase='rolled-back';savePrivate(path,s);return s;
 }};
}
