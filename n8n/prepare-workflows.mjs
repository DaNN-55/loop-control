import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const intervalPolicies = new Map([
  ["Cy50xRCgT2cj4WT4", { environment: "LOOP_DISPATCH_INTERVAL_MINUTES", fallback: 15 }],
  ["fFvOzmKS4OAMTcjd", { environment: "LOOP_NOTIFICATION_INTERVAL_MINUTES", fallback: 30 }],
]);

export async function prepareWorkflows(inputDirectory, environment = process.env) {
  const workflows = new Map();
  for (const filename of await readdir(inputDirectory)) {
    if (!filename.endsWith(".json")) continue;
    const workflow = JSON.parse(await readFile(join(inputDirectory, filename), "utf8"));
    const policy = intervalPolicies.get(workflow.id);
    if (policy) {
      const trigger = workflow.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger");
      if (!trigger) throw new Error(`${workflow.name} 缺少定时触发器。`);
      trigger.parameters.rule.interval = [{ field: "minutes", minutesInterval: positiveInteger(environment[policy.environment], policy) }];
    }
    workflows.set(workflow.id, workflow);
  }
  return workflows;
}

function positiveInteger(value, policy) {
  const parsed = Number(value ?? policy.fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${policy.environment} 必须是正整数。`);
  return parsed;
}

async function main() {
  const [inputDirectory, outputDirectory] = process.argv.slice(2);
  if (!inputDirectory || !outputDirectory) throw new Error("用法：prepare-workflows.mjs <输入目录> <输出目录>");
  const workflows = await prepareWorkflows(inputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  for (const workflow of workflows.values()) await writeFile(join(outputDirectory, `${workflow.id}.json`), `${JSON.stringify(workflow, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("prepare-workflows.mjs")) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
