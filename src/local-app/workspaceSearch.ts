import type { Pool } from 'pg';
import { ConfigurationError } from './configurationCommands.js';
import { ownerTransaction } from './ownerTransaction.js';
import type { WorkspaceSearchCategory, WorkspaceSearchHit, WorkspaceSearchResponse } from './workspaceSearchTypes.js';

export const workspaceSearchLimit = 8;

export function parseWorkspaceSearch(search: URLSearchParams): string {
  const raw = search.get('q') ?? '';
  const query = raw.trim();
  if ([...search.keys()].some(key => !['q','category','page'].includes(key)) || ['q','category','page'].some(key=>search.getAll(key).length>1) || search.getAll('q').length !== 1) {
    throw new ConfigurationError(400, '搜索参数无效。');
  }
  if (!query || raw.length > 200 || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new ConfigurationError(400, '搜索内容须为 1 至 200 个字符，不能包含控制字符。');
  }
  if (search.has('category')&&!['all','episodes','materials','accounts'].includes(search.get('category')!)) throw new ConfigurationError(400,'搜索分类无效。');
  if (search.has('page')&&!/^[1-9]\d{0,5}$/.test(search.get('page')!)) throw new ConfigurationError(400,'搜索页码无效。');
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
    NULL::text AS episode_id, a.id::text AS account_id, NULL::text AS path, NULL::text AS sha256, NULL::text AS file_type, row_number() OVER(ORDER BY a.archived_at IS NOT NULL, lower(a.name), a.id) AS match_order
  FROM owned_accounts a
  WHERE position(lower($2) IN lower(concat_ws(' ', a.name, a.slug, a.id::text))) > 0
  ORDER BY a.archived_at IS NOT NULL, lower(a.name), a.id
), episode_matches AS (
  SELECT 'episode'::text AS kind, e.id::text AS id,
    coalesce(nullif(e.title, ''), '未命名生产单') AS title,
    e.account_name || CASE WHEN e.archived_at IS NOT NULL THEN ' · 已归档' ELSE '' END AS subtitle,
    e.id::text AS episode_id, e.account_id::text AS account_id, NULL::text AS path, NULL::text AS sha256, NULL::text AS file_type, row_number() OVER(ORDER BY e.archived_at IS NOT NULL, e.updated_at DESC, e.id) AS match_order
  FROM owned_episodes e
  WHERE position(lower($2) IN lower(concat_ws(' ', e.title, e.account_name, e.id::text))) > 0
  ORDER BY e.archived_at IS NOT NULL, e.updated_at DESC, e.id
), registered_files AS (
  SELECT 'material:' || m.id::text AS id, e.id AS episode_id, e.account_id,
    coalesce(nullif(e.title, ''), '未命名生产单') AS episode_title, e.account_name,
    m.storage_path AS path, m.sha256, m.created_at,
    regexp_replace(replace(m.source_path, chr(92), '/'), '^.*/', '') AS name, m.material_type::text AS material_type, 0 AS priority
  FROM public.production_material_revisions m JOIN owned_episodes e ON e.id = m.episode_id
  UNION ALL
  SELECT 'artifact:' || f.id::text, e.id, e.account_id,
    coalesce(nullif(e.title, ''), '未命名生产单'), e.account_name,
    f.relative_path, f.sha256, f.created_at,
    regexp_replace(replace(f.relative_path, chr(92), '/'), '^.*/', ''), NULL::text, 1
  FROM public.artifacts f JOIN owned_episodes e ON e.id = f.episode_id
  UNION ALL
  SELECT 'export:' || x.id::text || ':' || entry.slot, e.id, e.account_id,
    coalesce(nullif(e.title, ''), '未命名生产单'), e.account_name,
    entry.file->>'relativePath', entry.file->>'sha256', x.created_at,
    regexp_replace(replace(entry.file->>'relativePath', chr(92), '/'), '^.*/', ''), NULL::text, 2
  FROM local_identity.workspace_exports x JOIN owned_episodes e ON e.id=x.episode_id
  CROSS JOIN LATERAL (VALUES('artifact',x.artifact),('project',x.project)) entry(slot,file)
  WHERE entry.file->>'relativePath' IS NOT NULL AND entry.file->>'sha256' ~ '^[a-f0-9]{64}$'

), unique_files AS (
  SELECT DISTINCT ON (episode_id, path, sha256) * FROM registered_files
  ORDER BY episode_id, path, sha256, priority, created_at DESC, id
), classified_files AS (
  SELECT f.*, CASE
    WHEN material_type='script' OR lower(name) ~ '\\.(md|txt|srt|vtt)$' THEN 'script'
    WHEN lower(name) ~ '\\.(avif|gif|jpe?g|png|webp)$' THEN 'image'
    WHEN lower(name) ~ '\\.(mp4|mov|webm|mkv)$' THEN 'video'
    WHEN lower(name) ~ '\\.(aac|m4a|mp3|ogg|opus|wav|flac)$' THEN 'audio'
    WHEN lower(name) ~ '\\.(json|jsonl|yaml|yml|log|sqlite|db)$' THEN 'record'
    ELSE 'file' END AS file_type
  FROM unique_files f
), material_matches AS (
  SELECT 'material'::text AS kind, f.id,
    coalesce(nullif(f.name, ''), regexp_replace(f.path, '^.*/', '')) AS title,
    f.episode_title || ' · ' || f.account_name AS subtitle,
    f.episode_id::text, f.account_id::text, f.path, f.sha256, f.file_type, row_number() OVER(ORDER BY CASE f.file_type WHEN 'script' THEN 0 WHEN 'image' THEN 1 WHEN 'video' THEN 1 WHEN 'audio' THEN 1 WHEN 'file' THEN 2 ELSE 3 END, f.created_at DESC, lower(f.name), f.id) AS match_order
  FROM classified_files f
  WHERE position(lower($2) IN lower(concat_ws(' ', f.name, f.path, f.episode_title, f.account_name))) > 0
  ORDER BY CASE f.file_type WHEN 'script' THEN 0 WHEN 'image' THEN 1 WHEN 'video' THEN 1 WHEN 'audio' THEN 1 WHEN 'file' THEN 2 ELSE 3 END, f.created_at DESC, lower(f.name), f.id
) , all_matches AS (
 SELECT * FROM episode_matches UNION ALL SELECT * FROM account_matches UNION ALL SELECT * FROM material_matches
), ranked AS (
 SELECT *, row_number() OVER(PARTITION BY kind ORDER BY match_order) AS rank FROM all_matches
), totals AS (
 SELECT kinds.kind,count(r.id)::integer AS total FROM (VALUES('episode'),('material'),('account')) kinds(kind) LEFT JOIN ranked r ON r.kind=kinds.kind GROUP BY kinds.kind
)
SELECT t.kind,t.total,r.id,r.title,r.subtitle,r.episode_id,r.account_id,r.path,r.sha256,r.file_type
FROM totals t LEFT JOIN ranked r ON r.kind=t.kind AND ($3='all' OR t.kind=CASE $3 WHEN 'episodes' THEN 'episode' WHEN 'materials' THEN 'material' ELSE 'account' END) AND r.rank > CASE WHEN $3='all' THEN 0 ELSE LEAST($4::integer-1,GREATEST(0,(t.total-1)/8))*8 END AND r.rank <= CASE WHEN $3='all' THEN 8 ELSE (LEAST($4::integer-1,GREATEST(0,(t.total-1)/8))+1)*8 END
ORDER BY CASE t.kind WHEN 'episode' THEN 0 WHEN 'material' THEN 1 ELSE 2 END,r.rank`;

interface SearchRow {
  kind: WorkspaceSearchHit['kind'];
  id: string | null;
  total: number;
  file_type: WorkspaceSearchHit['fileType'] | null;
  title: string;
  subtitle: string;
  episode_id: string | null;
  account_id: string | null;
  path: string | null;
  sha256: string | null;
}

export async function readWorkspaceSearch(pool: Pool, ownerId: string, search: URLSearchParams): Promise<WorkspaceSearchResponse> {
  const query = parseWorkspaceSearch(search),category=(search.get('category')??'all') as WorkspaceSearchCategory,page=Number(search.get('page')??1);
  return ownerTransaction(pool, ownerId, true, async client => {
    const { rows } = await client.query<SearchRow>(workspaceSearchSql, [ownerId, query, category, page]);
    const groups: Record<'episodes' | 'accounts' | 'materials', WorkspaceSearchHit[]> = { episodes: [], accounts: [], materials: [] };
    const total={episodes:0,accounts:0,materials:0};
    const labels={script:'脚本',image:'图片',video:'视频',audio:'音频',record:'辅助记录',file:'文件'};
    for (const row of rows) {
      const key=row.kind==='episode'?'episodes':row.kind==='account'?'accounts':'materials';
      total[key]=row.total;
      if(!row.id)continue;
      const hit: WorkspaceSearchHit = {
        id: row.id, kind: row.kind, title: row.title, subtitle: row.subtitle,
        ...(row.episode_id ? { episodeId: row.episode_id } : {}),
        ...(row.account_id ? { accountId: row.account_id } : {}),
        ...(row.path ? { path: row.path } : {}),
        ...(row.sha256 ? { sha256: row.sha256 } : {}),
        ...(row.file_type?{fileType:row.file_type,typeLabel:labels[row.file_type]}:{}),
      };
      groups[row.kind === 'episode' ? 'episodes' : row.kind === 'account' ? 'accounts' : 'materials'].push(hit);
    }
    return {
      query,
      pagination:{category,page:category==='all'?1:Math.min(page,Math.max(1,Math.ceil(total[category]/workspaceSearchLimit))),pageSize:workspaceSearchLimit,total,pages:{episodes:Math.max(1,Math.ceil(total.episodes/workspaceSearchLimit)),accounts:Math.max(1,Math.ceil(total.accounts/workspaceSearchLimit)),materials:Math.max(1,Math.ceil(total.materials/workspaceSearchLimit))}},
      episodes: groups.episodes.slice(0, workspaceSearchLimit),
      accounts: groups.accounts.slice(0, workspaceSearchLimit),
      materials: groups.materials.slice(0, workspaceSearchLimit),
      hasMore: {
        episodes: total.episodes > (category==='all'?1:page)*workspaceSearchLimit,
        accounts: total.accounts > (category==='all'?1:page)*workspaceSearchLimit,
        materials: total.materials > (category==='all'?1:page)*workspaceSearchLimit,
      },
    };
  });
}
