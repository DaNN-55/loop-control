import {generateVisualAssets} from './visualAssetExecutor.js';
import {extractMp3Artifact,trimMp3Artifact,trimMp4Artifact,trimMp4SegmentsArtifact,probeMp3Artifact,validateMp4Artifact,inspectMp4Artifact} from './mediaTools.js';
import { assertPreparedRuntime } from "../orchestration/runtimeBuild.js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  runCodexWorker,
  parseCodexOutput,
  type ClaimedWorkerTask,
  type WorkerProgress,
} from "./codexRunner.js";
import type { ArtifactManifest, WorkerPreflightResult, WorkerTaskPackage } from "./contracts.js";
import type { StoryboardManifest } from "./contracts.js";
import { verifyArtifactIndex, verifyMediaLibrary } from "./mediaLibrary.js";
import { nonNegativeIntegerEnvironment, requiredEnvironment } from "./runtimeEnvironment.js";
import { addFrozenStoryboardBasis, refreshArtifactManifest, verifyReportedStoryboardArtifact } from "./storyboardArtifact.js";
import { executeStoryboardRevision } from "./storyboardRevisionExecutor.js";
import { workerResultJsonSchema } from "./workerResultSchema.js";
import { executeControlledMediaTask, writeSafeAssetFile } from "./controlledMediaExecutor.js";
import { createHash } from "node:crypto";
import { executeOpenChatCutRender } from "./openchatcutRenderer.js";
import { readTaskIdArgument } from "./taskClaimArguments.js";
import { createRuntimePreflight, type RuntimeEvidenceAdapter, type RuntimeEvidenceDemand, type RuntimeEvidenceFact } from "./runtimePreflight.js";
import { credentialEnvironmentForReference, runtimeCommandArguments, runtimeCommandInvocation } from "./runtimeEvidence.js";
import { probeCodexModel, probeProviderConnection } from "./runtimeProbes.js";
import { runLocalWhisperXAlignment } from "./whisperxAlignment.js";

const supabaseUrl = requiredEnvironment("SUPABASE_URL");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const actualCostCents = nonNegativeIntegerEnvironment("CODEX_WORKER_ACTUAL_COST_CENTS");
const mediaLibraryMountPath = requiredEnvironment("MEDIA_LIBRARY_MOUNT_PATH");
const mediaLibraryMinimumFreeBytes = nonNegativeIntegerEnvironment("MEDIA_LIBRARY_MIN_FREE_BYTES");
const workerCapacity = Number(process.env.CODEX_WORKER_CAPACITY ?? "2");
if (!Number.isSafeInteger(workerCapacity) || workerCapacity <= 0) throw new Error("CODEX_WORKER_CAPACITY must be a positive integer.");
const codexExecutionTimeoutMs = Number(process.env.CODEX_WORKER_EXECUTION_TIMEOUT_MS ?? "300000");
if (!Number.isSafeInteger(codexExecutionTimeoutMs) || codexExecutionTimeoutMs <= 0) throw new Error("CODEX_WORKER_EXECUTION_TIMEOUT_MS must be a positive integer.");
const fromDispatcher = process.argv.length === 3 && process.argv[2] === "--claimed-task";
const requestedTaskId = fromDispatcher ? null : readTaskIdArgument(process.argv.slice(2));
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const workerLeaseHeartbeatMs = 5 * 60 * 1000;
let leaseHeartbeat: ReturnType<typeof setInterval> | undefined;
let activeLease: { taskId: string; attempt: number; token: string } | undefined;

await assertPreparedRuntime(process.env.LOOP_PROJECT_ROOT ?? process.cwd());
const result = await runCodexWorker({
  claimNextTask: claimNextTask,
  reportResult,
  verifyAssetRoot,
  verifyArtifacts,
  preflight: preflightTask,
  reportProgress,
  execute: executeTask,
  actualCostCents,
});

process.stdout.write(`${JSON.stringify(result)}\n`);

