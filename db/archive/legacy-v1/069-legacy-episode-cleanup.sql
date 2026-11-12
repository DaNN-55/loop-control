-- Cleanup of an owned archived legacy order does not opt it into native production.
CREATE OR REPLACE FUNCTION local_identity.lock_owned_episode_cleanup(p_episode_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM e.id FROM public.episodes e
 JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'
 WHERE e.id=p_episode_id AND NOT EXISTS(SELECT 1 FROM local_identity.historical_episodes h WHERE h.episode_id=e.id)
 FOR UPDATE OF e;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION local_identity.lock_owned_episode_cleanup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.lock_owned_episode_cleanup(uuid) TO loop_owner;

CREATE OR REPLACE FUNCTION local_identity.lock_owned_episode_deletion(p_episode_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT local_identity.lock_owned_episode_cleanup(p_episode_id) THEN RETURN false; END IF;
 PERFORM id FROM public.tasks WHERE episode_id=p_episode_id ORDER BY id FOR UPDATE NOWAIT;
 IF NOT EXISTS(SELECT 1 FROM public.episodes WHERE id=p_episode_id AND archived_at IS NOT NULL) OR EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode_id AND status='running') OR EXISTS(SELECT 1 FROM public.asset_locks WHERE episode_id=p_episode_id AND expires_at>now()) THEN RAISE EXCEPTION 'Archived Episode without active work required' USING ERRCODE='55000'; END IF; RETURN true;
END $$;
