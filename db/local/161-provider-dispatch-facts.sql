-- New attempts only. Legacy submissions/reservations are never reclassified.
CREATE TABLE local_identity.provider_dispatch_facts(
 task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
 attempt integer NOT NULL CHECK(attempt>=0),
 lease_token uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('speech','image')),
 request_hash text NOT NULL,
 phase text NOT NULL CHECK(phase IN ('preparing','reserved','dispatching','received','rejected')),
 route text CHECK(route IN ('confirmed','legacy')),
 local_recoveries integer NOT NULL DEFAULT 0 CHECK(local_recoveries BETWEEN 0 AND 2),
 last_reason text,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(task_id,attempt)
);
ALTER TABLE local_identity.provider_dispatch_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON local_identity.provider_dispatch_facts FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;

-- The frozen task stays authoritative; mutable defaults do not grant a retry.
CREATE FUNCTION local_identity.provider_dispatch_context_current(p_task uuid,p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id
  JOIN local_identity.production_workspaces w ON w.episode_id=e.id
  JOIN public.review_packages rp ON rp.id=w.storyboard_package_id
  WHERE t.id=p_task AND t.invalidated_at IS NULL AND e.archived_at IS NULL
   AND e.stage<>'production_completed' AND NOT local_identity.is_recycled_episode(e.id)
   AND e.main_script_revision_id=w.script_revision_id AND rp.invalidated_at IS NULL
   AND CASE WHEN p_kind='speech' THEN
    t.task_type='generate_narration' AND EXISTS(
     SELECT 1 FROM local_identity.workspace_narration_requests r
     JOIN local_identity.workspace_production_authorizations a ON a.episode_id=r.episode_id
     WHERE r.task_id=t.id AND r.workspace_id=w.id AND a.enabled AND a.authorized_at IS NOT NULL
      AND a.script_revision_id=w.script_revision_id AND a.authorization_hash=r.authorization_hash
      AND CASE WHEN r.request_snapshot->>'selectionVersion'='1'
       THEN w.project_sha256=r.request_snapshot#>>'{target,projectSha256}'
       ELSE EXISTS(SELECT 1 FROM local_identity.workspace_narrations n WHERE n.workspace_id=w.id AND n.shot_id=r.shot_id AND n.mode='tts' AND n.task_id=t.id AND n.input_fingerprint=r.input_fingerprint AND n.confirmed_fingerprint=r.input_fingerprint) END)
   ELSE p_kind='image' AND t.task_type='generate_static_visual' AND t.provider='openai' AND EXISTS(
    SELECT 1 FROM local_identity.workspace_visual_candidates v
    JOIN local_identity.workspace_production_authorizations a ON a.episode_id=v.episode_id
    WHERE v.task_id=t.id AND v.workspace_id=w.id AND a.enabled AND a.authorized_at IS NOT NULL
     AND a.script_revision_id=w.script_revision_id AND a.authorization_hash=v.request_snapshot->>'authorizationHash'
     AND (v.request_snapshot#>>'{target,projectSha256}' IS NULL OR w.project_sha256=v.request_snapshot#>>'{target,projectSha256}')) END
 )
$$;
REVOKE ALL ON FUNCTION local_identity.provider_dispatch_context_current(uuid,text) FROM PUBLIC;

CREATE FUNCTION local_identity.prepare_provider_dispatch(p_task uuid,p_attempt integer,p_lease uuid,p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tasks;f local_identity.provider_dispatch_facts;prior local_identity.provider_dispatch_facts;r text;ok boolean;
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO t FROM public.tasks WHERE id=p_task FOR UPDATE;
 IF p_kind NOT IN ('speech','image') THEN RAISE EXCEPTION 'Invalid dispatch kind' USING ERRCODE='22023';END IF;
 IF NOT local_identity.provider_dispatch_context_current(p_task,p_kind) THEN RETURN jsonb_build_object('phase','not_sent','reason','input_changed');END IF;
 IF EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts x WHERE x.task_id=p_task AND (x.request_hash<>md5(t.input_snapshot::text) OR x.kind<>p_kind)) THEN RETURN jsonb_build_object('phase','not_sent','reason','input_changed');END IF;
 IF EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts x WHERE x.task_id=p_task AND x.phase IN ('dispatching','received')) THEN RETURN jsonb_build_object('phase','unknown','reason','previous_submission');END IF;
 IF EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts x WHERE x.task_id=p_task AND x.phase='rejected') THEN RETURN jsonb_build_object('phase','not_sent','reason','previous_rejected');END IF;
 SELECT * INTO f FROM local_identity.provider_dispatch_facts WHERE task_id=p_task AND attempt=p_attempt;
 IF FOUND AND f.lease_token IS DISTINCT FROM p_lease THEN RAISE EXCEPTION 'Dispatch fence changed' USING ERRCODE='42501';END IF;
 SELECT * INTO prior FROM local_identity.provider_dispatch_facts WHERE task_id=p_task AND phase='reserved' ORDER BY attempt DESC LIMIT 1;
 -- No new-protocol proof: a historical reservation remains unknown forever.
 IF prior.task_id IS NULL AND (EXISTS(SELECT 1 FROM public.paid_generation_reservations WHERE task_id=p_task)
  OR EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions WHERE task_id=p_task)
  OR EXISTS(SELECT 1 FROM local_identity.workspace_visual_submissions WHERE task_id=p_task)) THEN RETURN jsonb_build_object('phase','unknown','reason','legacy_submission');END IF;
 INSERT INTO local_identity.provider_dispatch_facts(task_id,attempt,lease_token,kind,request_hash,phase)
 VALUES(p_task,p_attempt,p_lease,p_kind,md5(t.input_snapshot::text),'preparing') ON CONFLICT DO NOTHING;
 IF prior.task_id IS NOT NULL THEN r:=prior.route;
 ELSIF p_kind='speech' THEN
  r:=local_identity.reserve_workspace_narration_route(p_task,p_attempt,p_lease);
  IF r IS NULL THEN
   UPDATE local_identity.provider_dispatch_facts SET last_reason='input_or_prior_request',updated_at=clock_timestamp() WHERE task_id=p_task AND attempt=p_attempt;
   RETURN jsonb_build_object('phase','not_sent','reason','input_or_prior_request');
  END IF;
 ELSE
  PERFORM local_identity.reserve_workspace_images(p_task,p_attempt,p_lease);r:='confirmed';
 END IF;
 UPDATE local_identity.provider_dispatch_facts SET phase='reserved',route=r,last_reason=NULL,updated_at=clock_timestamp() WHERE task_id=p_task AND attempt=p_attempt;
 RETURN jsonb_build_object('phase','reserved','route',r);
