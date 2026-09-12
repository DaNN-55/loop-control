import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { ArtifactManifest, WorkerResult, WorkerTaskPackage } from "./contracts.js";
import { safeAssetOutputPath, writeSafeAssetFile } from "./controlledMediaExecutor.js";
import { activeOpenChatCutState, buildOpenChatCutCardProject, buildOpenChatCutProject, openChatCutProjectPath, type OpenChatCutProject } from "./openchatcutProject.js";
import { verifyOpenChatCutProject } from "./openchatcutProjectReader.js";

type ReviewRender = NonNullable<WorkerTaskPackage["reviewRender"]>;

export function reviewRenderMinimumDurationSeconds(render: ReviewRender): number {
  const confirmedShots = new Map(render.confirmedShots.map((shot) => [shot.shotId, shot]));
  return render.storyboard.shots.reduce((total, shot) => {
    const confirmedDuration = confirmedShots.get(shot.id)?.durationDecision?.studioAdoptedDurationSeconds;
    const preparedDuration = render.members.find((member) => member.memberKind === "shot_media" && member.memberKey === `shot:${shot.id}`)?.durationSeconds;
    const duration = confirmedDuration && confirmedDuration > 0
      ? confirmedDuration
      : preparedDuration && preparedDuration > 0
        ? preparedDuration
        : shot.durationSeconds;
    return total + duration;
  }, 0);
}

