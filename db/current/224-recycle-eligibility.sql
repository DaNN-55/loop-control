-- Share Owner and state checks between the advisory preview and the locked command.
CREATE FUNCTION local_identity.recycle_episode_eligibility(p_episode uuid) RETURNS text
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO ''
 AS $$
DECLARE episode_account uuid;
BEGIN
 SELECT e.account_id INTO episode_account
 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id
 WHERE e.id=p_episode AND m.user_id=local_identity.owner_id() AND m.role='owner'
 AND NOT EXISTS(SELECT 1 FROM local_identity.historical_episodes h WHERE h.episode_id=e.id);
 IF NOT FOUND THEN RETURN 'missing';END IF;
 IF local_identity.is_recycled_episode(p_episode) THEN RETURN 'recycled';END IF;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode AND invalidated_at IS NULL AND status IN ('ready','running'))
  OR EXISTS(SELECT 1 FROM public.asset_locks WHERE episode_id=p_episode AND expires_at>clock_timestamp())
  OR local_identity.episode_deletion_submission_unknown(p_episode)
  OR EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode AND status<>'completed' AND invalidated_at IS NULL AND coalesce(last_result#>'{preflight,checks}','[]'::jsonb) @> '[{"check":"provider_result_unknown"}]'::jsonb)
  OR EXISTS(SELECT 1 FROM local_identity.workspace_publication_holds(p_episode))
  OR EXISTS(SELECT 1 FROM local_identity.account_directory_migrations WHERE account_id=episode_account AND status IN ('planned','copying','failed'))
  OR EXISTS(SELECT 1 FROM local_identity.episode_deletion_intents WHERE episode_id=p_episode AND state IN ('prepared','committed'))
 THEN RETURN 'busy';END IF;
 RETURN 'ready';
END $$;

REVOKE ALL ON FUNCTION local_identity.recycle_episode_eligibility(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.recycle_episode_eligibility(uuid) TO loop_app;

CREATE OR REPLACE FUNCTION local_identity.recycle_owned_episode(p_episode uuid, p_inventory jsonb, p_size bigint) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
 AS $$
DECLARE e public.episodes; version uuid;
BEGIN
 IF NOT local_identity.lock_owned_episode_cleanup(p_episode) THEN RAISE EXCEPTION 'Owned Episode required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF local_identity.is_recycled_episode(p_episode) THEN RAISE EXCEPTION 'Episode already recycled' USING ERRCODE='55000';END IF;
 PERFORM id FROM public.tasks WHERE episode_id=p_episode ORDER BY id FOR UPDATE NOWAIT;
 IF local_identity.recycle_episode_eligibility(p_episode)<>'ready' THEN RAISE EXCEPTION 'Episode has active or unresolved work' USING ERRCODE='55000';END IF;
 IF p_size IS NULL OR p_size<0 OR p_inventory IS NULL OR jsonb_typeof(p_inventory)<>'object' THEN RAISE EXCEPTION 'Invalid recycle inventory' USING ERRCODE='22023';END IF;
 INSERT INTO local_identity.episode_recycle_bin(episode_id,owner_id,archived_before,size_bytes,inventory) VALUES(e.id,local_identity.owner_id(),e.archived_at,p_size,p_inventory) RETURNING revision INTO version;
 UPDATE public.episodes SET archived_at=coalesce(archived_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=e.id;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,e.id,'episode_recycled',jsonb_build_object('revision',version,'size_bytes',p_size),local_identity.owner_id());
 RETURN version;
END $$;
