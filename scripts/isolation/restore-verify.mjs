import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { config, env, sql, digest, quote, readBackup } from './backup.mjs';
import { targetConfiguration, targetContainer, targetId, restoreBackup } from './restore.mjs';
import { writePrivateFile, assertPrivatePath } from './environment.mjs';
const c=targetConfiguration(),f=JSON.parse(readFileSync(join(config.stateRoot,'restore-fixture.json'))),owner=JSON.parse(readFileSync(join(config.stateRoot,'owner.json')));
const restoredOwner=JSON.parse(readFileSync(join(c.stateRoot,`owner-${owner.id}.json`)));
const client=createClient(c.apiUrl,c.anonKey,{auth:{persistSession:false}}),admin=createClient(c.apiUrl,c.serviceRoleKey,{auth:{persistSession:false}});
const unwrap=async p=>{const {data,error}=await p;if(error)throw new Error(`恢复接口错误：${error.code}`);return data;};
const login=await unwrap(client.auth.signInWithPassword(restoredOwner));assert.equal(login.user.id,owner.id);
const ep=await unwrap(client.from('episodes').select('*').eq('id',f.episode).single());assert.equal(ep.title,'Stage B restore checkpoint');
const reviews=await unwrap(client.from('review_packages').select('*').eq('episode_id',f.episode));assert.equal(reviews[0].context_snapshot.frozen,'stage-b-review');
const approvals=await unwrap(client.from('approvals').select('*').eq('episode_id',f.episode));assert.equal(approvals[0].reason,'Stage B synthetic historical checkpoint');
const art=await unwrap(client.from('artifacts').select('*').eq('id',f.artifact).single());
const blueprint=await unwrap(client.from('account_blueprint_versions').select('policy').eq('id',ep.blueprint_version_id).single());
const media=join(blueprint.policy.asset_root,art.relative_path);assertPrivatePath(media);assert.equal(digest(readFileSync(media)),art.sha256);
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',media],{encoding:'utf8',env}));assert.ok(Number(probe.format.duration)>1);
const versions=await unwrap(client.rpc('list_external_connection_versions',{p_connection_id:f.connectionId}));assert.equal(versions.find(v=>v.id===f.versionId).status,'invalid');
const unresolved=await admin.rpc('resolve_external_connection_secret',{p_connection_id:f.versionId,p_account_id:ep.account_id});assert.ok(unresolved.error);
// Explicit new version, then explicit verification; historical reference remains blocked.
const replacement=crypto.randomUUID()+crypto.randomUUID();
const rotated=await unwrap(client.rpc('rotate_external_connection',{p_connection_id:f.connectionId,p_provider:'pexels',p_adapter:'pexels_video',p_secret:replacement}));
await unwrap(admin.rpc('record_external_connection_verification',{p_connection_id:rotated.current_version_id,p_status:'verified',p_detail:'Synthetic rebind test, no provider call.'}));
const resolved=await unwrap(admin.rpc('resolve_external_connection_secret',{p_connection_id:rotated.current_version_id,p_account_id:ep.account_id}));assert.equal(resolved,replacement);assert.notEqual(rotated.current_version_id,f.versionId);
const oldStillBlocked=await admin.rpc('resolve_external_connection_secret',{p_connection_id:f.versionId,p_account_id:ep.account_id});assert.ok(oldStillBlocked.error);
const {root}=JSON.parse(readFileSync(join(config.stateRoot,'latest-backup.json')));const manifest=readBackup(root);
const archiveSql=execFileSync('docker',['exec','-i',targetContainer,'pg_restore','--file=-'],{env,input:readFileSync(join(root,'business.dump')),maxBuffer:64*1024*1024});
for(const secret of [f.secret,owner.password,restoredOwner.password,replacement]) assert.ok(!archiveSql.includes(Buffer.from(secret)) && !readFileSync(join(root,'manifest.json')).includes(Buffer.from(secret)));
await assert.rejects(restoreBackup(root),/已有业务实体/);
// Full archive corruption must be rejected before any target write.
const archivePath=join(root,'business.dump'),original=readFileSync(archivePath);
try{writePrivateFile(archivePath,Buffer.from('corrupt'));assert.throws(()=>readBackup(root),/归档指纹/);}finally{writePrivateFile(archivePath,original);}
const first=join(root,'media',manifest.media[0].path),originalMedia=readFileSync(first);
try{writePrivateFile(first,Buffer.from('corrupt'));assert.throws(()=>readBackup(root),/媒体指纹/);}finally{writePrivateFile(first,originalMedia);}
assert.equal((await fetch(`http://127.0.0.1:${c.ports.console}/_episode-dispatch`,{method:'POST'})).status,503);
// Foreign keys were rebuilt and validated by pg_restore, not disabled for import.
assert.equal(sql("select count(*) from pg_constraint where connamespace='public'::regnamespace and contype='f' and not convalidated",targetContainer),'0');
const result={checkedAt:new Date().toISOString(),target:targetId,episodeId:f.episode,httpEpisodeReadable:true,reviewSnapshotPreserved:true,approvalPreserved:true,mediaSha256:art.sha256,probe,unboundSecretBlocked:true,explicitNewVersionRebound:true,oldVersionStillBlocked:true,noPlainSecretsInArchive:true,nonemptyRestoreRejected:true,archiveCorruptionRejected:true,mediaCorruptionRejected:true,foreignKeysValidated:true,localExecutionDisabled:true};
writePrivateFile(join(c.stateRoot,'verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
