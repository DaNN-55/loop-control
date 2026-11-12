-- Explicit Owner deletion of one production history; ordinary lifecycle semantics stay unchanged.
CREATE TABLE local_identity.history_episode_deletions(
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),episode_id text NOT NULL,
 deleted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,episode_id)
);
ALTER TABLE local_identity.history_episode_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_history_episode_deletions ON local_identity.history_episode_deletions TO loop_app USING(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.history_episode_deletions FROM PUBLIC,loop_owner,loop_worker;
GRANT SELECT ON local_identity.history_episode_deletions TO loop_app;

CREATE FUNCTION local_identity.history_episode_row_matches(p_table text,p_row jsonb,p_episode text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_episode IS NOT NULL AND (p_row->>'episode_id'=p_episode OR p_table='episodes' AND p_row->>'id'=p_episode
 OR p_row->>'task_id' IN(SELECT id::text FROM public.tasks WHERE episode_id=p_episode::uuid)
 OR p_row->>'review_package_id' IN(SELECT id::text FROM public.review_packages WHERE episode_id=p_episode::uuid)
 OR p_row->>'audio_track_id' IN(SELECT id::text FROM public.audio_tracks WHERE episode_id=p_episode::uuid)) IS TRUE
$$;
REVOKE ALL ON FUNCTION local_identity.history_episode_row_matches(text,jsonb,text) FROM PUBLIC,loop_owner,loop_app,loop_worker;
CREATE FUNCTION local_identity.history_episode_business_revision(p_episode text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t record;part text;parts text:='';
BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p') ORDER BY c.relname LOOP
  EXECUTE format($query$SELECT md5(coalesce(string_agg(to_jsonb(r)::text,'' ORDER BY to_jsonb(r)::text),'')) FROM %I.%I r WHERE local_identity.history_episode_row_matches($1,to_jsonb(r),$2)$query$,t.nspname,t.relname) INTO part USING t.relname,p_episode;
  parts:=parts||t.relname||':'||part||';';
 END LOOP;
 RETURN md5(parts);
END $$;
REVOKE ALL ON FUNCTION local_identity.history_episode_business_revision(text) FROM PUBLIC,loop_owner,loop_app,loop_worker;

-- Includes indirect JSON/text references. No caller gets data from another Owner.
CREATE FUNCTION local_identity.history_external_reference(p_value text,p_episode text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t record;hit boolean;
BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p') LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I r WHERE position($1 in to_jsonb(r)::text)>0 AND NOT local_identity.history_episode_row_matches($3,to_jsonb(r),$2))',t.nspname,t.relname) INTO hit USING p_value,p_episode,t.relname;
  IF hit THEN RETURN true;END IF;
 END LOOP;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION local_identity.history_external_reference(text,text) FROM PUBLIC,loop_owner,loop_app,loop_worker;

CREATE FUNCTION local_identity.history_episode_delete_plan(p_episode text,p_session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e jsonb;records jsonb;files jsonb;blobs jsonb;result jsonb;label text;dependency record;
BEGIN
 IF session_user<>'loop_app' OR NOT EXISTS(SELECT 1 FROM local_identity.sessions WHERE token_hash=p_session_hash AND owner_id=local_identity.owner_id() AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Verified Owner session required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.history_episode_records WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode) AND NOT EXISTS(SELECT 1 FROM local_identity.history_episode_files WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode) THEN RAISE EXCEPTION 'History episode unavailable' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM local_identity.history_episode_deletions WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode) THEN RAISE EXCEPTION 'History episode already deleted' USING ERRCODE='55000';END IF;
 SELECT to_jsonb(x) INTO e FROM(SELECT ep.*,b.policy FROM public.episodes ep JOIN public.account_blueprint_versions b ON b.id=ep.blueprint_version_id WHERE ep.id=p_episode::uuid FOR UPDATE OF ep)x;
 IF e IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.account_memberships WHERE account_id=(e->>'account_id')::uuid AND user_id=local_identity.owner_id() AND role='owner') THEN RAISE EXCEPTION 'Owner membership required' USING ERRCODE='42501';END IF;
  PERFORM id FROM public.tasks WHERE episode_id=p_episode::uuid ORDER BY id FOR UPDATE NOWAIT;
  IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode::uuid AND status='running') OR EXISTS(SELECT 1 FROM public.asset_locks WHERE episode_id=p_episode::uuid AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Active work prevents deletion' USING ERRCODE='55000';END IF;
 END IF;
 -- A surviving order must not lose a referenced episode, material, task or review object.
 FOR dependency IN SELECT p_episode id UNION SELECT id::text FROM public.production_material_revisions WHERE episode_id=p_episode::uuid UNION SELECT id::text FROM public.review_packages WHERE episode_id=p_episode::uuid UNION SELECT id::text FROM public.tasks WHERE episode_id=p_episode::uuid UNION SELECT id::text FROM public.artifacts WHERE episode_id=p_episode::uuid LOOP
  IF local_identity.history_external_reference(dependency.id,p_episode) THEN RAISE EXCEPTION 'Surviving business dependency prevents deletion' USING ERRCODE='55000';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY table_name,row_key::text,payload_sha256),'[]') INTO records FROM local_identity.history_episode_records r WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode AND NOT EXISTS(SELECT 1 FROM local_identity.history_episode_records other WHERE other.table_name=r.table_name AND other.row_key=r.row_key AND other.payload_sha256=r.payload_sha256 AND (other.owner_id<>r.owner_id OR other.episode_id<>p_episode));
 SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY logical_path,sha256,source_id),'[]') INTO files FROM local_identity.history_episode_files f WHERE owner_id=local_identity.owner_id() AND episode_id=p_episode;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY sha256),'[]') INTO blobs FROM(
  SELECT f.sha256,max(f.bytes) bytes FROM local_identity.history_episode_files f
  JOIN local_identity.history_file_catalog raw ON raw.owner_id=f.owner_id AND raw.source_id IS NOT DISTINCT FROM f.source_id AND raw.logical_path=f.logical_path AND raw.sha256=f.sha256
  WHERE f.owner_id=local_identity.owner_id() AND f.episode_id=p_episode
  GROUP BY f.sha256
  HAVING NOT bool_or(raw.kind IN('ordinary-template-configuration','ordinary-history-literals') OR raw.metadata?'currentPath' OR raw.metadata?'formerRuntimePath' OR raw.metadata?'replacements' OR EXISTS(SELECT 1 FROM local_identity.history_file_protections p WHERE p.original_sha256=f.sha256 OR p.protected_sha256=f.sha256) OR EXISTS(SELECT 1 FROM local_identity.history_retained_files keep WHERE keep.sha256=f.sha256 AND keep.retention_reason<>'production-history'))
  AND NOT EXISTS(SELECT 1 FROM local_identity.history_episode_files other WHERE other.sha256=f.sha256 AND (other.owner_id<>local_identity.owner_id() OR other.episode_id<>p_episode))
  AND NOT EXISTS(SELECT 1 FROM local_identity.history_file_catalog other WHERE other.sha256=f.sha256 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(files) own WHERE own->>'owner_id'=other.owner_id::text AND own->>'source_id' IS NOT DISTINCT FROM other.source_id AND own->>'logical_path'=other.logical_path AND own->>'sha256'=other.sha256))
  AND NOT EXISTS(SELECT 1 FROM local_identity.history_versions v WHERE position(f.sha256 in v.payload::text)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(records) r WHERE r->>'table_name'=v.table_name AND r->'row_key'=v.row_key AND r->>'payload_sha256'=v.payload_sha256))
  AND NOT local_identity.history_external_reference(f.sha256,p_episode)
 )x;
 SELECT coalesce(e->>'title',(SELECT payload->>'title' FROM local_identity.history_versions WHERE owner_id=local_identity.owner_id() AND table_name='public.episodes' AND payload->>'id'=p_episode ORDER BY coalesce(payload->>'updated_at','') DESC LIMIT 1),'未命名生产单 · '||left(p_episode,8)) INTO label;
 result:=jsonb_build_object('episodeId',p_episode,'title',label,'live',e,'businessRevision',local_identity.history_episode_business_revision(p_episode),'records',records,'files',files,'blobs',blobs);
 RETURN result||jsonb_build_object('revision',md5(result::text));
