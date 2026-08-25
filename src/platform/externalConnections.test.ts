import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Owner Pexels 连接迁移", () => {
  it("隔离秘密、记录验证并清理旧默认 B-roll 引用", () => {
    const migration = readFileSync("supabase/migrations/20260825100000_owner_pexels_connections.sql", "utf8");

    expect(migration).toContain("create table public.external_connections");
    expect(migration).toContain("create table public.external_connection_secrets");
    expect(migration).toContain("create table public.external_connection_verifications");
    expect(migration).toContain("revoke all on public.external_connection_secrets from public, anon, authenticated");
    expect(migration).toContain("resolve_external_connection_secret");
    expect(migration).toContain("record_external_connection_verification");
    expect(migration).toContain("blueprint.policy - 'b_roll'");
    expect(migration).toContain("status = 'verified'");
  });
});