async function claimNextTask(): Promise<ClaimedWorkerTask | null> {
  let row;
  if (fromDispatcher) {
    let input = "";
    for await (const chunk of process.stdin) { input += chunk.toString(); if (Buffer.byteLength(input) > 10 * 1024 * 1024) throw new Error("Claimed task package is too large."); }
    row = JSON.parse(input);
    // Validate the actual attempt/token before running an already reserved task.
    const { error } = await supabase.rpc("refresh_worker_task_lease", { p_task_id: row.task_id, p_attempt: row.attempt, p_lease_token: row.lease_token });
    if (error) throw new Error(`Unable to validate dispatched Worker lease: ${error.message}`);
  } else {
  const { data, error } = await supabase.rpc("claim_next_worker_task", { p_worker_capacity: workerCapacity, ...(requestedTaskId ? { p_task_id: requestedTaskId } : {}) });
  if (error) throw new Error(`Unable to claim a worker task: ${error.message}`);
  row = data?.[0];
  }
  if (!row) return null;
  if (row.provider !== "codex" && row.provider !== "google_tts" && row.provider !== "volcengine_tts" && row.provider !== "pexels" && row.provider !== "ffmpeg" && row.provider !== "freesound" && row.provider !== "openchatcut" && row.provider !== "openai" && row.provider !== "cloudflare" && row.provider !== "whisperx") throw new Error(`Unsupported worker provider: ${row.provider}`);
  if (typeof row.lease_token !== "string" || !/^[0-9a-f-]{36}$/i.test(row.lease_token)) throw new Error("Claimed task has no valid lease token; upgrade the database.");
  activeLease = { taskId: row.task_id, attempt: row.attempt, token: row.lease_token };
  startLeaseHeartbeat(row.task_id, row.attempt);

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
  if (taskPackage.storyboardRevision) return executeStoryboardRevision(taskPackage);
  if (taskPackage.provider === "codex") {
    const output = await executeCodex(taskPackage);
    const completedOutput = taskPackage.visualAssetPreparation?.imageGeneration ? await generateVisualAssets(taskPackage, output, resolveConnectionSecret, fetch) : output;
    return taskPackage.capability === "storyboard_planning" ? useWrittenStoryboard(taskPackage, completedOutput) : completedOutput;
  }
  if (taskPackage.provider === "openchatcut") {
    const input = { taskPackage, run: runCommand, validateMp4: validateMp4Artifact, inspectMp4: inspectMp4Artifact,
      ...(taskPackage.finalRender?{getApprovedReuseSource:async()=>{
        const {data,error}=await supabase.rpc("final_render_reuse_source",{p_task_id:taskPackage.task.id,p_attempt:taskPackage.budget.attempt,p_lease_token:leaseToken(taskPackage.task.id,taskPackage.budget.attempt)});
        if(error||!data||data.reviewPackageId!==taskPackage.finalRender?.sourceReviewPackageId)throw Error("最终成片来源审核已失效或无法核验，停止执行。");
        return data;
      }}:{}) };
    return executeOpenChatCutRender(input);
  }
  if (taskPackage.provider === "whisperx") return executeWhisperXTask(taskPackage);
  const apiKey = await resolveTaskSecret(taskPackage);
  return executeControlledMediaTask({
    taskPackage,
    fetcher: fetch,
    pexelsApiKey: taskPackage.provider === "pexels" ? apiKey : undefined,
    googleTtsApiKey: taskPackage.provider === "google_tts" ? apiKey : undefined,
    volcengineTtsApiKey: taskPackage.provider === "volcengine_tts" ? apiKey : undefined,
    freesoundApiKey: taskPackage.provider === "freesound" ? apiKey : undefined,
    openaiApiKey: taskPackage.provider === "openai" ? apiKey : undefined,
    cloudflareWorkersAiCredentials: taskPackage.provider === "cloudflare" ? apiKey : undefined,
    validateMp4: validateMp4Artifact,
    probeMp3: probeMp3Artifact,
    extractMp3: extractMp3Artifact,
    trimMp3: trimMp3Artifact,
    trimMp4: trimMp4Artifact,
    trimMp4Segments: trimMp4SegmentsArtifact,
    whisperXCacheDirectory: process.env.WHISPERX_MODEL_CACHE?.trim() || join(mediaLibraryMountPath, ".cache", "whisperx"),
  });
}

async function executeWhisperXTask(taskPackage: WorkerTaskPackage): Promise<string> {
  const alignment = taskPackage.acousticAlignment;
  if (taskPackage.capability !== "acoustic_alignment" || !alignment?.audioRelativePath || !alignment.audioSha256 || !alignment.inputVersion) throw new Error("本地 WhisperX 任务缺少冻结对齐输入。");
  const result = await runLocalWhisperXAlignment({
    audioPath: join(taskPackage.assets.allowedRoot, alignment.audioRelativePath),
    audioSha256: alignment.audioSha256,
    cacheDirectory: process.env.WHISPERX_MODEL_CACHE?.trim() || join(mediaLibraryMountPath, ".cache", "whisperx"),
    confirmedText: alignment.confirmedText,
    model: taskPackage.model,
    speakingRate: alignment.speakingRate ?? 1,
    voice: alignment.voice ?? "",
  });
  const content = new TextEncoder().encode(`${JSON.stringify(result, null, 2)}\n`);
  await writeSafeAssetFile(taskPackage.assets.allowedRoot, taskPackage.output.relativePath, content);
  const artifact = { artifactType: taskPackage.output.requiredArtifactTypes[0] ?? "acoustic_alignment_evidence", relativePath: taskPackage.output.relativePath, sha256: createHash("sha256").update(content).digest("hex"), fileSize: content.byteLength };
  return JSON.stringify({ version: "worker-result/v1", taskId: taskPackage.task.id, status: "completed", artifacts: [artifact], acousticAlignment: result, validation: { passed: true, checks: [{ name: "whisperx_alignment_output", passed: true, detail: result.status === "completed" ? "本地 WhisperX 时序与 Owner 正文已完整匹配。" : "本地 WhisperX 已返回候选时序和人工检查区间。" }] }, actualCostCents: 0, blockers: [], retry: { shouldRetry: false, reason: "Local alignment completed." }, nextStep: result.status === "completed" ? "Review the current shot timing." : "Owner must review unmatched or low-confidence intervals." });
}


