import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkerTaskPackage } from "./contracts.js";
import { normalizeShotComposition, shotCompositionRect } from "../shotComposition.js";
import { openChatCutSlotTransform } from "./openchatcutProject.js";
import { shotCaptionSafeAreaGeometry } from "../shotCaptions.js";

type ReviewRender = NonNullable<WorkerTaskPackage["reviewRender"]>;

export interface OpenChatCutProjectObservation {
  readable: boolean;
  activeTimelineId?: string;
  captionTracks: Array<{ id: string; enabled: boolean; editable: boolean; cues: Array<{ id?: string; text: string; start: number; end: number }>; constraints?: Array<{ sourceId: string; anchor?: string; offsetXRatio?: number; offsetYRatio?: number; safeWidthRatio?: number; safeHeightRatio?: number; maxLines?: number; maxCharactersPerLine?: number }> }>;
  textItemsOnCaptionTracks: number;
  audioTracks: Array<{ id: string; alias?: string; role?: "anchor" | "follower"; duckDepthDb?: number; items: Array<{ id: string; src?: string; sourceAssetId?: string; startFrame: number; durationInFrames: number; srcInFrame?: number; volume: number }> }>;
  audibleVideoItems: Array<{ id: string; track: string; volume: number }>;
  videoLayers: Array<{ id: string; track: string; alias?: string; startFrame: number; durationInFrames: number; sourceAssetId?: string; editable: boolean; transform?: Record<string, unknown> }>;
  assets: Array<{ id: string; src: string }>;
}