END $$;

CREATE FUNCTION local_identity.allow_provider_preparation_recovery(p_task uuid,p_attempt integer,p_lease uuid,p_kind text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tasks;used integer;
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO t FROM public.tasks WHERE id=p_task FOR UPDATE;
 IF p_kind NOT IN ('speech','image') OR NOT local_identity.provider_dispatch_context_current(p_task,p_kind) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts f WHERE f.task_id=p_task AND (f.phase NOT IN ('preparing','reserved') OR f.kind<>p_kind OR f.request_hash<>md5(t.input_snapshot::text))) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts WHERE task_id=p_task AND attempt=p_attempt AND lease_token<>p_lease) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts WHERE task_id=p_task AND phase='reserved')
  AND (EXISTS(SELECT 1 FROM public.paid_generation_reservations WHERE task_id=p_task)
   OR EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions WHERE task_id=p_task)
   OR EXISTS(SELECT 1 FROM local_identity.workspace_visual_submissions WHERE task_id=p_task)) THEN RETURN false;END IF;
 SELECT coalesce(sum(local_recoveries),0) INTO used FROM local_identity.provider_dispatch_facts WHERE task_id=p_task;
 IF used>=2 THEN RETURN false;END IF;
 INSERT INTO local_identity.provider_dispatch_facts(task_id,attempt,lease_token,kind,request_hash,phase)
 VALUES(p_task,p_attempt,p_lease,p_kind,md5(t.input_snapshot::text),'preparing') ON CONFLICT DO NOTHING;
 UPDATE local_identity.provider_dispatch_facts SET local_recoveries=local_recoveries+1,last_reason='temporary_local_failure',updated_at=clock_timestamp() WHERE task_id=p_task AND attempt=p_attempt;
 RETURN true;
END $$;

CREATE FUNCTION local_identity.mark_provider_dispatching(p_task uuid,p_attempt integer,p_lease uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f local_identity.provider_dispatch_facts;t public.tasks;
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO t FROM public.tasks WHERE id=p_task FOR UPDATE;
 SELECT * INTO f FROM local_identity.provider_dispatch_facts WHERE task_id=p_task AND attempt=p_attempt AND lease_token=p_lease;
 IF NOT FOUND OR f.phase<>'reserved' OR f.request_hash<>md5(t.input_snapshot::text) OR NOT local_identity.provider_dispatch_context_current(p_task,f.kind) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts WHERE task_id=p_task AND phase IN ('dispatching','received')) THEN RAISE EXCEPTION 'Previous dispatch requires reconciliation' USING ERRCODE='55000';END IF;
 UPDATE local_identity.provider_dispatch_facts SET phase='dispatching',updated_at=clock_timestamp() WHERE task_id=p_task AND attempt=p_attempt;
 RETURN true;
