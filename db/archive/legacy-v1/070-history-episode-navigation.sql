-- Derived navigation only. Original history payloads, file identities and protection maps are unchanged.
CREATE VIEW local_identity.history_episode_records WITH(security_invoker=true) AS
 SELECT DISTINCT v.owner_id,v.table_name,v.row_key,v.payload_sha256,
 CASE WHEN v.table_name='public.episodes' THEN v.payload->>'id' ELSE v.payload->>'episode_id' END episode_id
 FROM local_identity.history_versions v
 WHERE (CASE WHEN v.table_name='public.episodes' THEN v.payload->>'id' ELSE v.payload->>'episode_id' END) ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$'
 UNION
 SELECT DISTINCT v.owner_id,v.table_name,v.row_key,v.payload_sha256,t.payload->>'episode_id'
 FROM local_identity.history_versions v JOIN local_identity.history_versions t ON t.owner_id=v.owner_id AND t.table_name='public.tasks' AND t.payload->>'id'=v.payload->>'task_id'
 WHERE v.table_name='public.task_runs' AND t.payload->>'episode_id' ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$';
CREATE VIEW local_identity.history_episode_files WITH(security_invoker=true) AS
 SELECT DISTINCT s.owner_id,f.source_id,f.logical_path,f.sha256,f.bytes,f.kind,
 coalesce(nullif(f.metadata->>'episode_id',''),nullif(f.metadata->>'episodeId',''),
 (regexp_match(f.logical_path,'(?:^|/)episodes/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})(?:/|$)'))[1],
 (regexp_match(coalesce(f.metadata->>'formerRuntimePath',''),'(?:^|/)episodes/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})(?:/|$)'))[1]) episode_id
 FROM local_identity.history_files f JOIN local_identity.history_sources s ON s.id=f.source_id
 WHERE coalesce(nullif(f.metadata->>'episode_id',''),nullif(f.metadata->>'episodeId',''),
 (regexp_match(f.logical_path,'(?:^|/)episodes/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})(?:/|$)'))[1],
 (regexp_match(coalesce(f.metadata->>'formerRuntimePath',''),'(?:^|/)episodes/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})(?:/|$)'))[1]) ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$'
 UNION
 SELECT DISTINCT s.owner_id,f.source_id,f.logical_path,f.sha256,f.bytes,f.kind,v.payload->>'episode_id'
 FROM local_identity.history_files f JOIN local_identity.history_sources s ON s.id=f.source_id
 JOIN local_identity.history_versions v ON v.owner_id=s.owner_id AND v.table_name IN('public.artifacts','public.production_material_revisions') AND v.payload->>'sha256'=f.sha256
 WHERE v.payload->>'episode_id' ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$';
REVOKE ALL ON local_identity.history_episode_records,local_identity.history_episode_files FROM PUBLIC;
GRANT SELECT ON local_identity.history_episode_records,local_identity.history_episode_files TO loop_app;
CREATE INDEX history_versions_episode_lookup ON local_identity.history_versions(owner_id,(payload->>'id')) WHERE table_name IN('public.episodes','public.accounts','public.tasks');
CREATE INDEX history_versions_content_lookup ON local_identity.history_versions(owner_id,(payload->>'sha256')) WHERE table_name IN('public.artifacts','public.production_material_revisions');
CREATE TABLE local_identity.history_episode_preferences(
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),episode_id text NOT NULL CHECK(episode_id ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$'),archived_at timestamptz,
 PRIMARY KEY(owner_id,episode_id)
);
ALTER TABLE local_identity.history_episode_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_history_episode_preferences ON local_identity.history_episode_preferences TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.history_episode_preferences FROM PUBLIC,loop_owner,loop_worker;
GRANT SELECT,INSERT,UPDATE ON local_identity.history_episode_preferences TO loop_app;
CREATE FUNCTION local_identity.preview_history_episode(p_episode text,p_session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF session_user<>'loop_app' OR NOT EXISTS(SELECT 1 FROM local_identity.sessions WHERE token_hash=p_session_hash AND owner_id=local_identity.owner_id() AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Verified session required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.history_episode_records WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode) AND NOT EXISTS(SELECT 1 FROM local_identity.history_episode_files WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode) THEN RAISE EXCEPTION 'History Episode unavailable' USING ERRCODE='42501';END IF;
 WITH selected AS MATERIALIZED(SELECT * FROM local_identity.history_episode_files WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode),
 shared_shas AS(SELECT DISTINCT other.sha256 FROM local_identity.history_files other LEFT JOIN selected own USING(source_id,logical_path,sha256) WHERE own.sha256 IS NULL UNION SELECT sha256 FROM local_identity.history_episode_files WHERE owner_id<>local_identity.owner_id() OR episode_id<>p_episode),
 content AS(
  SELECT f.sha256,max(f.bytes) bytes,min(f.logical_path) logical_path,
   bool_or(p.original_sha256 IS NOT NULL OR f.kind IN('ordinary-template-configuration','ordinary-history-literals') OR coalesce(jsonb_typeof(raw.metadata->'replacements')='array',false) OR raw.metadata?'currentPath' OR raw.metadata?'formerRuntimePath') protected
  FROM selected f JOIN local_identity.history_files raw USING(source_id,logical_path,sha256) LEFT JOIN local_identity.history_file_protections p ON p.original_sha256=f.sha256
  WHERE f.owner_id=local_identity.owner_id() AND f.episode_id=p_episode GROUP BY f.sha256
 ), classified AS(
  SELECT c.*,s.sha256 IS NOT NULL shared FROM content c LEFT JOIN shared_shas s USING(sha256)
 ) SELECT jsonb_build_object('episodeId',p_episode,'deletionEnabled',false,'checkedAt',clock_timestamp(),
 'fileLinks',(SELECT count(*)FROM local_identity.history_episode_files WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode),
 'contents',count(*),'sharedContents',count(*) FILTER(WHERE shared),'protectedContents',count(*) FILTER(WHERE protected AND NOT shared),'reviewContents',count(*) FILTER(WHERE NOT shared AND NOT protected),'reviewBytes',coalesce(sum(bytes) FILTER(WHERE NOT shared AND NOT protected),0),
 'recordLinks',(SELECT count(*)FROM local_identity.history_episode_records WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode),
 'samples',coalesce((SELECT jsonb_agg(x)FROM(SELECT logical_path,CASE WHEN shared THEN 'shared' WHEN protected THEN 'protected' ELSE 'needs-review' END state FROM classified ORDER BY logical_path LIMIT 12)x),'[]'::jsonb)) INTO result FROM classified;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION local_identity.preview_history_episode(text,text) FROM PUBLIC,loop_owner,loop_worker;
GRANT EXECUTE ON FUNCTION local_identity.preview_history_episode(text,text) TO loop_app;
