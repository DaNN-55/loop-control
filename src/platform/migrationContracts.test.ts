import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationNames = readdirSync(resolve("supabase/migrations"));
const technicalConfigMigration = resolve(
  "supabase/migrations/20260822121000_use_blueprint_b_roll_technical_config.sql",
);
const legacyOrchestrationPermissionsMigration = resolve(
  "supabase/migrations/20260822121948_restrict_b_roll_legacy_orchestration.sql",
);
const storyboardHarnessMigration = resolve(
  "supabase/migrations/20260822215000_freeze_storyboard_harness.sql",
);
const audioAdapterConnectionsMigration = resolve(
  "supabase/migrations/20260822223000_freeze_audio_adapter_connections.sql",
);
const audioToolPermissionsMigration = resolve(
  "supabase/migrations/20260822223500_normalize_audio_tool_permissions.sql",
);
const deployedMigrations = {
  "20260822095959_guard_legacy_b_roll_history.sql": "b36e63037ca12c2785d7bbb9f2fe8596f31377de734dcf8b96cb03af23613c9b",
  "20260822100000_freeze_b_roll_adapter_connection.sql": "f38575ba3b5dcb7814f230c5a48a52c6a5ac37811868d00bdb0f7eb375b2a51d",
  "20260822104421_expand_legacy_b_roll_blueprints.sql": "f8182e92f0ccd25ed228e56d92ca54f1ef836954303d5d385b8e0672cd635a8f",
  "20260822112024_remove_legacy_b_roll_history_guard.sql": "f28b35a78d15812e85abc119440d7a7af3c880935dafa344fc9ff13b64663d30",
  "20260822223000_freeze_audio_adapter_connections.sql": "cd1b31c24d56a2e86b2b9c31cc23008d5bced7e8660582f0bd4176622ab05a68",
  "20260822223500_normalize_audio_tool_permissions.sql": "f258ccb1126c76083ffce532f022b8123476eb31a2392a7bd75de220bf27352b",
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

  it("只允许 Worker 调用内部 B-roll 编排函数", () => {
    const permissions = readFileSync(legacyOrchestrationPermissionsMigration, "utf8");

    expect(permissions).toContain("revoke all on function public.orchestrate_b_roll_tasks_legacy(uuid) from public, anon, authenticated;");
    expect(permissions).toContain("grant execute on function public.orchestrate_b_roll_tasks_legacy(uuid) to service_role;");
  });

  it("分镜任务冻结已登记 Adapter 与不可变 Prompt Harness", () => {
    const migration = readFileSync(storyboardHarnessMigration, "utf8");

    expect(migration).toContain("and harness.capability = 'storyboard_planning'");
    expect(migration).toContain("'harness', jsonb_build_object(");
    expect(migration).toContain("'adapter', 'codex'");
    expect(migration).toContain("grant execute on function public.orchestrate_storyboard_tasks() to service_role;");
  });

  it("旁白与配乐任务冻结已选择的非秘密连接引用", () => {
    const migration = readFileSync(audioAdapterConnectionsMigration, "utf8");

    expect(migration).toContain("'google-tts-default'");
    expect(migration).toContain("'freesound-default'");
    expect(migration).toContain("orchestrate_narration_tasks_without_connection_ref");
    expect(migration).toContain("orchestrate_soundtrack_tasks_without_connection_ref");
    expect(migration).toContain("set input_snapshot = jsonb_set(task.input_snapshot, '{credential_ref}'");
  });

  it("只保留账号实际授予的音频工具", () => {
    const migration = readFileSync(audioToolPermissionsMigration, "utf8");

    expect(migration).toContain("'{narration,allowed_tools}'");
    expect(migration).toContain("'{soundtrack,allowed_tools}'");
    expect(migration).not.toContain("'network'");
  });
});
