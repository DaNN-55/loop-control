import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfiguration, cleanEnvironment, readConfiguration, dockerHost, projectId, ports, ensurePrivateDirectory, assertLoopbackListeners } from './environment.mjs';
function fixture() {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'loop-isolation-')));
    const root = join(base, 'test'), prod = join(base, 'production');
    mkdirSync(prod);
    mkdirSync(root);
    const runtimeRoot = join(root, '.loop-control/stage-a');
    for (const x of ['media', 'logs', 'state'])
        mkdirSync(join(runtimeRoot, x), { recursive: true });
    const key = role => `test.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role })).toString('base64url')}.test`;
    return { base, root, prod, config: { version: 1, purpose: 'stage-a-isolated', projectRoot: root, projectId, dockerHost, ports: { ...ports }, runtimeRoot, mediaRoot: join(runtimeRoot, 'media'), logsRoot: join(runtimeRoot, 'logs'), stateRoot: join(runtimeRoot, 'state'), apiUrl: `http://127.0.0.1:${ports.api}`, databaseUrl: `postgresql://postgres:postgres@127.0.0.1:${ports.database}/postgres`, anonKey: key('anon'), serviceRoleKey: key('service_role') } };
}
function withFixture(fn) {
    const f = fixture();
    try {
        fn(f);
    }
    finally {
        rmSync(f.base, { recursive: true, force: true });
    }
}
test('missing configuration refuses before any network/process action', () => assert.throws(() => readConfiguration('/nonexistent/loop-isolation-config'), /缺少隔离配置/));
test('explicit independent configuration accepted', () => withFixture(f => assert.equal(validateConfiguration(f.config, f.root, f.prod), f.config)));
for (const [name, change] of [
    ['production root', f => { f.config.projectRoot = f.prod; }],
    ['production media', f => { f.config.mediaRoot = f.prod; }],
    ['remote database', f => { f.config.apiUrl = 'https://production.supabase.co'; }],
    ['production database port', f => { f.config.databaseUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'; }],
    ['missing port', f => { delete f.config.ports.console; }],
    ['default Docker socket', f => { f.config.dockerHost = 'unix:///var/run/docker.sock'; }],
    ['non-demo credential', f => { f.config.serviceRoleKey = 'production-key'; }],
    ['symlink escape', f => { rmSync(f.config.mediaRoot, { recursive: true }); symlinkSync(f.prod, f.config.mediaRoot); }],
])
    test(`reject ${name}`, () => withFixture(f => { change(f); assert.throws(() => validateConfiguration(f.config, f.root, f.prod)); }));
test('cannot initialize in primary checkout', () => withFixture(f => assert.throws(() => validateConfiguration(f.config, f.root, f.root), /主工作区/)));
test('child environment drops inherited provider secrets and redirects runtime resources', () => withFixture(f => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'should-not-leak';
    try {
        const env = cleanEnvironment(f.config);
        assert.equal(env.OPENAI_API_KEY, undefined);
        assert.equal(env.SUPABASE_URL, f.config.apiUrl);
        assert.equal(env.MEDIA_LIBRARY_MOUNT_PATH, f.config.mediaRoot);
        assert.equal(env.NODE_OPTIONS, undefined);
    }
    finally {
        if (prev === undefined)
            delete process.env.OPENAI_API_KEY;
        else
            process.env.OPENAI_API_KEY = prev;
    }
}));
test('initialization refuses symlink ancestors before writing', () => withFixture(f => {
    const alias = join(f.root, 'escape');
    symlinkSync(f.prod, alias);
    assert.throws(() => ensurePrivateDirectory(join(alias, 'must-not-exist'), f.root), /符号链接/);
    assert.equal(existsSync(join(f.prod, 'must-not-exist')), false);
}));
test('database accepts local host listeners and rejects wildcard listeners', () => {
    assert.equal(assertLoopbackListeners([{ hostIp: '127.0.0.1', hostPort: '55432' }]).length, 1);
    assert.throws(() => assertLoopbackListeners([{ hostIp: '*', hostPort: '55432' }]), /仅绑定本机/);
});
