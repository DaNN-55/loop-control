-- Deployment metadata only; frozen policies/task packages are never rewritten.
ALTER TABLE local_identity.import_record ADD COLUMN media_source_roots text[] NOT NULL DEFAULT '{}';
CREATE TABLE local_identity.restore_record(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 archive_sha256 text NOT NULL CHECK(archive_sha256~'^[0-9a-f]{64}$'),
 source_database text NOT NULL,media_root text NOT NULL,
 restored_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON local_identity.restore_record FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
CREATE FUNCTION local_identity.media_deployment() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('targetRoot',(SELECT media_root FROM local_identity.restore_record WHERE singleton),'sourceRoots',
  coalesce((SELECT jsonb_agg(DISTINCT r) FROM local_identity.import_record i CROSS JOIN LATERAL unnest(i.media_source_roots||ARRAY[i.source_media_root])r WHERE r IS NOT NULL AND r<>''),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION local_identity.media_deployment() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.media_deployment() TO loop_owner,loop_app,loop_worker;
