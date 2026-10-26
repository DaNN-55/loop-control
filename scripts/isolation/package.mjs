import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readConfiguration, cleanEnvironment, assertPrivatePath, writePrivateFile } from './environment.mjs';
import { createPublishPackage, verifyPublishPackage } from '../../dist/worker/publishing/publishPackage.js';
const config = readConfiguration(), env = cleanEnvironment(config), run = promisify(execFile);
const baseline = JSON.parse(await readFile(join(config.stateRoot, 'baseline.json'), 'utf8'));
const assetRoot = join(config.mediaRoot, 'smoke'), samples = [];
for (const sample of baseline.samples) {
    const started = performance.now(), base = `episodes/${sample.episodeId}`, video = sample.render.artifacts.find(a => a.artifactType === 'review_render_video'), qc = sample.render.artifacts.find(a => a.artifactType === 'review_qc_report');
    const coverPath = `${base}/cover.jpg`, metadataPath = `${base}/metadata.json`;
    assertPrivatePath(join(assetRoot, coverPath));
    await run('ffmpeg', ['-y', '-nostdin', '-v', 'error', '-i', join(assetRoot, video.relativePath), '-frames:v', '1', join(assetRoot, coverPath)], { env });
    writePrivateFile(join(assetRoot, metadataPath), JSON.stringify({ title: `Stage A ${sample.sample}`, fixture: true, note: 'Real media, synthetic package roles; no Owner approval or production completion recorded' }) + '\n');
    const artifacts = [];
    for (const [type, path] of [['final_render', video.relativePath], ['cover', coverPath], ['metadata', metadataPath], ['final_qc_report', qc.relativePath]]) {
        const b = await readFile(join(assetRoot, path));
        artifacts.push({ artifactType: type, relativePath: path, sha256: createHash('sha256').update(b).digest('hex'), fileSize: b.length });
    }
    const manifest = await createPublishPackage({ assetRoot, episodeId: sample.episodeId, artifacts });
    await verifyPublishPackage({ assetRoot, episodeId: sample.episodeId, publishPackage: manifest });
    const cover = await readFile(join(assetRoot, coverPath));
    let corruptionRejected = false;
    try {
        writePrivateFile(join(assetRoot, coverPath), Buffer.concat([cover, Buffer.from('test-corruption')]));
        await assert.rejects(verifyPublishPackage({ assetRoot, episodeId: sample.episodeId, publishPackage: manifest }));
        corruptionRejected = true;
    }
    finally {
        writePrivateFile(join(assetRoot, coverPath), cover);
    }
    await verifyPublishPackage({ assetRoot, episodeId: sample.episodeId, publishPackage: manifest });
    samples.push({ sample: sample.sample, episodeId: sample.episodeId, execution: 'real package module and real media; synthetic final/QC roles, no approvals', elapsedMs: performance.now() - started, manifest, artifacts, corruptionRejected, restoredAndVerified: true });
}
const result = { checkedAt: new Date().toISOString(), samples, note: 'Supplemental real-file package boundary; render videos and QC reused as explicit fixtures, not approved final production outputs.' };
writePrivateFile(join(config.stateRoot, 'packages.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.samples.map(s => ({ sample: s.sample, elapsedMs: s.elapsedMs, sha256: s.manifest.sha256, corruptionRejected: s.corruptionRejected })), null, 2));
