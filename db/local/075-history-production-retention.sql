-- Production history and protected runtime files outlive disposable source imports.
-- This migration creates the separation only; it never moves or deletes existing data.
CREATE TABLE local_identity.history_retained_files(
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 logical_path text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes bigint NOT NULL CHECK(bytes>=0),kind text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}',
 retention_reason text NOT NULL CHECK(retention_reason IN('production-history','business-dependency','protected-reference')),
 PRIMARY KEY(owner_id,logical_path,sha256)
);
REVOKE ALL ON local_identity.history_retained_files FROM PUBLIC,loop_owner,loop_worker;
ALTER TABLE local_identity.history_retained_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_history_retained_files ON local_identity.history_retained_files TO loop_owner
 USING(owner_id=local_identity.owner_id());
GRANT SELECT ON local_identity.history_retained_files TO loop_owner;
CREATE INDEX history_retained_files_content ON local_identity.history_retained_files(owner_id,sha256);

CREATE VIEW local_identity.history_file_catalog WITH(security_invoker=true) AS
 SELECT s.owner_id,f.source_id,f.logical_path,f.sha256,f.bytes,f.kind,f.metadata
 FROM local_identity.history_files f JOIN local_identity.history_sources s ON s.id=f.source_id
 UNION ALL
 SELECT f.owner_id,NULL::text source_id,f.logical_path,f.sha256,f.bytes,f.kind,f.metadata
 FROM local_identity.history_retained_files f;
REVOKE ALL ON local_identity.history_file_catalog FROM PUBLIC,loop_worker;
GRANT SELECT ON local_identity.history_file_catalog TO loop_owner,loop_app;
ALTER POLICY owner_history_file_protections ON local_identity.history_file_protections
 USING(EXISTS(SELECT 1 FROM local_identity.history_file_catalog f WHERE f.sha256=original_sha256 AND f.owner_id=local_identity.owner_id()));

