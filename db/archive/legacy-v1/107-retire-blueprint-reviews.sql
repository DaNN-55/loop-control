-- Script confirmation is an Owner action. Blueprint-wide readiness and retired
-- approval switches are not prerequisites; execution still checks its own inputs.
DO $$
DECLARE definition text; old_guard text:=$guard$  if current_episode.worker_preflight_at is null or current_episode.worker_preflight_at < now() - interval '10 minutes' then raise exception 'A fresh Worker preflight is required before starting episode production' using errcode = '42501'; end if;$guard$;
BEGIN
 definition:=pg_get_functiondef('public.start_episode_production(uuid)'::regprocedure);
 IF strpos(definition,old_guard)=0 THEN RAISE EXCEPTION 'Script confirmation contract changed'; END IF;
 EXECUTE replace(definition,old_guard,'');
END $$;
-- Keep the historical configuration, approvals and audit rows intact. No switch
-- may fabricate a new approval or automatically advance an old production order.
CREATE OR REPLACE FUNCTION public.auto_advance_disabled_approval_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN NEW;
END $$;

-- Owner's explicit preparation action can continue a validated legacy board.
-- This records the chosen script/board baseline, never an old review conclusion.
CREATE FUNCTION local_identity.confirm_legacy_workspace_preparation(p_episode uuid,p_script uuid,p_package uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF e.main_script_revision_id IS DISTINCT FROM p_script OR e.archived_at IS NOT NULL OR e.stage NOT IN ('storyboard_review','storyboard_approved','production_ready','render_ready','qc_review','qc_passed') OR local_identity.is_historical_episode(p_episode) THEN RAISE EXCEPTION 'Current confirmed script required' USING ERRCODE='22023'; END IF;
 IF p_package IS DISTINCT FROM (SELECT p.id FROM public.review_packages p JOIN public.artifacts a ON a.id=p.artifact_id WHERE p.episode_id=p_episode AND p.stage='storyboard_review' AND p.invalidated_at IS NULL ORDER BY p.revision_number DESC LIMIT 1) THEN RAISE EXCEPTION 'Current storyboard required' USING ERRCODE='22023'; END IF;
 INSERT INTO local_identity.workspace_preparations(package_id,episode_id,script_revision_id,origin,confirmed_by) VALUES(p_package,p_episode,p_script,'legacy-board',local_identity.owner_id()) ON CONFLICT(package_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM local_identity.workspace_preparations WHERE package_id=p_package AND episode_id=p_episode AND script_revision_id=p_script) THEN RAISE EXCEPTION 'Preparation baseline changed' USING ERRCODE='40001'; END IF;
END $$;
REVOKE ALL ON FUNCTION local_identity.confirm_legacy_workspace_preparation(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.confirm_legacy_workspace_preparation(uuid,uuid,uuid) TO loop_app;
