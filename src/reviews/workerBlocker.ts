import type{Database}from"../lib/database.types.js";
import type{WorkerPreflightAction,WorkerPreflightPhase,WorkerPreflightScope,WorkerPreflightStatus}from"../worker/contracts.js";
type Task=Database["public"]["Tables"]["tasks"]["Row"];
export interface WorkerBlocker {
  code: string;
  detail: string;
  taskId?: string;
  taskType?: Task["task_type"];
  capability?: string;
  check?: string;
  phase?: WorkerPreflightPhase;
  status?: WorkerPreflightStatus;
  action?: WorkerPreflightAction;
  scope?: WorkerPreflightScope;
}

