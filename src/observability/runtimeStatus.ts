export type RuntimeState = 'healthy' | 'attention' | 'offline' | 'unknown';
export interface WorkerRuntimeStatus {
  state: RuntimeState;
  heartbeatAt: string | null;
  lastScanAt: string | null;
  active: number | null;
  capacity: number | null;
  problem: string | null;
}
export interface RuntimeTask {
  id: string; episodeId: string; episodeTitle: string; taskType: string;
  status: 'ready' | 'running' | 'blocked' | 'failed';
  createdAt: string; claimedAt: string | null; availableAt: string | null;
}
export interface RuntimeQueue {
  running: number; queued: number; blocked: number; failed: number;
  total: number; page: number; pageSize: number; items: RuntimeTask[];
}
export interface RuntimeResources {
  cpuPercent: number | null;
  memory: {totalBytes: number; freeBytes: number};
  disk: {availableBytes: number; totalBytes: number} | null;
  media: {state: RuntimeState; availableBytes: number | null; minimumFreeBytes: number | null};
}
export interface RuntimeStatus {
  observedAt: string;
  version?:RuntimeVersionStatus;
  worker: WorkerRuntimeStatus;
  queue: RuntimeQueue | null;
  resources: RuntimeResources | null;
}

export type RuntimeVersionState='current'|'source_changed'|'restart_required'|'preparing'|'not_prepared'|'prepared_invalid'|'running_invalid'|'mismatch'|'unknown';
export interface RuntimeVersionStatus {
 state:RuntimeVersionState;
 backendReleaseId:string|null;workerReleaseId:string|null;preparedReleaseId:string|null;
 startedAt:string;checkedAt:string;
}
