import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StoryboardShotManifest, WorkerResult, WorkerTaskPackage } from "./contracts.js";
import { safeAssetOutputPath, writeSafeAssetFile } from "./controlledMediaExecutor.js";

export async function executeHyperframesCardVideo(input: {
  taskPackage: WorkerTaskPackage;
  run(command: string, args: string[]): Promise<void>;
  validateMp4(path: string, minimumDurationSeconds: number): Promise<void>;
}): Promise<string> {
  const shot = input.taskPackage.aRoll?.adapter === "hyperframes_card_video" ? input.taskPackage.aRoll.shot : input.taskPackage.media?.adapter === "hyperframes_card_video" ? input.taskPackage.media.cardVideo.shot : null;
  if (!shot) throw new Error("卡片视频任务缺少冻结镜头。");
  const projectPath = `episodes/${input.taskPackage.episode.id}/card-video/${input.taskPackage.task.id}/index.html`;
  const projectDirectory = dirname(await safeAssetOutputPath(input.taskPackage.assets.allowedRoot, projectPath));
  const outputPath = await safeAssetOutputPath(input.taskPackage.assets.allowedRoot, input.taskPackage.output.relativePath);
  await writeSafeAssetFile(input.taskPackage.assets.allowedRoot, projectPath, cardProject(shot));
  await input.run("hyperframes", ["check", projectDirectory]);
  await input.run("hyperframes", ["render", projectDirectory, "--quality", "standard", "--strict", "--no-best-effort", "--output", outputPath]);
  await input.validateMp4(outputPath, shot.durationSeconds);
  const bytes = await readFile(outputPath);
  const result: WorkerResult = {
    version: "worker-result/v1", taskId: input.taskPackage.task.id, status: "completed",
    artifacts: [{ artifactType: input.taskPackage.output.requiredArtifactTypes[0], relativePath: input.taskPackage.output.relativePath, sha256: createHash("sha256").update(bytes).digest("hex"), fileSize: bytes.byteLength }],
    validation: { passed: true, checks: [{ name: "hyperframes_card_video", passed: true, detail: `已按冻结分镜渲染 ${shot.shotType} 卡片视频。` }] }, actualCostCents: 0, blockers: [], retry: { shouldRetry: false, reason: "Completed successfully." }, nextStep: "Await the next controlled production step.",
  };
  return JSON.stringify(result);
}

function cardProject(shot: StoryboardShotManifest): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=1080,height=1920"/><style>*{box-sizing:border-box}html,body,#root{width:1080px;height:1920px;margin:0;overflow:hidden;background:#09131f;color:#f5eee3;font-family:system-ui,sans-serif}#root{display:grid;align-content:end;gap:34px;padding:120px 88px;background:radial-gradient(circle at 85% 15%,#2c6d80 0,transparent 32%),linear-gradient(145deg,#09131f,#172d43)}.tag{color:#9ee4f2;font-size:34px;font-weight:800;letter-spacing:.18em}.line{width:150px;border-top:8px solid #d49052}.copy{font-size:64px;font-weight:800;line-height:1.28}.meta{color:#cad8e3;font-size:30px;letter-spacing:.08em}</style></head><body><main id="root" data-start="0" data-duration="${shot.durationSeconds}"><div class="tag">${shot.shotType === "a_roll" ? "A-ROLL" : "B-ROLL"}</div><div class="line"></div><div class="copy">${escapeHtml(shot.scriptSegment)}</div><div class="meta">${escapeHtml(shot.productionMethod)}</div></main></body></html>`;
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
