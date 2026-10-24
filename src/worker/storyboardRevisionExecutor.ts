import{createHash}from'node:crypto';
import type{WorkerTaskPackage}from'./contracts.js';
import{applyStoryboardStructureRevision}from'./storyboardRevision.js';
import{writeSafeAssetFile}from'./controlledMediaExecutor.js';
export async function executeStoryboardRevision(taskPackage: WorkerTaskPackage): Promise<string> {
  const revision = taskPackage.storyboardRevision;
  if (!revision) throw new Error("缺少分镜结构修订。");
  const storyboard = applyStoryboardStructureRevision(revision.storyboard, revision.operation);
  const content = `${JSON.stringify(storyboard, null, 2)}\n`;
  await writeSafeAssetFile(taskPackage.assets.allowedRoot, taskPackage.output.relativePath, content);
  const artifact = { artifactType: taskPackage.output.requiredArtifactTypes[0] ?? "storyboard", relativePath: taskPackage.output.relativePath, sha256: createHash("sha256").update(content).digest("hex"), fileSize: Buffer.byteLength(content) };
  return JSON.stringify({ version: "worker-result/v1", taskId: taskPackage.task.id, status: "completed", artifacts: [artifact], storyboard, validation: { passed: true, checks: [{ name: "storyboard_structure_revision", passed: true, detail: "结构操作已按冻结输入应用。" }] }, actualCostCents: 0, blockers: [], retry: { shouldRetry: false, reason: "Completed successfully." }, nextStep: "Submit the revised storyboard for Owner review." });
}