export async function executeOpenChatCutRender(input: {
  taskPackage: WorkerTaskPackage;
  run(command: string, args: string[]): Promise<void>;
  validateMp4(path: string, minimumDurationSeconds: number, frameRate?: number, allowedFrames?: number): Promise<void>;
  inspectMp4(path: string): Promise<{ durationSeconds: number; width: number; height: number; hasAudio: boolean; blackFrameCount: number }>;
}): Promise<string> {
  const cardShot = input.taskPackage.aRoll?.adapter === "openchatcut_card_video"
    ? input.taskPackage.aRoll.shot
    : input.taskPackage.media?.adapter === "openchatcut_card_video"
      ? input.taskPackage.media.cardVideo.shot
      : null;
  if (cardShot) return executeCardVideo(input, cardShot);
  const render = input.taskPackage.finalRender?.reviewRender ?? input.taskPackage.reviewRender;
  if (!render) throw new Error("OpenChatCut 渲染任务缺少冻结生产单工程。");
  const projectRelativePath = openChatCutProjectPath(input.taskPackage.finalRender?.projectRelativePath ?? render.projectRelativePath);
  const outputPath = await safeAssetOutputPath(input.taskPackage.assets.allowedRoot, input.taskPackage.output.relativePath);
  const project = render.studioProject
    ? await readFrozenStudioProject(input.taskPackage.assets.allowedRoot, render.studioProject)
    : buildOpenChatCutProject(render, `production-${input.taskPackage.episode.id}`);
  await verifyOpenChatCutProject(render, project, {}, render.studioProject ? { requireConfirmedText: false, allowStudioEdits: true } : {});
  const projectPath = await safeAssetOutputPath(input.taskPackage.assets.allowedRoot, projectRelativePath);
  await writeSafeAssetFile(input.taskPackage.assets.allowedRoot, projectRelativePath, JSON.stringify(project, null, 2) + "\n");
  await renderProject(input, project, outputPath, render.members.map((member) => ({ relativePath: member.relativePath })));
  await input.validateMp4(
    outputPath,
    reviewRenderMinimumDurationSeconds(render),
    render.adjustments.frameRate,
    render.adjustments.allowedFrames,
  );
  const inspection = await input.inspectMp4(outputPath);
  if (inspection.width !== render.adjustments.width || inspection.height !== render.adjustments.height || inspection.blackFrameCount > 0) throw new Error("OpenChatCut 渲染未通过画幅或黑帧检查。");
  const isShotPreview = input.taskPackage.task.type === "generate_shot_sync_preview";
  const qcRelativePath = `${dirname(projectRelativePath)}/${input.taskPackage.finalRender ? "final-qc-report.json" : "qc-report.json"}`;
  const runtimeRelativePath = `${dirname(projectRelativePath)}/openchatcut-runtime.json`;
  const audioExpected = render.members.some((member) => member.memberKind !== "shot_media") || render.confirmedShots?.some((shot) => shot.audioMode === "source");
  const audioPassed = !audioExpected || inspection.hasAudio;
  const inputFingerprint = render.confirmationMode === "shot_preparation" && render.confirmedShots?.length === 1 ? render.confirmedShots[0].inputFingerprint : undefined;
  const report = { version: "qc-report/v1", passed: audioPassed && inspection.blackFrameCount === 0, ...(inputFingerprint ? { inputFingerprint } : {}), output: { relativePath: input.taskPackage.output.relativePath, ...inspection }, checks: [{ name: "openchatcut_project", passed: true, detail: `OpenChatCut 项目已冻结：${projectRelativePath}` }, { name: "openchatcut_render", passed: audioPassed, detail: inspection.hasAudio ? "输出包含音频。" : audioExpected ? "输出缺少必需音频。" : "静音镜头按契约不要求音频流。" }] };
  if (!report.passed) throw new Error("OpenChatCut 渲染未通过 QC 校验。");
  await writeSafeAssetFile(input.taskPackage.assets.allowedRoot, qcRelativePath, JSON.stringify(report, null, 2) + "\n");
  await writeSafeAssetFile(input.taskPackage.assets.allowedRoot, runtimeRelativePath, JSON.stringify({ name: "OpenChatCut", version: "0.2.14" }) + "\n");
  const outputArtifact = await artifact(input.taskPackage.output.requiredArtifactTypes[0], input.taskPackage.output.relativePath, outputPath);
  const projectArtifact = await artifact(input.taskPackage.finalRender ? "final_render_project" : isShotPreview ? "shot_editable_project" : "review_render_project", projectRelativePath, projectPath);
  const qcArtifact = await artifact(isShotPreview ? "shot_preview_qc_report" : "review_qc_report", qcRelativePath, await safeAssetOutputPath(input.taskPackage.assets.allowedRoot, qcRelativePath));
  const runtimeArtifact = await artifact(isShotPreview ? "shot_preview_runtime" : "review_render_runtime", runtimeRelativePath, await safeAssetOutputPath(input.taskPackage.assets.allowedRoot, runtimeRelativePath));
  const artifacts = input.taskPackage.finalRender ? [outputArtifact, projectArtifact, qcArtifact] : [outputArtifact, projectArtifact, runtimeArtifact, qcArtifact];
  const normalizedQcArtifact = input.taskPackage.finalRender ? { ...qcArtifact, artifactType: "final_qc_report" } : qcArtifact;
  const finalArtifacts = input.taskPackage.finalRender ? [outputArtifact, projectArtifact, normalizedQcArtifact] : artifacts;
  const result: WorkerResult = { version: "worker-result/v1", taskId: input.taskPackage.task.id, status: "completed", artifacts: finalArtifacts, validation: { passed: true, checks: [{ name: "openchatcut_project", passed: true, detail: `已将 ${render.members.length} 个冻结成员转换为 OpenChatCut 时间线。` }, { name: "openchatcut_render", passed: true, detail: `已完成 OpenChatCut ${input.taskPackage.finalRender ? "最终" : "审核"}预览渲染。` }, { name: "openchatcut_qc", passed: true, detail: "时长、分辨率、音频和黑帧检查通过。" }] }, actualCostCents: 0, blockers: [], retry: { shouldRetry: false, reason: "Completed successfully." }, nextStep: "Owner reviews the OpenChatCut project and QC evidence." };
  return JSON.stringify(result);
}

