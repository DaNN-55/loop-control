import { once } from 'node:events';
import { closeSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { projectRoot, readConfiguration, initializeConfiguration, cleanEnvironment, workerEnvironment, ports, assertPrivatePath, openPrivateFile, writePrivateFile } from './environment.mjs';
export function inspectConsole(record, config) {
    try {
        process.kill(record.pid, 0);
        const command = execFileSync('ps', ['-o', 'command=', '-p', String(record.pid)], { encoding: 'utf8' });
        const cwd = execFileSync('lsof', ['-a', '-p', String(record.pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
        const listeners = execFileSync('lsof', ['-nP', '-a', '-p', String(record.pid), `-iTCP:${config.ports.console}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split(/\s+/);
        return listeners.includes(String(record.pid)) && record.projectRoot === projectRoot && command.includes(join(projectRoot, 'node_modules/vite/bin/vite.js')) && cwd.split('\n').includes(`n${projectRoot}`) && record.port === config.ports.console;
    }
    catch {
        return false;
    }
}
async function available(port) { return new Promise((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve)); }); }
const action = process.argv[2];
try {
    if (action === 'init') {
        initializeConfiguration();
        console.log('已创建独立测试配置（未读取生产凭据）。');
    }
    else {
        const config = readConfiguration();
        const recordPath = join(config.stateRoot, 'console.json');
        assertPrivatePath(recordPath);
        const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : null;
        if (action === 'start') {
            if (record && inspectConsole(record, config))
                throw new Error('隔离控制台已运行。');
            await available(ports.console); // Strict port: never reuse a different project's listener.
            const { createClient } = await import('@supabase/supabase-js');
            const db = createClient(config.apiUrl, config.serviceRoleKey, { auth: { persistSession: false } });
            const { data, error } = await db.from('account_blueprint_versions').select('policy');
            if (error)
                throw error;
            const { inside } = await import('./environment.mjs');
            for (const row of data ?? [])
                if (row.policy?.asset_root && (!existsSync(row.policy.asset_root) || !inside(config.mediaRoot, row.policy.asset_root)))
                    throw new Error('测试蓝图指向隔离媒体目录以外。');
            if (existsSync(join(projectRoot, '.env.local')))
                throw new Error('隔离树不能存在.env.local回退环境文件。');
            const workerPath = join(projectRoot, 'n8n/worker.env.local');
            assertPrivatePath(workerPath);
            const expectedWorker = workerEnvironment(config);
            if (existsSync(workerPath) && readFileSync(workerPath, 'utf8') !== expectedWorker)
                throw new Error('Worker配置与隔离配置不符；拒绝覆盖。');
            if (!existsSync(workerPath))
                writePrivateFile(workerPath, expectedWorker, { exclusive: true });
            const log = openPrivateFile(join(config.logsRoot, 'console.log'), { append: true });
            const child = spawn(process.execPath, [join(projectRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(ports.console), '--strictPort'], { cwd: projectRoot, env: cleanEnvironment(config), detached: true, stdio: ['ignore', log, log] });
            await once(child, 'spawn');
            closeSync(log);
            writePrivateFile(recordPath, JSON.stringify({ pid: child.pid, projectRoot, port: ports.console }, null, 2) + '\n');
            child.unref();
            let ready = false;
            for (let i = 0; i < 80; i++) {
                try {
                    const r = await fetch(`http://127.0.0.1:${ports.console}/loop-control-health.txt`);
                    if (r.ok && (await r.text()).trim() === 'loop-control-console-v1') {
                        ready = true;
                        break;
                    }
                }
                catch { }
                await new Promise(r => setTimeout(r, 250));
            }
            if (!ready) {
                child.kill('SIGTERM');
                rmSync(recordPath, { force: true });
                throw new Error('隔离控制台启动失败；查看独立日志。');
            }
            console.log(`隔离控制台：http://127.0.0.1:${ports.console}/（PID ${child.pid}）`);
        }
        else if (action === 'stop') {
            if (record && inspectConsole(record, config)) {
                process.kill(record.pid, 'SIGTERM');
                for (let i = 0; i < 40 && inspectConsole(record, config); i++)
                    await new Promise(r => setTimeout(r, 100));
                if (inspectConsole(record, config))
                    throw new Error('进程未退出，保留记录。');
                console.log('已停止本工作树的隔离控制台。');
            }
            else
                console.log('没有身份匹配的隔离控制台；未发送信号。');
            rmSync(recordPath, { force: true });
        }
        else if (action === 'test') {
            const result = spawnSync('npm', ['test'], { cwd: projectRoot, env: cleanEnvironment(config), stdio: 'inherit' });
            process.exitCode = result.status ?? 1;
        }
        else if (action === 'status')
            console.log(JSON.stringify({ running: !!record && inspectConsole(record, config), consolePort: ports.console, projectRoot }, null, 2));
        else
            throw new Error('用法：node scripts/isolation/run.mjs init|start|stop|status|test');
    }
}
catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
