// @vitest-environment node
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { workerEnvironment } from './environment.mjs';
const fixture = vi.hoisted(() => ({ contents: '' }));
vi.mock('node:fs', async original => {
    const fs = await original();
    return { ...fs, readFileSync: (path, ...args) => path === resolve('n8n/worker.env.local') ? fixture.contents : fs.readFileSync(path, ...args) };
});
import { localWorkerServiceRoleKey } from '../../src/local-control-plane/routes/handlers';
test('actual HTTP handler reader consumes the generated worker key without quotes', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'loop-reader-'))), runtimeRoot = join(root, '.loop-control/stage-a'), stateRoot = join(runtimeRoot, 'state');
    mkdirSync(stateRoot, { recursive: true });
    const config = { projectRoot: root, runtimeRoot, stateRoot, serviceRoleKey: 'test.service-role.test' };
    try { fixture.contents = workerEnvironment(config); assert.equal(localWorkerServiceRoleKey(), config.serviceRoleKey); }
    finally { rmSync(root, { recursive: true, force: true }); }
});