END $$;
REVOKE ALL ON FUNCTION local_identity.history_episode_delete_plan(text,text) FROM PUBLIC,loop_owner,loop_worker;
GRANT EXECUTE ON FUNCTION local_identity.history_episode_delete_plan(text,text) TO loop_app;

CREATE FUNCTION local_identity.delete_history_episode(p_episode text,p_session_hash text,p_revision text,p_retained text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p jsonb;summary jsonb;r record;
BEGIN
 -- Stable reference inventory while the API stages this episode's confirmed directories.
 PERFORM local_identity.lock_history_deletion_inventory(p_session_hash);
 p:=local_identity.history_episode_delete_plan(p_episode,p_session_hash);
 IF p->>'revision' IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'History deletion plan changed' USING ERRCODE='55000';END IF;
 IF p->'live'<>'null'::jsonb THEN
  DELETE FROM local_identity.historical_tasks WHERE task_id IN(SELECT id FROM public.tasks WHERE episode_id=p_episode::uuid);
  DELETE FROM local_identity.historical_episodes WHERE episode_id=p_episode::uuid;
  DELETE FROM local_identity.input_episodes WHERE episode_id=p_episode::uuid;
  UPDATE public.episodes SET archived_at=coalesce(archived_at,now()) WHERE id=p_episode::uuid;
  summary:=public.delete_episode(p_episode::uuid,local_identity.owner_id());
 END IF;
 FOR r IN SELECT x->>'table_name' table_name,x->'row_key' row_key,x->>'payload_sha256' sha FROM jsonb_array_elements(p->'records')x LOOP
  DELETE FROM local_identity.history_source_rows sr USING local_identity.history_sources s WHERE sr.source_id=s.id AND s.owner_id=local_identity.owner_id() AND sr.table_name=r.table_name AND sr.row_key=r.row_key AND sr.payload_sha256=r.sha;
  DELETE FROM local_identity.history_projection_results pr WHERE pr.table_name=r.table_name AND pr.row_key=r.row_key AND pr.payload_sha256=r.sha AND NOT EXISTS(SELECT 1 FROM local_identity.history_source_rows sr WHERE sr.table_name=pr.table_name AND sr.row_key=pr.row_key AND sr.payload_sha256=pr.payload_sha256);
  DELETE FROM local_identity.history_versions v WHERE v.owner_id=local_identity.owner_id() AND v.table_name=r.table_name AND v.row_key=r.row_key AND v.payload_sha256=r.sha AND NOT EXISTS(SELECT 1 FROM local_identity.history_source_rows sr WHERE sr.table_name=v.table_name AND sr.row_key=v.row_key AND sr.payload_sha256=v.payload_sha256);
 END LOOP;
 -- Keep metadata and protected/shared content available to surviving business references.
 INSERT INTO local_identity.history_retained_files(owner_id,logical_path,sha256,bytes,kind,metadata,retention_reason)
 SELECT f.owner_id,f.logical_path,f.sha256,f.bytes,f.kind,f.metadata,'business-dependency'
 FROM local_identity.history_file_catalog f WHERE f.owner_id=local_identity.owner_id()
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(p->'files') x WHERE x->>'logical_path'=f.logical_path AND x->>'sha256'=f.sha256 AND x->>'source_id' IS NOT DISTINCT FROM f.source_id)
 AND (f.sha256=ANY(p_retained) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'blobs') x WHERE x->>'sha256'=f.sha256))
 ON CONFLICT(owner_id,logical_path,sha256,retention_variant) DO UPDATE SET retention_reason=CASE WHEN history_retained_files.retention_reason='production-history' THEN 'business-dependency' ELSE history_retained_files.retention_reason END;
 FOR r IN SELECT DISTINCT x->>'source_id' source_id,x->>'logical_path' logical_path,x->>'sha256' sha FROM jsonb_array_elements(p->'files')x LOOP
  -- Shared physical content stays. Remove only the selected association when it cannot belong to another episode.
  IF NOT EXISTS(SELECT 1 FROM local_identity.history_episode_files other WHERE other.sha256=r.sha AND other.logical_path=r.logical_path AND other.source_id IS NOT DISTINCT FROM r.source_id AND (other.owner_id<>local_identity.owner_id() OR other.episode_id<>p_episode)) THEN
   IF r.source_id IS NULL THEN
    DELETE FROM local_identity.history_retained_files f WHERE f.owner_id=local_identity.owner_id() AND f.logical_path=r.logical_path AND f.sha256=r.sha AND f.retention_reason='production-history';
   ELSE
    DELETE FROM local_identity.history_files f USING local_identity.history_sources s WHERE f.source_id=s.id AND s.owner_id=local_identity.owner_id() AND f.source_id=r.source_id AND f.logical_path=r.logical_path AND f.sha256=r.sha;
   END IF;
  END IF;
 END LOOP;
 INSERT INTO local_identity.history_episode_deletions(owner_id,episode_id) VALUES(local_identity.owner_id(),p_episode);
 RETURN jsonb_build_object('episode',summary,'records',jsonb_array_length(p->'records'),'fileLinks',jsonb_array_length(p->'files'));
