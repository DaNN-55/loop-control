// T06: use only the final B target; never claim preserved A/B fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config, sql, quote, digest, env, assertContainer } from './backup.mjs';
import { targetConfiguration, targetContainer, targetId, stopTargetConsole, startTargetConsole } from './restore.mjs';
import { cleanEnvironment, writePrivateFile, ensurePrivateDirectory, projectRoot } from './environment.mjs';

assert.ok(process.argv.includes('--verified'), 'T06 requires --verified');
const c = targetConfiguration();
assert.equal(c.projectId, 'loop-control-stage-b-verified');
assertContainer(targetContainer, targetId);
const admin = createClient(c.apiUrl, c.serviceRoleKey, { auth: { persistSession: false } });
const ownerClient = createClient(c.apiUrl, c.anonKey, { auth: { persistSession: false } });
const unwrap = async promise => { const { data, error } = await promise; if (error) throw Error(`T06 DB: ${error.code} ${error.message}`); return data; };
const sourceOwner = JSON.parse(readFileSync(join(config.stateRoot, 'owner.json')));
const owner = JSON.parse(readFileSync(join(c.stateRoot, `owner-${sourceOwner.id}.json`)));
const login = await unwrap(ownerClient.auth.signInWithPassword(owner));
const headers = { authorization: `Bearer ${login.session.access_token}`, origin: `http://127.0.0.1:${c.ports.console}` };
const episode = randomUUID(), root = join(c.mediaRoot, 'smoke');
ensurePrivateDirectory(join(root, 'episodes', episode));
const sourceBytes = readFileSync(join(root, 'episodes/13029a1c-8dff-49eb-a2d4-e04e36126f6d/source-0.mp4'));
const source = `episodes/${episode}/source.mp4`;
writePrivateFile(join(root, source), sourceBytes, { exclusive: true });
await unwrap(admin.from('episodes').insert({ id: episode, account_id: 'a0000000-0000-4000-8000-000000000001', blueprint_version_id: 'a0000000-0000-4000-8000-000000000002', title: 'Stage C T06 unified durable queue', is_test: true }));
const taskRow = id => unwrap(admin.from('tasks').select('*').eq('id', id).single());
const runs = id => unwrap(admin.from('task_runs').select('*').eq('task_id', id).order('attempt'));
const route = id => `http://127.0.0.1:${c.ports.console}/_episode-dispatch?episode=${episode}&task=${id}`;
const post = id => fetch(route(id), { method: 'POST', headers });
const status = async id => { const response = await fetch(route(id), { headers }); assert.equal(response.status, 200); return response.json(); };
const workerEnvironment = { ...cleanEnvironment(c), LOOP_PROJECT_ROOT: projectRoot };
const cli = join(projectRoot, 'dist/orchestration/orchestration/loopOrchestratorCli.js');
async function newTask(label) {
  const id = randomUUID();
  await unwrap(admin.from('tasks').insert({ id, episode_id: episode, task_type: 'generate_a_roll', status: 'ready', provider: 'ffmpeg', model: 'ffmpeg', prompt_version: 'shot-clip-v1', budget_limit_cents: 0, max_attempts: 2,
    input_snapshot: { capability: 'shot_clip_preparation', executor: { provider: 'ffmpeg', adapter: 'ffmpeg_trim_video', model: 'ffmpeg', prompt_version: 'shot-clip-v1' }, allowed_tools: ['read', 'write'], media: { adapter: 'ffmpeg_trim_video', video_clip: { source_relative_path: source, start_seconds: 0, end_seconds: 2, target_duration_seconds: 2 } }, output: { required_artifact_types: ['a_roll_video'], content_type: 'video/mp4', relative_path: `episodes/${episode}/${label}.mp4`, review_stage: 'production_ready' }, input_artifacts: [{ artifactType: 'source_video', relativePath: source, sha256: digest(sourceBytes), fileSize: sourceBytes.length }] } }));
  return id;
}
function tick(args = []) {
  const child = spawn(process.execPath, [cli, 'dispatch', ...args], { cwd: projectRoot, env: workerEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  return once(child, 'close').then(([code]) => { assert.equal(code, 0, stderr); return JSON.parse(stdout.trim().split('\n').at(-1)); });
}
async function barrier(statement) {
  const child = spawn('docker', ['exec', '-i', targetContainer, 'psql', '-XqAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise((resolve, reject) => { lines.on('line', line => { if (line === 'barrier') resolve(); }); child.once('exit', () => reject(Error('T06 barrier exited'))); });
  child.stdin.write(`begin; ${statement}; select 'barrier';\n`); await ready;
  return async () => { const done = once(child, 'exit'); child.stdin.end('rollback;\n'); await done; };
}
async function completed(id) {
  for (let i = 0; i < 600; i++) {
    const row = await taskRow(id);
    if (['completed', 'blocked', 'failed'].includes(row.status)) { assert.equal(row.status, 'completed', JSON.stringify(row.last_result)); return row; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('T06 completion timeout');
}
async function verify(id, before) {
  const row = await completed(id), attempts = await runs(id);
  assert.equal(row.attempt, 1); assert.deepEqual(attempts.map(r => [r.attempt, r.status]), [[0, 'completed']]);
  assert.equal(row.lease_token, null); assert.ok(attempts[0].lease_token);
  for (const key of ['executor', 'media', 'output', 'input_artifacts']) assert.deepEqual(row.input_snapshot[key], before.input_snapshot[key]);
  const artifacts = await unwrap(admin.from('artifacts').select('*').eq('producer_task_id', id));
  assert.equal(artifacts.length, 1); assert.equal(artifacts[0].episode_id, episode);
  const bytes = readFileSync(join(root, artifacts[0].relative_path)); assert.equal(digest(bytes), artifacts[0].sha256); assert.equal(bytes.length, artifacts[0].file_size);
  assert.equal((await status(id)).status, 'succeeded');
  return { taskId: id, attempts: attempts.length, artifact: { relativePath: artifacts[0].relative_path, sha256: artifacts[0].sha256, fileSize: bytes.length } };
}

// Preserve every pre-existing task byte-for-byte while running a genuine global tick.
const preserved = sql('select coalesce(jsonb_agg(to_jsonb(t) order by id),\'[]\') from tasks t', targetContainer);
const task = await newTask('http-and-timer'), before = await taskRow(task);
const releaseOthers = await barrier(`select id from public.tasks where episode_id <> ${quote(episode)} for update`);
const evidence = [];
try {
  const holder = await newTask('capacity-holder');
  const held = (await unwrap(admin.rpc('claim_next_worker_task', { p_task_id: holder, p_worker_capacity: 1 })))[0]; assert.ok(held);
  const started = performance.now(), queued = await post(task);
  assert.equal(queued.status, 202); assert.equal((await queued.json()).status, 'queued');
  const responseMs = performance.now() - started;
  assert.ok(responseMs < 2000, `HTTP submission took ${responseMs}ms`);
  // This independent invocation observes the full group and must leave the task durable.
  const capacityResult = await tick(['--task-id', task]);
  assert.equal(capacityResult.workers[0].status, 'idle'); assert.equal((await taskRow(task)).attempt, 0); assert.equal((await status(task)).status, 'queued'); assert.equal((await runs(task)).length, 0);
  await unwrap(admin.rpc('report_worker_result', { p_task_id: holder, p_attempt: held.attempt, p_lease_token: held.lease_token, p_result: { version: 'worker-result/v1', taskId: holder, status: 'failed', artifacts: [], validation: { passed: false, checks: [] }, actualCostCents: 0, blockers: [], retry: { shouldRetry: false, reason: 'Synthetic capacity holder released without execution.' }, nextStep: 'Run the queued T06 task.' } }));
  const releaseClaims = await barrier("select pg_advisory_xact_lock(hashtextextended('loop-worker-lease-recovery',0))");
  let timer;
  try {
    const replies = await Promise.all(Array.from({ length: 5 }, () => post(task)));
    for (const reply of replies) { assert.equal(reply.status, 202); assert.equal((await reply.json()).taskId, task); }
    // First establish an HTTP waiter before starting the timer. Otherwise the
    // timer's own two parallel consumers could satisfy a two-waiter assertion.
    const waitingClaims = () => Number(sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%claim_next_worker_task%'", targetContainer));
    let httpWaiting = false;
    for (let i = 0; i < 600; i++) {
      if (waitingClaims() >= 1) { httpWaiting = true; break; }
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(httpWaiting, 'HTTP worker must be observed waiting before the scheduled CLI starts');
    timer = tick();
    // Now a second waiter proves overlap between the two entry points.
    let waiters = 0;
    for (let i = 0; i < 600; i++) {
      waiters = Number(sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%claim_next_worker_task%'", targetContainer));
      if (waiters >= 2) break; await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(waiters >= 2, 'HTTP and scheduled worker claims must really overlap');
  } finally { await releaseClaims(); }
  await timer;
  evidence.push({ path: 'HTTP duplicates + real global scheduled CLI', responseMs, capacityWaitPreserved: true, concurrentClaimsObserved: true, ...await verify(task, before) });
  const repeated = await post(task); assert.equal(repeated.status, 200); assert.equal((await repeated.json()).status, 'succeeded'); assert.equal((await runs(task)).length, 1);
  const episodeTask = await newTask('episode-entry'), episodeBefore = await taskRow(episodeTask);
  await tick(['--episode', episode]);
  evidence.push({ path: 'Episode entry consumes existing task with empty planner result', ...await verify(episodeTask, episodeBefore) });
  // A genuine service restart must not lose terminal task state.
  await stopTargetConsole();
  if (!process.argv.includes('--worker')) process.argv.push('--worker');
  await startTargetConsole();
  assert.equal((await status(task)).status, 'succeeded');
} finally { await releaseOthers(); }
assert.equal(sql(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tasks t where episode_id <> ${quote(episode)}`, targetContainer), preserved);
const result = { checkedAt: new Date().toISOString(), target: targetId, episodeId: episode, execution: 'ordinary T06 HTTP middleware and shared dispatcher; real Worker CLI, DB and FFmpeg', tasks: evidence, serviceRestartStatusPersisted: true, existingTasksUnchanged: true, providerCalls: false };
writePrivateFile(join(c.stateRoot, 't06-queue-entry.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