async function readFrozenStudioProject(
  assetRoot: string,
  manifest: NonNullable<NonNullable<WorkerTaskPackage["reviewRender"]>["studioProject"]>,
): Promise<OpenChatCutProject> {
  const path = await safeAssetOutputPath(assetRoot, manifest.relativePath);
  const contents = await readFile(path);
  if (contents.byteLength !== manifest.fileSize || createHash("sha256").update(contents).digest("hex") !== manifest.sha256) {
    throw new Error("OpenChatCut 冻结工程与任务清单的大小或哈希不一致。");
  }
  let project: unknown;
  try {
    project = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error("OpenChatCut 冻结工程不是有效 JSON。");
  }
  if (!project || typeof project !== "object" || Array.isArray(project)) throw new Error("OpenChatCut 冻结工程内容无效。");
  return project as OpenChatCutProject;
}

async function executeCardVideo(
  input: Parameters<typeof executeOpenChatCutRender>[0],
  shot: NonNullable<WorkerTaskPackage["aRoll"]>["shot"],
): Promise<string> {
  const projectRelativePath = `episodes/${input.taskPackage.episode.id}/card-video/${input.taskPackage.task.id}/project.json`;
  const outputPath = await safeAssetOutputPath(input.taskPackage.assets.allowedRoot, input.taskPackage.output.relativePath);
  const project = buildOpenChatCutCardProject(shot, `card-${input.taskPackage.task.id}`);
  await safeAssetOutputPath(input.taskPackage.assets.allowedRoot, projectRelativePath);
  await writeSafeAssetFile(input.taskPackage.assets.allowedRoot, projectRelativePath, JSON.stringify(project, null, 2) + "\n");
  await renderProject(input, project, outputPath, []);
  await input.validateMp4(outputPath, shot.durationSeconds);
  const inspection = await input.inspectMp4(outputPath);
  if (inspection.width !== 1080 || inspection.height !== 1920 || inspection.blackFrameCount > 0) throw new Error("OpenChatCut 卡片视频未通过画幅或黑帧检查。");
  const bytes = await readFile(outputPath);
  const result: WorkerResult = {
    version: "worker-result/v1",
    taskId: input.taskPackage.task.id,
    status: "completed",
    artifacts: [{ artifactType: input.taskPackage.output.requiredArtifactTypes[0], relativePath: input.taskPackage.output.relativePath, sha256: createHash("sha256").update(bytes).digest("hex"), fileSize: bytes.byteLength }],
    validation: { passed: true, checks: [{ name: "openchatcut_card_video", passed: true, detail: `已按冻结分镜渲染 ${shot.shotType} 卡片视频，工程为 ${projectRelativePath}。` }] },
    actualCostCents: 0,
    blockers: [],
    retry: { shouldRetry: false, reason: "Completed successfully." },
    nextStep: "Await the next controlled production step.",
  };
  return JSON.stringify(result);
}

async function renderProject(
  input: Parameters<typeof executeOpenChatCutRender>[0],
  project: OpenChatCutProject,
  outputPath: string,
  sources: Array<{ relativePath: string }>,
): Promise<void> {
  const specDirectory = await mkdtemp(join(tmpdir(), "loop-control-openchatcut-render-"));
  const specPath = join(specDirectory, "spec.json");
  await writeFile(specPath, JSON.stringify({
    openchatcutRoot: process.env.OPENCHATCUT_ROOT,
    nodePath: process.env.OPENCHATCUT_NODE,
    assetRoot: input.taskPackage.assets.allowedRoot,
    outputPath,
    state: activeOpenChatCutState(project),
    sources,
  }, null, 2) + "\n");
  try {
    await input.run("openchatcut", [specPath]);
  } finally {
    await rm(specDirectory, { recursive: true, force: true });
  }
}

async function artifact(artifactType: string, relativePath: string, path: string): Promise<ArtifactManifest> {
  const contents = await readFile(path);
  return { artifactType, relativePath, sha256: createHash("sha256").update(contents).digest("hex"), fileSize: contents.byteLength };
}
