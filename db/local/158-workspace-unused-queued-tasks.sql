-- Explicitly abandoned content must not start another automatic attempt.
-- Native content remains authoritative; this records an irreversible stop of
-- that queued request, never cancellation of an already sent Provider request.
CREATE FUNCTION local_identity.stop_workspace_queued_tasks(p_workspace uuid,p_kind text,p_shot text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces; stopped integer;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned current workspace required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN public.review_packages p ON p.id=w.storyboard_package_id
  WHERE e.id=w.episode_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_historical_episode(e.id)
  AND e.main_script_revision_id=w.script_revision_id AND p.invalidated_at IS NULL) THEN RAISE EXCEPTION 'Current writable workspace required' USING ERRCODE='55000';END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('narration','bgm','sfx','shot') OR
  (p_kind IN ('narration','shot') AND (p_shot IS NULL OR length(p_shot)=0)) OR
  (p_kind IN ('bgm','sfx') AND p_shot IS NOT NULL) THEN RAISE EXCEPTION 'Invalid stopped content scope' USING ERRCODE='22023';END IF;
 IF p_kind='shot' AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot) THEN RAISE EXCEPTION 'Shot is still in the current workspace' USING ERRCODE='22023';END IF;
 WITH scoped AS (
  SELECT r.task_id FROM local_identity.workspace_narration_requests r WHERE r.workspace_id=w.id AND r.shot_id=p_shot AND p_kind IN ('narration','shot')
  UNION SELECT r.task_id FROM local_identity.workspace_audio_requests r JOIN local_identity.workspace_audio_preparations p ON p.id=r.preparation_id
   WHERE r.workspace_id=w.id AND (p_kind IN ('bgm','sfx') AND p.kind=p_kind OR p_kind='shot' AND p.shot_id=p_shot)
  UNION SELECT v.task_id FROM local_identity.workspace_visual_candidates v WHERE v.workspace_id=w.id AND p_kind='shot' AND v.shot_id=p_shot
 )
 UPDATE public.tasks t SET status='superseded',invalidated_at=clock_timestamp(),invalidated_reason='当前用途已关闭或删除，不再自动执行。'
 WHERE t.id IN (SELECT task_id FROM scoped) AND t.episode_id=w.episode_id AND t.status='ready' AND t.invalidated_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions s WHERE s.task_id=t.id AND s.outcome IN ('started','received'))
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_visual_submissions s WHERE s.task_id=t.id AND s.outcome IN ('started','received'))
  AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id)
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_publication_holds(w.episode_id) h WHERE h.task_id=t.id)
  AND NOT (coalesce(t.last_result#>'{preflight,checks}','[]'::jsonb) @> '[{"check":"provider_result_unknown"}]'::jsonb);
 GET DIAGNOSTICS stopped=ROW_COUNT;
 IF stopped>0 THEN INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id)
  SELECT e.account_id,e.id,'workspace_queued_content_stopped',jsonb_build_object('workspace_id',w.id,'kind',p_kind,'shot_id',p_shot,'stopped_count',stopped),local_identity.owner_id() FROM public.episodes e WHERE e.id=w.episode_id;END IF;
 RETURN stopped;
END $$;
REVOKE ALL ON FUNCTION local_identity.stop_workspace_queued_tasks(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.stop_workspace_queued_tasks(uuid,text,text) TO loop_owner;

-- Owner API can select tasks but cannot lock/update them directly. Keep the
-- narrow revision fence inside a checked definer instead of widening grants.
CREATE FUNCTION local_identity.lock_owned_revision_tasks(p_episode uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned revision required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e WHERE e.id=p_episode AND e.archived_at IS NULL AND e.stage='qc_review' AND NOT local_identity.is_historical_episode(e.id)) THEN RAISE EXCEPTION 'Current editable review required' USING ERRCODE='55000';END IF;
 PERFORM id FROM public.tasks WHERE episode_id=p_episode AND invalidated_at IS NULL FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode AND invalidated_at IS NULL AND status='running') THEN RAISE EXCEPTION 'Current production task is running' USING ERRCODE='55000';END IF;
END $$;
REVOKE ALL ON FUNCTION local_identity.lock_owned_revision_tasks(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.lock_owned_revision_tasks(uuid) TO loop_owner;
