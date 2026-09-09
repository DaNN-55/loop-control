export const workerRequiredTools = ["read", "write"] as const;

const adapterSafetyLimits: Record<string, number> = {
  pexels_video: 3,
  google_tts: 2,
  volcengine_tts: 2,
  freesound_preview: 1,
  openai_images: 1,
  workers_ai_images: 1,
  openchatcut_card_video: 1,
};

export interface WorkerRuntimeConstraints {
  adapterSafetyLimit: number;
  effectiveConcurrency: number;
  providerOrConnectionLimit: number | null;
  workerCapacity: number;
}

export function workerRuntimeConstraints({ adapter, providerOrConnectionLimit = null, workerCapacity = 1 }: { adapter?: string; providerOrConnectionLimit?: number | null; workerCapacity?: number }): WorkerRuntimeConstraints {
  const adapterSafetyLimit = adapterSafetyLimits[adapter ?? ""] ?? 1;
  const safeWorkerCapacity = Number.isInteger(workerCapacity) && workerCapacity > 0 ? workerCapacity : 1;
  const safeProviderLimit = providerOrConnectionLimit !== null && Number.isInteger(providerOrConnectionLimit) && providerOrConnectionLimit > 0 ? providerOrConnectionLimit : null;
  return {
    adapterSafetyLimit,
    effectiveConcurrency: Math.min(safeProviderLimit ?? adapterSafetyLimit, adapterSafetyLimit, safeWorkerCapacity),
    providerOrConnectionLimit: safeProviderLimit,
    workerCapacity: safeWorkerCapacity,
  };
}
