-- Presentation preferences only. Original sources, records, files and protections remain immutable.
CREATE TABLE local_identity.history_source_preferences(
 source_id text PRIMARY KEY REFERENCES local_identity.history_sources(id),
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 archived_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON local_identity.history_source_preferences FROM PUBLIC,loop_owner,loop_worker;
ALTER TABLE local_identity.history_source_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_history_preferences ON local_identity.history_source_preferences TO loop_app
 USING(owner_id=local_identity.owner_id() AND EXISTS(SELECT 1 FROM local_identity.history_sources s WHERE s.id=source_id AND s.owner_id=local_identity.owner_id()))
 WITH CHECK(owner_id=local_identity.owner_id() AND EXISTS(SELECT 1 FROM local_identity.history_sources s WHERE s.id=source_id AND s.owner_id=local_identity.owner_id()));
GRANT SELECT,INSERT,UPDATE ON local_identity.history_source_preferences TO loop_app;

-- Aggregate sharing checks must include sources owned by others, without exposing their metadata.
CREATE FUNCTION local_identity.preview_history_cleanup(p_source text,p_session_hash text) RETURNS jsonb
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
  SELECT c.*,EXISTS(SELECT 1 FROM local_identity.history_files other WHERE other.sha256=c.sha256 AND other.source_id<>p_source) shared FROM content c
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
REVOKE ALL ON FUNCTION local_identity.preview_history_cleanup(text,text) FROM PUBLIC,loop_owner,loop_worker;
GRANT EXECUTE ON FUNCTION local_identity.preview_history_cleanup(text,text) TO loop_app;
CREATE INDEX history_files_content_sources ON local_identity.history_files(sha256,source_id);
CREATE INDEX history_rows_version_sources ON local_identity.history_source_rows(table_name,row_key,payload_sha256,source_id);
