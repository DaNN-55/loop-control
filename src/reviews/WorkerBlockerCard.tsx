import type { WorkerBlocker } from "./reviewSelectors";
import { workerBlockerGuidance } from "./blockerGuidance";

export function WorkerBlockerCard({ blocker, compact = false, context }: { blocker: WorkerBlocker; compact?: boolean; context?: { assetRoot?: string; episodeId?: string; onOpenEpisode?: (episodeId: string) => void } }) {
  const guidance = workerBlockerGuidance(blocker);
  return <article className={`worker-blocker ${compact ? "worker-blocker-compact" : ""}`}>
    <header className="worker-blocker-heading"><strong>{guidance.title}</strong><span>{guidance.retryLabel}</span></header>
    <p className="worker-blocker-summary">{guidance.summary}</p>
    <ol className="worker-blocker-resolution">{guidance.resolution.map((step) => <li key={step}>{step}</li>)}</ol>
    {context && (context.episodeId || context.assetRoot) ? <dl className="worker-blocker-context">{context.episodeId ? <div><dt>Episode</dt><dd>{context.onOpenEpisode ? <button className="worker-blocker-context-link" onClick={() => context.onOpenEpisode?.(context.episodeId!)} type="button">打开 Episode 详情</button> : context.episodeId}</dd></div> : null}{context.assetRoot ? <div><dt>资产目录</dt><dd>{context.assetRoot}</dd></div> : null}</dl> : null}
    <details className="worker-blocker-technical"><summary>技术详情</summary><dl><div><dt>错误码</dt><dd>{blocker.code}</dd></div><div><dt>原始原因</dt><dd>{guidance.technicalDetail}</dd></div>{blocker.taskId ? <div><dt>任务 ID</dt><dd>{blocker.taskId}</dd></div> : null}</dl></details>
  </article>;
}
