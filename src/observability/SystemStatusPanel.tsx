import { useMemo, useState } from "react";
import type { Database, Json } from "../lib/database.types";
import { useDialogFocus } from "../ui/useDialogFocus";

type Task = Database["public"]["Tables"]["tasks"]["Row"];
type Episode = Database["public"]["Tables"]["episodes"]["Row"];
export type SystemState = "healthy" | "attention" | "unknown" | "offline";

export interface LocalSystemStatusReport {
  dependencies: Array<{ detail: string; name: string; state: SystemState }>;
  mediaLibrary: { detail: string; state: SystemState };
  n8n: {
    detail: string;
    lastDispatchAt?: string | null;
    lastEventAt?: string | null;
    lastHealthCheckAt: string | null;
    lastNotification?: { at: string; state: "failure" | "success"; workflowName: string } | null;
    lastRunAt?: string | null;
    lastScheduleCheckAt?: string | null;
    lastWorkerDispatchAt?: string | null;
    state: SystemState;
  };
  observedAt: string;
  supabase?: { detail: string; state: SystemState };
}

export interface GoldenProductionTestReport {
  checks: Array<{ detail: string; name: string; passed: boolean }>;
  observedAt: string;
  passed: boolean;
}

interface StatusItem {
  detail: string;
  detailRows?: Array<{ label: string; state?: SystemState; value: string }>;
  id: string;
  label: string;
  state: SystemState;
}

function stateLabel(state: SystemState): string {
  return state === "healthy" ? "正常" : state === "attention" ? "需处理" : state === "offline" ? "不可用" : "待确认";
}

function formatDate(source: string | null): string {
  return source ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(source)) : "暂无记录";
}

function latestTask(tasks: Task[]): Task | null {
  return [...tasks].sort((left, right) => (right.completed_at ?? right.claimed_at ?? right.created_at).localeCompare(left.completed_at ?? left.claimed_at ?? left.created_at))[0] ?? null;
}

function snapshotString(snapshot: Json, ...path: string[]): string | null {
  let value: Json | undefined = snapshot;
  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    value = value[key];
  }
  return typeof value === "string" && value.trim() ? value : null;
}

function operationIdentity(task: Task): string {
  if (task.task_type === "generate_review_render" || task.task_type === "generate_final_render") return `episode-render-stage:${task.task_type}`;

  const snapshot = task.input_snapshot;
  const preparationDraftId = snapshotString(snapshot, "shot_preparation", "draft_id");
  if (preparationDraftId) return `shot-preparation:${preparationDraftId}`;

  const preparationReviewPackageId = snapshotString(snapshot, "shot_preparation", "review_package_id");
  const preparationShotId = snapshotString(snapshot, "shot_preparation", "shot_id");
  if (preparationReviewPackageId && preparationShotId) return `shot-preparation:${preparationReviewPackageId}:${preparationShotId}`;

  const storyboardReviewPackageId = snapshotString(snapshot, "storyboard_review_package_id");
  const shotId = snapshotString(snapshot, "shot", "id");
  if (storyboardReviewPackageId && shotId) return `storyboard-shot:${storyboardReviewPackageId}:${shotId}`;

  const audioReviewPackageId = snapshotString(snapshot, "audio_track", "source_review_package_id");
  const cueId = snapshotString(snapshot, "audio_track", "cue_id");
  if (audioReviewPackageId && cueId) return `audio-cue:${audioReviewPackageId}:${cueId}`;

  const outputPath = snapshotString(snapshot, "output", "relative_path");
  if (outputPath) return `output:${outputPath}`;

  return `task:${task.id}`;
}

function isLaterTask(candidate: Task, current: Task): boolean {
  const candidateAt = candidate.completed_at ?? candidate.claimed_at ?? candidate.created_at;
  const currentAt = current.completed_at ?? current.claimed_at ?? current.created_at;
  return candidateAt > currentAt || (candidateAt === currentAt && candidate.id > current.id);
}

