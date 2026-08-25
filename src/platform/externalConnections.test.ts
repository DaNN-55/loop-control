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

  it("扩展同一 Owner 连接池支持 Google TTS，并按能力校验已验证版本", () => {
    const migration = readFileSync("supabase/migrations/20260825120000_owner_google_tts_connections.sql", "utf8");

    expect(migration).toContain("provider = 'google_tts'");
    expect(migration).toContain("adapter = 'google_tts'");
    expect(migration).toContain("vault.create_secret");
    expect(migration).toContain("connection.created_by = auth.uid()");
    expect(migration).toContain("connection.current_version_id = version.id");
    expect(migration).toContain("narration");
    expect(migration).toContain("status = 'verified'");
    expect(migration).toContain("policy = blueprint.policy - 'narration'");
    expect(migration).toContain("Owner permission is required");
  });
});
