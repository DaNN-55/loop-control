import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("导入脚本先创建可覆盖的 n8n runtime，再在其中暂存工作流", async () => {
  const importer = await readFile(new URL("./import-workflows.sh", import.meta.url), "utf8");

  assert.match(importer, /export N8N_USER_FOLDER="\$\{N8N_USER_FOLDER:-\$project_root\/n8n\/runtime\}"/);
  assert.match(importer, /mkdir -p "\$N8N_USER_FOLDER"/);
  assert.match(importer, /mktemp -d "\$N8N_USER_FOLDER\/import-workflows\.XXXXXX"/);
});
