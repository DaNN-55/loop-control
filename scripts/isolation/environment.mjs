import { existsSync, realpathSync, readFileSync, mkdirSync, writeFileSync, lstatSync, openSync, closeSync, constants, fstatSync, ftruncateSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
export const projectRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
export const configPath = join(projectRoot, '.loop-control/isolation.json');
// Infrastructure identity stays fixed even when an application child re-enters these scripts with a private HOME.
export const hostHome = realpathSync(userInfo().homedir);
export const dockerHost = `unix://${hostHome}/.colima/loop-stage-a/docker.sock`;
export const projectId = 'loop-control-stage-a';
export const ports = { console: 55173, api: 55431, database: 55432, shadow: 55430 };
export function primaryRoot(root = projectRoot) {
    const list = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
    return realpathSync(list.split('\n')[0].slice('worktree '.length));
}
export function inside(root, path) {
    const rel = relative(realpathSync(root), realpathSync(path));
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
export function validateConfiguration(config, root = projectRoot, protectedRoot = primaryRoot(root)) {
    if (root === protectedRoot)
        throw new Error('隔离命令拒绝在主工作区运行。');
    if (config?.version !== 1 || config.purpose !== 'stage-a-isolated' || config.projectRoot !== realpathSync(root))
        throw new Error('缺少有效的独立工作树配置。');
    const runtime = join(root, '.loop-control/stage-a');
    for (const [key, expected] of Object.entries({ runtimeRoot: runtime, mediaRoot: join(runtime, 'media'), logsRoot: join(runtime, 'logs'), stateRoot: join(runtime, 'state') })) {
        if (config[key] !== expected || !existsSync(expected) || !inside(root, expected) || inside(protectedRoot, expected))
            throw new Error(`隔离目录无效或指向生产：${key}`);
        // Reject symlinks even when their current target happens to be inside this tree.
        if (realpathSync(expected) !== expected)
            throw new Error(`隔离目录不能经符号链接：${key}`);
    }
    if (config.projectId !== projectId || config.dockerHost !== dockerHost)
        throw new Error('测试数据库实例身份不匹配。');
    if (JSON.stringify(config.ports) !== JSON.stringify(ports))
        throw new Error('隔离端口缺失或与保留端口不符。');
    if (config.apiUrl !== `http://127.0.0.1:${ports.api}` || config.databaseUrl !== `postgresql://postgres:postgres@127.0.0.1:${ports.database}/postgres`)
        throw new Error('只允许专用本机测试数据库。');
    for (const key of ['anonKey', 'serviceRoleKey']) {
        const payload = (() => {
            try {
                return JSON.parse(Buffer.from(config[key].split('.')[1], 'base64url').toString());
            }
            catch {
                return null;
            }
        })();
        if (payload?.iss !== 'supabase-demo' || payload.role !== (key === 'anonKey' ? 'anon' : 'service_role'))
            throw new Error('拒绝非独立测试凭据。');
    }
    return config;
}
export function readConfiguration(path = configPath) {
    if (!existsSync(path))
        throw new Error('缺少隔离配置；先启动专用数据库并执行 npm run isolated:init。');
    assertPrivatePath(path);
    return validateConfiguration(JSON.parse(readFileSync(path, 'utf8')));
}
export function cleanEnvironment(config) {
    // Deliberate allowlist: never inherit provider tokens, remote URLs, worker settings or NODE_OPTIONS.
    const env = toolEnvironment(config.projectRoot);
    const tmp = join(config.stateRoot, 'tmp');
    ensurePrivateDirectory(tmp, config.projectRoot);
    const renderer = join(config.runtimeRoot, 'OpenChatCut');
    if (existsSync(renderer) && (!inside(config.runtimeRoot, renderer) || realpathSync(renderer) !== renderer))
        throw new Error('渲染运行时必须是隔离副本。');
    return { ...env, TMPDIR: tmp, ...(existsSync(renderer) ? { OPENCHATCUT_ROOT: renderer, OPENCHATCUT_NODE: process.execPath } : {}), DOCKER_HOST: config.dockerHost, VITE_SUPABASE_URL: config.apiUrl, VITE_SUPABASE_PUBLISHABLE_KEY: config.anonKey, SUPABASE_URL: config.apiUrl, SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey, MEDIA_LIBRARY_MOUNT_PATH: config.mediaRoot, MEDIA_LIBRARY_MIN_FREE_BYTES: '0', CODEX_WORKER_ACTUAL_COST_CENTS: '0', LOOP_CONTROL_ISOLATED_MEDIA_ROOT: config.mediaRoot, LOOP_CONTROL_SERVICE_RECORD: join(config.stateRoot, 'services.json'), N8N_PORT: '55437', N8N_RUNNERS_BROKER_PORT: '55436' };
}
export function initializeConfiguration() {
    if (projectRoot === primaryRoot())
        throw new Error('拒绝在主工作区初始化。');
    assertPrivatePath(configPath);
    assertStackConfiguration();
    if (existsSync(configPath))
        throw new Error('隔离配置已存在；不覆盖。');
    const status = execFileSync(join(projectRoot, 'node_modules/.bin/supabase'), ['--workdir', join(projectRoot, '.loop-control/stack'), 'status', '-o', 'env'], { cwd: projectRoot, env: { ...toolEnvironment(), DOCKER_HOST: dockerHost }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const values = Object.fromEntries(status.split('\n').flatMap(line => { const m = /^([A-Z_]+)="(.*)"$/.exec(line); return m ? [[m[1], m[2]]] : []; }));
    const runtimeRoot = join(projectRoot, '.loop-control/stage-a');
    for (const name of ['media', 'logs', 'state'])
        ensurePrivateDirectory(join(runtimeRoot, name));
    const config = { version: 1, purpose: 'stage-a-isolated', projectRoot, projectId, dockerHost, ports, runtimeRoot, mediaRoot: join(runtimeRoot, 'media'), logsRoot: join(runtimeRoot, 'logs'), stateRoot: join(runtimeRoot, 'state'), apiUrl: values.API_URL, databaseUrl: values.DB_URL, anonKey: values.ANON_KEY, serviceRoleKey: values.SERVICE_ROLE_KEY };
    validateConfiguration(config);
    writePrivateFile(configPath, JSON.stringify(config, null, 2) + '\n', { exclusive: true });
    return config;
}
export function workerEnvironment(config) {
    const values = cleanEnvironment(config);
    return Object.entries(values).filter(([key]) => !['PATH', 'USER', 'LANG', 'LC_ALL', 'SHELL'].includes(key)).map(([key, value]) => {
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') {
            if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error('测试 JWT 必须为 shell 安全的原始值。');
            return `${key}=${value}`; // Also consumed by the existing line-based HTTP reader.
        }
        return key + "='" + String(value).replaceAll("'", "'\\''") + "'";
    }).join('\n') + '\n';
}
export function assertPrivatePath(path, root = projectRoot) {
    const target = resolve(path);
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel))
        throw new Error('隔离路径离开工作树。');
    let parent = target;
    while (true) {
        try {
            if (lstatSync(parent).isSymbolicLink()) throw new Error('隔离路径不能经符号链接。');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        if (parent === root) break;
        parent = dirname(parent);
    }
    return target;
}
export function ensurePrivateDirectory(path, root = projectRoot) {
    assertPrivatePath(path, root);
    mkdirSync(path, { recursive: true });
    assertPrivatePath(path, root);
}
// O_NOFOLLOW closes the leaf replacement race after the lstat check. Parent directories
// remain owned by this local user; this is not a sandbox against a malicious same-UID process.
export function openPrivateFile(path, { append = false, exclusive = false, root = projectRoot } = {}) {
    assertPrivatePath(path, root);
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (append ? constants.O_APPEND : 0) | (exclusive ? constants.O_EXCL : 0);
    const fd = openSync(path, flags, 0o600);
    try {
        const info = fstatSync(fd);
        if (!info.isFile() || info.nlink !== 1) throw new Error('隔离输出必须是独立普通文件。');
        return fd;
    } catch (error) { closeSync(fd); throw error; }
}
export function writePrivateFile(path, content, options = {}) {
    const fd = openPrivateFile(path, options);
    try { ftruncateSync(fd, 0); writeFileSync(fd, content); }
    finally { closeSync(fd); }
}
export function toolEnvironment(root = projectRoot) {
    const state = join(root, '.loop-control/stage-a/state');
    const home = join(state, 'home');
    const locations = { HOME: home, CODEX_HOME: join(home, '.codex'), XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'), TMPDIR: join(state, 'tmp') };
    for (const path of Object.values(locations)) ensurePrivateDirectory(path, root);
    const npmrc = join(home, '.npmrc'), gitconfig = join(home, '.gitconfig');
    for (const path of [npmrc, gitconfig]) {
        assertPrivatePath(path, root);
        if (!existsSync(path)) writePrivateFile(path, '', { root, exclusive: true });
    }
    return { ...Object.fromEntries(['PATH', 'USER', 'LANG', 'LC_ALL', 'SHELL'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : [])), ...locations, NPM_CONFIG_USERCONFIG: npmrc, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' };
}
export function assertStackConfiguration() {
    const stack = join(projectRoot, '.loop-control/stack');
    assertPrivatePath(stack);
    const path = join(stack, 'supabase/config.toml');
    assertPrivatePath(path);
    if (readFileSync(path, 'utf8') !== readFileSync(join(projectRoot, 'scripts/isolation/supabase.toml'), 'utf8'))
        throw new Error('测试栈配置与隔离模板不符。');
    if (existsSync(join(stack, 'supabase/.temp/project-ref')))
        throw new Error('隔离栈不能关联云项目。');
    return stack;
}
export function assertLoopbackListeners(listeners) {
    if (!listeners.length || listeners.some(binding => !['127.0.0.1', '[::1]'].includes(binding.hostIp)))
        throw new Error('隔离数据库端口必须仅绑定本机。');
    return listeners;
}
