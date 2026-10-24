import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv, promisify } from "node:util";
import { startWorkerScheduler } from "../orchestration/workerScheduler";
import type { DispatchScope, WorkerDispatchOptions } from "../orchestration/workerDispatch";
import { assertPreparedRuntime } from "../orchestration/runtimeBuild";

const services = new Map<string, Awaited<ReturnType<typeof startWorkerScheduler>>>();
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CODEX_WORKER_ACTUAL_COST_CENTS", "MEDIA_LIBRARY_MOUNT_PATH", "MEDIA_LIBRARY_MIN_FREE_BYTES"];

export function assertWorkerDispatchEnvironment(contents: string): void {
  const environment = parseEnv(contents);
  const missing = required.filter(name => !environment[name]?.trim());
  if (missing.length) throw Error(`Worker 即时派发配置不完整：${missing.join("、")}`);
}

export function workerDispatchOptions(supabaseUrl: string | undefined): WorkerDispatchOptions & {supabaseUrl:string;serviceRoleKey:string} {
  const environment = process.env.SUPABASE_URL ? { ...process.env } : {
    ...process.env, ...parseEnv(readFileSync(join(process.cwd(), "n8n/worker.env.local"), "utf8")),
  };
  if (!supabaseUrl || environment.SUPABASE_URL !== supabaseUrl) throw Error("Worker 与 HTTP 服务的数据库绑定不一致，拒绝派发。");
  assertWorkerDispatchEnvironment(Object.entries(environment).map(([key, value]) => `${key}=${JSON.stringify(value ?? "")}`).join("\n"));
  return {
    projectRoot: process.cwd(), supabaseUrl, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY!, environment,
    concurrency: Number(environment.LOOP_WORKER_CONCURRENCY ?? environment.CODEX_WORKER_CAPACITY ?? "2"),
  };
}

export async function startLocalWorkerService(supabaseUrl: string | undefined) {
  if (!process.env.SUPABASE_URL && !existsSync(join(process.cwd(), "n8n/worker.env.local"))) return;
  const options = workerDispatchOptions(supabaseUrl);
  if (services.has(options.supabaseUrl)) throw Error("本机Worker调度器已启动，拒绝重复注册。");
  await promisify(execFile)(process.execPath, [join(options.projectRoot, "scripts/prepare-runtime.mjs")], { cwd: options.projectRoot, env: options.environment });
  const scheduler = await startWorkerScheduler(options);
  services.set(options.supabaseUrl, scheduler);
  return {
    ...scheduler,
    async stop() {
      if (services.get(options.supabaseUrl) === scheduler) services.delete(options.supabaseUrl);
      await scheduler.stop();
    },
  };
}

export function wakeLocalWorkerService(supabaseUrl: string | undefined, scope: DispatchScope) {
  const scheduler = supabaseUrl ? services.get(supabaseUrl) : undefined;
  if (!scheduler) throw Error("本机Worker调度器未准备；请运行 runtime:prepare 并重启服务。");
  scheduler.wake(scope);
}

export async function assertLocalWorkerServiceReady(supabaseUrl: string | undefined) {
  if (!supabaseUrl || !services.has(supabaseUrl)) throw Error("本机Worker调度器未准备；请运行 runtime:prepare 并重启服务。");
  await assertPreparedRuntime(process.cwd());
}
