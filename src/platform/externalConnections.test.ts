import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Owner Pexels 连接迁移", () => {
  it("使用 Vault 连接版本隔离秘密并强制 Owner 引用", () => {
    const migration = readFileSync("supabase/migrations/20260825110000_harden_owner_pexels_connection_versions.sql", "utf8");

    expect(migration).toContain("create table public.external_connection_versions");
    expect(migration).toContain("vault.create_secret");
    expect(migration).toContain("drop table public.external_connection_secrets");
    expect(migration).toContain("resolve_external_connection_secret");
    expect(migration).toContain("record_external_connection_verification");
    expect(migration).toContain("connection.created_by = auth.uid()");
    expect(migration).toContain("connection.current_version_id = version.id");
  });
});
