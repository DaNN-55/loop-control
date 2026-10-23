import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readConfiguration, toolEnvironment, projectRoot } from './environment.mjs';
const config = readConfiguration();
const env = { ...toolEnvironment(), DOCKER_HOST: config.dockerHost };
const container = `supabase_db_${config.projectId}`;
const identity = JSON.parse(execFileSync('docker', ['inspect', container], { env, encoding: 'utf8' }));
if (identity[0]?.Config?.Labels?.['com.supabase.cli.project'] !== config.projectId) throw new Error('隔离数据库身份不符');
if (process.argv[2] === 'sql') {
  process.stdout.write(execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { env, input: readFileSync(0), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
} else if (process.argv[2] === 'apply-lease-migration') {
 const {targetContainer,targetId}=await import('./restore.mjs'); const {sql,assertContainer,quote}=await import('./backup.mjs');assertContainer(targetContainer,targetId);
 const name='20261023103336_worker_lease_recovery_and_fencing'; const migration=readFileSync(`${projectRoot}/supabase/migrations/${name}.sql`,'utf8');
 console.log(sql(`begin; ${migration} insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261023103336','worker_lease_recovery_and_fencing',array[${quote(migration)}]);commit;select count(*) from supabase_migrations.schema_migrations;`,targetContainer));
} else if (process.argv[2] === 'sql-target') {
 const {targetContainer,targetId}=await import('./restore.mjs'); const {sql,assertContainer}=await import('./backup.mjs');assertContainer(targetContainer,targetId); console.log(sql(readFileSync(0,'utf8'),targetContainer));
} else if (process.argv[2] === 't04-red') {
  const { snapshotTables } = await import('../../src/orchestration/backupPolicy.ts');
  const missing = [];
  for (const table of Object.keys(snapshotTables)) {
    const response = await fetch(`${config.apiUrl}/rest/v1/${table}?select=*&limit=0`, { headers: { apikey: config.serviceRoleKey, authorization: `Bearer ${config.serviceRoleKey}` } });
    if (!response.ok) missing.push({ table, status: response.status });
  }
  console.log(JSON.stringify({ boundary: 'real PostgREST', missing }));
  if (missing.length) process.exitCode = 1;
} else if (process.argv[2] === 'browser-login') {
  const {targetConfiguration}=await import('./restore.mjs'); const c=targetConfiguration();
  const owner=JSON.parse(readFileSync(`${config.stateRoot}/owner.json`));
  const restored=JSON.parse(readFileSync(`${c.stateRoot}/owner-${owner.id}.json`));
  const script=`(async()=>{const {supabase}=await import('/src/lib/supabase.ts'); const r=await supabase.auth.signInWithPassword(${JSON.stringify(restored)}); if(r.error)throw Error('login failed'); return {authenticated:!!r.data.session};})()`;
  process.stdout.write(execFileSync('agent-browser',['--session','loop-stage-b','eval','--stdin'],{input:script,encoding:'utf8'}));
} else if (['export','health'].includes(process.argv[2])) {
  const { cleanEnvironment } = await import('./environment.mjs');
  process.stdout.write(execFileSync(process.execPath, [`${projectRoot}/dist/orchestration/orchestration/loopOrchestratorCli.js`,process.argv[2]], { env: { ...cleanEnvironment(config), LOOP_PROJECT_ROOT:projectRoot }, encoding:'utf8' }));
} else if (process.argv[2] === 'cli') {
  process.stdout.write(execFileSync(`${projectRoot}/node_modules/.bin/supabase`, process.argv.slice(3), { env, encoding: 'utf8' }));
} else throw new Error('stage-b sql < file.sql | cli <supabase arguments>');
