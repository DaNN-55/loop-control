// B compatibility backup: real PostgreSQL snapshot, public business schema/data,
// migration history and media. Auth credentials/sessions and Vault data are excluded.
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, copyFileSync, existsSync, chmodSync, renameSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { securityInventorySql } from './security-inventory.mjs';
import { readConfiguration, toolEnvironment, projectRoot, ensurePrivateDirectory, writePrivateFile, assertPrivatePath } from './environment.mjs';
export const config = readConfiguration();
export const env = { ...toolEnvironment(), DOCKER_HOST: config.dockerHost };
export const sourceContainer = `supabase_db_${config.projectId}`;
export function assertContainer(container, id) {
  const found = JSON.parse(execFileSync('docker', ['inspect', container], { env, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }));
  if (found[0]?.Config?.Labels?.['com.supabase.cli.project'] !== id) throw new Error('隔离容器身份不匹配');
}
export function sql(text, container = sourceContainer, user = 'postgres') {
  try { return execFileSync('docker', ['exec', '-i', container, 'psql', '-Xq', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { env, input: text, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe','pipe','pipe'] }).trim(); }
  catch { throw new Error('隔离数据库命令失败（原始 SQL/输出不写入日志）'); }
}
export const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
export function digest(content) { return createHash('sha256').update(content).digest('hex'); }
export function inventorySql(snapshot) {
  return `create function pg_temp.inventory() returns jsonb language plpgsql as $$
declare t record; rows jsonb; result jsonb := '{}'; begin
for t in select tablename from pg_tables where schemaname='public' order by tablename loop
 execute format('select coalesce(jsonb_agg(row_data order by row_data::text), ''[]''::jsonb) from (select to_jsonb(r) as row_data from public.%I r) s',t.tablename) into rows;
 result := result || jsonb_build_object(t.tablename, jsonb_build_object('count',jsonb_array_length(rows),'md5',md5(rows::text)));
end loop; return result; end $$;
begin isolation level repeatable read read only; ${snapshot ? `set transaction snapshot ${quote(snapshot)};` : ''}
select pg_temp.inventory(); commit;`;
}
function files(root, base = root) {
  assertPrivatePath(root);
  return readdirSync(root).sort().flatMap(name => {
    const path = join(root, name), info = lstatSync(path);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink !== 1)) throw new Error('备份媒体必须是独立普通文件/目录');
    return info.isDirectory() ? files(path, base) : [{ path: relative(base, path), size: info.size, sha256: digest(readFileSync(path)) }];
  });
}
export async function createBackup(selectedConfig = config) {
  const stateDirectory = join(selectedConfig.stateRoot,'orchestration');
  ensurePrivateDirectory(stateDirectory);
  function record(passed, detail) {
    const outcome={at:new Date().toISOString(),passed,detail};
    for(const name of ['backup-result.json',`backup-last-${passed?'success':'failure'}.json`]){
      const path=join(stateDirectory,name),temporary=`${path}.${randomUUID()}.next`;
      writePrivateFile(temporary,JSON.stringify(outcome)+'\n',{exclusive:true});renameSync(temporary,path);
    }
  }
  try {const result=await performBackup(selectedConfig);record(true,`完整 v2 备份成功：${result.tables} 张表、${result.rows} 行、${result.mediaFiles} 个媒体文件。`);return result;}
  catch(error){record(false,'完整备份失败，未生成可恢复成功结论；请检查本机日志。');throw error;}
}
async function performBackup(config) {
  if(!['loop-control-stage-a','loop-control-stage-b-verified'].includes(config.projectId))throw Error('备份只接受已批准的隔离目标');
  const sourceContainer=`supabase_db_${config.projectId}`;
  const runSql=text=>sql(text,sourceContainer);
  assertContainer(sourceContainer, config.projectId);
  const root = join(config.runtimeRoot, 'backups', randomUUID());
  ensurePrivateDirectory(root);
  const holder = spawn('docker', ['exec','-i',sourceContainer,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], { env, stdio: ['pipe','pipe','pipe'] });
  let snapshot;
  try {
    const lines = createInterface({ input: holder.stdout });
    const ready = once(lines, 'line');
    holder.stdin.write('begin isolation level repeatable read read only; select pg_export_snapshot();\n');
    [snapshot] = await Promise.race([ready, once(holder, 'exit').then(() => { throw new Error('数据库快照会话失败'); })]);
    if (!/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/.test(snapshot)) throw new Error('快照标识无效');
    const inventory = JSON.parse(runSql(inventorySql(snapshot)));
    const schemaSecurity = JSON.parse(runSql(securityInventorySql(snapshot)));
    // Only ordinary business schemas: never dump Auth passwords/tokens or Vault secrets.
    const archive = execFileSync('docker', ['exec',sourceContainer,'pg_dump','-U','postgres','-d','postgres','-Fc','--schema=public','--schema=loop_internal','--schema=supabase_migrations',`--snapshot=${snapshot}`], { env, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore','pipe','pipe'] });
    writePrivateFile(join(root,'business.dump'),archive,{exclusive:true});
    const users = JSON.parse(runSql(`begin isolation level repeatable read read only; set transaction snapshot ${quote(snapshot)}; select coalesce(json_agg(json_build_object('id',id,'email',email)), '[]') from auth.users; commit;`));
    const references = JSON.parse(runSql(`begin isolation level repeatable read read only; set transaction snapshot ${quote(snapshot)};
      select coalesce(json_agg(r),'[]') from (
        select b.policy->>'asset_root' as root,a.relative_path,a.sha256,a.file_size from public.artifacts a join public.episodes e on e.id=a.episode_id join public.account_blueprint_versions b on b.id=e.blueprint_version_id
        union all select b.policy->>'asset_root',a.relative_path,a.sha256,a.file_size from public.audio_tracks a join public.episodes e on e.id=a.episode_id join public.account_blueprint_versions b on b.id=e.blueprint_version_id
        union all select b.policy->>'asset_root',a.storage_path,a.sha256,a.file_size from public.production_material_revisions a join public.episodes e on e.id=a.episode_id join public.account_blueprint_versions b on b.id=e.blueprint_version_id
      ) r; commit;`));
    const media = files(config.mediaRoot);
    const byPath = new Map(media.map(file => [file.path,file]));
    for (const ref of references) {
      const path=resolve(ref.root,ref.relative_path); assertPrivatePath(path);
      const copied = byPath.get(relative(config.mediaRoot,path));
      if (relative(config.mediaRoot,path).startsWith('..') || copied?.sha256!==ref.sha256 || copied?.size!==ref.file_size) throw new Error('数据库引用媒体缺失或指纹不符，备份未完成');
    }
    for (const file of media) {
      const destination = join(root,'media',file.path); ensurePrivateDirectory(resolve(destination,'..')); assertPrivatePath(destination);
      copyFileSync(join(config.mediaRoot,file.path),destination); chmodSync(destination,0o600);
      if (digest(readFileSync(destination)) !== file.sha256) throw new Error('复制期间媒体已变化，备份未完成');
    }
    if (JSON.stringify(files(config.mediaRoot)) !== JSON.stringify(media)) throw new Error('备份期间媒体已变化，备份未完成');
    const manifest = { version:'loop-business-backup/v2', consistency:'postgres-exported-snapshot', mediaConsistency:'verified-copy; writes must be paused', createdAt:new Date().toISOString(), sourceProject:config.projectId, mediaRoot:config.mediaRoot, archiveSha256:digest(archive), inventory, schemaSecurity, users, media, mediaReferences:references.length, excluded:['auth passwords/sessions/tokens','vault secrets','host credentials/config'], secrets:'explicitly rotate a new connection version, verify it, and repair affected configuration; historical unresolved versions remain invalid' };
    writePrivateFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{exclusive:true});
    writePrivateFile(join(config.stateRoot,'latest-backup.json'),JSON.stringify({root})+'\n');
    return { root, tables:Object.keys(inventory).length, rows:Object.values(inventory).reduce((n,t)=>n+t.count,0), mediaFiles:media.length, archiveSha256:manifest.archiveSha256 };
  } finally { if(holder.exitCode===null && holder.signalCode===null){ const done=once(holder,'exit').catch(()=>{});holder.stdin.end('rollback;\n');await done; } }
}
export function readBackup(root, selectedConfig = config) {
  const config=selectedConfig;
  assertPrivatePath(root);
  if (!resolve(root).startsWith(join(config.runtimeRoot,'backups')+'/')) throw new Error('只接受本树生成的隔离备份');
  const manifestPath = join(root,'manifest.json'); assertPrivatePath(manifestPath);
  const m = JSON.parse(readFileSync(manifestPath,'utf8'));
  if (!m.schemaSecurity || m.version !== 'loop-business-backup/v2' || m.sourceProject !== config.projectId || m.mediaRoot !== config.mediaRoot) throw new Error('备份身份不符');
  const path = join(root,'business.dump'); assertPrivatePath(path);
  if (digest(readFileSync(path)) !== m.archiveSha256) throw new Error('备份归档指纹不符');
  for (const f of m.media) {
    const p = resolve(root,'media',f.path); assertPrivatePath(p);
    if (relative(join(root,'media'),p).startsWith('..') || !existsSync(p) || digest(readFileSync(p)) !== f.sha256) throw new Error('备份媒体指纹不符');
  }
  return m;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { console.log(JSON.stringify({ mode:'backup',passed:true,...await createBackup(process.argv.includes('--verified')?(await import('./restore.mjs')).targetConfiguration():config) })); }
  catch { console.error(JSON.stringify({mode:'backup',passed:false,detail:'一致性备份未完成；保留诊断目录，无有效 manifest 不可恢复。'})); process.exitCode=1; }
}