async function useWrittenStoryboard(taskPackage: WorkerTaskPackage, output: string): Promise<string> {
  const candidate = parseCodexOutput(output, 0);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("分镜结果格式无效。");
  const result = candidate as Record<string, unknown>;
  if (result.status !== "completed") return output;
  const relativePath = taskPackage.output.relativePath;
  const storyboard = addFrozenStoryboardBasis(JSON.parse(await readFile(join(taskPackage.assets.allowedRoot, relativePath), "utf8")), taskPackage.assets.inputs);
  const content = `${JSON.stringify(storyboard, null, 2)}\n`;
  await writeFile(join(taskPackage.assets.allowedRoot, relativePath), content);
  return JSON.stringify({ ...result, artifacts: refreshArtifactManifest(result.artifacts, relativePath, content), storyboard });
}

async function preflightTask(taskPackage: WorkerTaskPackage): Promise<WorkerPreflightResult> {
  const evidence = workerRuntimeEvidenceAdapter(taskPackage);
  return (await createRuntimePreflight(evidence).inspect({ kind: "worker_task", taskPackage })).report;
}

function workerRuntimeEvidenceAdapter(taskPackage: WorkerTaskPackage): RuntimeEvidenceAdapter {
  return {
    async collect({ demands }) {
      const commands = new Map<string, Promise<{ available: boolean; detail: string }>>();
      const secrets = new Map<string, Promise<string | undefined>>();
      const providers = new Map<string, Promise<Awaited<ReturnType<typeof probeProviderConnection>> | undefined>>();
      const codexModels = new Map<string, Promise<Awaited<ReturnType<typeof probeCodexModel>> | undefined>>();
      const commandStatus = (command: string) => {
        let pending = commands.get(command);
        if (!pending) {
          pending = workerCommandStatus(command);
          commands.set(command, pending);
        }
        return pending;
      };
      const secretFor = (demand: RuntimeEvidenceDemand) => {
        const key = demand.credentialRef ?? demand.credential ?? demand.provider ?? demand.key;
        let pending = secrets.get(key);
        if (!pending) {
          pending = demand.credential
            ? Promise.resolve(process.env[demand.credential]?.trim())
            : resolveConnectionSecret(demand.credentialRef, demand.provider ?? "", demand.adapter, taskPackage.accountId);
          secrets.set(key, pending);
        }
        return pending;
      };
      const providerProbe = (demand: RuntimeEvidenceDemand) => {
        const key = `${demand.provider}:${demand.credentialRef ?? demand.credential ?? ""}:${demand.model ?? ""}`;
        let pending = providers.get(key);
        if (!pending) pending = secretFor(demand).then((secret) => secret && demand.provider && demand.provider !== "codex" ? probeProviderConnection(demand.provider, secret, fetch, demand.model) : undefined);
        providers.set(key, pending);
        return pending;
      };
      const codexProbe = (demand: RuntimeEvidenceDemand) => {
        const model = demand.model ?? demand.key;
        let pending = codexModels.get(model);
        if (!pending) pending = commandStatus("codex").then((status) => status.available ? probeCodexModel(model, (probeCommand, argumentsList, options) => runCommandWithOutput(probeCommand, argumentsList, options?.timeoutMs), tmpdir()) : undefined);
        codexModels.set(model, pending);
        return pending;
      };
      return Promise.all(demands.map(async (demand): Promise<RuntimeEvidenceFact> => {
        if (demand.kind === "asset_root" || demand.kind === "media_library") return { ...demand, state: "not_applicable" };
        if (demand.kind === "command_availability") return { ...demand, state: "observed", value: await commandStatus(demand.command ?? demand.key) };
        if (demand.kind === "local_adapter_readiness") return { ...demand, state: "observed", value: demand.command ? await commandStatus(demand.command) : { available: false, detail: `本地 ${demand.key} 尚未完成当前 Worker 就绪探测。` } };
        if (demand.kind === "connection_reference") {
          const secret = await secretFor(demand);
          return { ...demand, state: "observed", value: secret ? { available: true, detail: "外部连接引用已解析。" } : { available: false, detail: "外部连接秘密不可用。" } };
        }
        if (demand.kind === "credential_presence") return { ...demand, state: "observed", value: Boolean(await secretFor(demand)) };
        if (demand.kind === "model_permission") {
          const probe = demand.provider === "codex" ? await codexProbe(demand) : await providerProbe(demand);
          return probe?.modelPermission ? { ...demand, state: "observed", value: probe.modelPermission } : { ...demand, state: "not_applicable" };
        }
        if (demand.kind === "network_connectivity") {
          const probe = demand.provider === "codex" ? await codexProbe(demand) : await providerProbe(demand);
          return probe?.connection ? { ...demand, state: "observed", value: probe.connection } : { ...demand, state: "not_applicable" };
        }
        const probe = await providerProbe(demand);
        return probe?.credentialValidity ? { ...demand, state: "observed", value: probe.credentialValidity } : { ...demand, state: "not_applicable" };
      }));
    },
  };
}

