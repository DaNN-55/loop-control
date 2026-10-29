import type { Pool } from 'pg';
import { ConfigurationError } from './configurationCommands.js';
import { ownerTransaction } from './ownerTransaction.js';
import type { WorkspaceSearchHit, WorkspaceSearchResponse } from './workspaceSearchTypes.js';

export const workspaceSearchLimit = 8;

export function parseWorkspaceSearch(search: URLSearchParams): string {
  const raw = search.get('q') ?? '';
  const query = raw.trim();
  if ([...search.keys()].some(key => key !== 'q') || search.getAll('q').length !== 1) {
    throw new ConfigurationError(400, '搜索参数无效。');
  }
  if (!query || raw.length > 200 || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new ConfigurationError(400, '搜索内容须为 1 至 200 个字符，不能包含控制字符。');
  }
  return query;
}

// Only registered metadata is searched. File content, credentials and task
// snapshots are outside this index. The membership fence also applies to files.
export const workspaceSearchSql = `
WITH owned_accounts AS MATERIALIZED (
  SELECT a.id, a.name, a.slug, a.archived_at
  FROM public.accounts a
  JOIN public.account_memberships membership ON membership.account_id = a.id
  WHERE membership.user_id = $1 AND membership.role = 'owner'
), owned_episodes AS MATERIALIZED (
  SELECT e.id, e.account_id, e.title, e.updated_at, e.archived_at, a.name AS account_name
  FROM public.episodes e JOIN owned_accounts a ON a.id = e.account_id
), account_matches AS (
  SELECT 'account'::text AS kind, a.id::text AS id, a.name AS title,
    CASE WHEN a.archived_at IS NOT NULL THEN '已归档账号' ELSE '账号与系列' END AS subtitle,
    NULL::text AS episode_id, a.id::text AS account_id, NULL::text AS path, NULL::text AS sha256
  FROM owned_accounts a
  WHERE position(lower($2) IN lower(concat_ws(' ', a.name, a.slug, a.id::text))) > 0
  ORDER BY a.archived_at IS NOT NULL, lower(a.name), a.id LIMIT $3
), episode_matches AS (
  SELECT 'episode'::text AS kind, e.id::text AS id,
    coalesce(nullif(e.title, ''), '未命名生产单') AS title,
    e.account_name || CASE WHEN e.archived_at IS NOT NULL THEN ' · 已归档' ELSE '' END AS subtitle,
    e.id::text AS episode_id, e.account_id::text AS account_id, NULL::text AS path, NULL::text AS sha256
  FROM owned_episodes e
  WHERE position(lower($2) IN lower(concat_ws(' ', e.title, e.account_name, e.id::text))) > 0
  ORDER BY e.archived_at IS NOT NULL, e.updated_at DESC, e.id LIMIT $3
), registered_files AS (
  SELECT 'material:' || m.id::text AS id, e.id AS episode_id, e.account_id,
    coalesce(nullif(e.title, ''), '未命名生产单') AS episode_title, e.account_name,
    m.storage_path AS path, m.sha256, m.created_at,
    regexp_replace(replace(m.source_path, chr(92), '/'), '^.*/', '') AS name, 0 AS priority
  FROM public.production_material_revisions m JOIN owned_episodes e ON e.id = m.episode_id
  UNION ALL
  SELECT 'artifact:' || f.id::text, e.id, e.account_id,
    coalesce(nullif(e.title, ''), '未命名生产单'), e.account_name,
    f.relative_path, f.sha256, f.created_at,
    regexp_replace(replace(f.relative_path, chr(92), '/'), '^.*/', ''), 1
  FROM public.artifacts f JOIN owned_episodes e ON e.id = f.episode_id
), unique_files AS (
  SELECT DISTINCT ON (episode_id, path, sha256) * FROM registered_files
  ORDER BY episode_id, path, sha256, priority, created_at DESC, id
), material_matches AS (
  SELECT 'material'::text AS kind, f.id,
    coalesce(nullif(f.name, ''), regexp_replace(f.path, '^.*/', '')) AS title,
    f.episode_title || ' · ' || f.account_name AS subtitle,
    f.episode_id::text, f.account_id::text, f.path, f.sha256
  FROM unique_files f
  WHERE position(lower($2) IN lower(concat_ws(' ', f.name, f.path, f.episode_title, f.account_name))) > 0
  ORDER BY f.created_at DESC, lower(f.name), f.id LIMIT $3
)
SELECT * FROM episode_matches
UNION ALL SELECT * FROM account_matches
UNION ALL SELECT * FROM material_matches`;

interface SearchRow {
  kind: WorkspaceSearchHit['kind'];
  id: string;
  title: string;
  subtitle: string;
  episode_id: string | null;
  account_id: string | null;
  path: string | null;
  sha256: string | null;
}

export async function readWorkspaceSearch(pool: Pool, ownerId: string, search: URLSearchParams): Promise<WorkspaceSearchResponse> {
  const query = parseWorkspaceSearch(search);
  return ownerTransaction(pool, ownerId, true, async client => {
    const { rows } = await client.query<SearchRow>(workspaceSearchSql, [ownerId, query, workspaceSearchLimit + 1]);
    const groups: Record<'episodes' | 'accounts' | 'materials', WorkspaceSearchHit[]> = { episodes: [], accounts: [], materials: [] };
    for (const row of rows) {
      const hit: WorkspaceSearchHit = {
        id: row.id, kind: row.kind, title: row.title, subtitle: row.subtitle,
        ...(row.episode_id ? { episodeId: row.episode_id } : {}),
        ...(row.account_id ? { accountId: row.account_id } : {}),
        ...(row.path ? { path: row.path } : {}),
        ...(row.sha256 ? { sha256: row.sha256 } : {}),
      };
      groups[row.kind === 'episode' ? 'episodes' : row.kind === 'account' ? 'accounts' : 'materials'].push(hit);
    }
    return {
      query,
      episodes: groups.episodes.slice(0, workspaceSearchLimit),
      accounts: groups.accounts.slice(0, workspaceSearchLimit),
      materials: groups.materials.slice(0, workspaceSearchLimit),
      hasMore: {
        episodes: groups.episodes.length > workspaceSearchLimit,
        accounts: groups.accounts.length > workspaceSearchLimit,
        materials: groups.materials.length > workspaceSearchLimit,
      },
    };
  });
}