function currentWorkerTasks(tasks: Task[]): Task[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const successfullyRecoveredTaskIds = new Set(tasks.flatMap((task) => {
    const recoveredTaskId = task.status === "completed" ? snapshotString(task.input_snapshot, "recovered_from_task_id") : null;
    const recoveredTask = recoveredTaskId ? tasksById.get(recoveredTaskId) : null;
    return recoveredTask && recoveredTask.episode_id === task.episode_id && recoveredTask.task_type === task.task_type ? [recoveredTask.id] : [];
  }));
  const latestByOperation = new Map<string, Task>();
  for (const task of tasks.filter((candidate) => !successfullyRecoveredTaskIds.has(candidate.id))) {
    const operationKey = `${task.episode_id}:${task.task_type}:${operationIdentity(task)}`;
    const latest = latestByOperation.get(operationKey);
    if (!latest || isLaterTask(task, latest)) latestByOperation.set(operationKey, task);
  }
  return [...latestByOperation.values()].filter((task) => task.status === "running" || task.status === "blocked" || task.status === "failed");
}

function workerStatus(currentTasks: Task[], latest: Task | null, blockedCount: number, failedCount: number): SystemState {
  if (blockedCount || failedCount) return "attention";
  if (currentTasks.some((task) => task.status === "running") || latest?.status === "completed") return "healthy";
  return "unknown";
}

function n8nStatus(report: LocalSystemStatusReport | null): { detail: string; state: SystemState } {
  if (!report) return { detail: "尚未读取本地 n8n 状态。", state: "unknown" };
  if (report.n8n.state !== "offline" && report.n8n.lastNotification?.state === "failure") {
    return { detail: report.n8n.detail, state: "attention" };
  }
  return { detail: report.n8n.detail, state: report.n8n.state };
}

function statusDependency(report: LocalSystemStatusReport | null, name: string): { detail: string; name: string; state: SystemState } | null {
  return report?.dependencies.find((dependency) => dependency.name === name) ?? null;
}

function combinedState(states: SystemState[]): SystemState {
  if (states.some((state) => state === "attention" || state === "offline")) return "attention";
  if (states.some((state) => state === "unknown")) return "unknown";
  return "healthy";
}

function migrationDisplayDetail(detail: string): string {
  if (/failed to connect|connection (?:refused|terminated)|initialising login role/i.test(detail)) {
    return "远程数据库连接失败，暂时无法确认本地迁移是否已同步。请稍后刷新重试。";
  }
  return detail;
}

function dependencyVersion(detail: string | undefined): string | null {
  return detail?.match(/\b\d+(?:\.\d+)+\b/)?.[0] ?? null;
}

function n8nEvidence(report: LocalSystemStatusReport): { notification: { at: string; state: "failure" | "success"; workflowName: string } | null; scheduleCheckAt: string | null; workerDispatchAt: string | null } {
  return {
    notification: report.n8n.lastNotification ?? null,
    scheduleCheckAt: report.n8n.lastScheduleCheckAt ?? report.n8n.lastEventAt ?? null,
    workerDispatchAt: report.n8n.lastWorkerDispatchAt ?? report.n8n.lastDispatchAt ?? report.n8n.lastRunAt ?? null,
  };
}

