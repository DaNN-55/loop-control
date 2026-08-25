import { useState } from "react";
import type { WorkerBlocker } from "./reviewSelectors";
import { workerBlockerGuidance } from "./blockerGuidance";

type ConnectionVersion = { id: string; version: number; is_current: boolean; status: "unverified" | "verified" | "revoked" | "invalid" | "retryable" };

export function WorkerBlockerCard({ affectedTaskCount, blocker, compact = false, connectionVersions = [], onOpenBlueprint, onOpenConnection, onRepairConnection }: { affectedTaskCount?: number; blocker: WorkerBlocker; compact?: boolean; connectionVersions?: ConnectionVersion[]; onOpenBlueprint?: (blocker: WorkerBlocker) => void; onOpenConnection?: () => void; onRepairConnection?: (blocker: WorkerBlocker, versionId: string) => void }) {
  const guidance = workerBlockerGuidance(blocker);
  const [versionId, setVersionId] = useState(connectionVersions.find((version) => version.status === "verified" && version.is_current)?.id ?? "");
  return <article className={`worker-blocker ${compact ? "worker-blocker-compact" : ""}`}>
    <header className="worker-blocker-heading"><strong>{guidance.title}</strong><span>{guidance.retryLabel}</span></header>
    {affectedTaskCount && affectedTaskCount > 1 ? <p className="worker-blocker-affected">影响 {affectedTaskCount} 个任务</p> : null}
    <p className="worker-blocker-summary">{guidance.summary}</p>
    <ol className="worker-blocker-resolution">{guidance.resolution.map((step) => <li key={step}>{step}</li>)}</ol>
    <div className={`worker-blocker-next-step ${guidance.primaryAction ? "" : "is-static"}`}>
      <div><span>处理位置</span><strong>{guidance.location}</strong></div>
      <p>{guidance.locationNote}</p>
      {guidance.primaryAction === "blueprint" && onOpenBlueprint ? <button className="button button-danger-soft button-small" onClick={() => onOpenBlueprint(blocker)} type="button">{blocker.taskId ? "修改配置并继续当前生产单" : "打开蓝图配置"}</button> : null}
      {guidance.primaryAction === "connection" ? <><button className="button button-danger-soft button-small" onClick={() => onOpenConnection ? onOpenConnection() : window.dispatchEvent(new Event("open-external-connections"))} type="button">打开外部连接管理</button>{blocker.taskId && connectionVersions.some((version) => version.status === "verified" && version.is_current) && onRepairConnection ? <div className="worker-blocker-repair"><label>替换为已验证版本<select aria-label="连接版本" onChange={(event) => setVersionId(event.target.value)} value={versionId}>{connectionVersions.filter((version) => version.status === "verified" && version.is_current).map((version) => <option key={version.id} value={version.id}>v{version.version}</option>)}</select></label><button className="button button-secondary button-small" disabled={!versionId} onClick={() => onRepairConnection(blocker, versionId)} type="button">修复并继续当前生产单</button></div> : null}</> : null}
    </div>
    <details className="worker-blocker-technical"><summary>技术详情</summary><dl><div><dt>错误码</dt><dd>{blocker.code}</dd></div><div><dt>原始原因</dt><dd>{guidance.technicalDetail}</dd></div>{blocker.taskId ? <div><dt>任务 ID</dt><dd>{blocker.taskId}</dd></div> : null}</dl></details>
  </article>;
}