END $$;
REVOKE ALL ON FUNCTION local_identity.delete_history_episode(text,text,text,text[]) FROM PUBLIC,loop_owner,loop_worker;
GRANT EXECUTE ON FUNCTION local_identity.delete_history_episode(text,text,text,text[]) TO loop_app;

CREATE FUNCTION local_identity.history_cleanup_blob_referenced(p_sha text,p_session_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF session_user<>'loop_app' OR NOT EXISTS(SELECT 1 FROM local_identity.sessions WHERE token_hash=p_session_hash AND owner_id=local_identity.owner_id() AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Verified Owner session required' USING ERRCODE='42501';END IF;
 RETURN EXISTS(SELECT 1 FROM local_identity.history_file_catalog WHERE sha256=p_sha) OR EXISTS(SELECT 1 FROM local_identity.history_file_protections WHERE original_sha256=p_sha OR protected_sha256=p_sha) OR EXISTS(SELECT 1 FROM local_identity.history_versions WHERE position(p_sha in payload::text)>0) OR local_identity.history_external_reference(p_sha);
END $$;
REVOKE ALL ON FUNCTION local_identity.history_cleanup_blob_referenced(text,text) FROM PUBLIC,loop_owner,loop_worker;
GRANT EXECUTE ON FUNCTION local_identity.history_cleanup_blob_referenced(text,text) TO loop_app;

CREATE FUNCTION local_identity.history_media_path_referenced(p_path text,p_episode text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT local_identity.history_external_reference(p_path,p_episode) OR local_identity.history_external_reference('episodes/'||p_episode||'/',p_episode)
 OR EXISTS(SELECT 1 FROM local_identity.history_versions v WHERE (position(p_path in v.payload::text)>0 OR position('episodes/'||p_episode||'/' in v.payload::text)>0) AND NOT EXISTS(SELECT 1 FROM local_identity.history_episode_records r WHERE r.owner_id=v.owner_id AND r.table_name=v.table_name AND r.row_key=v.row_key AND r.payload_sha256=v.payload_sha256 AND r.episode_id=p_episode))
$$;
REVOKE ALL ON FUNCTION local_identity.history_media_path_referenced(text,text) FROM PUBLIC,loop_owner,loop_worker;
GRANT EXECUTE ON FUNCTION local_identity.history_media_path_referenced(text,text) TO loop_app;

CREATE FUNCTION local_identity.lock_history_deletion_inventory(p_session_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t record;
BEGIN
 IF session_user<>'loop_app' OR NOT EXISTS(SELECT 1 FROM local_identity.sessions WHERE token_hash=p_session_hash AND owner_id=local_identity.owner_id() AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Verified Owner session required' USING ERRCODE='42501';END IF;
 FOR t IN SELECT n.nspname,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('r','p') AND (n.nspname='public' OR n.nspname='local_identity' AND c.relname IN('history_sources','history_versions','history_source_rows','history_files','history_retained_files','history_file_protections','history_projection_results')) ORDER BY n.nspname,c.relname LOOP
  EXECUTE format('LOCK TABLE %I.%I IN SHARE ROW EXCLUSIVE MODE NOWAIT',t.nspname,t.relname);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION local_identity.lock_history_deletion_inventory(text) FROM PUBLIC,loop_owner,loop_worker;
GRANT EXECUTE ON FUNCTION local_identity.lock_history_deletion_inventory(text) TO loop_app;

CREATE FUNCTION local_identity.retain_history_cleanup_file(p_key uuid,p_sha text,p_session_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target jsonb;
BEGIN
 IF session_user<>'loop_app' OR NOT EXISTS(SELECT 1 FROM local_identity.sessions WHERE token_hash=p_session_hash AND owner_id=local_identity.owner_id() AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Verified Owner session required' USING ERRCODE='42501';END IF;
 SELECT t INTO target FROM local_identity.command_receipts r CROSS JOIN LATERAL jsonb_array_elements(r.result->'historyCleanupTargets')t WHERE r.owner_id=local_identity.owner_id() AND r.idempotency_key=p_key AND t->>'sha'=p_sha;
 IF target IS NULL THEN RAISE EXCEPTION 'Cleanup target unavailable' USING ERRCODE='42501';END IF;
 INSERT INTO local_identity.history_retained_files(owner_id,logical_path,sha256,bytes,kind,metadata,retention_reason)
 VALUES(local_identity.owner_id(),'retained-after-deletion/'||p_key::text||'/'||p_sha,p_sha,(target->>'bytes')::bigint,'retained-dependency',jsonb_build_object('deletionKey',p_key),'business-dependency') ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION local_identity.retain_history_cleanup_file(uuid,text,text) FROM PUBLIC,loop_owner,loop_worker;
GRANT EXECUTE ON FUNCTION local_identity.retain_history_cleanup_file(uuid,text,text) TO loop_app;