CREATE OR REPLACE VIEW local_identity.history_episode_files WITH(security_invoker=true) AS
 WITH visible_files AS MATERIALIZED(
 SELECT f.*,coalesce(nullif(f.metadata->>'episode_id',''),nullif(f.metadata->>'episodeId',''),
 (regexp_match(f.logical_path,'(?:^|/)episodes/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})(?:/|$)'))[1],
 (regexp_match(coalesce(f.metadata->>'formerRuntimePath',''),'(?:^|/)episodes/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})(?:/|$)'))[1]) direct_episode_id FROM local_identity.history_file_catalog f
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

CREATE OR REPLACE FUNCTION local_identity.preview_history_episode(p_episode text,p_session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF session_user<>'loop_app' OR NOT EXISTS(SELECT 1 FROM local_identity.sessions WHERE token_hash=p_session_hash AND owner_id=local_identity.owner_id() AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Verified session required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.history_episode_records WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode) AND NOT EXISTS(SELECT 1 FROM local_identity.history_episode_files WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode) THEN RAISE EXCEPTION 'History Episode unavailable' USING ERRCODE='42501';END IF;
 WITH selected AS MATERIALIZED(SELECT * FROM local_identity.history_episode_files WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode),
 shared_shas AS(SELECT DISTINCT other.sha256 FROM local_identity.history_file_catalog other WHERE NOT EXISTS(SELECT 1 FROM selected own WHERE own.owner_id=other.owner_id AND own.source_id IS NOT DISTINCT FROM other.source_id AND own.logical_path=other.logical_path AND own.sha256=other.sha256) UNION SELECT sha256 FROM local_identity.history_episode_files WHERE owner_id<>local_identity.owner_id() OR episode_id<>p_episode),
 content AS(
  SELECT f.sha256,max(f.bytes) bytes,min(f.logical_path) logical_path,
   bool_or(p.original_sha256 IS NOT NULL OR f.kind IN('ordinary-template-configuration','ordinary-history-literals') OR coalesce(jsonb_typeof(raw.metadata->'replacements')='array',false) OR raw.metadata?'currentPath' OR raw.metadata?'formerRuntimePath') protected
  FROM selected f JOIN local_identity.history_file_catalog raw ON raw.owner_id=f.owner_id AND raw.source_id IS NOT DISTINCT FROM f.source_id AND raw.logical_path=f.logical_path AND raw.sha256=f.sha256 LEFT JOIN local_identity.history_file_protections p ON p.original_sha256=f.sha256
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

CREATE OR REPLACE FUNCTION local_identity.secret_reference_inventory(p_session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF session_user<>'loop_app' OR NOT EXISTS(SELECT 1 FROM local_identity.sessions WHERE token_hash=p_session_hash AND owner_id=local_identity.owner_id() AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Verified application session required' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object(
  'connections',coalesce((SELECT jsonb_agg(jsonb_build_object('reference',b.secret_ref,'connectionId',c.id,'name',c.name,'provider',v.provider,'version',v.version,'current',c.current_version_id=v.id,'revoked',v.revoked_at IS NOT NULL)) FROM local_identity.connection_bindings b JOIN public.external_connection_versions v ON v.id=b.version_id JOIN public.external_connections c ON c.id=v.connection_id WHERE b.store_mode='keychain'),'[]'),
  'intents',coalesce((SELECT jsonb_agg(jsonb_build_object('reference',secret_ref,'name',metadata->>'name','operation',metadata->>'command')) FROM local_identity.connection_intents WHERE store_mode='keychain' AND applied_at IS NULL),'[]'),
  'history',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(
   SELECT reference,count(*)::integer occurrences FROM(
    SELECT m[1] reference FROM local_identity.history_versions v CROSS JOIN LATERAL regexp_matches(v.payload::text,'(?:"\$keychainRef"\s*:\s*"|keychain:)([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})','g') m
    UNION ALL SELECT r->>'reference' FROM local_identity.history_file_protections p CROSS JOIN LATERAL jsonb_array_elements(p.replacements) r
    UNION ALL SELECT r->>'reference' FROM local_identity.history_file_catalog f CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.metadata->'replacements')='array' THEN f.metadata->'replacements' ELSE '[]'::jsonb END) r
   ) refs WHERE reference ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$' GROUP BY reference
  ) x),'[]'),
  'files',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(
    SELECT DISTINCT ON(coalesce(p.protected_sha256,f.sha256)) coalesce(p.protected_sha256,f.sha256) sha256, coalesce(p.protected_bytes,f.bytes) bytes, f.logical_path FROM local_identity.history_file_catalog f LEFT JOIN local_identity.history_file_protections p ON p.original_sha256=f.sha256
    WHERE f.bytes>0 AND (f.logical_path ~* '\.(json|jsonl|md|txt|sql|ya?ml|toml|env|sh|py|[cm]?[jt]sx?|html|css|csv|log|ini|conf)$' OR f.kind IN ('text','source'))
    ORDER BY coalesce(p.protected_sha256,f.sha256),f.logical_path
  ) x),'[]')
 ) INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION local_identity.preview_history_cleanup(p_source text,p_session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF session_user<>'loop_app' OR NOT EXISTS(SELECT 1 FROM local_identity.sessions WHERE token_hash=p_session_hash AND owner_id=local_identity.owner_id() AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Verified application session required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.history_sources WHERE id=p_source AND owner_id=local_identity.owner_id()) THEN
  RAISE EXCEPTION 'History source unavailable' USING ERRCODE='42501';
 END IF;
 WITH content AS(
  SELECT f.sha256,max(f.bytes) bytes,min(f.logical_path) logical_path,
   bool_or(p.original_sha256 IS NOT NULL OR (CASE WHEN jsonb_typeof(f.metadata->'replacements')='array' THEN jsonb_array_length(f.metadata->'replacements')>0 ELSE false END) OR f.kind IN('ordinary-template-configuration','ordinary-history-literals') OR f.metadata ? 'currentPath' OR f.metadata ? 'formerRuntimePath') protected
  FROM local_identity.history_files f LEFT JOIN local_identity.history_file_protections p ON p.original_sha256=f.sha256
  WHERE f.source_id=p_source GROUP BY f.sha256
 ), classified AS(
  SELECT c.*,EXISTS(SELECT 1 FROM local_identity.history_file_catalog other WHERE other.sha256=c.sha256 AND other.source_id IS DISTINCT FROM p_source) shared FROM content c
 ) SELECT jsonb_build_object(
  'sourceId',p_source,'deletionEnabled',false,'checkedAt',clock_timestamp(),
  'fileLinks',(SELECT count(*) FROM local_identity.history_files WHERE source_id=p_source),
  'contents',count(*),'sharedContents',count(*) FILTER(WHERE shared),
  'protectedContents',count(*) FILTER(WHERE protected AND NOT shared),
  'reviewContents',count(*) FILTER(WHERE NOT shared AND NOT protected),
  'reviewBytes',coalesce(sum(bytes) FILTER(WHERE NOT shared AND NOT protected),0),
  'recordLinks',(SELECT count(*) FROM local_identity.history_source_rows WHERE source_id=p_source),
  'sharedRecords',(SELECT count(*) FROM local_identity.history_source_rows r WHERE source_id=p_source AND EXISTS(SELECT 1 FROM local_identity.history_source_rows other WHERE other.source_id<>p_source AND other.table_name=r.table_name AND other.row_key=r.row_key AND other.payload_sha256=r.payload_sha256)),
  'projectedRecords',(SELECT count(*) FROM local_identity.history_source_rows r JOIN local_identity.history_projection_results p USING(table_name,row_key,payload_sha256) WHERE r.source_id=p_source AND p.status IN('inserted','current-preserved')),
  'samples',coalesce((SELECT jsonb_agg(x) FROM(SELECT logical_path,CASE WHEN shared THEN 'shared' WHEN protected THEN 'protected' ELSE 'needs-review' END state FROM classified ORDER BY logical_path LIMIT 12)x),'[]'::jsonb)
 ) INTO result FROM classified;
 RETURN result;
END $$;
