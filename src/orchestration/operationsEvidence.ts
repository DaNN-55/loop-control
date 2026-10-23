import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export type Operation = "schedule" | "notification" | "health" | "backup" | "snapshot";
export interface OperationResult { at: string; passed: boolean; detail: string; idle?: boolean }
export interface OperationEvidence { latest: OperationResult; lastSuccess: OperationResult | null; lastFailure: OperationResult | null }
export type OperationsEvidence = Partial<Record<Operation, OperationEvidence>>;
const operations: Operation[] = ["schedule", "notification", "health", "backup", "snapshot"];
function readResult(path: string): OperationResult | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as OperationResult;
    if (!value || typeof value.passed !== "boolean" || typeof value.detail !== "string" || value.detail.length > 1000 || !Number.isFinite(Date.parse(value.at))) throw Error("invalid");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { at: new Date().toISOString(), passed: false, detail: "本机结果记录无效或无法读取。" };
  }
}
export async function readOperationsEvidence(directory: string): Promise<OperationsEvidence> {
  const result: OperationsEvidence = {};
  for (const operation of operations) {
    const lastSuccess=readResult(join(directory, `${operation}-last-success.json`));
    const lastFailure=readResult(join(directory, `${operation}-last-failure.json`));
    const latest=[readResult(join(directory, `${operation}-result.json`)),lastSuccess,lastFailure].filter((entry):entry is OperationResult=>entry!==null).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||Number(a.passed)-Number(b.passed))[0];
    if (latest) result[operation] = { latest, lastSuccess, lastFailure };
  }
  return result;
}
export async function recordOperation(directory: string, operation: Operation, result: Omit<OperationResult, "at">): Promise<void> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const previous = readResult(join(directory, `${operation}-result.json`));
  if (result.idle && result.passed && previous?.passed && previous.idle && previous.detail === result.detail) return;
  const latest = { ...result, at: new Date().toISOString() };
  const write = (path: string) => {
    const temporary = `${path}.${randomUUID()}.next`;
    writeFileSync(temporary, JSON.stringify(latest) + "\n", { mode: 0o600 });
    renameSync(temporary, path);
  };
  // Independent outcome files: a concurrent success never rewrites lastFailure.
  // Atomic rename publishes complete records; storage remains three files/mode.
  write(join(directory, `${operation}-last-${result.passed ? "success" : "failure"}.json`));
  write(join(directory, `${operation}-result.json`));
}