END $$;

-- Existing submission outcomes stay authoritative, including legacy callers.
ALTER FUNCTION local_identity.record_workspace_narration_submission(uuid,integer,uuid,text) RENAME TO record_workspace_narration_submission_before_dispatch_facts;
ALTER FUNCTION local_identity.record_workspace_visual_submission(uuid,integer,uuid,text) RENAME TO record_workspace_visual_submission_before_dispatch_facts;
REVOKE ALL ON FUNCTION local_identity.record_workspace_narration_submission_before_dispatch_facts(uuid,integer,uuid,text),local_identity.record_workspace_visual_submission_before_dispatch_facts(uuid,integer,uuid,text) FROM PUBLIC,loop_app,loop_owner,loop_worker;
CREATE FUNCTION local_identity.record_workspace_narration_submission(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_outcome text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM local_identity.record_workspace_narration_submission_before_dispatch_facts(p_task_id,p_attempt,p_lease_token,p_outcome);
 UPDATE local_identity.workspace_narration_submissions SET outcome=p_outcome
 WHERE task_id=p_task_id AND outcome='started' AND EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts f WHERE f.task_id=p_task_id AND f.attempt=p_attempt AND f.lease_token=p_lease_token AND f.phase='dispatching');
 UPDATE local_identity.provider_dispatch_facts SET phase=p_outcome,updated_at=clock_timestamp() WHERE task_id=p_task_id AND attempt=p_attempt AND lease_token=p_lease_token AND phase='dispatching';
END $$;
CREATE FUNCTION local_identity.record_workspace_visual_submission(p_task uuid,p_attempt integer,p_lease uuid,p_outcome text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM local_identity.record_workspace_visual_submission_before_dispatch_facts(p_task,p_attempt,p_lease,p_outcome);
 UPDATE local_identity.provider_dispatch_facts SET phase=p_outcome,updated_at=clock_timestamp() WHERE task_id=p_task AND attempt=p_attempt AND lease_token=p_lease AND phase='dispatching';
END $$;

CREATE FUNCTION local_identity.provider_dispatch_observation(p_task uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('phase',f.phase,'localRecoveries',(SELECT coalesce(sum(x.local_recoveries),0) FROM local_identity.provider_dispatch_facts x WHERE x.task_id=t.id),'reason',f.last_reason)
 FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id
 JOIN local_identity.input_episodes i ON i.episode_id=e.id AND i.owner_id=local_identity.owner_id()
 JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=i.owner_id AND m.role='owner'
 JOIN LATERAL(SELECT * FROM local_identity.provider_dispatch_facts x WHERE x.task_id=t.id ORDER BY x.attempt DESC LIMIT 1)f ON true WHERE t.id=p_task
$$;
REVOKE ALL ON FUNCTION local_identity.prepare_provider_dispatch(uuid,integer,uuid,text),local_identity.allow_provider_preparation_recovery(uuid,integer,uuid,text),local_identity.mark_provider_dispatching(uuid,integer,uuid),local_identity.record_workspace_narration_submission(uuid,integer,uuid,text),local_identity.record_workspace_visual_submission(uuid,integer,uuid,text),local_identity.provider_dispatch_observation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.prepare_provider_dispatch(uuid,integer,uuid,text),local_identity.allow_provider_preparation_recovery(uuid,integer,uuid,text),local_identity.mark_provider_dispatching(uuid,integer,uuid),local_identity.record_workspace_narration_submission(uuid,integer,uuid,text),local_identity.record_workspace_visual_submission(uuid,integer,uuid,text) TO loop_worker;
GRANT EXECUTE ON FUNCTION local_identity.provider_dispatch_observation(uuid) TO loop_app;

-- Only a persisted preparation phase, with no later dispatch, proves no send.
CREATE FUNCTION local_identity.provider_request_not_sent(p_task uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts WHERE task_id=p_task)
 AND NOT EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts WHERE task_id=p_task AND phase NOT IN ('preparing','reserved'))
$$;
REVOKE ALL ON FUNCTION local_identity.provider_request_not_sent(uuid) FROM PUBLIC;
