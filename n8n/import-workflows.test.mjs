import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const n8nDirectory = dirname(fileURLToPath(import.meta.url));
const workflowSdkPath = resolve(n8nDirectory, "node24/node_modules/@n8n/workflow-sdk");

test("导入脚本先创建可覆盖的 n8n runtime，再在其中暂存工作流", async () => {
  const importer = await readFile(new URL("./import-workflows.sh", import.meta.url), "utf8");

  assert.match(importer, /export N8N_USER_FOLDER="\$\{N8N_USER_FOLDER:-\$project_root\/n8n\/runtime\}"/);
  assert.match(importer, /mkdir -p "\$N8N_USER_FOLDER"/);
  assert.match(importer, /mktemp -d "\$N8N_USER_FOLDER\/import-workflows\.XXXXXX"/);
});

test("提醒工作流声明零字段透传契约", async () => {
  const approvalWorkflow = JSON.parse(await readFile(new URL("./workflows/approval-notifications.json", import.meta.url), "utf8"));
  const stateWorkflow = JSON.parse(await readFile(new URL("./workflows/state-change-notifications.json", import.meta.url), "utf8"));
  const caller = approvalWorkflow.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflow");
  const trigger = stateWorkflow.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflowTrigger");

  assert.ok(caller);
  assert.ok(trigger);
  assert.equal(trigger.parameters.inputSource, "passthrough");
  assert.deepEqual(caller.parameters.workflowInputs, { mappingMode: "defineBelow", value: {} });
});

test("提醒工作流通过本机 n8n 节点配置校验", { skip: !existsSync(workflowSdkPath) }, async () => {
  const require = createRequire(import.meta.url);
  const { setSchemaBaseDirs, validateNodeConfig } = require(workflowSdkPath);
  const approvalWorkflow = JSON.parse(await readFile(new URL("./workflows/approval-notifications.json", import.meta.url), "utf8"));
  const stateWorkflow = JSON.parse(await readFile(new URL("./workflows/state-change-notifications.json", import.meta.url), "utf8"));
  const caller = approvalWorkflow.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflow");
  const trigger = stateWorkflow.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflowTrigger");

  assert.ok(caller);
  assert.ok(trigger);
  setSchemaBaseDirs([resolve(n8nDirectory, "node24/node_modules/n8n-nodes-base/dist/node-definitions")]);
  assert.deepEqual(validateNodeConfig(trigger.type, trigger.typeVersion, { parameters: {} }), {
    valid: false,
    errors: [{
      path: "parameters.workflowInputs",
      message: 'Required field "parameters.workflowInputs" is missing. Expected object.',
    }],
  });
  assert.deepEqual(validateNodeConfig(trigger.type, trigger.typeVersion, { parameters: trigger.parameters }), { valid: true, errors: [] });
  assert.deepEqual(validateNodeConfig(caller.type, caller.typeVersion, { parameters: caller.parameters }), { valid: true, errors: [] });
});
