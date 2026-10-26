import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, existsSync, copyFileSync, closeSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, env, sql, assertContainer, readBackup, inventorySql, digest, quote } from './backup.mjs';
import { projectRoot, ensurePrivateDirectory, writePrivateFile, assertPrivatePath, cleanEnvironment, hostHome, openPrivateFile, assertLoopbackListeners } from './environment.mjs';
import { securityInventorySql, clearRestoreDefaultsSql } from './security-inventory.mjs';
import { inspectRecordedService } from '../local-service-record.mjs';
export const targetName = process.argv.includes('--verified') ? 'verified' : process.argv.includes('--replay') ? 'replay' : 'restore';
export const targetId = `loop-control-stage-b-${targetName}`;
export const targetContainer = `supabase_db_${targetId}`;
export const targetRoot = join(projectRoot,`.loop-control/stage-b/${targetName}`);
export const targetStack = join(targetRoot,'stack');
export const targetPorts = targetName==='verified'?{api:55461,database:55462,console:55176}:targetName === 'replay' ? {api:55451,database:55452,console:55175} : {api:55441,database:55442,console:55174};
function cli(args) { try {return execFileSync(join(projectRoot,'node_modules/.bin/supabase'),['--workdir',targetStack,...args],{env,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});}catch {throw new Error(`恢复栈 CLI ${args[0]} 失败，敏感输出已抑制。`);} }
export async function prepareTarget() {
  ensurePrivateDirectory(join(targetStack,'supabase'));
  const path=join(targetStack,'supabase/config.toml');
  const template=readFileSync(join(projectRoot,'scripts/isolation/supabase.toml'),'utf8').replace('loop-control-stage-a',targetId).replaceAll('55173',String(targetPorts.console)).replace(/5543(\d)/g,(_m,n)=>`${targetName==='verified'?'5546':targetName==='replay'?'5545':'5544'}${n}`);
  if (existsSync(path) && readFileSync(path,'utf8')!==template) throw new Error('恢复目标配置不符，拒绝覆盖');
  if (!existsSync(path)) writePrivateFile(path,template,{exclusive:true});
  if (existsSync(join(targetStack,'supabase/.temp/project-ref'))) throw new Error('恢复目标不能关联云端');
  for (const name of ['media','state','logs']) ensurePrivateDirectory(join(targetRoot,name));
  const recordPath=join(targetRoot,'tunnel.json'),sshConfig=join(hostHome,'.colima/_lima/colima-loop-stage-a/ssh.config');
  const verified=r=>r?.projectRoot===projectRoot && [targetPorts.api,targetPorts.database].every(port=>inspectRecordedService({pid:r.pid,port:String(port),commandIdentity:sshConfig},projectRoot).valid);
  if (existsSync(recordPath)) { if (!verified(JSON.parse(readFileSync(recordPath)))) throw new Error('恢复隧道身份不符'); } else {
  if (!/^portForwarder: none$/m.test(readFileSync(join(hostHome,'.colima/loop-stage-a/colima.yaml'),'utf8'))) throw new Error('Colima 转发必须禁用');
  const log=openPrivateFile(join(targetRoot,'logs/tunnel.log'),{append:true});
  const child=spawn('ssh',['-F',sshConfig,'-o','ControlMaster=no','-o','ControlPath=none','-o','ExitOnForwardFailure=yes','-N','-L',`127.0.0.1:${targetPorts.api}:127.0.0.1:${targetPorts.api}`,'-L',`127.0.0.1:${targetPorts.database}:127.0.0.1:${targetPorts.database}`,'lima-colima-loop-stage-a'],{env,cwd:projectRoot,detached:true,stdio:['ignore',log,log]});
  await once(child,'spawn');closeSync(log);
  const record={pid:child.pid,projectRoot};
  for(let i=0;i<40;i++) { if(verified(record)){writePrivateFile(recordPath,JSON.stringify(record)+'\n',{exclusive:true});child.unref();break;} await new Promise(r=>setTimeout(r,100)); }
  if (!verified(record)) { child.kill('SIGTERM');throw new Error('恢复隧道未就绪'); }
  }
  console.log('正在启动独立空白兼容栈（不应用业务迁移，不重置 A 数据库）');
  cli(['start','--exclude','realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
  assertContainer(targetContainer,targetId);
  const status=cli(['status','-o','env']);
  const values=Object.fromEntries(status.split('\n').flatMap(line=>{const m=/^([A-Z_]+)="(.*)"$/.exec(line);return m?[[m[1],m[2]]]:[]}));
  const c={...config,projectId:targetId,databaseUrl:`postgresql://postgres:postgres@127.0.0.1:${targetPorts.database}/postgres`,apiUrl:`http://127.0.0.1:${targetPorts.api}`,anonKey:values.ANON_KEY,serviceRoleKey:values.SERVICE_ROLE_KEY,mediaRoot:join(targetRoot,'media'),stateRoot:join(targetRoot,'state'),logsRoot:join(targetRoot,'logs'),runtimeRoot:targetRoot,ports:targetPorts};
  for (const name of ['media','state','logs']) ensurePrivateDirectory(join(targetRoot,name));
  writePrivateFile(join(targetRoot,'config.json'),JSON.stringify(c)+'\n');
  const tunnel=JSON.parse(readFileSync(recordPath));
  const bindings=execFileSync('lsof',['-nP','-a','-p',String(tunnel.pid),'-iTCP','-sTCP:LISTEN','-Fn'],{encoding:'utf8'}).split('\n').filter(line=>line.startsWith('n')).map(line=>({hostIp:line.slice(1,line.lastIndexOf(':')),hostPort:line.slice(line.lastIndexOf(':')+1)}));
  assertLoopbackListeners(bindings);if(bindings.length!==2)throw new Error('恢复隧道监听不完整');
  return c;
}
export function targetConfiguration() {
  const path=join(targetRoot,'config.json');assertPrivatePath(path);
  const c=JSON.parse(readFileSync(path,'utf8'));
  const expected={projectRoot,projectId:targetId,dockerHost:config.dockerHost,apiUrl:`http://127.0.0.1:${targetPorts.api}`,databaseUrl:`postgresql://postgres:postgres@127.0.0.1:${targetPorts.database}/postgres`,runtimeRoot:targetRoot,mediaRoot:join(targetRoot,'media'),stateRoot:join(targetRoot,'state'),logsRoot:join(targetRoot,'logs')};
  for(const [key,value] of Object.entries(expected)){if(c[key]!==value)throw new Error(`恢复目标配置身份不符：${key}`);if(key.endsWith('Root'))assertPrivatePath(value);}
  if(JSON.stringify(c.ports)!==JSON.stringify(targetPorts))throw new Error('恢复目标端口不符');
  for(const [key,role] of [['anonKey','anon'],['serviceRoleKey','service_role']]){const payload=JSON.parse(Buffer.from(c[key].split('.')[1],'base64url'));if(payload.iss!=='supabase-demo'||payload.role!==role)throw new Error('恢复凭据不是测试凭据');}
  return c;
}
export async function restoreBackup(root) {
  const m=readBackup(root);const c=targetConfiguration();assertContainer(targetContainer,targetId);
  if (sql("select count(*) from pg_tables where schemaname='public'",targetContainer)!=='0') throw new Error('恢复目标已有业务实体，拒绝覆盖');
  const {createClient}=await import('@supabase/supabase-js');
  const admin=createClient(c.apiUrl,c.serviceRoleKey,{auth:{persistSession:false}});
  // Recreate only stable identity; never restore passwords, sessions or tokens.
  for(const user of m.users) {
    const password=crypto.randomUUID()+crypto.randomUUID();
    const {data:existing}=await admin.auth.admin.getUserById(user.id);
    const result=existing?.user ? await admin.auth.admin.updateUserById(user.id,{password}) : await admin.auth.admin.createUser({id:user.id,email:user.email,password,email_confirm:true});
    if(result.error || result.data.user?.id !== user.id) throw new Error('恢复 Owner 身份失败');
    writePrivateFile(join(c.stateRoot,`owner-${user.id}.json`),JSON.stringify({id:user.id,email:user.email,password})+'\n');
  }
  sql(clearRestoreDefaultsSql,targetContainer,'supabase_admin');
  const archive=readFileSync(join(root,'business.dump'));
  // pg_restore list omits only the already managed public schema itself.
  const list=execFileSync('docker',['exec','-i',targetContainer,'pg_restore','--list'],{env,input:archive,encoding:'utf8',maxBuffer:10*1024*1024});
  const useList=list.split('\n').filter(line=>!/^\d+; .* SCHEMA - public /.test(line)).join('\n');
  execFileSync('docker',['exec','-i',targetContainer,'sh','-c','umask 077; cat > /tmp/loop-stage-b-restore.list'],{env,input:useList});
  try { execFileSync('docker',['exec','-i',targetContainer,'pg_restore','-U','supabase_admin','-d','postgres','--exit-on-error','--single-transaction','--use-list=/tmp/loop-stage-b-restore.list'],{env,input:archive,maxBuffer:10*1024*1024,stdio:['pipe','pipe','pipe']}); }
  catch(error) {writePrivateFile(join(c.stateRoot,'restore-error.log'),error.stderr ?? String(error));throw new Error('独立空库恢复失败，未操作 A；目标保留供诊断');}
  finally {execFileSync('docker',['exec',targetContainer,'rm','-f','/tmp/loop-stage-b-restore.list'],{env});}
  const restored=JSON.parse(sql(inventorySql(),targetContainer));
  const schemaSecurity=JSON.parse(sql(securityInventorySql(),targetContainer));
  if(JSON.stringify(schemaSecurity)!==JSON.stringify(m.schemaSecurity))throw new Error('恢复对象/Owner/权限/默认授权指纹不一致');
  if(JSON.stringify(restored)!==JSON.stringify(m.inventory)) throw new Error('恢复逐表数量/内容指纹不一致');
  for(const f of m.media){const p=join(c.mediaRoot,f.path);ensurePrivateDirectory(resolve(p,'..'));assertPrivatePath(p);if(existsSync(p))throw new Error('恢复媒体目标非空');copyFileSync(join(root,'media',f.path),p);if(digest(readFileSync(p))!==f.sha256)throw new Error('恢复媒体校验失败');}
  // Keep frozen records byte-identical; only deployment asset roots are explicitly remapped.
  sql(`set session_replication_role=replica; update public.account_blueprint_versions set policy=jsonb_set(policy,'{asset_root}',to_jsonb(replace(policy->>'asset_root',${quote(m.mediaRoot)},${quote(c.mediaRoot)}))) where policy->>'asset_root'=${quote(m.mediaRoot)} or policy->>'asset_root' like ${quote(m.mediaRoot+'/%')}; set session_replication_role=origin;`,targetContainer);
  // Mark unresolved versions invalid with an appended verification, preserving history.
  sql(`insert into public.external_connection_verifications(connection_id,connection_version_id,status,detail) select v.connection_id,v.id,'invalid','恢复后秘密尚未绑定；需显式重绑原引用并重新验证。' from public.external_connection_versions v where not exists(select 1 from vault.secrets s where s.id=v.vault_secret_id); update public.external_connections set status='invalid',last_verification_detail='恢复后秘密尚未绑定',last_verified_at=null; notify pgrst,'reload schema';`,targetContainer);
  const result={checkedAt:new Date().toISOString(),target:targetId,emptyBusinessTarget:true,schemaSecurityMatched:true,schemaSecurity,tables:restored,mediaFiles:m.media.length,mediaVerified:true,ownerIdsPreserved:true,excluded:m.excluded,referenceRemap:{from:m.mediaRoot,to:c.mediaRoot},secretsInvalidated:true};
  writePrivateFile(join(c.stateRoot,'restore-result.json'),JSON.stringify(result,null,2)+'\n');
  return result;
}
export function mountRestoredMedia() {
  const c=targetConfiguration(),image=join(targetRoot,'media.sparseimage'),saved=join(targetRoot,'media-restored-before-mount');
  const mounted=()=>{const info=execFileSync('hdiutil',['info','-plist']);const json=JSON.parse(execFileSync('plutil',['-convert','json','-o','-','-'],{input:info,encoding:'utf8'}));return json.images.find(i=>i['system-entities']?.some(e=>e['mount-point']===c.mediaRoot));};
  const current=mounted();if(current){if(current['image-path']!==image)throw new Error('恢复媒体挂载身份不符');return {mounted:true,image,mediaRoot:c.mediaRoot};}
  assertPrivatePath(image);assertPrivatePath(saved);
  if(existsSync(image)||existsSync(saved))throw new Error('媒体卷准备残留需先检查，拒绝覆盖');
  execFileSync('hdiutil',['create','-srcfolder',c.mediaRoot,'-volname',`LoopStageB-${targetName}`,'-format','UDSP',image],{env,stdio:['ignore','pipe','pipe']});
  renameSync(c.mediaRoot,saved);ensurePrivateDirectory(c.mediaRoot);
  execFileSync('hdiutil',['attach',image,'-mountpoint',c.mediaRoot,'-nobrowse'],{env,stdio:['ignore','pipe','pipe']});
  if(mounted()?.['image-path']!==image)throw new Error('新媒体卷未挂载');
  return {mounted:true,image,mediaRoot:c.mediaRoot,originalCopyPreserved:saved};
}
export async function stopTargetConsole() {
  const c=targetConfiguration(),recordPath=join(c.stateRoot,'console.json');assertPrivatePath(recordPath);
  if(!existsSync(recordPath))return;
  const r=JSON.parse(readFileSync(recordPath));
  const valid=()=>inspectRecordedService({pid:r.pid,port:String(c.ports.console),commandIdentity:join(projectRoot,'node_modules/vite/bin/vite.js')},projectRoot).valid;
  if(!valid() || r.port!==c.ports.console || r.projectRoot!==projectRoot)throw new Error('恢复控制台身份不符，拒绝停止');
  process.kill(r.pid,'SIGTERM');for(let i=0;i<40 && valid();i++)await new Promise(r=>setTimeout(r,100));
  if(valid())throw new Error('恢复控制台未退出，保留记录');rmSync(recordPath);
}
export async function startTargetConsole() {
  const c=targetConfiguration();assertContainer(targetContainer,targetId);
  const recordPath=join(c.stateRoot,'console.json');
  if(existsSync(recordPath)){const r=JSON.parse(readFileSync(recordPath));if(inspectRecordedService({pid:r.pid,port:String(c.ports.console),commandIdentity:join(projectRoot,'node_modules/vite/bin/vite.js')},projectRoot).valid)return r;throw new Error('恢复控制台记录不符');}
  const log=openPrivateFile(join(c.logsRoot,'console.log'),{append:true});
  const child=spawn(process.execPath,[join(projectRoot,'node_modules/vite/bin/vite.js'),'--config',join(projectRoot,'scripts/isolation/restore-vite.config.mjs'),'--host','127.0.0.1','--port',String(c.ports.console),'--strictPort'],{cwd:projectRoot,env:{...cleanEnvironment(c),...(process.argv.includes('--worker')?{LOOP_STAGE_B_WORKER:'1'}:{})},detached:true,stdio:['ignore',log,log]});
  await once(child,'spawn');closeSync(log);
  const r={pid:child.pid,port:c.ports.console,projectRoot,workerEnabled:process.argv.includes('--worker')};
  for(let i=0;i<80;i++){try {if((await fetch(`http://127.0.0.1:${c.ports.console}/loop-control-health.txt`)).ok){writePrivateFile(recordPath,JSON.stringify(r)+'\n',{exclusive:true});child.unref();return r;}}catch{}await new Promise(r=>setTimeout(r,250));}
  child.kill('SIGTERM');throw new Error('恢复控制台未就绪');
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 try {const mode=process.argv[2];if(mode==='prepare')await prepareTarget();else if(mode==='restore'){const {root}=JSON.parse(readFileSync(join(config.stateRoot,'latest-backup.json')));console.log(JSON.stringify(await restoreBackup(root)));}else if(mode==='mount-media')console.log(JSON.stringify(mountRestoredMedia()));else if(mode==='stop-console')await stopTargetConsole();else if(mode==='console')console.log(JSON.stringify(await startTargetConsole()));else throw new Error('用法：prepare|restore|console');}
 catch(error){console.error(error instanceof Error ? error.message.split('\n')[0] : '恢复入口失败');process.exitCode=1;}
}
