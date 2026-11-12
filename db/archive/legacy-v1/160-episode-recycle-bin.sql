-- Recycle membership preserves the complete Episode graph and original archive state.
CREATE TABLE local_identity.episode_recycle_bin(
 episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 archived_before timestamptz,
 recycled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revision uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
 size_bytes bigint NOT NULL CHECK(size_bytes>=0),
 inventory jsonb NOT NULL CHECK(jsonb_typeof(inventory)='object'),
 last_error text
);
CREATE INDEX episode_recycle_bin_owner_age ON local_identity.episode_recycle_bin(owner_id,recycled_at,episode_id);
CREATE TABLE local_identity.recycle_bin_settings(
 owner_id uuid PRIMARY KEY REFERENCES local_identity.owners(id),
 limit_bytes bigint NOT NULL DEFAULT 5000000000 CHECK(limit_bytes BETWEEN 100000000 AND 1000000000000),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0)
);
ALTER TABLE local_identity.episode_recycle_bin ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.recycle_bin_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY episode_recycle_owner ON local_identity.episode_recycle_bin TO loop_app USING(owner_id=local_identity.owner_id());
CREATE POLICY recycle_settings_owner ON local_identity.recycle_bin_settings TO loop_app USING(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.episode_recycle_bin,local_identity.recycle_bin_settings FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT ON local_identity.episode_recycle_bin,local_identity.recycle_bin_settings TO loop_app;

CREATE FUNCTION local_identity.is_recycled_episode(p_episode uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin r WHERE r.episode_id=p_episode)
$$;
REVOKE ALL ON FUNCTION local_identity.is_recycled_episode(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.is_recycled_episode(uuid) TO loop_app,loop_worker;

CREATE OR REPLACE FUNCTION local_identity.lock_owned_input_episode(p_episode_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM e.id FROM public.episodes e
 JOIN local_identity.input_episodes i ON i.episode_id=e.id AND i.owner_id=local_identity.owner_id()
 JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'
 WHERE e.id=p_episode_id AND NOT local_identity.is_recycled_episode(e.id) FOR UPDATE OF e;
 RETURN FOUND;
END $$;

-- Keep the existing task capability expression, but stop all dispatch for recycled work.
DO $recycle_dispatch$ DECLARE original text; expression text; language text;BEGIN
 SELECT p.prosrc,l.lanname INTO original,language FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid='local_identity.input_task_allowed(uuid,text)'::regprocedure;
 IF language<>'sql' OR original !~* '^\s*select\s+' THEN RAISE EXCEPTION 'Input dispatch contract changed';END IF;
 expression:=regexp_replace(regexp_replace(original,'^\s*select\s+','','i'),';\s*$','');
 EXECUTE 'CREATE OR REPLACE FUNCTION local_identity.input_task_allowed(p_episode_id uuid,p_task_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='''' AS '||quote_literal('SELECT ('||expression||') AND NOT local_identity.is_recycled_episode(p_episode_id)');
END $recycle_dispatch$;

CREATE FUNCTION local_identity.recycle_owned_episode(p_episode uuid,p_inventory jsonb,p_size bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes; version uuid;
BEGIN
 IF NOT local_identity.lock_owned_episode_cleanup(p_episode) THEN RAISE EXCEPTION 'Owned Episode required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF local_identity.is_recycled_episode(p_episode) THEN RAISE EXCEPTION 'Episode already recycled' USING ERRCODE='55000';END IF;
 PERFORM id FROM public.tasks WHERE episode_id=p_episode ORDER BY id FOR UPDATE NOWAIT;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode AND invalidated_at IS NULL AND status IN ('ready','running'))
  OR EXISTS(SELECT 1 FROM public.asset_locks WHERE episode_id=p_episode AND expires_at>clock_timestamp())
  OR local_identity.episode_deletion_submission_unknown(p_episode)
  OR EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode AND status<>'completed' AND invalidated_at IS NULL AND coalesce(last_result#>'{preflight,checks}','[]'::jsonb) @> '[{"check":"provider_result_unknown"}]'::jsonb)
  OR EXISTS(SELECT 1 FROM local_identity.workspace_publication_holds(p_episode))
  OR EXISTS(SELECT 1 FROM local_identity.account_directory_migrations WHERE account_id=e.account_id AND status IN ('planned','copying','failed'))
  OR EXISTS(SELECT 1 FROM local_identity.episode_deletion_intents WHERE episode_id=p_episode AND state IN ('prepared','committed')) THEN RAISE EXCEPTION 'Episode has active or unresolved work' USING ERRCODE='55000';END IF;
 IF p_size IS NULL OR p_size<0 OR p_inventory IS NULL OR jsonb_typeof(p_inventory)<>'object' THEN RAISE EXCEPTION 'Invalid recycle inventory' USING ERRCODE='22023';END IF;
 INSERT INTO local_identity.episode_recycle_bin(episode_id,owner_id,archived_before,size_bytes,inventory) VALUES(e.id,local_identity.owner_id(),e.archived_at,p_size,p_inventory) RETURNING revision INTO version;
 UPDATE public.episodes SET archived_at=coalesce(archived_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=e.id;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,e.id,'episode_recycled',jsonb_build_object('revision',version,'size_bytes',p_size),local_identity.owner_id());
 RETURN version;
END $$;
REVOKE ALL ON FUNCTION local_identity.recycle_owned_episode(uuid,jsonb,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.recycle_owned_episode(uuid,jsonb,bigint) TO loop_app;

CREATE FUNCTION local_identity.restore_recycled_episode(p_episode uuid,p_revision uuid) RETURNS public.episodes
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r local_identity.episode_recycle_bin; e public.episodes;
BEGIN
 IF NOT local_identity.lock_owned_episode_cleanup(p_episode) THEN RAISE EXCEPTION 'Owned Episode required' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM local_identity.episode_recycle_bin WHERE episode_id=p_episode AND owner_id=local_identity.owner_id() FOR UPDATE;
 IF NOT FOUND OR r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Recycle revision changed' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM local_identity.episode_deletion_intents WHERE episode_id=p_episode AND state IN ('prepared','committed')) THEN RAISE EXCEPTION 'Episode deletion pending' USING ERRCODE='55000';END IF;
 UPDATE public.episodes SET archived_at=r.archived_before,updated_at=clock_timestamp() WHERE id=p_episode RETURNING * INTO e;
 DELETE FROM local_identity.episode_recycle_bin WHERE episode_id=p_episode;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,e.id,'episode_restored_from_recycle',jsonb_build_object('revision',r.revision),local_identity.owner_id());
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION local_identity.restore_recycled_episode(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.restore_recycled_episode(uuid,uuid) TO loop_app;

CREATE FUNCTION local_identity.save_recycle_limit(p_bytes bigint,p_revision bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current local_identity.recycle_bin_settings;
BEGIN
 IF local_identity.owner_id() IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF p_bytes IS NULL OR p_bytes NOT BETWEEN 100000000 AND 1000000000000 THEN RAISE EXCEPTION 'Invalid recycle limit' USING ERRCODE='22023';END IF;
 INSERT INTO local_identity.recycle_bin_settings(owner_id) VALUES(local_identity.owner_id()) ON CONFLICT DO NOTHING;
 SELECT * INTO current FROM local_identity.recycle_bin_settings WHERE owner_id=local_identity.owner_id() FOR UPDATE;
 IF current.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Recycle settings changed' USING ERRCODE='55000';END IF;
 UPDATE local_identity.recycle_bin_settings SET limit_bytes=p_bytes,revision=revision+1 WHERE owner_id=local_identity.owner_id() RETURNING revision INTO p_revision;
 RETURN p_revision;
END $$;
REVOKE ALL ON FUNCTION local_identity.save_recycle_limit(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.save_recycle_limit(bigint,bigint) TO loop_app;

CREATE FUNCTION local_identity.note_recycle_error(p_episode uuid,p_revision uuid,p_message text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 UPDATE local_identity.episode_recycle_bin SET last_error=left(p_message,1000) WHERE episode_id=p_episode AND revision=p_revision AND owner_id=local_identity.owner_id();
END $$;
REVOKE ALL ON FUNCTION local_identity.note_recycle_error(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.note_recycle_error(uuid,uuid,text) TO loop_app;

-- Planner holds the same Episode row lock as recycle admission. A predicate on
-- input_task_allowed alone would stop claims but still allow legacy planning.
CREATE OR REPLACE FUNCTION local_identity.plan_input_tasks(p_episode_id uuid DEFAULT NULL) RETURNS SETOF public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501';END IF;
 FOR candidate IN SELECT i.episode_id FROM local_identity.input_episodes i JOIN public.episodes e ON e.id=i.episode_id
 WHERE i.enabled AND e.archived_at IS NULL AND NOT local_identity.is_recycled_episode(e.id)
 AND (p_episode_id IS NULL OR i.episode_id=p_episode_id)
 AND NOT EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.episode_id=i.episode_id)
 FOR UPDATE OF e SKIP LOCKED LOOP
  RETURN QUERY SELECT * FROM local_identity.plan_input_tasks_before_workspace_audio(candidate.episode_id);
 END LOOP;
END $$;