export function SystemStatusPanel({ episodes, isRefreshing = false, onRefresh = async () => {}, onRunGoldenTest, report, tasks }: { episodes: Episode[]; isRefreshing?: boolean; onRefresh?: () => Promise<void>; onRunGoldenTest?: () => Promise<GoldenProductionTestReport>; report: LocalSystemStatusReport | null; tasks: Task[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testReport, setTestReport] = useState<GoldenProductionTestReport | null>(null);
  const [testError, setTestError] = useState("");
  const close = () => setIsOpen(false);
  const dialogRef = useDialogFocus(isOpen, close);
  const currentTasks = useMemo(() => {
    const currentEpisodeIds = new Set(episodes.filter((episode) => !episode.archived_at).map((episode) => episode.id));
    return tasks.filter((task) => currentEpisodeIds.has(task.episode_id));
  }, [episodes, tasks]);
  const actionableTasks = useMemo(() => currentWorkerTasks(currentTasks), [currentTasks]);
  const blockedCount = actionableTasks.filter((task) => task.status === "blocked").length;
  const failedCount = actionableTasks.filter((task) => task.status === "failed").length;
  const latest = latestTask(currentTasks);
  const n8n = n8nStatus(report);
  const n8nTimeline = report ? n8nEvidence(report) : null;
  const taskExecution = workerStatus(actionableTasks, latest, blockedCount, failedCount);
  const items = useMemo<StatusItem[]>(() => {
    const migration = statusDependency(report, "Supabase 迁移");
    const codexModelDependencies = report?.dependencies.filter((dependency) => dependency.name === "Codex 模型" || dependency.name.startsWith("Codex 模型 · ")) ?? [];
    const codexCli = statusDependency(report, "Codex CLI");
    const otherDependencies = report?.dependencies.filter((dependency) => dependency.name !== "Supabase 迁移" && dependency.name !== "Codex CLI" && !codexModelDependencies.includes(dependency)) ?? [];
    const supabase = report?.supabase ?? { detail: "状态报告未提供 Supabase 控制数据读取证据。", state: "unknown" as const };
    const migrationStatus = migration ?? { detail: "尚未读取 Supabase 迁移状态。", state: "unknown" as const };
    const codexState = combinedState([codexCli?.state ?? "unknown", ...codexModelDependencies.map((dependency) => dependency.state)]);
    const codexCliVersion = dependencyVersion(codexCli?.detail);
    const workerRuntime = report ? combinedState([report.mediaLibrary.state, ...report.dependencies.filter((dependency) => dependency.name !== "Supabase 迁移").map((dependency) => dependency.state)]) : "unknown";
    return [
    { id: "supabase", label: "Supabase", state: combinedState([supabase.state, migrationStatus.state]), detail: "", detailRows: [
      { label: "控制数据", state: supabase.state, value: supabase.detail },
      { label: "迁移", state: migrationStatus.state, value: migrationDisplayDetail(migrationStatus.detail) },
    ] },
    { id: "production-pipeline", label: "生产执行链", state: combinedState([n8n.state, workerRuntime]), detail: "n8n 负责编排与派发，Worker 环境负责实际执行。", detailRows: [
      { label: "Worker 环境", state: workerRuntime, value: report ? "执行依赖与媒体库已纳入检查；正常不代表当前有任务运行。" : "尚未读取 Worker 执行环境。" },
      { label: "n8n 编排", state: n8n.state, value: n8n.detail },
    ] },
    { id: "task-execution", label: "任务执行", state: taskExecution, detail: `${actionableTasks.filter((task) => task.status === "running").length} 执行中 · ${blockedCount} 阻塞 · ${failedCount} 失败${latest?.status === "completed" ? " · 最近任务已完成" : ""}。` },
    { id: "media", label: "媒体库", state: report?.mediaLibrary.state ?? "unknown", detail: report?.mediaLibrary.detail ?? "尚未读取媒体库挂载状态。" },
    { id: "codex-cli", label: `依赖 · Codex CLI${codexCliVersion ? ` · ${codexCliVersion}` : ""}`, state: codexState, detail: codexCliVersion ? "" : codexCli?.detail ?? "尚未读取 Codex CLI 状态。", detailRows: codexModelDependencies.map((dependency) => ({ label: "模型", state: dependency.state, value: dependency.name.replace(/^Codex 模型(?: · )?/, "") || "未配置" })) },
    ...otherDependencies.map((dependency, index) => ({ id: `dependency-${index}`, label: `依赖 · ${dependency.name}`, state: dependency.state, detail: dependency.detail })),
    ];
  }, [actionableTasks, blockedCount, failedCount, n8n, report, taskExecution]);
  const overallState = items.some((item) => item.state === "attention" || item.state === "offline") ? "attention" : items.some((item) => item.state === "unknown") ? "unknown" : "healthy";
  const summary = items.map((item) => `${item.label}：${stateLabel(item.state)}`).join(" · ");

  async function runGoldenTest() {
    if (!onRunGoldenTest) return;
    setIsTesting(true); setTestError(""); setTestReport(null);
    try { setTestReport(await onRunGoldenTest()); }
    catch (error) { setTestError(error instanceof Error ? error.message : "黄金生产链测试失败。"); }
    finally { setIsTesting(false); }
  }

  return <div className="system-status"><button aria-expanded={isOpen} aria-haspopup="dialog" aria-label={`系统状态：${stateLabel(overallState)}`} className={`system-status-trigger system-status-${overallState}`} onClick={() => setIsOpen((current) => !current)} onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)} title={summary} type="button"><i aria-hidden="true" /></button>{isHovering && !isOpen ? <div aria-hidden="true" className="system-status-hover-card">{items.map((item) => <div className="system-status-hover-row" key={item.id}><i className={`system-status-hover-dot system-status-hover-dot-${item.state}`} /><strong>{item.label}</strong><span>{stateLabel(item.state)}</span></div>)}</div> : null}{isOpen ? <section aria-label="系统状态详情" className="system-status-panel" ref={dialogRef} role="dialog"><header><div><h2>系统状态</h2><p>生产执行链展示服务是否可用；任务执行展示当前是否正在工作。</p></div><button aria-label="关闭系统状态详情" className="icon-button" onClick={close} type="button">×</button></header><div className="system-status-list">{items.map((item) => <article className={`system-status-item system-status-item-${item.state}`} key={item.id}><div><strong>{item.label}</strong><span>{stateLabel(item.state)}</span></div>{item.detail ? <p>{item.detail}</p> : null}{item.detailRows?.length ? <dl className="system-status-detail-rows">{item.detailRows.map((row) => <div key={`${item.id}-${row.label}-${row.value}`}><dt>{row.label}</dt><dd>{row.value}</dd>{row.state ? <span>{stateLabel(row.state)}</span> : null}</div>)}</dl> : null}{item.id === "production-pipeline" && report && n8nTimeline ? <dl><div><dt>最近调度检查</dt><dd>{formatDate(n8nTimeline.scheduleCheckAt)}</dd></div><div><dt>最近 Worker 派发</dt><dd>{formatDate(n8nTimeline.workerDispatchAt)}</dd></div><div><dt>最近通知执行</dt><dd>{n8nTimeline.notification ? <><span className="system-status-notification-result">{formatDate(n8nTimeline.notification.at)} · 通知{n8nTimeline.notification.state === "failure" ? "失败" : "成功"}</span><span className="system-status-notification-workflow">{n8nTimeline.notification.workflowName}</span></> : "暂无记录"}</dd></div><div><dt>最近健康检查</dt><dd>{formatDate(report.n8n.lastHealthCheckAt)}</dd></div></dl> : null}</article>)}</div><article className="system-status-evidence"><strong>Worker 最近任务</strong><span>{latest ? `${latest.task_type} · ${formatDate(latest.completed_at ?? latest.claimed_at ?? latest.created_at)}` : "暂无任务记录"}</span><strong>阻塞摘要</strong><span>{blockedCount ? `${blockedCount} 个阻塞任务需要处理。` : "当前没有阻塞任务。"}</span></article>{testReport || testError ? <article aria-live="polite" className={`golden-test-result ${testReport?.passed ? "is-passed" : "is-failed"}`}><strong>{testReport?.passed ? "黄金生产链测试通过" : "黄金生产链测试未通过"}</strong>{testReport?.checks.map((check) => <span key={check.name}>{check.name}：{check.detail}</span>)}{testError ? <span>{testError}</span> : null}</article> : null}<footer><span>最近读取 {report ? formatDate(report.observedAt) : "暂无"}</span><div><button className="button button-secondary" disabled={isTesting || !onRunGoldenTest} onClick={() => void runGoldenTest()} type="button">{isTesting ? "测试中…" : "一键测试"}</button><button className="button button-secondary" disabled={isRefreshing} onClick={() => void onRefresh()} type="button">{isRefreshing ? "读取中…" : "刷新系统状态"}</button></div></footer></section> : null}</div>;
}
