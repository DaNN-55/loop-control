import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260822100000_freeze_b_roll_adapter_connection.sql"),
  "utf8",
);

describe("B-roll 连接固化迁移", () => {
  it("不改写 Episode 已固定引用的历史版本", () => {
    expect(migration).not.toMatch(/\bupdate\s+public\.(?:account_blueprint_versions|series_versions)\b/i);
  });
});
