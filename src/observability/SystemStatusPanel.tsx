import {uiText,getUiLocale,useUiLocale} from '../i18n/ui';
import type { WorkerSummary } from "../episodes/episodeCatalog";
import type { OperationsEvidence } from "../orchestration/operationsEvidence";
import { useMemo, useState } from "react";
import type { Database, Json } from "../lib/database.types";
import {SystemStatusSurface, stateLabel, type StatusItem, type SystemState} from "./SystemStatusSurface";
export type {SystemState} from "./SystemStatusSurface";

type Task = Database["public"]["Tables"]["tasks"]["Row"];
type Episode = Database["public"]["Tables"]["episodes"]["Row"];


export interface LocalSystemStatusReport {
  operations?: OperationsEvidence;
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
  viewTransport?: { detail: string; state: SystemState };
}

export interface GoldenProductionTestReport {
  checks: Array<{ detail: string; name: string; passed: boolean }>;
  observedAt: string;
  passed: boolean;
}

function formatDate(source: string | null): string {
  return source ? new Intl.DateTimeFormat(getUiLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(source)) : uiText("暂无记录");
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
  if (!report) return { detail: uiText("尚未读取本地 n8n 状态。"), state: "unknown" };
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
    return uiText("远程数据库连接失败，暂时无法确认本地迁移是否已同步。请稍后刷新重试。");
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

export function SystemStatusPanel({ workerSummary, episodes, isRefreshing = false, onRefresh = async () => {}, onRunGoldenTest, report, tasks }: { workerSummary?: WorkerSummary; episodes: Episode[]; isRefreshing?: boolean; onRefresh?: () => Promise<void>; onRunGoldenTest?: () => Promise<GoldenProductionTestReport>; report: LocalSystemStatusReport | null; tasks: Task[] }) {
  const locale=useUiLocale();
  const [isTesting, setIsTesting] = useState(false);
  const [testReport, setTestReport] = useState<GoldenProductionTestReport | null>(null);
  const [testError, setTestError] = useState("");
  const currentTasks = useMemo(() => {
    const currentEpisodeIds = new Set(episodes.filter((episode) => !episode.archived_at).map((episode) => episode.id));
    return tasks.filter((task) => currentEpisodeIds.has(task.episode_id));
  }, [episodes, tasks]);
  const actionableTasks = useMemo(() => currentWorkerTasks(currentTasks), [currentTasks]);
  const blockedCount = workerSummary?.blocked ?? actionableTasks.filter((task) => task.status === "blocked").length;
  const failedCount = workerSummary?.failed ?? actionableTasks.filter((task) => task.status === "failed").length;
  const latest = latestTask(currentTasks);
  const latestWorkerLabel = workerSummary ? workerSummary.latest ? `${workerSummary.latest.task_type} · ${formatDate(workerSummary.latest.at)}` : uiText("暂无任务记录") : latest ? `${latest.task_type} · ${formatDate(latest.completed_at ?? latest.claimed_at ?? latest.created_at)}` : uiText("暂无任务记录");
  const n8n = n8nStatus(report);
  const n8nTimeline = report ? n8nEvidence(report) : null;
  const runningCount = workerSummary?.running ?? actionableTasks.filter((task) => task.status === "running").length;
  const latestCompleted = workerSummary?.latestCompleted ?? latest?.status === "completed";
  const taskExecution = workerSummary ? blockedCount || failedCount ? "attention" : runningCount || latestCompleted ? "healthy" : "unknown" : workerStatus(actionableTasks, latest, blockedCount, failedCount);
  const items = useMemo<StatusItem[]>(() => {
    const migration = statusDependency(report, "Supabase 迁移");
    const codexModelDependencies = report?.dependencies.filter((dependency) => dependency.name === "Codex 模型" || dependency.name.startsWith("Codex 模型 · ")) ?? [];
    const codexCli = statusDependency(report, "Codex CLI");
    const otherDependencies = report?.dependencies.filter((dependency) => dependency.name !== "Supabase 迁移" && dependency.name !== "Codex CLI" && !codexModelDependencies.includes(dependency)) ?? [];
    const viewTransport = report?.viewTransport ?? { detail: uiText("状态报告未提供 Supabase 控制数据读取证据。"), state: "unknown" as const };
    const migrationStatus = migration ?? { detail: uiText("尚未读取 Supabase 迁移状态。"), state: "unknown" as const };
    const codexState = combinedState([codexCli?.state ?? "unknown", ...codexModelDependencies.map((dependency) => dependency.state)]);
    const codexCliVersion = dependencyVersion(codexCli?.detail);
    const workerRuntime = report ? combinedState([report.mediaLibrary.state, ...report.dependencies.filter((dependency) => dependency.name !== "Supabase 迁移").map((dependency) => dependency.state)]) : "unknown";
    return [
    { id: "supabase", label: "Supabase", state: combinedState([viewTransport.state, migrationStatus.state]), detail: "", detailRows: [
      { label: uiText("控制数据"), state: viewTransport.state, value: viewTransport.detail },
      { label: uiText("迁移"), state: migrationStatus.state, value: migrationDisplayDetail(migrationStatus.detail) },
    ] },
    { id: "production-pipeline", label: uiText("生产执行链"), state: combinedState([n8n.state, workerRuntime]), detail: uiText("n8n 负责编排与派发，Worker 环境负责实际执行。"), detailRows: [
      { label: uiText("Worker 环境"), state: workerRuntime, value: report ? uiText("执行依赖与媒体库已纳入检查；正常不代表当前有任务运行。") : uiText("尚未读取 Worker 执行环境。") },
      { label: uiText("n8n 编排"), state: n8n.state, value: n8n.detail },
    ] },
    { id: "task-execution", label: uiText("任务执行"), state: taskExecution, detail: uiText("{value0} 执行中 · {value1} 阻塞 · {value2} 失败{value3}。",{value0:runningCount,value1:blockedCount,value2:failedCount,value3:latestCompleted ? uiText(" · 最近任务已完成") : ""}) },
    { id: "media", label: uiText("媒体库"), state: report?.mediaLibrary.state ?? "unknown", detail: report?.mediaLibrary.detail ?? uiText("尚未读取媒体库挂载状态。") },
    { id: "codex-cli", label: uiText("依赖 · Codex CLI{value0}",{value0:codexCliVersion ? ` · ${codexCliVersion}` : ""}), state: codexState, detail: codexCliVersion ? "" : codexCli?.detail ?? uiText("尚未读取 Codex CLI 状态。"), detailRows: codexModelDependencies.map((dependency) => ({ label: uiText("模型"), state: dependency.state, value: dependency.name.replace(/^Codex 模型(?: · )?/, "") || uiText("未配置") })) },
    ...(report?.operations ? (["schedule","notification","health","backup","snapshot"] as const).map(operation => {
      const evidence=report.operations?.[operation];
      return ({
      id: `operation-${operation}`, label: ({schedule:uiText("调度检查"),notification:uiText("事件提醒"),health:uiText("每日健康检查"),backup:uiText("完整备份"),snapshot:uiText("部分快照")} as Record<string,string>)[operation],
      state: !evidence ? "unknown" as const : evidence.latest.passed ? "healthy" as const : "attention" as const, detail: evidence?.latest.detail ?? uiText("尚无独立执行记录。"),
      detailRows: evidence ? [
        {label:uiText("最近结果"),value:formatDate(evidence.latest.at)},
        ...(evidence.lastSuccess ? [{label:uiText("最近成功"),value:formatDate(evidence.lastSuccess.at)}] : []),
        ...(evidence.lastFailure ? [{label:uiText("最近失败"),value:`${formatDate(evidence.lastFailure.at)} · ${evidence.lastFailure.detail}`,state:"attention" as const}] : []),
      ] : [],
    }); }) : []),
    ...otherDependencies.map((dependency, index) => ({ id: `dependency-${index}`, label: uiText("依赖 · {value0}",{value0:dependency.name}), state: dependency.state, detail: dependency.detail })),
    ];
  }, [runningCount, latestCompleted, blockedCount, failedCount, n8n, report, taskExecution,locale]);
  const overallState = items.some((item) => item.state === "attention" || item.state === "offline") ? "attention" : items.some((item) => item.state === "unknown") ? "unknown" : "healthy";
  const summary = items.map((item) => `${item.label}：${stateLabel(item.state)}`).join(" · ");

  async function runGoldenTest() {
    if (!onRunGoldenTest) return;
    setIsTesting(true); setTestError(""); setTestReport(null);
    try { setTestReport(await onRunGoldenTest()); }
    catch (error) { setTestError(error instanceof Error ? error.message : uiText("黄金生产链测试失败。")); }
    finally { setIsTesting(false); }
  }

  return <SystemStatusSurface items={items} overallState={overallState} summary={summary}
    description={uiText("生产执行链展示服务是否可用；任务执行展示当前是否正在工作。")}
    renderDetails={(item) => <>{item.id === "production-pipeline" && report && n8nTimeline ? <dl><div><dt>{uiText("最近调度检查")}</dt><dd>{formatDate(n8nTimeline.scheduleCheckAt)}</dd></div><div><dt>{uiText("最近 Worker 派发")}</dt><dd>{formatDate(n8nTimeline.workerDispatchAt)}</dd></div><div><dt>{uiText("最近通知执行")}</dt><dd>{n8nTimeline.notification ? <><span className="system-status-notification-result">{formatDate(n8nTimeline.notification.at)} {uiText("· 通知")}{n8nTimeline.notification.state === "failure" ? uiText("失败") : uiText("成功")}</span><span className="system-status-notification-workflow">{n8nTimeline.notification.workflowName}</span></> : uiText("暂无记录")}</dd></div><div><dt>{uiText("最近健康检查")}</dt><dd>{formatDate(report.n8n.lastHealthCheckAt)}</dd></div></dl> : null}</>}
    footer={<><span>{uiText("最近读取 ")}{report ? formatDate(report.observedAt) : uiText("暂无")}</span><div><button className="button button-secondary" disabled={isTesting || !onRunGoldenTest} onClick={() => void runGoldenTest()} type="button">{isTesting ? uiText("测试中…") : uiText("一键测试")}</button><button className="button button-secondary" disabled={isRefreshing} onClick={() => void onRefresh()} type="button">{isRefreshing ? uiText("读取中…") : uiText("刷新系统状态")}</button></div></>}>
    <article className="system-status-evidence"><strong>{uiText("Worker 最近任务")}</strong><span>{latestWorkerLabel}</span><strong>{uiText("阻塞摘要")}</strong><span>{blockedCount ? uiText("{value0} 个阻塞任务需要处理。",{value0:blockedCount}) : uiText("当前没有阻塞任务。")}</span></article>{testReport || testError ? <article aria-live="polite" className={`golden-test-result ${testReport?.passed ? "is-passed" : "is-failed"}`}><strong>{testReport?.passed ? uiText("黄金生产链测试通过") : uiText("黄金生产链测试未通过")}</strong>{testReport?.checks.map((check) => <span key={check.name}>{check.name}：{check.detail}</span>)}{testError ? <span>{testError}</span> : null}</article> : null}
  </SystemStatusSurface>;
}
