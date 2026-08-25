import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  runCodexWorker,
  parseCodexOutput,
  type ClaimedWorkerTask,
} from "./codexRunner.js";
import type { ArtifactManifest, VisualAssetRequest, WorkerPreflightResult, WorkerTaskPackage } from "./contracts.js";
import type { StoryboardManifest } from "./contracts.js";
import { verifyArtifactIndex, verifyMediaLibrary } from "./mediaLibrary.js";
import { nonNegativeIntegerEnvironment, requiredEnvironment } from "./runtimeEnvironment.js";
import { verifyReportedStoryboardArtifact } from "./storyboardArtifact.js";
import { workerResultJsonSchema } from "./workerResultSchema.js";
import { executeControlledMediaTask, writeSafeAssetFile } from "./controlledMediaExecutor.js";
import { generateOpenAiImage } from "./mediaProviders.js";
import { createHash } from "node:crypto";
import { executeHyperframesReviewRender } from "./hyperframesReviewRenderer.js";
import { executeHyperframesFinalRender } from "./hyperframesFinalRenderer.js";
import { readTaskIdArgument } from "./taskClaimArguments.js";
import { createRuntimePreflight, credentialEnvironmentForReference, runtimeCapabilityFromTask, runtimeCommandArguments, runtimeCommandForProvider } from "./runtimePreflight.js";
import { probeCodexModel, probeProviderConnection } from "./runtimeProbes.js";

const supabaseUrl = requiredEnvironment("SUPABASE_URL");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const actualCostCents = nonNegativeIntegerEnvironment("CODEX_WORKER_ACTUAL_COST_CENTS");
const mediaLibraryMountPath = requiredEnvironment("MEDIA_LIBRARY_MOUNT_PATH");
const mediaLibraryMinimumFreeBytes = nonNegativeIntegerEnvironment("MEDIA_LIBRARY_MIN_FREE_BYTES");
const codexExecutionTimeoutMs = Number(process.env.CODEX_WORKER_EXECUTION_TIMEOUT_MS ?? "300000");
if (!Number.isSafeInteger(codexExecutionTimeoutMs) || codexExecutionTimeoutMs <= 0) throw new Error("CODEX_WORKER_EXECUTION_TIMEOUT_MS must be a positive integer.");
const requestedTaskId = readTaskIdArgument(process.argv.slice(2));
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const result = await runCodexWorker({
  claimNextTask: claimNextTask,
  reportResult,
  verifyAssetRoot,
  verifyArtifacts,
  preflight: preflightTask,
  execute: executeTask,
  actualCostCents,
});

process.stdout.write(`${JSON.stringify(result)}\n`);

