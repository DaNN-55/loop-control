export interface N8nExecutionEvidenceRow {
  data: string | null;
  id: number;
  startedAt: string | null;
  status: string;
  workflowName: string;
}

export interface N8nExecutionEvidence {
  lastNotification: { at: string; state: "failure" | "success"; workflowName: string } | null;
  lastScheduleCheckAt: string | null;
  lastWorkerDispatchAt: string | null;
}

export interface SupabaseControlDataEvidence {
  detail: string;
  state: "healthy" | "unknown";
}

const dispatchWorkflowName = "Loop Control — 任务派发";
const notificationWorkflowNames = new Set(["Loop Control — 审核提醒", "Loop Control — 状态变更提醒"]);

export function summarizeN8nExecutions(rows: readonly N8nExecutionEvidenceRow[]): N8nExecutionEvidence {
  const newestFirst = [...rows].sort((left, right) => executionTime(right) - executionTime(left) || right.id - left.id);
  const scheduleCheck = newestFirst.find((row) => row.workflowName === dispatchWorkflowName);
  const workerDispatch = newestFirst.find((row) => row.workflowName === dispatchWorkflowName && row.status === "success" && executionStartedWorker(row.data));
  const notification = newestFirst.find((row) => notificationWorkflowNames.has(row.workflowName));

  return {
    lastNotification: notification?.startedAt ? {
      at: sqliteTimestampToIso(notification.startedAt),
      state: notification.status === "success" ? "success" : "failure",
      workflowName: notification.workflowName,
    } : null,
    lastScheduleCheckAt: scheduleCheck?.startedAt ? sqliteTimestampToIso(scheduleCheck.startedAt) : null,
    lastWorkerDispatchAt: workerDispatch?.startedAt ? sqliteTimestampToIso(workerDispatch.startedAt) : null,
  };
}

export function executionStartedWorker(data: string | null): boolean {
  if (!data) return false;
  let values: unknown;
  try { values = JSON.parse(data); }
  catch { return false; }
  if (!Array.isArray(values)) return false;
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const line of value.split(/\r?\n/).reverse()) {
      const candidate = line.trim();
      if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
      try {
        const payload = JSON.parse(candidate) as { mode?: unknown; workers?: unknown };
        if (payload.mode === "dispatch" && Array.isArray(payload.workers) && payload.workers.length > 0) return true;
      } catch { /* Other command output may contain brace-delimited text. */ }
    }
  }
  return false;
}

export function supabaseControlDataEvidence(input: { activeBlueprintsReadable: boolean; hasOwnerMembership: boolean; ownerMembershipsReadable: boolean }): SupabaseControlDataEvidence {
  if (!input.ownerMembershipsReadable) return { detail: "Owner 会话有效，但无法读取账号成员关系。", state: "unknown" };
  if (!input.hasOwnerMembership) return { detail: "会话有效，但未读取到 Owner 账号成员关系。", state: "unknown" };
  if (!input.activeBlueprintsReadable) return { detail: "Owner 会话有效，但无法读取激活蓝图控制数据。", state: "unknown" };
  return { detail: "Owner 会话有效，账号成员关系与激活蓝图控制数据已成功读取。", state: "healthy" };
}

export class ExpiringProbeCache<T> {
  readonly #entries = new Map<string, { expiresAt: number; inFlight?: Promise<void>; value: T }>();

  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  read(key: string, fallback: T, load: () => Promise<T>): T {
    const current = this.#entries.get(key);
    const observedAt = this.now();
    if (current && current.expiresAt > observedAt) return current.value;
    if (!current?.inFlight) {
      const entry = current ?? { expiresAt: 0, value: fallback };
      entry.inFlight = Promise.resolve()
        .then(load)
        .then((value) => { this.#entries.set(key, { expiresAt: this.now() + this.ttlMs, value }); })
        .catch(() => { this.#entries.set(key, { expiresAt: this.now() + this.ttlMs, value: fallback }); });
      this.#entries.set(key, entry);
    }
    return current?.value ?? fallback;
  }
}

function executionTime(row: N8nExecutionEvidenceRow): number {
  return row.startedAt ? Date.parse(sqliteTimestampToIso(row.startedAt)) || 0 : 0;
}

function sqliteTimestampToIso(source: string): string {
  const parsed = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(source) ? source : `${source.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? source : parsed.toISOString();
}
