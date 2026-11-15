-- ADR-0066 E2: one visual queue transaction owns confirmation, source selection,
-- pending/unknown guards, settings and the current shot protocol. Original rows stay frozen.
CREATE OR REPLACE FUNCTION local_identity.queue_workspace_visual(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v local_identity.workspace_visual_candidates;w local_identity.production_workspaces;tid uuid;aid uuid;cfg jsonb;
BEGIN
SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned video request required' USING ERRCODE='42501';END IF;
 IF v.task_id IS NOT NULL THEN RETURN v.task_id;END IF;
 IF v.request_snapshot->>'authorizationHash' IS DISTINCT FROM local_identity.current_workspace_call_hash(v.workspace_id) OR local_identity.current_workspace_call_hash(v.workspace_id) IS NULL THEN RAISE EXCEPTION 'Current call confirmation required' USING ERRCODE='42501';END IF;
 IF v.request_snapshot->>'selectionVersion'='1' THEN
 cfg:=v.request_snapshot->'execution';
 IF v.request_snapshot#>>'{selection,capability}'<>'video' OR cfg->>'credential_ref' IS DISTINCT FROM v.request_snapshot#>>'{selection,connectionVersionId}' OR NOT EXISTS(SELECT 1 FROM public.external_connection_versions cv JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=local_identity.owner_id() AND cn.current_version_id=cv.id JOIN local_identity.connection_bindings cb ON cb.version_id=cv.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=cv.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE cv.id::text=cfg->>'credential_ref' AND cv.provider=cfg#>>'{executor,provider}' AND cv.adapter=cfg#>>'{executor,adapter}' AND cv.revoked_at IS NULL AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence p WHERE p.version_id=cv.id AND p.owner_id=cn.created_by AND p.mode='live' AND p.outcome='verified')) THEN RAISE EXCEPTION 'Validated owned video connection required';END IF;
 SELECT account_id INTO aid FROM public.episodes WHERE id=v.episode_id;
 END IF;
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned visual request required' USING ERRCODE='42501'; END IF;
 w:=local_identity.lock_current_production_workspace(v.workspace_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(v.workspace_id::text||v.target_item_id,0));
 IF v.task_id IS NOT NULL THEN RETURN v.task_id; END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates other JOIN public.tasks t ON t.id=other.task_id LEFT JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id WHERE other.workspace_id=v.workspace_id AND other.target_item_id=v.target_item_id AND t.task_type IN ('generate_shot_video','search_shot_video','preview_shot_video','generate_a_roll', 'generate_b_roll') AND (t.status='running' OR (t.status='ready' AND (t.invalidated_at IS NULL OR EXISTS(SELECT 1 FROM public.paid_generation_reservations prior_reservation WHERE prior_reservation.task_id=t.id) OR EXISTS(SELECT 1 FROM local_identity.native_output_publications prior_publication WHERE prior_publication.task_id=t.id))) OR (s.outcome IN ('started','received') AND t.status<>'completed'))) THEN RAISE EXCEPTION 'Previous visual submission pending or unknown; reconcile or resume its saved Provider ID' USING ERRCODE='55000'; END IF;
 UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=v.episode_id;
 IF v.request_snapshot#>>'{execution,executor,provider}'='bailian' THEN
 tid:=local_identity.request_workspace_wan_visual(v.episode_id,w.preparation_revision_id,v.shot_id,(v.request_snapshot->>'firstFrameId')::uuid,v.request_snapshot->>'prompt',(v.request_snapshot->>'providerDurationSeconds')::integer,v.id);
 ELSE
 tid:=local_identity.request_workspace_official_visual(v.episode_id,w.preparation_revision_id,v.shot_id,(v.request_snapshot->>'firstFrameId')::uuid,v.request_snapshot->>'prompt',(v.request_snapshot->>'providerDurationSeconds')::integer,v.id,(v.request_snapshot->>'reservationCents')::integer);
 END IF;
 UPDATE local_identity.workspace_visual_candidates SET task_id=tid WHERE id=v.id AND task_id IS NULL;
 IF v.request_snapshot ? 'videoSettings' OR v.request_snapshot ? 'firstFrameComposition' THEN
 UPDATE public.tasks SET input_snapshot=jsonb_set(input_snapshot,'{media,wan_video}',input_snapshot#>'{media,wan_video}'||jsonb_build_object('settings',v.request_snapshot->'videoSettings','composition',v.request_snapshot->'firstFrameComposition')) WHERE id=tid AND status='ready';
 END IF;

 IF v.request_snapshot->>'selectionVersion'='1' THEN
 UPDATE public.tasks SET input_snapshot=input_snapshot||jsonb_build_object('production_selection',v.request_snapshot->'selection','production_context',v.request_snapshot->'context','workspace_target',v.request_snapshot->'target','cost_basis',v.request_snapshot->'costBasis','configuration_hash',v.input_fingerprint),budget_limit_cents=(v.request_snapshot->>'reservationCents')::integer WHERE id=tid;
 UPDATE public.tasks SET input_snapshot=jsonb_set(jsonb_set(input_snapshot,'{media,wan_video,prompt}',v.request_snapshot->'actualPrompt'),'{budget,limit_cents}',v.request_snapshot->'reservationCents') WHERE id=tid;
 END IF;
 UPDATE public.tasks SET input_snapshot=local_identity.shot_video_snapshot(input_snapshot)
 WHERE id=tid AND task_type IN ('generate_shot_video','search_shot_video','preview_shot_video') AND status='ready';
 RETURN tid;
END;
$function$;
DROP FUNCTION local_identity.queue_workspace_visual_before_shot_protocol(uuid);
DROP FUNCTION local_identity.queue_workspace_visual_before_selection(uuid);
DROP FUNCTION local_identity.queue_workspace_visual_before_settings(uuid);
-- Current Pexels owns its complete independent-shot queue; this body has no consumer.
DROP FUNCTION local_identity.queue_workspace_pexels_before_shot_protocol(uuid);
