import type { WorkerBlocker } from "./reviewSelectors";
import { workerBlockerGuidance } from "./blockerGuidance";

export function WorkerBlockerCard({ affectedTaskCount, blocker, compact = false, onOpenBlueprint }: { affectedTaskCount?: number; blocker: WorkerBlocker; compact?: boolean; onOpenBlueprint?: (blocker: WorkerBlocker) => void }) {
  const guidance = workerBlockerGuidance(blocker);
  return <article className={`worker-blocker ${compact ? "worker-blocker-compact" : ""}`}>
    <header className="worker-blocker-heading"><strong>{guidance.title}</strong><span>{guidance.retryLabel}</span></header>
    {affectedTaskCount && affectedTaskCount > 1 ? <p className="worker-blocker-affected">影响 {affectedTaskCount} 个任务</p> : null}
    <p className="worker-blocker-summary">{guidance.summary}</p>
    <ol className="worker-blocker-resolution">{guidance.resolution.map((step) => <li key={step}>{step}</li>)}</ol>
    <div className={`worker-blocker-next-step ${guidance.primaryAction ? "" : "is-static"}`}>
      <div><span>处理位置</span><strong>{guidance.location}</strong></div>
      <p>{guidance.locationNote}</p>
      {guidance.primaryAction === "blueprint" && onOpenBlueprint ? <button className="button button-danger-soft button-small" onClick={() => onOpenBlueprint(blocker)} type="button">修改配置并继续当前生产单</button> : null}
    </div>
    <details className="worker-blocker-technical"><summary>技术详情</summary><dl><div><dt>错误码</dt><dd>{blocker.code}</dd></div><div><dt>原始原因</dt><dd>{guidance.technicalDetail}</dd></div>{blocker.taskId ? <div><dt>任务 ID</dt><dd>{blocker.taskId}</dd></div> : null}</dl></details>
  </article>;
}
