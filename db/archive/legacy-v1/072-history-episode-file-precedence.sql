-- Exact production paths take precedence. Only unassigned files use artifact hash fallback.
-- Deduplicate historical artifact versions before joining; keep original files and metadata intact.
CREATE OR REPLACE VIEW local_identity.history_episode_files WITH(security_invoker=true) AS
 WITH visible_files AS MATERIALIZED(
 SELECT s.owner_id,f.*,coalesce(nullif(f.metadata->>'episode_id',''),nullif(f.metadata->>'episodeId',''),
 (regexp_match(f.logical_path,'(?:^|/)episodes/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})(?:/|$)'))[1],
 (regexp_match(coalesce(f.metadata->>'formerRuntimePath',''),'(?:^|/)episodes/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})(?:/|$)'))[1]) direct_episode_id FROM local_identity.history_files f JOIN local_identity.history_sources s ON s.id=f.source_id
 ),content_records AS MATERIALIZED(
 SELECT DISTINCT owner_id,payload->>'sha256' sha256,payload->>'episode_id' episode_id FROM local_identity.history_versions
 WHERE table_name IN('public.artifacts','public.production_material_revisions') AND payload->>'episode_id' ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$'
 )
 SELECT DISTINCT f.owner_id,f.source_id,f.logical_path,f.sha256,f.bytes,f.kind,
 f.direct_episode_id episode_id
 FROM visible_files f
 WHERE f.direct_episode_id ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$'
 UNION
 SELECT DISTINCT f.owner_id,f.source_id,f.logical_path,f.sha256,f.bytes,f.kind,v.episode_id
 FROM visible_files f JOIN content_records v ON v.owner_id=f.owner_id AND v.sha256=f.sha256
 WHERE f.direct_episode_id IS NULL;
