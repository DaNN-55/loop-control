-- Recovery aliases describe an actual restore, including new installations with
-- no historical import. They never manufacture source/archive evidence.
ALTER TABLE local_identity.restore_record ADD COLUMN media_source_roots text[] NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION local_identity.media_deployment() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('targetRoot',coalesce((SELECT path FROM local_identity.media_root_binding WHERE singleton),(SELECT media_root FROM local_identity.restore_record WHERE singleton)),
 'binding',local_identity.media_root_binding(),'sourceRoots',coalesce((SELECT jsonb_agg(DISTINCT r) FROM (
  SELECT unnest(i.media_source_roots||ARRAY[i.source_media_root]) r FROM local_identity.import_record i
  UNION ALL SELECT unnest(x.media_source_roots) FROM local_identity.restore_record x
 ) aliases WHERE r IS NOT NULL AND r<>''),'[]'::jsonb))
$$;
