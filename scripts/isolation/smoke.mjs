import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { readConfiguration, ports, assertPrivatePath, writePrivateFile, ensurePrivateDirectory } from './environment.mjs';
const config = readConfiguration();
const admin = createClient(config.apiUrl, config.serviceRoleKey, { auth: { persistSession: false } });
const ownerPath = join(config.stateRoot, 'owner.json');
assertPrivatePath(ownerPath);
let owner;
if (existsSync(ownerPath))
    owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
else {
    owner = { email: 'stage-a@example.test', password: randomUUID() + randomUUID() };
    const { data, error } = await admin.auth.admin.createUser({ email: owner.email, password: owner.password, email_confirm: true });
    if (error)
        throw error;
    owner.id = data.user.id;
    writePrivateFile(ownerPath, JSON.stringify(owner) + '\n', { exclusive: true });
}
const client = createClient(config.apiUrl, config.anonKey, { auth: { persistSession: false } });
const { data: login, error: loginError } = await client.auth.signInWithPassword(owner);
if (loginError)
    throw loginError;
const ids = { account: 'a0000000-0000-4000-8000-000000000001', blueprint: 'a0000000-0000-4000-8000-000000000002', episode: 'a0000000-0000-4000-8000-000000000003', task: 'a0000000-0000-4000-8000-000000000004' };
const assetRoot = join(config.mediaRoot, 'smoke');
ensurePrivateDirectory(join(assetRoot, 'episodes', ids.episode));
async function upsert(table, row) {
    const { error } = await admin.from(table).upsert(row);
    if (error)
        throw new Error(`${table}: ${error.message}`);
}
await upsert('accounts', { id: ids.account, slug: 'stage-a-smoke', name: 'A阶段隔离测试', timezone: 'Asia/Shanghai' });
await upsert('account_blueprint_versions', { id: ids.blueprint, account_id: ids.account, version: 1, policy: { asset_root: assetRoot }, is_active: true });
await upsert('accounts', { id: ids.account, slug: 'stage-a-smoke', name: 'A阶段隔离测试', timezone: 'Asia/Shanghai', current_blueprint_version_id: ids.blueprint });
await upsert('account_memberships', { account_id: ids.account, user_id: owner.id, role: 'owner' });
await upsert('episodes', { id: ids.episode, account_id: ids.account, blueprint_version_id: ids.blueprint, title: 'Stage A synthetic smoke Episode', is_test: true });
await upsert('tasks', { id: ids.task, episode_id: ids.episode, task_type: 'draft_brief', status: 'ready', input_snapshot: { capability: 'brief_drafting' }, provider: 'codex', model: 'stage-a-no-execution', prompt_version: 'stage-a-v1', budget_limit_cents: 0, max_attempts: 1 });
const { data: episode, error } = await client.from('episodes').select('*').eq('id', ids.episode).single();
if (error)
    throw error;
assert.equal(episode.is_test, true);
const route = `http://127.0.0.1:${ports.console}/_episode-dispatch?episode=${ids.episode}&task=${ids.task}`;
const started = performance.now();
const response = await fetch(route, { headers: { authorization: `Bearer ${login.session.access_token}` } });
const body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.status, 'unknown');
const unauthenticated = await fetch(route);
assert.equal(unauthenticated.status, 400);
const { data: anonymous, error: anonymousError } = await createClient(config.apiUrl, config.anonKey, { auth: { persistSession: false } }).from('episodes').select('id').eq('id', ids.episode);
assert.ok(anonymousError?.code === '42501' || (anonymous && anonymous.length === 0));
const evidence = { version: 'stage-a-smoke/v1', checkedAt: new Date().toISOString(), ids, apiPort: ports.api, consolePort: ports.console, httpRead: { status: response.status, elapsedMs: performance.now() - started, body }, unauthenticatedStatus: unauthenticated.status, anonymousVisibleEpisodes: anonymous?.length ?? 0, anonymousError: anonymousError?.code ?? null, episode: { id: episode.id, title: episode.title, is_test: episode.is_test }, note: '真实Auth/PostgREST/RLS/本机HTTP读取；独立合成数据，未执行模型。' };
writePrivateFile(join(config.stateRoot, 'smoke.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