async function resolveTaskSecret(taskPackage: WorkerTaskPackage): Promise<string | undefined> {
  return resolveConnectionSecret(taskPackage.credentialRef, taskPackage.provider, taskPackage.aRoll?.adapter ?? taskPackage.media?.adapter, taskPackage.accountId);
}

async function resolveConnectionSecret(credentialRef: string | undefined, provider: string, adapter: string | undefined, accountId: string): Promise<string | undefined> {
  if (credentialRef && isConnectionId(credentialRef)) {
    const { data, error } = await supabase.rpc("resolve_external_connection_secret", { p_account_id: accountId, p_connection_id: credentialRef });
    if (error) throw new Error("无法解析 Worker 外部连接秘密。");
    return typeof data === "string" && data.trim() ? data.trim() : undefined;
  }
  if (provider === "pexels" || provider === "openai" || provider === "cloudflare") return undefined;
  const credential = credentialEnvironmentForReference(provider, adapter, credentialRef);
  return credential ? process.env[credential]?.trim() : undefined;
}

function isConnectionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function workerCommandStatus(command: string): Promise<{ available: boolean; detail: string }> {
  try {
    const result = await runCommandWithOutput(command, runtimeCommandArguments(command));
    return { available: true, detail: result.stdout.split("\n")[0] || `${command} 可调用。` };
  } catch (error) {
    return { available: false, detail: error instanceof Error ? `${command} 无法调用：${error.message}` : `${command} 无法调用。` };
  }
}

async function reportResult(taskId: string, attempt: number, workerResult: unknown): Promise<void> {
  try {
    const { error } = await supabase.rpc("report_worker_result", {
      p_task_id: taskId,
      p_attempt: attempt,
      p_result: workerResult,
      p_lease_token: leaseToken(taskId, attempt),
    });
    if (error) throw new Error(`Unable to report the worker result: ${error.message}`);
  } finally {
    stopLeaseHeartbeat();
  }
}

async function reportProgress(taskId: string, attempt: number, progress: WorkerProgress): Promise<void> {
  const value = { version: "worker-progress/v1", progress };
  const { error } = await supabase.rpc("report_worker_progress", {
    p_task_id: taskId, p_attempt: attempt, p_lease_token: leaseToken(taskId, attempt), p_progress: value,
  });
  if (error) throw new Error(`Unable to report Worker progress: ${error.message}`);
}

function leaseToken(taskId: string, attempt: number): string {
  if (!activeLease || activeLease.taskId !== taskId || activeLease.attempt !== attempt) throw new Error("Worker lease does not match this attempt.");
  return activeLease.token;
}

function startLeaseHeartbeat(taskId: string, attempt: number): void {
  stopLeaseHeartbeat();
  leaseHeartbeat = setInterval(() => {
    void (async () => {
      try {
        const { error } = await supabase.rpc("refresh_worker_task_lease", { p_task_id: taskId, p_attempt: attempt, p_lease_token: leaseToken(taskId, attempt) });
        if (error) process.stderr.write(`Unable to refresh the worker lease: ${error.message}\n`);
      } catch (error) {
        process.stderr.write(`Unable to refresh the worker lease: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    })();
  }, workerLeaseHeartbeatMs);
  leaseHeartbeat.unref?.();
}

function stopLeaseHeartbeat(): void {
  if (!leaseHeartbeat) return;
  clearInterval(leaseHeartbeat);
  leaseHeartbeat = undefined;
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
  const directory = await mkdtemp(join(tmpdir(), "loop-control-codex-"));
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
    const invocation = runtimeCommandInvocation(command, argumentsList);
    const child = spawn(invocation.command, invocation.argumentsList, { stdio: ["ignore", "pipe", "pipe"] });
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
