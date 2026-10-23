import { spawn } from "node:child_process";
import { join } from "node:path";
import { runWithConcurrency } from "./providedScriptDispatch.js";

export type DispatchScope = { taskId?: string; episodeId?: string };
export interface WorkerDispatchOptions {
  projectRoot: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  environment?: NodeJS.ProcessEnv;
  concurrency: number;
}

// tasks is the durable queue: its ID identifies a frozen input. All entry points
// scan the same rows, then let the fenced DB claim decide capacity and ownership.
// A process-local wake is only a latency hint, never an execution/status record.
export async function dispatchWorkerTasks(options: WorkerDispatchOptions, scope: DispatchScope = {}) {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency <= 0) throw new Error("Worker concurrency must be a positive integer.");
  const expiredBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  // Preserve the light idle path. The DB still decides lease validity at claim.
  if (!scope.taskId && !scope.episodeId && !await hasPendingWork()) return { plannedTasks: 0, queuedTasks: 0, workers: [], productionReadyEpisodes: 0, preRenderReviewPackages: 0, skipped: "idle" };
  const planned = scope.taskId ? [] : await planTasks(scope.episodeId);
  const candidates: Array<{ id: string }> = [];
  for (let offset = 0; ; offset += 1000) {
    const endpoint = new URL("/rest/v1/tasks", options.supabaseUrl);
    endpoint.searchParams.set("select", "id");
    endpoint.searchParams.set("or", `(status.eq.ready,and(status.eq.running,or(claimed_at.is.null,claimed_at.lte.${expiredBefore})))`);
    endpoint.searchParams.set("order", "created_at.asc,id.asc");
    endpoint.searchParams.set("limit", "1000");
    endpoint.searchParams.set("offset", String(offset));
    if (scope.taskId) endpoint.searchParams.set("id", `eq.${scope.taskId}`);
    if (scope.episodeId) endpoint.searchParams.set("episode_id", `eq.${scope.episodeId}`);
    const response = await fetch(endpoint, { headers: headers() });
    if (!response.ok) throw new Error(`读取持久任务队列失败：Supabase 返回 HTTP ${response.status}`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.some(row => !isRecord(row) || typeof row.id !== "string")) throw new Error("持久任务队列格式无效。");
    candidates.push(...rows as Array<{ id: string }>);
    if (rows.length < 1000) break;
  }
  if (candidates.length) await runCommand("npm", ["run", "worker:build"]);
  const workers = await runWithConcurrency(candidates, options.concurrency, async task => {
    const result = await runCommand(process.execPath, [join(options.projectRoot, "dist/worker/worker/codexWorkerCli.js"), "--task-id", task.id]);
    const line = result.stdout.trim().split("\n").at(-1);
    if (!line) throw new Error("Worker 没有输出结果。");
    return JSON.parse(line) as unknown;
  });
  const productionReadyEpisodes = scope.taskId ? [] : await orchestrateTasks("advance_production_ready_episodes", scope.episodeId ? { p_episode_id: scope.episodeId } : {});
  const preRenderPackages = scope.taskId ? [] : await orchestrateTasks(scope.episodeId ? "create_pre_render_review_packages_for_episode" : "create_pre_render_review_packages", scope.episodeId ? { p_episode_id: scope.episodeId } : {});
  return { plannedTasks: planned.length, queuedTasks: candidates.length, workers, productionReadyEpisodes: productionReadyEpisodes.length, preRenderReviewPackages: preRenderPackages.length };

  function headers() { return { apikey: options.serviceRoleKey, Authorization: `Bearer ${options.serviceRoleKey}` }; }
  function runCommand(command: string, argumentsList: string[]): Promise<{ stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, argumentsList, { cwd: options.projectRoot, env: options.environment ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve({ stdout }) : reject(new Error(stderr.trim() || `Worker 命令退出状态 ${code ?? "unknown"}。`)));
    });
  }
  async function hasPendingWork(): Promise<boolean> {
    for (const [table, filters] of [
      ["tasks", { or: `(status.eq.ready,and(status.eq.running,or(claimed_at.is.null,claimed_at.lte.${expiredBefore})))` }],
      ["episodes", { stage: "in.(script_approved,visual_approved,storyboard_approved,production_ready,render_ready,qc_passed)" }],
    ] as const) {
      const endpoint = new URL(`/rest/v1/${table}`, options.supabaseUrl);
      endpoint.searchParams.set("select", "id");
      endpoint.searchParams.set("limit", "1");
      for (const [key, value] of Object.entries(filters)) endpoint.searchParams.set(key, value);
      const response = await fetch(endpoint, { headers: headers() });
      if (!response.ok) throw new Error(`检查持久任务队列失败：Supabase 返回 HTTP ${response.status}`);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error("持久任务队列格式无效。");
      if (rows.length) return true;
    }
    return false;
  }

  async function planTasks(episodeId?: string): Promise<Array<{ id: string }>> {
    const args: Record<string, string> = episodeId ? { p_episode_id: episodeId } : {};
    const scoped = (name: string) => episodeId ? `${name}_for_episode` : name;
    const initial = await Promise.all([
      orchestrateTasks(scoped("orchestrate_provided_script_tasks"), args),
      orchestrateTasks(scoped("orchestrate_storyboard_tasks"), args),
    ]);
    const tasks = initial.flat();
    for (const name of [
      "orchestrate_b_roll_tasks", scoped("orchestrate_a_roll_tasks"), "orchestrate_narration_tasks",
      "orchestrate_soundtrack_tasks", "orchestrate_embedded_audio_tasks", "orchestrate_review_render_tasks", "orchestrate_final_render_tasks",
    ]) tasks.push(...await orchestrateTasks(name, args));
    return tasks;
  }

  async function orchestrateTasks(functionName: string, args: Record<string, string> = {}): Promise<Array<{ id: string }>> {
    const { supabaseUrl: url, serviceRoleKey } = options;
    const endpoint = new URL(`/rest/v1/rpc/${functionName}`, url);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error(`创建 Worker 任务失败：Supabase 返回 HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload) || payload.some((task) => !isRecord(task) || typeof task.id !== "string")) throw new Error("创建 Worker 任务失败：Supabase 返回格式无效。");
    return payload as Array<{ id: string }>;
  }

}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
