// Restore the new full archive into an otherwise empty database inside ONLY the
// verified container. Managed Supabase schemas are copied schema-only; no Auth
// passwords/sessions or Vault rows are copied. This is not an Auth login test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {targetConfiguration,targetContainer,targetId} from './restore.mjs';
import {sql,quote,env,assertContainer,readBackup,inventorySql,digest} from './backup.mjs';
import {securityInventorySql,clearRestoreDefaultsSql} from './security-inventory.mjs';
import {ensurePrivateDirectory,writePrivateFile} from './environment.mjs';
assert.ok(process.argv.includes('--verified'));assert.equal(targetId,'loop-control-stage-b-verified');assertContainer(targetContainer,targetId);
const c=targetConfiguration(),reference=JSON.parse(readFileSync(join(c.stateRoot,'t09-latest.json'))),result=JSON.parse(readFileSync(join(reference.directory,'result.json'))),root=result.backup.root,m=readBackup(root,c);
const directory=join(reference.directory,'restore');ensurePrivateDirectory(directory);
const database=`loop_t09_restore_${Date.now()}`;assert.match(database,/^loop_t09_restore_[0-9]+$/);
const exec=(args,input)=>execFileSync('docker',['exec',...(input?['-i']:[]),targetContainer,...args],{env,input,encoding:Buffer.isBuffer(input)?undefined:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
const query=text=>String(exec(['psql','-XqAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1'],text)).trim();
sql(`create database ${database} template template0;`,targetContainer);
const scaffold=exec(['pg_dump','-U','postgres','-d','postgres','--schema-only','--exclude-schema=public','--exclude-schema=loop_internal','--exclude-schema=supabase_migrations']);
writePrivateFile(join(directory,'managed-schema.sql'),scaffold);
query(String(scaffold));
assert.equal(query("select count(*) from pg_tables where schemaname='public'"),'0');
query(clearRestoreDefaultsSql);
for(const user of m.users)query(`insert into auth.users(id,email,aud,role) values(${quote(user.id)},${quote(user.email)},'authenticated','authenticated');`);
const archive=readFileSync(join(root,'business.dump'));
const list=String(exec(['pg_restore','--list'],archive)).split('\n').filter(line=>!/^\d+; .* SCHEMA - public /.test(line)).join('\n');
const toc=`/tmp/${database}.list`;exec(['sh','-c',`umask 077;cat > ${toc}`],list);
try{exec(['pg_restore','-U','supabase_admin','-d',database,'--exit-on-error','--single-transaction',`--use-list=${toc}`],archive);}
catch(error){writePrivateFile(join(directory,'restore-error.log'),error.stderr??String(error));throw Error('T09 empty restore failed; private diagnostic retained');}
const inventory=JSON.parse(query(inventorySql()));assert.deepEqual(inventory,m.inventory);
const security=JSON.parse(query(securityInventorySql()));assert.deepEqual(security,m.schemaSecurity);
assert.equal(query("select count(*) from public.claim_notification_event()"),'0','accepted/reserved/uncertain history must not be replayed');
assert.equal(query("select has_function_privilege('authenticated','public.claim_notification_event()','execute')"),'f');
const trigger=query("begin;insert into public.audit_events(id,account_id,event_type,payload,created_at) values(gen_random_uuid(),'a0000000-0000-4000-8000-000000000001','stage_transition','{\"to_stage\":\"script_review\"}','2000-01-01');select count(*) from public.claim_notification_event();rollback;");assert.equal(trigger,'1');
const evidence={target:targetId,database,backupRoot:root,archiveSha256:digest(archive),emptyPublicBeforeRestore:true,inventoryMatched:true,tables:Object.keys(inventory).length,rows:Object.values(inventory).reduce((n,row)=>n+row.count,0),schemaSecurity:security,internalTriggerRestored:true,restoredAcceptedEventsNotReplayed:true,authenticatedClaimDenied:true,managedSchemas:'real source schema-only; no managed data or secrets',authIdentityOnly:true,authLoginTested:false,mediaFilesVerified:m.media.length,databaseRetained:true};
writePrivateFile(join(directory,'result.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
