import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { readConfiguration, cleanEnvironment, projectRoot, ports, writePrivateFile } from './environment.mjs';
const config = readConfiguration(), env = cleanEnvironment(config);
function productionListeners() {
    try {
        return execFileSync('lsof', ['-nP', '-iTCP:5173', '-iTCP:5678', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split(/\s+/).sort();
    }
    catch {
        return [];
    }
}
function command(action) { execFileSync(process.execPath, [join(projectRoot, 'scripts/isolation/run.mjs'), action], { cwd: projectRoot, env, stdio: 'pipe' }); }
const before = productionListeners();
command('stop');
await assert.rejects(fetch(`http://127.0.0.1:${ports.console}/loop-control-health.txt`));
const sentinel = spawn(process.execPath, ['-e', "require('node:http').createServer((q,s)=>s.end('sentinel')).listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
try {
    const [data] = await Promise.race([once(sentinel.stdout, 'data'), once(sentinel, 'exit').then(() => { throw new Error('哨兵启动失败'); })]);
    const sentinelPort = Number(String(data).trim());
    writePrivateFile(join(config.stateRoot, 'console.json'), JSON.stringify({ pid: sentinel.pid, projectRoot, port: ports.console }) + '\n');
    command('stop');
    assert.equal(await (await fetch(`http://127.0.0.1:${sentinelPort}`)).text(), 'sentinel');
}
finally {
    sentinel.kill('SIGTERM');
    await once(sentinel, 'exit');
}
command('start');
assert.equal(await (await fetch(`http://127.0.0.1:${ports.console}/loop-control-health.txt`)).text(), 'loop-control-console-v1\n');
const after = productionListeners();
assert.deepEqual(after, before);
const result = { checkedAt: new Date().toISOString(), consoleStops: true, consoleRestarts: true, foreignPidSkipped: true, productionPidsBefore: before, productionPidsAfter: after, note: 'foreign PID is our own sentinel, never a production process; original production listeners only read' };
writePrivateFile(join(config.stateRoot, 'lifecycle.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
