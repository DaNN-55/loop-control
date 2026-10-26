// @vitest-environment node
import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cleanEnvironment, workerEnvironment, assertPrivatePath } from './environment.mjs';
const fixtures = [];
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'loop-regressions-'))); fixtures.push(root);
    const runtimeRoot = join(root, '.loop-control/stage-a'), stateRoot = join(runtimeRoot, 'state');
    mkdirSync(stateRoot, { recursive: true });
    return { root, config: { projectRoot: root, runtimeRoot, stateRoot, mediaRoot: join(runtimeRoot, 'media'), apiUrl: 'http://127.0.0.1:55431', anonKey: 'test.anon.test', serviceRoleKey: 'test.service-role.test', dockerHost: 'unix:///test/docker.sock' } };
}
test('generated service key remains a bare JWT for the existing HTTP reader and shell', () => {
    const { config } = fixture(), contents = workerEnvironment(config);
    // Exact reader contract in localWorkerServiceRoleKey(), plus the actual worker shell parser.
    assert.equal(contents.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim(), config.serviceRoleKey);
    const shell = execFileSync('/bin/zsh', ['-f', '-c', 'source /dev/stdin; print -rn -- "$SUPABASE_SERVICE_ROLE_KEY"'], { input: contents, encoding: 'utf8' });
    assert.equal(shell, config.serviceRoleKey);
});
test('application and worker redirect HOME and inherited config locations before spawning', () => {
    const { root, config } = fixture();
    const names = ['CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'NPM_CONFIG_USERCONFIG', 'GIT_CONFIG_GLOBAL'];
    const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
    try {
        for (const key of names) process.env[key] = '/outside/host-config';
        const env = cleanEnvironment(config);
        assert.equal(env.HOME, join(config.stateRoot, 'home'));
        for (const key of names) assert.ok(env[key]?.startsWith(root + '/'), key);
        const result = JSON.parse(execFileSync(process.execPath, ['-e', "const fs=require('node:fs'),os=require('node:os'),path=require('node:path'); console.log(JSON.stringify({home:os.homedir(),codex:process.env.CODEX_HOME,hostAuth:fs.existsSync(path.join(os.homedir(),'.codex','auth.json'))}))"], { env, encoding: 'utf8' }));
        assert.equal(result.home, env.HOME); assert.equal(result.codex, env.CODEX_HOME); assert.equal(result.hostAuth, false);
        assert.match(workerEnvironment(config), /^HOME=/m);
    } finally { for (const key of names) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
});
test.each(['console.log', 'console.json', 'worker.env.local', 'tunnel.log', 'tunnel.json'])('reject dangling leaf %s before any write', name => {
    const { root } = fixture(), foreign = join(root, 'foreign-target'), leaf = join(root, name);
    symlinkSync(foreign, leaf);
    assert.throws(() => { assertPrivatePath(leaf, root); writeFileSync(leaf, 'must-not-write'); }, /符号链接/);
    assert.equal(existsSync(foreign), false);
});
test('private writer rejects linked files and preserves the existing outside target', async () => {
    const { openPrivateFile, writePrivateFile } = await import('./environment.mjs');
    const { root } = fixture(), outside = join(root, 'outside'); mkdirSync(outside);
    const target = join(outside, 'sentinel'); writeFileSync(target, 'unchanged');
    for (const name of ['console.log', 'console.json', 'worker.env.local', 'tunnel.log', 'tunnel.json']) {
        const leaf = join(root, name); symlinkSync(target, leaf);
        assert.throws(() => writePrivateFile(leaf, 'overwrite', { root }), /符号链接/);
        assert.throws(() => openPrivateFile(leaf, { append: true, root }), /符号链接/);
    }
    assert.equal(readFileSync(target, 'utf8'), 'unchanged');
});
test('private writer truncates owned records, supports exclusive creation and refuses hard links', async () => {
    const { writePrivateFile } = await import('./environment.mjs');
    const { linkSync } = await import('node:fs');
    const { root } = fixture(), path = join(root, 'record');
    writePrivateFile(path, 'long-old-record', { root, exclusive: true });
    writePrivateFile(path, 'new', { root }); assert.equal(readFileSync(path, 'utf8'), 'new');
    assert.throws(() => writePrivateFile(path, 'bad', { root, exclusive: true }));
    linkSync(path, join(root, 'linked-record'));
    assert.throws(() => writePrivateFile(path, 'bad', { root }), /独立普通文件/);
    assert.equal(readFileSync(path, 'utf8'), 'new');
});
test('worker shell explicitly overrides inherited HOME and config paths', () => {
    const { config } = fixture();
    const result = JSON.parse(execFileSync('/bin/zsh', ['-f', '-c', 'set -a; source /dev/stdin; set +a; exec "$LOOP_TEST_NODE" -e \'console.log(JSON.stringify({home:process.env.HOME,codex:process.env.CODEX_HOME}))\''], { input: workerEnvironment(config), env: { PATH: process.env.PATH, HOME: '/outside/home', CODEX_HOME: '/outside/codex', LOOP_TEST_NODE: process.execPath }, encoding: 'utf8' }));
    assert.equal(result.home, join(config.stateRoot, 'home')); assert.equal(result.codex, join(config.stateRoot, 'home/.codex'));
});
