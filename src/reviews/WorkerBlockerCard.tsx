import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
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
    <div className={`worker-blocker-next-step ${guidance.primaryAction ? "" : "is-static"}`}>
      <div><span>处理位置</span><strong>{guidance.location}</strong></div>
      {guidance.primaryAction === "blueprint" && onOpenBlueprint ? <Button size="xs" color="secondary-destructive" className="button button-danger-soft button-small" onClick={() => onOpenBlueprint(blocker)} type="button">{blocker.taskId ? "修改配置并继续当前生产单" : "打开蓝图配置"}</Button> : null}
      {guidance.primaryAction === "connection" ? <><Button size="xs" color="secondary-destructive" className="button button-danger-soft button-small" onClick={() => onOpenConnection ? onOpenConnection() : window.dispatchEvent(new Event("open-external-connections"))} type="button">打开外部连接管理</Button>{blocker.taskId && connectionVersions.some((version) => version.status === "verified" && version.is_current) && onRepairConnection ? <div className="worker-blocker-repair"><label>替换为已验证版本<NativeSelect size="sm" aria-label="连接版本" onChange={(event) => setVersionId(event.target.value)} value={versionId}>{connectionVersions.filter((version) => version.status === "verified" && version.is_current).map((version) => <option key={version.id} value={version.id}>v{version.version}</option>)}</NativeSelect></label><Button size="xs" color="secondary" className="button button-secondary button-small" isDisabled={!versionId} onClick={() => onRepairConnection(blocker, versionId)} type="button">修复并继续当前生产单</Button></div> : null}</> : null}
    </div>
    <Disclosure label={<>处理说明</>} className="worker-blocker-guidance"><p>{guidance.locationNote}</p><ol className="worker-blocker-resolution">{guidance.resolution.map((step) => <li key={step}>{step}</li>)}</ol></Disclosure>
    <Disclosure label={<>技术详情</>} className="worker-blocker-technical"><dl><div><dt>错误码</dt><dd>{blocker.code}</dd></div><div><dt>原始原因</dt><dd>{guidance.technicalDetail}</dd></div>{blocker.taskId ? <div><dt>任务 ID</dt><dd>{blocker.taskId}</dd></div> : null}</dl></Disclosure>
  </article>;
}
