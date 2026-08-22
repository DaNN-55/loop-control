import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260822100000_freeze_b_roll_adapter_connection.sql"),
  "utf8",
);
const migrationNames = readdirSync(resolve("supabase/migrations"));

describe("B-roll 连接固化迁移", () => {
  it("保持已部署迁移内容不变", () => {
    expect(createHash("sha256").update(migration).digest("hex")).toBe("f38575ba3b5dcb7814f230c5a48a52c6a5ac37811868d00bdb0f7eb375b2a51d");
  });

  it("在旧迁移前后安装并移除历史版本保护", () => {
    expect(migrationNames).toContain("20260822095959_guard_legacy_b_roll_history.sql");
    expect(migrationNames).toContain("20260822112024_remove_legacy_b_roll_history_guard.sql");
  });
});
