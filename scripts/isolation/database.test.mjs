// @vitest-environment node
import { test, vi, afterEach } from 'vitest';
import assert from 'node:assert/strict';
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), run: vi.fn(), stop: vi.fn(), start: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.inspect, spawnSync: mocks.run }));
vi.mock('./tunnel.mjs', () => ({ stopTunnel: mocks.stop, startTunnel: mocks.start }));
vi.mock('./environment.mjs', () => ({ projectRoot: '/isolated', primaryRoot: () => '/production', dockerHost: 'unix:///isolated.sock', projectId: 'loop-control-stage-a', assertPrivatePath: () => {}, ensurePrivateDirectory: () => {}, assertStackConfiguration: () => {}, toolEnvironment: () => ({}), assertLoopbackListeners: () => {} }));
const argv = process.argv.slice();
afterEach(() => { process.argv = argv.slice(); process.exitCode = 0; vi.resetAllMocks(); vi.resetModules(); });
test('stop cleans the owned tunnel even when Docker inspect fails', async () => {
    process.argv = [...argv.slice(0, 2), 'stop'];
    mocks.inspect.mockImplementation(() => { throw new Error('No such object: supabase_db_loop-control-stage-a'); });
    await import('./database.mjs').catch(() => {});
    assert.equal(mocks.stop.mock.calls.length, 1);
    assert.equal(mocks.run.mock.calls.length, 0);
});
test('stop never mutates a mismatched container but still invokes verified tunnel cleanup', async () => {
    process.argv = [...argv.slice(0, 2), 'stop'];
    mocks.inspect.mockReturnValue(JSON.stringify([{ Config: { Labels: { 'com.supabase.cli.project': 'other-project' } } }]));
    await assert.rejects(import('./database.mjs'), /身份不匹配/);
    assert.equal(mocks.stop.mock.calls.length, 1); assert.equal(mocks.run.mock.calls.length, 0);
});
test.each([1, null])('stop cleans tunnel when CLI exits with %s', async status => {
    process.argv = [...argv.slice(0, 2), 'stop'];
    mocks.inspect.mockReturnValue(JSON.stringify([{ Config: { Labels: { 'com.supabase.cli.project': 'loop-control-stage-a' } } }]));
    mocks.run.mockReturnValue({ status });
    await import('./database.mjs');
    assert.equal(mocks.stop.mock.calls.length, 1); assert.equal(process.exitCode, 1);
});
test('status inspect failure leaves running tunnel alone', async () => {
    process.argv = [...argv.slice(0, 2), 'status'];
    mocks.inspect.mockImplementation(() => { throw new Error('Docker unavailable'); });
    await assert.rejects(import('./database.mjs'), /Docker unavailable/);
    assert.equal(mocks.stop.mock.calls.length, 0);
});
