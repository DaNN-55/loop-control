// Restore the new full archive into an otherwise empty database inside ONLY the
// verified container. Managed Supabase schemas are copied schema-only; no Auth
// passwords/sessions or Vault rows are copied. This is not an Auth login test.
import assert from 'node:assert/strict';
import{randomUUID}from'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {targetConfiguration,targetContainer,targetId} from './restore.mjs';
import {sql,quote,env,assertContainer,readBackup,inventorySql,digest} from './backup.mjs';
import {securityInventorySql,clearRestoreDefaultsSql} from './security-inventory.mjs';
import {ensurePrivateDirectory,writePrivateFile} from './environment.mjs';
assert.ok(process.argv.includes('--verified'));assert.equal(targetId,'loop-control-stage-b-verified');assertContainer(targetContainer,targetId);
const stageC=process.argv.includes('--stage-c');
const c=targetConfiguration(),reference=JSON.parse(readFileSync(join(c.stateRoot,'t09-latest.json'))),result=JSON.parse(readFileSync(join(reference.directory,'result.json'))),root=stageC?JSON.parse(readFileSync(join(c.stateRoot,'stage-c-backup.json'))).root:result.backup.root,m=readBackup(root,c);
const directory=stageC?join(c.stateRoot,'stage-c-restore',String(Date.now())):join(reference.directory,'restore');ensurePrivateDirectory(directory);
const database=`loop_${stageC?'c':'t09'}_restore_${Date.now()}`;assert.match(database,/^loop_(?:c|t09)_restore_[0-9]+$/);
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
if(stageC){
 const pending=query("select count(*) from public.notification_delivery_events where outcome='pending'");
 const claim=JSON.parse(query("begin;create temporary table ledger_before as select event_id,outcome from public.notification_delivery_events;create temporary table claimed as select * from public.claim_notification_event();select jsonb_build_object('count',(select count(*) from claimed),'pendingOnly',not exists(select 1 from claimed c left join ledger_before b on b.event_id=c.id where b.outcome is distinct from 'pending'),'historyUnchanged',not exists(select 1 from ledger_before b join public.notification_delivery_events d using(event_id) where b.outcome<>'pending' and d.outcome is distinct from b.outcome));rollback;"));
 assert.equal(claim.count,Number(pending)>0?1:0);assert.equal(claim.pendingOnly,true);assert.equal(claim.historyUnchanged,true);
 assert.equal(query("select has_function_privilege('authenticated','public.final_render_reuse_source(uuid,integer,uuid)','execute')"),'f');
 const counter=query("begin;create temporary table old_counter as select coalesce(sum(revision),0)n from public.episode_read_revisions;update public.tasks set last_result=coalesce(last_result,'{}')||'{\"c_restore_probe\":true}' where id=(select id from public.tasks order by id limit 1);select coalesce(sum(revision),0)>(select n from old_counter) from public.episode_read_revisions;rollback;");
 assert.equal(counter,'t','restored revision trigger advances on real row update');
}else assert.equal(query("select count(*) from public.claim_notification_event()"),'0','accepted/reserved/uncertain history must not be replayed');
assert.equal(query("select has_function_privilege('authenticated','public.claim_notification_event()','execute')"),'f');
const eventId=randomUUID();
const trigger=query(`begin;insert into public.audit_events(id,account_id,event_type,payload,created_at) values(${quote(eventId)},'a0000000-0000-4000-8000-000000000001','stage_transition','{"to_stage":"script_review"}','2000-01-01');select count(*) from public.notification_delivery_events where event_id=${quote(eventId)} and outcome='pending';${stageC?'':"select id from public.claim_notification_event();"}rollback;`);
assert.equal(trigger,stageC?'1':`1\n${eventId}`,'exact new event is enqueued by restored trigger');
const evidence={stage:stageC?'C-final':'T09',revisionTriggerRestored:stageC,finalReuseBrowserDenied:stageC,target:targetId,database,backupRoot:root,archiveSha256:digest(archive),emptyPublicBeforeRestore:true,inventoryMatched:true,tables:Object.keys(inventory).length,rows:Object.values(inventory).reduce((n,row)=>n+row.count,0),schemaSecurity:security,internalTriggerRestored:true,restoredAcceptedEventsNotReplayed:true,authenticatedClaimDenied:true,managedSchemas:'real source schema-only; no managed data or secrets',authIdentityOnly:true,authLoginTested:false,mediaFilesVerified:m.media.length,databaseRetained:true};
writePrivateFile(join(directory,'result.json'),JSON.stringify(evidence,null,2)+'\n');if(stageC)writePrivateFile(join(c.stateRoot,'stage-c-restore-latest.json'),JSON.stringify({directory,database})+'\n');console.log(JSON.stringify(evidence,null,2));
