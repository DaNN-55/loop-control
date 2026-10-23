import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, rmSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { inspectRecordedService } from '../local-service-record.mjs';
import { projectRoot, assertPrivatePath, hostHome, openPrivateFile, writePrivateFile } from './environment.mjs';
const sshConfig = join(hostHome, '.colima/_lima/colima-loop-stage-a/ssh.config');
const recordPath = join(projectRoot, '.loop-control/stack/tunnel.json');
function verified(record) { return record?.projectRoot === projectRoot && [55431, 55432].every(port => inspectRecordedService({ pid: record.pid, port: String(port), commandIdentity: sshConfig }, projectRoot).valid); }
export async function startTunnel(env) {
    assertPrivatePath(recordPath);
    if (existsSync(recordPath)) {
        const record = JSON.parse(readFileSync(recordPath, 'utf8'));
        if (verified(record))
            return record;
        throw new Error('隧道记录已失效，先核对/移除本次旧记录。');
    }
    const profile = readFileSync(join(hostHome, '.colima/loop-stage-a/colima.yaml'), 'utf8');
    if (!/^portForwarder: none$/m.test(profile))
        throw new Error('专用Colima必须使用portForwarder: none，拒绝默认全网卡转发。');
    const log = openPrivateFile(join(projectRoot, '.loop-control/stack/tunnel.log'), { append: true });
    const child = spawn('ssh', ['-F', sshConfig, '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ExitOnForwardFailure=yes', '-N', '-L', '127.0.0.1:55431:127.0.0.1:55431', '-L', '127.0.0.1:55432:127.0.0.1:55432', 'lima-colima-loop-stage-a'], { cwd: projectRoot, env, detached: true, stdio: ['ignore', log, log] });
    try {
        await once(child, 'spawn');
        closeSync(log);
        const record = { pid: child.pid, projectRoot };
        for (let i = 0; i < 40; i++) {
            if (verified(record)) {
                writePrivateFile(recordPath, JSON.stringify(record) + '\n', { exclusive: true });
                child.unref();
                return record;
            }
            if (child.exitCode !== null)
                break;
            await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('本机专用隧道启动失败；检查独立日志和端口占用。');
    }
    catch (error) {
        child.kill('SIGTERM');
        throw error;
    }
}
export function stopTunnel() {
    assertPrivatePath(recordPath);
    if (!existsSync(recordPath))
        return;
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    if (verified(record))
        process.kill(record.pid, 'SIGTERM');
    else
        throw new Error('隧道身份不匹配，未发送信号。');
    rmSync(recordPath);
}
