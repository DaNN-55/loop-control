import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { projectRoot, primaryRoot, dockerHost, projectId, assertPrivatePath, ensurePrivateDirectory, assertStackConfiguration, toolEnvironment, assertLoopbackListeners, writePrivateFile } from './environment.mjs';
import { startTunnel, stopTunnel } from './tunnel.mjs';
if (projectRoot === primaryRoot())
    throw new Error('拒绝操作主工作区数据库。');
const action = process.argv[2];
if (!['prepare', 'start', 'stop', 'status'].includes(action))
    throw new Error('用法：database.mjs prepare|start|stop|status');
const stack = join(projectRoot, '.loop-control/stack');
assertPrivatePath(stack);
if (action === 'prepare') {
    if (existsSync(join(stack, 'supabase/config.toml')))
        throw new Error('已有测试数据库配置；拒绝覆盖。');
    ensurePrivateDirectory(join(stack, 'supabase'));
    writePrivateFile(join(stack, 'supabase/config.toml'), readFileSync(join(projectRoot, 'scripts/isolation/supabase.toml')), { exclusive: true });
    cpSync(join(projectRoot, 'supabase/migrations'), join(stack, 'supabase/migrations'), { recursive: true });
    console.log('已准备独立Supabase配置和原样历史迁移。');
}
else {
    assertStackConfiguration();
    const env = { ...toolEnvironment(), DOCKER_HOST: dockerHost };
    let tunnel, result;
    // Always clean our identity-verified tunnel on stop, including inspect/CLI failures.
    // Never proceed with a database mutation when inspect cannot establish identity.
    try {
        if (action !== 'start') {
            const containers = JSON.parse(execFileSync('docker', ['inspect', `supabase_db_${projectId}`], { env, encoding: 'utf8' }));
            if (containers[0]?.Config?.Labels?.['com.supabase.cli.project'] !== projectId)
                throw new Error('数据库容器身份不匹配。');
        }
        tunnel = action === 'start' ? await startTunnel(env) : null;
        const args = ['--workdir', stack, action];
        if (action === 'start')
            args.push('--exclude', 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor');
        result = spawnSync(join(projectRoot, 'node_modules/.bin/supabase'), args, { env, stdio: 'inherit' });
        process.exitCode = result.status ?? 1;
    } finally {
        if (action === 'stop' || (action === 'start' && result?.status !== 0)) stopTunnel();
    }
    if (action === 'start' && result.status === 0) {
        try {
            const lines = execFileSync('lsof', ['-nP', '-a', '-p', String(tunnel.pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' }).split('\n').filter(s => s.startsWith('n'));
            const listeners = lines.map(line => ({ hostIp: line.slice(1, line.lastIndexOf(':')), hostPort: line.slice(line.lastIndexOf(':') + 1) }));
            assertLoopbackListeners(listeners);
            if (listeners.length !== 2)
                throw new Error('专用隧道端口不完整。');
            console.log(JSON.stringify({ loopbackListeners: listeners }));
        }
        catch (error) {
            spawnSync(join(projectRoot, 'node_modules/.bin/supabase'), ['--workdir', stack, 'stop'], { env, stdio: 'ignore' });
            stopTunnel();
            throw error;
        }
    }
}
