// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { parseWorkspaceSearch, readWorkspaceSearch, workspaceSearchLimit, workspaceSearchSql } from './workspaceSearch';

describe('workspace search query boundary', () => {
  it('trims a bounded query and treats percent, underscore and SQL punctuation as literal search text', () => {
    expect(parseWorkspaceSearch(new URLSearchParams({ q: '  主脚本  ' }))).toBe('主脚本');
    expect(parseWorkspaceSearch(new URLSearchParams({ q: "%_' OR true --" }))).toBe("%_' OR true --");
    expect(parseWorkspaceSearch(new URLSearchParams({ q: 'x'.repeat(200) }))).toHaveLength(200);
  });

  it.each(['', 'q=', 'q=+++', 'q=a&q=b', 'q=a&ownerId=foreign', 'q=%00bad', 'q=%0Abad', 'q=%7Fbad', `q=${'x'.repeat(201)}`])('rejects invalid or ambiguous query %s before opening a transaction', async raw => {
    const connect = vi.fn();
    await expect(readWorkspaceSearch({ connect } as unknown as Pool, 'owner', new URLSearchParams(raw))).rejects.toMatchObject({ status: 400 });
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('workspace search read contract', () => {
  it('uses a read-only Owner transaction and parameters without interpolating the search text', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql === workspaceSearchSql ? [
      { kind: 'episode', id: 'episode', title: '真实生产单', subtitle: '账号', episode_id: 'episode', account_id: 'account', path: null, sha256: null },
      { kind: 'account', id: 'account', title: '账号', subtitle: '账号与系列', episode_id: null, account_id: 'account', path: null, sha256: null },
      { kind: 'material', id: 'material:one', title: 'main-script.md', subtitle: '真实生产单 · 账号', episode_id: 'episode', account_id: 'account', path: 'episodes/episode/main-script.md', sha256: 'a'.repeat(64) },
    ] : [] }));
    const release = vi.fn(), pool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool;
    const needle = "%_' OR true --";
    const result = await readWorkspaceSearch(pool, 'owner', new URLSearchParams({ q: needle }));
    expect(query.mock.calls[0]).toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY']);
    expect(query.mock.calls[1]).toEqual(["SELECT set_config('loop.owner_id',$1,true)", ['owner']]);
    expect(query).toHaveBeenCalledWith(workspaceSearchSql, ['owner', needle, workspaceSearchLimit + 1]);
    expect(workspaceSearchSql).not.toContain(needle);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
    expect(result).toEqual({
      query: needle,
      episodes: [{ kind: 'episode', id: 'episode', title: '真实生产单', subtitle: '账号', episodeId: 'episode', accountId: 'account' }],
      accounts: [{ kind: 'account', id: 'account', title: '账号', subtitle: '账号与系列', accountId: 'account' }],
      materials: [{ kind: 'material', id: 'material:one', title: 'main-script.md', subtitle: '真实生产单 · 账号', episodeId: 'episode', accountId: 'account', path: 'episodes/episode/main-script.md', sha256: 'a'.repeat(64) }],
      hasMore: { episodes: false, accounts: false, materials: false },
    });
  });

  it('caps each group independently and reports undisplayed matches', async () => {
    const rows = ['episode', 'account', 'material'].flatMap(kind => Array.from({ length: workspaceSearchLimit + 1 }, (_, i) => ({ kind, id: `${kind}-${i}`, title: `Result ${i}`, subtitle: 'fixture', episode_id: null, account_id: null, path: null, sha256: null })));
    const client = { query: vi.fn(async (sql: string) => ({ rows: sql === workspaceSearchSql ? rows : [] })), release: vi.fn() };
    const result = await readWorkspaceSearch({ connect: vi.fn().mockResolvedValue(client) } as unknown as Pool, 'owner', new URLSearchParams({ q: 'Result' }));
    expect(result.episodes).toHaveLength(workspaceSearchLimit);
    expect(result.accounts).toHaveLength(workspaceSearchLimit);
    expect(result.materials).toHaveLength(workspaceSearchLimit);
    expect(result.hasMore).toEqual({ episodes: true, accounts: true, materials: true });
  });

  it('rolls back and releases the connection if the metadata query fails', async () => {
    const error = new Error('fixture query failure');
    const client = { query: vi.fn(async (sql: string) => { if (sql === workspaceSearchSql) throw error; return { rows: [] }; }), release: vi.fn() };
    await expect(readWorkspaceSearch({ connect: vi.fn().mockResolvedValue(client) } as unknown as Pool, 'owner', new URLSearchParams({ q: 'file' }))).rejects.toBe(error);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  // Structural guardrails supplement, but do not replace, actual database/RLS verification.
  it('fences all three groups through owned account membership and only selects registered file metadata', () => {
    expect(workspaceSearchSql).toContain("membership.user_id = $1 AND membership.role = 'owner'");
    expect(workspaceSearchSql).toContain('public.episodes e JOIN owned_accounts a ON a.id = e.account_id');
    expect(workspaceSearchSql).toContain('public.production_material_revisions m JOIN owned_episodes e ON e.id = m.episode_id');
    expect(workspaceSearchSql).toContain('public.artifacts f JOIN owned_episodes e ON e.id = f.episode_id');
    expect(workspaceSearchSql).toContain('DISTINCT ON (episode_id, path, sha256)');
    expect(workspaceSearchSql).toContain('position(lower($2) IN lower(');
    expect(workspaceSearchSql).not.toMatch(/\bILIKE\b|\bLIKE\b|input_snapshot|secret|credential|payload/i);
  });
});
