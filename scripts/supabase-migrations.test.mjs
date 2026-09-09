import { describe, expect, it, vi } from "vitest";
import { compareMigrationVersions, migrationVersionsFromCliOutput, readMigrationStatus } from "./supabase-migrations.mjs";

describe("Supabase migration status", () => {
  it("区分一致和不一致", () => {
    expect(compareMigrationVersions(["20260901000000"], ["20260901000000"])).toMatchObject({ state: "consistent" });
    expect(compareMigrationVersions(["20260901000000", "20260902000000"], ["20260901000000"])).toMatchObject({ state: "inconsistent" });
  });

  it("解析 CLI JSON 和表格输出", () => {
    expect(migrationVersionsFromCliOutput('[{"local":"20260901000000","remote":"20260901000000"}]')).toEqual({ local: ["20260901000000"], remote: ["20260901000000"] });
    expect(migrationVersionsFromCliOutput(" 20260901000000 │ 20260901000000 │ 2026-09-01")).toEqual({ local: ["20260901000000"], remote: ["20260901000000"] });
  });

  it("连接失败返回 unknown 并隐藏凭据", () => {
    const run = vi.fn().mockReturnValue({ status: 1, stderr: "\u001b[31mAuthorization: Bearer highly-secret-token connection refused\u001b[39m" });
    const result = readMigrationStatus({ projectRef: "project-ref", run });
    expect(result.state).toBe("unknown");
    expect(result.detail).toBe("远程数据库连接失败，暂时无法确认本地迁移是否已同步。请稍后刷新重试。");
    expect(result.detail).not.toContain("highly-secret-token");
    expect(result.detail).not.toContain("\u001b");
    expect(run.mock.calls[0][1]).toContain("list");
    expect(run.mock.calls[0][1]).not.toContain("push");
  });
});
