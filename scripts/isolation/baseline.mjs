import { createClient } from '@supabase/supabase-js';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import os from 'node:os';
import { readConfiguration, cleanEnvironment, ports, projectRoot, assertPrivatePath, writePrivateFile, ensurePrivateDirectory } from './environment.mjs';
import { createWorkerTaskPackage } from '../../dist/worker/worker/contracts.js';
import { defaultShotCaptionContract } from '../../dist/worker/shotCaptions.js';
import { executeOpenChatCutRender } from '../../dist/worker/worker/openchatcutRenderer.js';
const run = promisify(execFile), config = readConfiguration(), env = cleanEnvironment(config);
for (const key of ['OPENCHATCUT_ROOT', 'OPENCHATCUT_NODE', 'TMPDIR'])
    if (env[key])
        process.env[key] = env[key];
const admin = createClient(config.apiUrl, config.serviceRoleKey, { auth: { persistSession: false } });
const owner = JSON.parse(await readFile(join(config.stateRoot, 'owner.json'), 'utf8'));
const client = createClient(config.apiUrl, config.anonKey, { auth: { persistSession: false } });
const { data: login, error: loginError } = await client.auth.signInWithPassword(owner);
if (loginError)
    throw loginError;
const headers = { authorization: `Bearer ${login.session.access_token}` };
const accountId = 'a0000000-0000-4000-8000-000000000001', blueprintId = 'a0000000-0000-4000-8000-000000000002';
const assetRoot = join(config.mediaRoot, 'smoke');
const consoleRecord = JSON.parse(await readFile(join(config.stateRoot, 'console.json'), 'utf8'));
const samples = [], resources = [];
const began = new Date().toISOString();
async function unwrap(promise) {
    const { data, error } = await promise;
    if (error)
        throw new Error(error.message);
    return data;
}
async function probe(path) { const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', path], { env }); const p = JSON.parse(stdout), video = p.streams.find(s => s.codec_type === 'video'); const black = await run('ffmpeg', ['-nostdin', '-v', 'info', '-i', path, '-vf', 'blackdetect=d=0.1:pix_th=0.02', '-an', '-f', 'null', '-'], { env }); return { durationSeconds: Number(p.format.duration), width: video.width, height: video.height, hasAudio: p.streams.some(s => s.codec_type === 'audio'), blackFrameCount: (black.stderr.match(/black_start:/g) || []).length }; }
async function artifact(path, type) { const content = await readFile(join(assetRoot, path)); return { artifactType: type, relativePath: path, sha256: createHash('sha256').update(content).digest('hex'), fileSize: content.length }; }
function resourceSample() {
    try {
        const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,%cpu=,rss='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
        const pids = new Set([process.pid, consoleRecord.pid]);
        for (let n = 0; n < 8; n++)
            for (const [pid, ppid] of rows)
                if (pids.has(ppid))
                    pids.add(pid);
        const active = rows.filter(([pid]) => pids.has(pid));
        resources.push({ at: new Date().toISOString(), processes: active.map(([pid, ppid, cpuPercent, rssKiB]) => ({ pid, ppid, cpuPercent, rssKiB })), rssKiB: active.reduce((n, r) => n + r[3], 0), cpuPercent: active.reduce((n, r) => n + r[2], 0) });
    }
    catch { }
}
async function bytes(root) {
    let total = 0;
    for (const e of await readdir(root, { withFileTypes: true })) {
        const p = join(root, e.name);
        total += e.isDirectory() ? await bytes(p) : e.isFile() ? (await stat(p)).size : 0;
    }
    return total;
}
async function pageWorkload(episode) {
    const requests = [];
    const measuredFetch = async (url, options) => { const start = performance.now(); const response = await fetch(url, options); const body = await response.clone().arrayBuffer(); requests.push({ method: options?.method || 'GET', path: new URL(url).pathname, status: response.status, bodyBytes: body.byteLength, elapsedMs: performance.now() - start }); return response; };
    const db = createClient(config.apiUrl, config.anonKey, { auth: { persistSession: false }, global: { headers, fetch: measuredFetch } });
    const t = performance.now();
    await unwrap(db.from('episodes').select('*').eq('id', episode).single());
    await Promise.all([
        db.from('account_blueprint_versions').select('*').eq('id', blueprintId).maybeSingle(), db.rpc('list_external_connection_versions', { p_connection_id: null }),
        ...['production_material_revisions', 'shot_preparation_drafts', 'storyboard_audio_selections', 'review_packages', 'artifacts', 'audio_tracks', 'tasks', 'state_transitions'].map(table => db.from(table).select('*').eq('episode_id', episode).order(table === 'shot_preparation_drafts' || table === 'storyboard_audio_selections' ? 'updated_at' : 'created_at', { ascending: false })),
    ].map(unwrap));
    const tasks = await unwrap(db.from('tasks').select('id').eq('episode_id', episode));
    if (tasks.length)
        await unwrap(db.from('task_runs').select('id,task_id,status,attempt,started_at,completed_at').in('task_id', tasks.map(t => t.id)).order('started_at', { ascending: false }));
    return { boundary: 'Episode detail HTTP workload; same tables, extra task-ID lookup recorded; not browser navigation', elapsedMs: performance.now() - t, requestCount: requests.length, responseBodyBytes: requests.reduce((n, r) => n + r.bodyBytes, 0), requests };
}
const diskBefore = await bytes(config.mediaRoot);
resourceSample();
// Idle host process footprint, same probe used during execution.
for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 500));
    resourceSample();
}
const sampler = setInterval(resourceSample, 500);
try {
    for (const shotCount of [1, 3]) {
        const episodeId = randomUUID();
        const episodeDir = join(assetRoot, 'episodes', episodeId);
        ensurePrivateDirectory(episodeDir);
        await unwrap(admin.from('episodes').insert({ id: episodeId, account_id: accountId, blueprint_version_id: blueprintId, title: `Stage A fixed ${shotCount}-shot`, is_test: true }));
        const tasks = [];
        for (let i = 0; i < shotCount; i++) {
            const sourcePath = `episodes/${episodeId}/source-${i}.mp4`, outputPath = `episodes/${episodeId}/shot-${i}.mp4`;
            assertPrivatePath(join(assetRoot, sourcePath));
            await run('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${['blue', 'green', 'red'][i]}:size=640x360:rate=30`, '-f', 'lavfi', '-i', `sine=frequency=${330 + i * 110}:sample_rate=48000`, '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(assetRoot, sourcePath)], { env });
            const source = await artifact(sourcePath, 'source_video'), taskId = randomUUID();
            await unwrap(admin.from('tasks').insert({ id: taskId, episode_id: episodeId, task_type: 'generate_a_roll', status: 'ready', provider: 'ffmpeg', model: 'ffmpeg', prompt_version: 'shot-clip-v1', budget_limit_cents: 0, max_attempts: 1, input_snapshot: { capability: 'shot_clip_preparation', executor: { provider: 'ffmpeg', adapter: 'ffmpeg_trim_video', model: 'ffmpeg', prompt_version: 'shot-clip-v1' }, allowed_tools: ['read', 'write'], media: { adapter: 'ffmpeg_trim_video', video_clip: { source_relative_path: sourcePath, start_seconds: 0, end_seconds: 2, target_duration_seconds: 2 } }, output: { required_artifact_types: ['a_roll_video'], content_type: 'video/mp4', relative_path: outputPath, review_stage: 'production_ready' }, input_artifacts: [source] } }));
            tasks.push({ id: taskId, outputPath, source });
        }
        const pageBefore = await pageWorkload(episodeId), timings = [];
        for (const task of tasks) {
            const route = `http://127.0.0.1:${ports.console}/_episode-dispatch?episode=${episodeId}&task=${task.id}`;
            const submittedAt = new Date().toISOString(), t = performance.now();
            const dispatch = await fetch(route, { method: 'POST', headers });
            const dispatchBody = await dispatch.json();
            assert.equal(dispatch.status, 202, JSON.stringify(dispatchBody));
            let row;
            for (let i = 0; i < 360; i++) {
                row = await unwrap(admin.from('tasks').select('*').eq('id', task.id).single());
                if (['completed', 'failed', 'blocked'].includes(row.status))
                    break;
                await new Promise(r => setTimeout(r, 250));
            }
            if (row.status !== 'completed')
                throw new Error(`Task ${row.id}: ${row.status} ${JSON.stringify(row.last_result)}`);
            const runs = await unwrap(admin.from('task_runs').select('*').eq('task_id', task.id).order('started_at'));
            assert.equal(runs.length, 1);
            const r = runs[0], submitted = Date.parse(submittedAt), claimed = Date.parse(r.started_at), completed = Date.parse(r.completed_at);
            const output = await artifact(task.outputPath, 'a_roll_video');
            const stored = await unwrap(admin.from('artifacts').select('*').eq('producer_task_id', task.id));
            assert.equal(stored[0].sha256, output.sha256);
            timings.push({ taskId: task.id, execution: 'real-worker-cli-ffmpeg', submittedAt, claimedAt: r.started_at, completedAt: r.completed_at, submitToClaimMs: claimed - submitted, executionAndReportMs: completed - claimed, totalMs: completed - submitted, observedTotalMs: performance.now() - t, readyBeforeSubmitMs: submitted - Date.parse(row.created_at), dispatchBody, artifact: output, probe: await probe(join(assetRoot, task.outputPath)) });
        }
        const storyboard = { version: 'storyboard/v1', shots: tasks.map((task, i) => ({ id: `shot-${i}`, scriptSegment: `固定镜头 ${i + 1}`, durationSeconds: 2, shotType: 'a_roll', productionMethod: '人工合成输入，真实本地裁剪', inputBasis: [], targetSpec: '9:16' })), audioCues: [] };
        const confirmedShots = tasks.map((task, i) => { const composition = { version: 'shot-composition/v1', layout: 'full', slots: [{ id: 'full', clipSegmentIndex: 0, fit: 'cover', focalPoint: { x: 0.5, y: 0.5 } }] }; const subtitleText = `固定镜头 ${i + 1}`; const captions = { version: 'shot-captions/v1', enabled: true, contentMode: 'independent', text: subtitleText, cues: [{ id: `cue-${i}`, text: subtitleText, startMs: 0, endMs: 2000 }], spatial: { version: 'shot-caption-space/v1', anchor: 'bottom-center', safeArea: 'title-safe', maxLines: 2, maxCharactersPerLine: 16 } }; Object.assign(captions, defaultShotCaptionContract(subtitleText, 'independent', true), { cues: captions.cues }); const preparationContract = { version: 'shot-preparation/v1', storyboardFingerprint: '0'.repeat(32), sourceMaterialRevisionId: `source-${i}`, clipSegments: [{ startSeconds: 0, endSeconds: 2 }], composition, transitionMode: 'cut', audioMode: 'source', ttsText: null, ttsVoice: null, ttsSpeakingRate: null, audioMix: { version: 'shot-audio-mix/v1', mainVoice: { mode: 'source', trackId: `source-${i}`, gainDb: 0, role: 'anchor' }, bgm: null, sfx: null }, captions, inputFingerprint: String(i + 1).repeat(32) }; return { shotId: `shot-${i}`, confirmationStatus: 'confirmed', inputFingerprint: preparationContract.inputFingerprint, sourceMaterialRevisionId: `source-${i}`, clipSegments: preparationContract.clipSegments, composition, preparationContract, audioMode: 'source', audioTrackId: null, subtitleText, subtitlesEnabled: true }; });
        const outputPath = `episodes/${episodeId}/review-render/v1/review.mp4`;
        const render = { projectRelativePath: `episodes/${episodeId}/review-render/v1/index.html`, projectRevision: 1, preRenderReviewPackageId: randomUUID(), confirmationMode: 'shot_preparation', confirmedShots, adjustments: { aspectRatio: '9:16', width: 360, height: 640, captionsEnabled: true, captionStyle: 'minimal', pacing: 'standard', crop: 'cover', transition: 'cut', layout: 'center', narrationGainDb: 0, bgmGainDb: -12, sfxGainDb: -6, frameRate: 30, allowedFrames: 2, reason: 'Stage A fixed baseline' }, storyboard, members: await Promise.all(tasks.map(async (task, i) => ({ memberKey: `shot:shot-${i}`, memberKind: 'shot_media', taskId: task.id, sourceMaterialRevisionId: `source-${i}`, clipSegments: confirmedShots[i].clipSegments, composition: confirmedShots[i].composition, preparationContract: confirmedShots[i].preparationContract, inputFingerprint: confirmedShots[i].inputFingerprint, relativePath: task.outputPath, sha256: (await artifact(task.outputPath, 'a_roll_video')).sha256, startSeconds: 0, durationSeconds: 2, audioMode: 'source', audioTrackId: null, subtitleText: confirmedShots[i].subtitleText, subtitlesEnabled: true }))) };
        writePrivateFile(join(config.stateRoot, 'baseline-task-partial.json'), JSON.stringify({ episodeId, shotCount, timings }, null, 2) + '\n');
        const pack = createWorkerTaskPackage({ task: { id: randomUUID(), type: 'generate_review_render', attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: 'openchatcut', model: 'openchatcut@0.2.14', promptVersion: 'review-render-v1' }, episode: { id: episodeId, accountId, blueprintVersionId: blueprintId, title: 'Stage A real render' }, capability: 'review_rendering', allowedTools: ['read', 'write'], allowedAssetRoot: assetRoot, reviewRender: render, output: { requiredArtifactTypes: ['review_render_video', 'review_render_project', 'review_render_runtime', 'review_qc_report'], contentType: 'video/mp4', relativePath: outputPath, reviewStage: 'qc_review' }, inputArtifacts: await Promise.all(tasks.map(t => artifact(t.outputPath, 'shot_media'))) });
        const renderStart = performance.now();
        const result = JSON.parse(await executeOpenChatCutRender({ taskPackage: pack, run: async (_command, args) => { await run(process.execPath, [join(projectRoot, 'scripts/openchatcut-render.mjs'), ...args], { env, maxBuffer: 10 * 1024 * 1024 }); }, validateMp4: async (path, min) => { assert.ok((await probe(path)).durationSeconds >= min - 2 / 30); }, inspectMp4: probe }));
        assert.equal(result.status, 'completed');
        const outputProbe = await probe(join(assetRoot, outputPath));
        assert.equal(outputProbe.hasAudio, true);
        assert.equal(outputProbe.width, 360);
        assert.equal(outputProbe.height, 640);
        assert.ok(Math.abs(outputProbe.durationSeconds - shotCount * 2) < 0.1);
        samples.push({ sample: `${shotCount}-shot`, episodeId, input: 'synthetic color+sine, 640x360/30fps, 2 seconds per shot; fixed seed-free inputs', shotCount, taskCount: tasks.length, pageBefore, pageAfter: await pageWorkload(episodeId), timings, render: { execution: 'real-OpenChatCut-direct; current worker render module, outside DB render orchestration', elapsedMs: performance.now() - renderStart, probe: outputProbe, artifacts: result.artifacts }, diskBytes: await bytes(episodeDir) });
        writePrivateFile(join(config.stateRoot, 'baseline-partial.json'), JSON.stringify({ samples, resources }, null, 2) + '\n');
    }
}
finally {
    clearInterval(sampler);
    resourceSample();
}
const result = { version: 'stage-a-baseline/v1', began, completedAt: new Date().toISOString(), gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), environment: { node: process.version, os: os.release(), arch: os.arch(), hostCpuCount: os.cpus().length, hostMemoryBytes: os.totalmem(), vm: { cpu: 2, memoryGiB: 4, diskGiB: 20 }, consolePort: ports.console, apiPort: ports.api, worker: 'current HTTP -> shell -> per-task tsc -> real claim/execute/report', resourceProbe: '500ms ps lifetime %CPU and RSS sum for harness+console+descendants; excludes VM/Chrome; raw samples retained; not instantaneous CPU or capacity' }, samples, resources, disk: { beforeBytes: diskBefore, afterBytes: await bytes(config.mediaRoot) }, limitations: ['one run per sample, no statistically meaningful p50/p95 or production capacity', 'online model/TTS/download not executed', 'OpenChatCut direct module render is real; not a DB render workflow or an Owner approval', 'fixture setup is outside task submit timings; per-task compile remains included', 'HTTP detail workload matches table set with explicit extra task-ID lookup; browser metrics recorded separately'] };
writePrivateFile(join(config.stateRoot, 'baseline.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ samples: result.samples.map(s => ({ sample: s.sample, taskTimings: s.timings.map(t => ({ queueMs: t.submitToClaimMs, executionMs: t.executionAndReportMs, totalMs: t.totalMs })), renderMs: s.render.elapsedMs, probe: s.render.probe })), disk: result.disk }, null, 2));
