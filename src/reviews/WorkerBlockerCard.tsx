import type { WorkerBlocker } from "./reviewSelectors";
import { workerBlockerGuidance } from "./blockerGuidance";

export function WorkerBlockerCard({ blocker, compact = false }: { blocker: WorkerBlocker; compact?: boolean }) {
  const guidance = workerBlockerGuidance(blocker);
  return <article className={`worker-blocker ${compact ? "worker-blocker-compact" : ""}`}>
    <header className="worker-blocker-heading"><strong>{guidance.title}</strong><span>{guidance.retryLabel}</span></header>
    <p className="worker-blocker-summary">{guidance.summary}</p>
    <ol className="worker-blocker-resolution">{guidance.resolution.map((step) => <li key={step}>{step}</li>)}</ol>
    <details className="worker-blocker-technical"><summary>技术详情</summary><dl><div><dt>错误码</dt><dd>{blocker.code}</dd></div><div><dt>原始原因</dt><dd>{guidance.technicalDetail}</dd></div>{blocker.taskId ? <div><dt>任务 ID</dt><dd>{blocker.taskId}</dd></div> : null}</dl></details>
  </article>;
}
