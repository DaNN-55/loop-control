import { useMemo, useState } from "react";
import type { Database } from "../lib/database.types";

type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type SystemState = "healthy" | "attention" | "unknown" | "offline";

export interface LocalSystemStatusReport {
  dependencies: Array<{ detail: string; name: string; state: SystemState }>;
  mediaLibrary: { detail: string; state: SystemState };
  n8n: { detail: string; lastDispatchAt: string | null; lastEventAt: string | null; lastHealthCheckAt: string | null; lastRunAt: string | null; state: SystemState };
  observedAt: string;
}

interface StatusItem {
  detail: string;
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

function n8nStatus(report: LocalSystemStatusReport | null): { detail: string; state: SystemState } {
  if (!report) return { detail: "尚未读取本地 n8n 状态。", state: "unknown" };
  if (!report.n8n.lastEventAt) return { detail: report.n8n.detail, state: report.n8n.state };
  const age = Date.now() - new Date(report.n8n.lastEventAt).getTime();
  if (age > 24 * 60 * 60 * 1000) return { detail: `${report.n8n.detail} 最近事件已超过 24 小时，请运行健康检查确认。`, state: "attention" };
  return { detail: report.n8n.detail, state: report.n8n.state };
}

export function SystemStatusPanel({ isRefreshing = false, onRefresh = async () => {}, report, tasks }: { isRefreshing?: boolean; onRefresh?: () => Promise<void>; report: LocalSystemStatusReport | null; tasks: Task[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const blockedCount = tasks.filter((task) => task.status === "blocked").length;
  const failedCount = tasks.filter((task) => task.status === "failed").length;
  const latest = latestTask(tasks);
  const n8n = n8nStatus(report);
  const items = useMemo<StatusItem[]>(() => [
    { id: "supabase", label: "Supabase", state: "healthy", detail: "控制数据已成功读取。" },
    { id: "worker", label: "Worker", state: blockedCount || failedCount ? "attention" : tasks.some((task) => task.status === "running") ? "healthy" : "unknown", detail: `${tasks.filter((task) => task.status === "running").length} 执行中 · ${blockedCount} 阻塞 · ${failedCount} 失败。` },
    { id: "n8n", label: "n8n 编排", state: n8n.state, detail: n8n.detail },
    { id: "media", label: "媒体库", state: report?.mediaLibrary.state ?? "unknown", detail: report?.mediaLibrary.detail ?? "尚未读取媒体库挂载状态。" },
    ...(report?.dependencies ?? []).map((dependency, index) => ({ id: `dependency-${index}`, label: `依赖 · ${dependency.name}`, state: dependency.state, detail: dependency.detail })),
  ], [blockedCount, failedCount, n8n, report, tasks]);
  const overallState = items.some((item) => item.state === "attention" || item.state === "offline") ? "attention" : items.some((item) => item.state === "unknown") ? "unknown" : "healthy";
  const summary = items.map((item) => `${item.label}：${stateLabel(item.state)}`).join(" · ");

  return <div className="system-status"><button aria-expanded={isOpen} aria-haspopup="dialog" aria-label={`系统状态：${stateLabel(overallState)}`} className={`system-status-trigger system-status-${overallState}`} onClick={() => setIsOpen((current) => !current)} onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)} title={summary} type="button"><i aria-hidden="true" /> <span className="system-status-trigger-label">系统状态</span></button>{isHovering && !isOpen ? <div aria-hidden="true" className="system-status-hover-card">{summary}</div> : null}{isOpen ? <section aria-label="系统状态详情" className="system-status-panel" role="dialog"><header><div><h2>系统状态</h2><p>n8n 负责编排、通知和健康检查；Worker 负责实际执行。</p></div><button aria-label="关闭系统状态详情" className="icon-button" onClick={() => setIsOpen(false)} type="button">×</button></header><div className="system-status-list">{items.map((item) => <article className={`system-status-item system-status-item-${item.state}`} key={item.id}><div><strong>{item.label}</strong><span>{stateLabel(item.state)}</span></div><p>{item.detail}</p>{item.id === "n8n" && report ? <dl><div><dt>最近派发</dt><dd>{formatDate(report.n8n.lastRunAt)}</dd></div><div><dt>最近运行</dt><dd>{formatDate(report.n8n.lastEventAt)}</dd></div><div><dt>最近健康检查</dt><dd>{formatDate(report.n8n.lastHealthCheckAt)}</dd></div></dl> : null}</article>)}</div><article className="system-status-evidence"><strong>Worker 最近任务</strong><span>{latest ? `${latest.task_type} · ${formatDate(latest.completed_at ?? latest.claimed_at ?? latest.created_at)}` : "暂无任务记录"}</span><strong>阻塞摘要</strong><span>{blockedCount ? `${blockedCount} 个阻塞任务需要处理。` : "当前没有阻塞任务。"}</span></article><footer><span>最近读取 {report ? formatDate(report.observedAt) : "暂无"}</span><button className="button button-secondary" disabled={isRefreshing} onClick={() => void onRefresh()} type="button">{isRefreshing ? "读取中…" : "刷新系统状态"}</button></footer></section> : null}</div>;
}
