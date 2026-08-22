import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationNames = readdirSync(resolve("supabase/migrations"));
const technicalConfigMigration = resolve(
  "supabase/migrations/20260822121000_use_blueprint_b_roll_technical_config.sql",
);
const deployedMigrations = {
  "20260822095959_guard_legacy_b_roll_history.sql": "b36e63037ca12c2785d7bbb9f2fe8596f31377de734dcf8b96cb03af23613c9b",
  "20260822100000_freeze_b_roll_adapter_connection.sql": "f38575ba3b5dcb7814f230c5a48a52c6a5ac37811868d00bdb0f7eb375b2a51d",
  "20260822104421_expand_legacy_b_roll_blueprints.sql": "f8182e92f0ccd25ed228e56d92ca54f1ef836954303d5d385b8e0672cd635a8f",
  "20260822112024_remove_legacy_b_roll_history_guard.sql": "f28b35a78d15812e85abc119440d7a7af3c880935dafa344fc9ff13b64663d30",
};

describe("B-roll 连接固化迁移", () => {
  it("保持已部署迁移内容不变", () => {
    for (const [filename, expectedHash] of Object.entries(deployedMigrations)) {
      const migration = readFileSync(resolve("supabase/migrations", filename), "utf8");
      expect(createHash("sha256").update(migration).digest("hex")).toBe(expectedHash);
    }
  });

  it("在旧迁移前后安装并移除历史版本保护", () => {
    expect(migrationNames).toContain("20260822095959_guard_legacy_b_roll_history.sql");
    expect(migrationNames).toContain("20260822112024_remove_legacy_b_roll_history_guard.sql");
  });

  it("以账号蓝图而非系列规则冻结 B-roll 技术配置", () => {
    const technicalConfig = readFileSync(technicalConfigMigration, "utf8");

    expect(technicalConfig).toContain("create or replace function public.orchestrate_b_roll_tasks_legacy");
    expect(technicalConfig).toContain("selected_config := candidate.blueprint_policy -> 'b_roll';");
    expect(technicalConfig).not.toContain("series_version.rules as series_rules");
  });
});