async function claimNextTask(): Promise<ClaimedWorkerTask | null> {
  const { data, error } = await supabase.rpc("claim_next_worker_task", requestedTaskId ? { p_task_id: requestedTaskId } : {});
  if (error) throw new Error(`Unable to claim a worker task: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  if (row.provider !== "codex" && row.provider !== "google_tts" && row.provider !== "pexels" && row.provider !== "ffmpeg" && row.provider !== "freesound" && row.provider !== "hyperframes" && row.provider !== "openai") throw new Error(`Unsupported worker provider: ${row.provider}`);

  return {
    taskId: row.task_id,
    taskType: row.task_type,
    attempt: row.attempt,
    budgetLimitCents: row.budget_limit_cents,
    maxAttempts: row.max_attempts,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    episodeId: row.episode_id,
    accountId: row.account_id,
    blueprintVersionId: row.blueprint_version_id,
    title: row.title,
    allowedAssetRoot: row.allowed_asset_root,
    inputSnapshot: row.input_snapshot,
  };
}

async function executeTask(taskPackage: WorkerTaskPackage): Promise<string> {
  if (taskPackage.provider === "codex") {
    const output = await executeCodex(taskPackage);
    const completedOutput = taskPackage.visualAssetPreparation?.imageGeneration ? await generateVisualAssets(taskPackage, output) : output;
    return taskPackage.capability === "storyboard_planning" ? useWrittenStoryboard(taskPackage, completedOutput) : completedOutput;
  }
  if (taskPackage.provider === "hyperframes") {
    const input = { taskPackage, run: runCommand, validateMp4: validateMp4Artifact, inspectMp4: inspectMp4Artifact };
    return taskPackage.capability === "final_rendering" ? executeHyperframesFinalRender(input) : executeHyperframesReviewRender(input);
  }
  const credential = credentialEnvironmentForReference(taskPackage.provider, taskPackage.aRoll?.adapter ?? taskPackage.media?.adapter, taskPackage.credentialRef);
  const apiKey = credential ? process.env[credential] : undefined;
  return executeControlledMediaTask({
    taskPackage,
    fetcher: fetch,
    pexelsApiKey: taskPackage.provider === "pexels" ? apiKey : undefined,
    googleTtsApiKey: taskPackage.provider === "google_tts" ? apiKey : undefined,
    freesoundApiKey: taskPackage.provider === "freesound" ? apiKey : undefined,
    openaiApiKey: taskPackage.provider === "openai" ? apiKey : undefined,
    validateMp4: validateMp4Artifact,
    probeMp3: probeMp3Artifact,
    extractMp3: extractMp3Artifact,
    trimMp3: trimMp3Artifact,
  });
}

async function useWrittenStoryboard(taskPackage: WorkerTaskPackage, output: string): Promise<string> {
  const candidate = parseCodexOutput(output, 0);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("分镜结果格式无效。");
  const result = candidate as Record<string, unknown>;
  if (result.status !== "completed") return output;
  const relativePath = taskPackage.output.relativePath;
  const storyboard = JSON.parse(await readFile(join(taskPackage.assets.allowedRoot, relativePath), "utf8"));
  return JSON.stringify({ ...result, storyboard });
}

async function generateVisualAssets(taskPackage: WorkerTaskPackage, output: string): Promise<string> {
  const candidate = parseCodexOutput(output, 0);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("视觉资产准备结果格式无效。");
  const result = candidate as Record<string, unknown>;
  if (result.status !== "completed") return output;
  const requests = visualAssetRequests(result.visualAssetRequests);
  if (!requests.length) return output;
  const imageGeneration = taskPackage.visualAssetPreparation?.imageGeneration;
  if (!imageGeneration) throw new Error("视觉资产存在缺失项，但没有冻结的图片 Adapter。" );
  if (imageGeneration.provider !== "openai" || imageGeneration.adapter !== "openai_images") throw new Error("冻结的图片 Adapter 没有可用执行路径。" );
  const apiKey = process.env[credentialEnvironmentForReference(imageGeneration.provider, imageGeneration.adapter, imageGeneration.credentialRef) ?? ""];
  if (!apiKey?.trim()) throw new Error("OPENAI_API_KEY 未配置，无法生成冻结视觉资产。" );
  const generated: ArtifactManifest[] = [];
  for (const request of requests) {
    const bytes = await generateOpenAiImage({ apiKey, fetcher: fetch, model: imageGeneration.model, prompt: request.prompt });
    const relativePath = `episodes/${taskPackage.episode.id}/visuals/${request.id}.png`;
    await writeSafeAssetFile(taskPackage.assets.allowedRoot, relativePath, bytes);
    generated.push({ artifactType: "static_visual", relativePath, sha256: createHash("sha256").update(bytes).digest("hex"), fileSize: bytes.byteLength });
  }
  if (!Array.isArray(result.artifacts)) throw new Error("视觉资产准备结果缺少产物清单。" );
  result.artifacts = [...result.artifacts, ...generated];
  return JSON.stringify(result);
}

function visualAssetRequests(value: unknown): VisualAssetRequest[] {
  if (!Array.isArray(value)) throw new Error("视觉资产准备缺少图片生成需求。" );
  return value.map((request) => {
    if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("视觉图片生成需求格式无效。" );
    const value = request as Record<string, unknown>;
    if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id) || typeof value.prompt !== "string" || !value.prompt.trim()) throw new Error("视觉图片生成需求格式无效。" );
    return { id: value.id, prompt: value.prompt, inputBasis: [] };
  });
}

async function preflightTask(taskPackage: WorkerTaskPackage): Promise<WorkerPreflightResult> {
  const capability = runtimeCapabilityFromTask(taskPackage);
  const credential = credentialEnvironmentForReference(taskPackage.provider, taskPackage.aRoll?.adapter ?? taskPackage.media?.adapter, taskPackage.credentialRef);
  const command = runtimeCommandForProvider(taskPackage.provider);
  const commandStatus = command ? await workerCommandStatus(command) : undefined;
  const commands = command && commandStatus ? { [command]: commandStatus } : undefined;
  const modelProbe = taskPackage.provider === "codex" && commandStatus?.available
    ? await probeCodexModel(taskPackage.model, (probeCommand, argumentsList, options) => runCommandWithOutput(probeCommand, argumentsList, options?.timeoutMs), tmpdir())
    : undefined;
  const apiKey = credential ? process.env[credential]?.trim() : undefined;
  const providerProbe = apiKey && taskPackage.provider !== "codex" ? await probeProviderConnection(taskPackage.provider, apiKey, fetch, taskPackage.model) : undefined;
  return createRuntimePreflight([capability], {
    credentials: credential ? { [credential]: Boolean(process.env[credential]?.trim()) } : undefined,
    commands,
    ...(modelProbe ? { modelPermissions: { [taskPackage.model]: modelProbe.modelPermission }, connections: { [taskPackage.provider]: modelProbe.connection } } : {}),
    ...(providerProbe ? { connections: { [taskPackage.provider]: providerProbe.connection }, ...(providerProbe.credentialValidity && credential ? { credentialValidity: { [credential]: providerProbe.credentialValidity } } : {}), ...(providerProbe.modelPermission ? { modelPermissions: { [taskPackage.model]: providerProbe.modelPermission } } : {}) } : {}),
  });
}

async function workerCommandStatus(command: string): Promise<{ available: boolean; detail: string }> {
  try {
    const result = await runCommandWithOutput(command, runtimeCommandArguments(command));
    return { available: true, detail: result.stdout.split("\n")[0] || `${command} 可调用。` };
  } catch (error) {
    return { available: false, detail: error instanceof Error ? `${command} 无法调用：${error.message}` : `${command} 无法调用。` };
  }
}

async function extractMp3Artifact(sourcePath: string, minimumDurationSeconds: number): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "tk-workflow-audio-"));
  const outputPath = join(directory, "derived.mp3");
  try {
    await runCommand("ffmpeg", ["-nostdin", "-v", "error", "-i", sourcePath, "-vn", "-codec:a", "libmp3lame", "-q:a", "2", outputPath]);
    const { stdout } = await runCommandWithOutput("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputPath]);
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration < minimumDurationSeconds) throw new Error(`派生音频不可播放或时长不足：${duration || "未知"} 秒。`);
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function trimMp3Artifact(bytes: Uint8Array, targetDurationSeconds: number): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "tk-workflow-soundtrack-"));
  const inputPath = join(directory, "source.mp3");
  const outputPath = join(directory, "trimmed.mp3");
  try {
    await writeFile(inputPath, bytes);
    await runCommand("ffmpeg", ["-nostdin", "-v", "error", "-i", inputPath, "-t", String(targetDurationSeconds), "-codec:a", "libmp3lame", "-q:a", "2", outputPath]);
    const duration = await probeMp3Artifact(outputPath);
    if (duration + 0.15 < targetDurationSeconds) throw new Error(`Freesound 裁剪后的音频时长不足：${duration} 秒。`);
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function probeMp3Artifact(path: string): Promise<number> {
  const { stdout } = await runCommandWithOutput("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("音频不可播放或缺少有效时长。");
  return duration;
}

async function validateMp4Artifact(path: string, minimumDurationSeconds: number): Promise<void> {
  const { stdout } = await runCommandWithOutput("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration < minimumDurationSeconds) {
    throw new Error(`Pexels 视频不可播放或时长不足：${duration || "未知"} 秒。`);
  }
}

async function inspectMp4Artifact(path: string): Promise<{ durationSeconds: number; width: number; height: number; hasAudio: boolean; blackFrameCount: number }> {
  const { stdout } = await runCommandWithOutput("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path]);
  const inspected = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
  const durationSeconds = Number(inspected.format?.duration);
  const video = inspected.streams?.find((stream) => stream.codec_type === "video");
  if (!Number.isFinite(durationSeconds) || !video || !Number.isInteger(video.width) || !Number.isInteger(video.height)) throw new Error("最终视频缺少有效的时长或视频流。");
  const black = await runCommandWithOutput("ffmpeg", ["-nostdin", "-v", "info", "-i", path, "-vf", "blackdetect=d=0.1:pix_th=0.02", "-an", "-f", "null", "-"]);
  return { durationSeconds, width: Number(video.width), height: Number(video.height), hasAudio: Boolean(inspected.streams?.some((stream) => stream.codec_type === "audio")), blackFrameCount: (black.stderr.match(/black_start:/g) ?? []).length };
}

async function reportResult(taskId: string, attempt: number, workerResult: unknown): Promise<void> {
  const { error } = await supabase.rpc("report_worker_result", {
    p_task_id: taskId,
    p_attempt: attempt,
    p_result: workerResult,
  });
  if (error) throw new Error(`Unable to report the worker result: ${error.message}`);
}

async function verifyAssetRoot(allowedAssetRoot: string): Promise<void> {
  await verifyMediaLibrary({
    assetRoot: allowedAssetRoot,
    mountPath: mediaLibraryMountPath,
    minimumFreeBytes: mediaLibraryMinimumFreeBytes,
  });
}

async function verifyArtifacts(taskPackage: WorkerTaskPackage, artifacts: ArtifactManifest[], storyboard?: StoryboardManifest): Promise<void> {
  await verifyArtifactIndex({ assetRoot: taskPackage.assets.allowedRoot, episodeId: taskPackage.episode.id, artifacts });
  if (storyboard) await verifyReportedStoryboardArtifact({
    assetRoot: taskPackage.assets.allowedRoot,
    frozenInputs: [...taskPackage.assets.inputs],
    relativePath: taskPackage.output.relativePath,
    storyboard,
  });
}

async function executeCodex(taskPackage: WorkerTaskPackage): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "tk-workflow-codex-"));
  const schemaPath = join(directory, "worker-result.schema.json");
  const resultPath = join(directory, "result.json");
  try {
    await writeFile(schemaPath, JSON.stringify(workerResultJsonSchema(taskPackage.capability)));
    await runCommand("codex", [
      "exec",
      "--approve-for-me",
      "--ephemeral",
      "--skip-git-repo-check",
      "--cd", taskPackage.assets.allowedRoot,
      "--model", taskPackage.model,
      "--output-schema", schemaPath,
      "--output-last-message", resultPath,
      buildCodexPrompt(taskPackage),
    ], codexExecutionTimeoutMs);
    return await readFile(resultPath, "utf8");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function buildCodexPrompt(taskPackage: WorkerTaskPackage): string {
  return [
    "You are the Codex Content Worker for a controlled production platform.",
    "Work only inside assets.allowedRoot. Do not inspect, modify, or transmit files outside that directory.",
    "Use only the tools listed in allowedTools. If the task cannot be completed with them, return blocked instead of substituting another tool.",
    "allowedTools is a capability policy, not a list of Codex tool names. When it includes read and write, use your normal workspace filesystem tools only to read and write within assets.allowedRoot.",
    "When task package includes seriesBaseline, it is an approved, frozen reusable base. For visual planning, do not regenerate covered characters, voices, or visual references; create only additions or explicit deviations. When visualAssetPreparation is present, write the required visual_asset_manifest as Markdown: list every frozen external visual input by its role, list only the missing character, location, prop, or key-frame needs, and cite the frozen input paths that justify each item. Also return visualAssetRequests: [] when external assets fully cover the need; otherwise return one request per missing item, each with a lowercase kebab-case id, an explicit image prompt, and inputBasis paths/hashes drawn only from frozen inputs. Do not create SVGs, placeholder images, or a static_visual artifact yourself. The registered image Adapter will create only the returned missing requests; without one, return blocked rather than claiming completion.",
    "For a completed storyboard_planning task, write the primary artifact as valid JSON and also return the identical object in result.storyboard. It must have version storyboard/v1, a non-empty shots array, and an audioCues array (empty when no BGM/SFX is needed). Every shot needs id, scriptSegment, durationSeconds, shotType (a_roll or b_roll), productionMethod, inputBasis (objects containing each frozen input's relativePath and sha256), and targetSpec. Each optional audio cue needs id, kind (bgm or sfx), description, searchQuery, startSeconds, and durationSeconds. description is the Owner-facing display text; searchQuery is a concise English Freesound search phrase of at most 100 characters. Each shot must include the frozen main script and at least one approved visual input. For a blocked or failed storyboard_planning task, set result.storyboard to null. Do not generate or queue A-roll, B-roll, or audio media; this task is only the reviewable storyboard. When reviewAnnotations are present, revise the matching shot IDs to address their reasons.",
    "For a_roll_generation, create only the frozen shot in aRoll with its declared aRoll.adapter. Do not replace the adapter, add other shots, scan for newer inputs, or advance an Episode stage. Use only aRoll.shot.inputBasis and produce the frozen video output contract; if the declared adapter cannot produce that output, return blocked with an explicit blocker.",
    "Do not approve, publish, change any blueprint, call platform APIs, or change an Episode stage.",
    "If any required input, tool, permission, or rule is missing, return status blocked with explicit blockers; do not silently substitute a provider.",
    ...(taskPackage.promptHarness ? ["Frozen Prompt Harness (follow it unless it conflicts with the fixed safety rules above):", taskPackage.promptHarness.content] : []),
    `Create the required artifact at output.relativePath inside episodes/${taskPackage.episode.id}/ and return a JSON result that matches the provided schema. Use paths relative to assets.allowedRoot and SHA-256 hashes in lowercase hexadecimal.`,
    "The retry reason must always be non-empty. For a completed result, set retry.shouldRetry to false and retry.reason to Completed successfully.",
    "Task package:",
    JSON.stringify(taskPackage),
  ].join("\n\n");
}

function runCommand(command: string, argumentsList: string[], timeoutMs?: number): Promise<void> {
  return runCommandWithOutput(command, argumentsList, timeoutMs).then(() => undefined);
}

function runCommandWithOutput(command: string, argumentsList: string[], timeoutMs?: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = timeoutMs ? setTimeout(() => {
      child.kill("SIGTERM");
      if (settled) return;
      settled = true;
      reject(new Error(`${command} 执行超时。`));
    }, timeoutMs) : undefined;
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `Codex exited with status ${code ?? "unknown"}.`));
    });
  });
}