export async function inspectOpenChatCutProjectWithRuntime(
  project: unknown,
  runtimeConfig: { nodePath?: string; root?: string } = {},
): Promise<OpenChatCutProjectObservation> {
  const openchatcutRoot = runtimeConfig.root?.trim() || process.env.OPENCHATCUT_ROOT?.trim();
  if (!openchatcutRoot) throw new Error("未配置 OPENCHATCUT_ROOT，无法验证 OpenChatCut 工程。");
  const nodePath = runtimeConfig.nodePath?.trim() || process.env.OPENCHATCUT_NODE?.trim() || process.execPath;
  const inspectorPath = resolve("scripts/inspect-openchatcut-project.ts");
  const tsxLoaderPath = resolve(openchatcutRoot, "node_modules/tsx/dist/loader.mjs");
  const directory = await mkdtemp(join(tmpdir(), "loop-control-openchatcut-read-"));
  const projectPath = join(directory, "project.json");
  await writeFile(projectPath, JSON.stringify(project));
  try {
    const stdout = await run(nodePath, ["--import", tsxLoaderPath, inspectorPath, projectPath, openchatcutRoot]);
    return JSON.parse(stdout) as OpenChatCutProjectObservation;
  } catch (cause) {
    throw new Error(`OpenChatCut 真实读取失败：${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function assertConfirmedShotCaptionsReadable(
  render: ReviewRender,
  observation: OpenChatCutProjectObservation,
  options: { requireConfirmedText?: boolean } = {},
): void {
  if (render.confirmationMode !== "shot_preparation") return;
  if (!observation.readable) throw new Error("OpenChatCut 真实读取失败，镜头不能确认。");
  if (observation.textItemsOnCaptionTracks > 0) throw new Error("OpenChatCut 字幕轨包含普通 text item，镜头不能确认。");
  const required = (render.confirmedShots ?? []).filter((shot) => render.adjustments.captionsEnabled && shot.subtitlesEnabled);
  if (required.length > 0 && observation.captionTracks.length === 0) throw new Error("OpenChatCut 字幕轨不存在，镜头不能确认。");
  if (required.some((shot) => {
    const track = observation.captionTracks.find((candidate) => candidate.enabled && candidate.editable);
    const cues = track?.cues.filter((cue) => cue.id === `cue-${shot.shotId}` || cue.id?.startsWith(`cue-${shot.shotId}-`)) ?? [];
    const constraint = track?.constraints?.find((candidate) => candidate.sourceId === `lane-${shot.shotId}`);
    const spatial = shot.preparationContract.captions.spatial;
    const safeArea = shotCaptionSafeAreaGeometry(spatial);
    return cues.length === 0
      || (options.requireConfirmedText === false ? !cues.some((cue) => cue.text.trim()) : cues.map((cue) => cue.text).join("") !== shot.subtitleText)
      || cues.some((cue) => !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start)
      || !constraint || constraint.anchor !== spatial.anchor || constraint.offsetXRatio !== safeArea.offsetX || constraint.offsetYRatio !== safeArea.offsetY || constraint.safeWidthRatio !== safeArea.width || constraint.safeHeightRatio !== safeArea.height || constraint.maxLines !== spatial.maxLines || constraint.maxCharactersPerLine !== spatial.maxCharactersPerLine
      || cues.some((cue) => Array.from(cue.text).length > spatial.maxLines * spatial.maxCharactersPerLine);
  })) {
    throw new Error("OpenChatCut 字幕 cues 为空、无效或正文与确认快照不一致，镜头不能确认。");
  }
}

export function assertConfirmedShotLayoutsReadable(render: ReviewRender, observation: OpenChatCutProjectObservation, options: { allowStudioEdits?: boolean } = {}): void {
  if (render.confirmationMode !== "shot_preparation") return;
  for (const shot of render.confirmedShots ?? []) {
    const member = render.members.find((candidate) => candidate.memberKey === `shot:${shot.shotId}`);
    const composition = normalizeShotComposition(shot.composition ?? member?.composition, Math.max(1, member?.clipSegments?.length ?? 1));
    if (composition.layout === "full") {
      const segmentCount = Math.max(1, member?.clipSegments?.length ?? 1);
      const layers = Array.from({ length: segmentCount }, (_, index) => observation.videoLayers.find((layer) => layer.id === (segmentCount === 1 ? `shot-${shot.shotId}-full` : `shot-${shot.shotId}-full-${index + 1}`)));
      const expected = openChatCutSlotTransform(shotCompositionRect("full", "full"), composition.slots[0]);
      if (layers.some((layer) => !layer || (layer.alias ?? layer.track) !== "V1" || !layer.editable || (!options.allowStudioEdits && !sameTransform(layer.transform, expected)))) throw new Error(`OpenChatCut ${shot.shotId} 没有生成完整、连续且可编辑的全屏片段。`);
      continue;
    }
    const layers = composition.slots.map((slot) => observation.videoLayers.find((layer) => layer.id === `shot-${shot.shotId}-${slot.id}`));
    if (layers.some((layer) => !layer) || new Set(layers.map((layer) => layer?.track)).size !== composition.slots.length) throw new Error(`OpenChatCut ${shot.shotId} 没有生成全部独立构图视频层。`);
    for (const [index, slot] of composition.slots.entries()) {
      const layer = layers[index]!;
      const expected = openChatCutSlotTransform(shotCompositionRect(composition.layout, slot.id), slot);
      if (!layer.editable || (!options.allowStudioEdits && !sameTransform(layer.transform, expected))) throw new Error(`OpenChatCut ${shot.shotId}/${slot.id} 视频层的位置、尺寸或可编辑性无效。`);
    }
  }
}

export function assertConfirmedShotAudioReadable(render: ReviewRender, observation: OpenChatCutProjectObservation): void {
  if (render.confirmationMode !== "shot_preparation") return;
  const mainTrack = observation.audioTracks.find((track) => track.id === "A1" || track.alias === "A1");
  const mainItems = mainTrack?.items ?? [];
  if (observation.audibleVideoItems.length) throw new Error("OpenChatCut 构图视频层仍在播放素材音频，主声音不唯一。");
  for (const shot of render.confirmedShots ?? []) {
    const mix = shot.preparationContract.audioMix;
    const sourceSegmentCount = shot.preparationContract.composition.layout === "full" ? shot.preparationContract.clipSegments.length : 1;
    const expectedIds = mix.mainVoice.mode === "source"
      ? Array.from({ length: sourceSegmentCount }, (_, index) => sourceSegmentCount === 1 ? `main-source-${shot.shotId}` : `main-source-${shot.shotId}-${index + 1}`)
      : [`main-tts-narration-${shot.shotId}`];
    const matchingMain = mainItems.filter((item) => expectedIds.includes(item.id));
    if (mix.mainVoice.mode === "none" ? matchingMain.length !== 0 : matchingMain.length !== expectedIds.length || mainTrack?.role !== "anchor") {
      throw new Error(`OpenChatCut ${shot.shotId} 没有且仅有一条权威主声音。`);
    }
    const bgmItem = observation.audioTracks.flatMap((track) => track.items.map((item) => ({ item, track }))).find(({ item }) => item.id === `bgm-${shot.shotId}`);
    if (mix.bgm && (!bgmItem || bgmItem.track.role !== "follower" || bgmItem.track.duckDepthDb !== mix.bgm.duckDepthDb)) throw new Error(`OpenChatCut ${shot.shotId} 的 BGM follower 或闪避强度无效。`);
    if (!mix.bgm && bgmItem) throw new Error(`OpenChatCut ${shot.shotId} 不应存在 BGM 片段。`);
  }
  const sfxTracks = observation.audioTracks.filter((track) => track.items.some((item) => item.id.startsWith("soundtrack-sfx-")));
  if (sfxTracks.some((track) => track.role !== undefined || track.duckDepthDb !== undefined)) throw new Error("OpenChatCut SFX 默认不应参与自动闪避。");
}

export function assertShotPreviewFingerprint(render: ReviewRender, project: unknown): void {
  if (render.confirmationMode !== "shot_preparation" || render.confirmedShots?.length !== 1) return;
  const metadata = project && typeof project === "object" && !Array.isArray(project) ? (project as { loopControl?: Record<string, unknown> }).loopControl : undefined;
  const shot = render.confirmedShots[0];
  if (!metadata || metadata.version !== "shot-sync-preview/v1" || metadata.inputFingerprint !== shot.inputFingerprint || metadata.transitionMode !== shot.preparationContract.transitionMode) {
    throw new Error("OpenChatCut 镜头工程描述与当前输入指纹或衔接要求不一致。");
  }
}

export async function verifyOpenChatCutProject(
  render: ReviewRender,
  project: unknown,
  runtimeConfig: { nodePath?: string; root?: string } = {},
  options: { requireConfirmedText?: boolean; allowStudioEdits?: boolean } = {},
): Promise<OpenChatCutProjectObservation> {
  const observation = await inspectOpenChatCutProjectWithRuntime(project, runtimeConfig);
  assertShotPreviewFingerprint(render, project);
  assertConfirmedShotCaptionsReadable(render, observation, options);
  assertConfirmedShotLayoutsReadable(render, observation, options);
  assertConfirmedShotAudioReadable(render, observation);
  return observation;
}

function sameTransform(actual: Record<string, unknown> | undefined, expected: Record<string, unknown>): boolean {
  if (!actual) return false;
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) rejectRun(new Error(String(stderr || error.message).trim()));
      else resolveRun(stdout);
    });
  });
}
