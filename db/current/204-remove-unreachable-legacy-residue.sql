-- Remove disconnected legacy writers and helpers after the 201-203 boundary.
-- Keep immutable history, current storage checks and shared Worker execution.
-- Reject unreviewed body consumers; RESTRICT also checks catalog dependencies.
DO $retired_dependency_check$
DECLARE targets text[] := ARRAY[
 'local_identity.owned_studio_frozen_reference(uuid,jsonb)',
 'public.assert_current_storyboard_shot(uuid,uuid,text)',
 'public.clip_segment_union_duration(jsonb)',
 'public.create_shot_preparation_review_package(uuid,uuid)',
 'public.current_openchatcut_review_package(uuid,boolean)',
 'public.has_required_artifacts(uuid,public.episode_stage)',
 'public.is_allowed_episode_transition(public.episode_stage,public.episode_stage)',
 'public.orchestrate_final_render_tasks(uuid)',
 'public.orchestrate_review_render_tasks(uuid)',
 'public.record_publish_input(uuid,text,text,text,bigint)',
 'public.record_publish_package(uuid,text,text,bigint)',
 'public.record_publish_package_verification_before_workspace(uuid,text,bigint)',
 'public.register_manual_a_roll(uuid,uuid,text,uuid)',
 'public.register_manual_b_roll(uuid,uuid,text,uuid)',
 'public.shot_composition_playback_duration(jsonb,jsonb)',
 'local_identity.input_final_reuse_source(uuid,integer,uuid)',
 'public.final_render_reuse_source(uuid,integer,uuid)',
 'public.has_current_shot_preparation_snapshot(uuid,uuid)',
 'public.shot_duration_decision(text,numeric,numeric,numeric,numeric,integer,numeric)',
 'public.shot_tts_configuration_hash(uuid,uuid)',
 'local_identity.current_owned_final_render(uuid,uuid)',
 'local_identity.owned_delivery_episode(uuid)'
]; blockers text;
BEGIN
 SELECT string_agg(p.oid::regprocedure::text||' -> '||t.signature,E'\n' ORDER BY p.oid::regprocedure::text,t.signature)
 INTO blockers
 FROM unnest(targets) AS t(signature)
 JOIN pg_proc target ON target.oid=to_regprocedure(t.signature)
 CROSS JOIN pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','local_identity','loop_internal') AND p.prokind='f'
 AND NOT EXISTS(SELECT 1 FROM unnest(targets) own(signature) WHERE to_regprocedure(own.signature)=p.oid)
 AND p.prosrc ~ ('\m'||target.proname||'\s*\(');
 IF blockers IS NOT NULL THEN RAISE EXCEPTION 'Retired execution functions still have consumers: %',blockers USING ERRCODE='2BP01'; END IF;
END
$retired_dependency_check$;

DROP FUNCTION IF EXISTS local_identity.owned_studio_frozen_reference(uuid,jsonb) RESTRICT;
DROP FUNCTION IF EXISTS public.assert_current_storyboard_shot(uuid,uuid,text) RESTRICT;
DROP FUNCTION IF EXISTS public.clip_segment_union_duration(jsonb) RESTRICT;
DROP FUNCTION IF EXISTS public.create_shot_preparation_review_package(uuid,uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.current_openchatcut_review_package(uuid,boolean) RESTRICT;
DROP FUNCTION IF EXISTS public.has_required_artifacts(uuid,public.episode_stage) RESTRICT;
DROP FUNCTION IF EXISTS public.is_allowed_episode_transition(public.episode_stage,public.episode_stage) RESTRICT;
DROP FUNCTION IF EXISTS public.orchestrate_final_render_tasks(uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.orchestrate_review_render_tasks(uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.record_publish_input(uuid,text,text,text,bigint) RESTRICT;
DROP FUNCTION IF EXISTS public.record_publish_package(uuid,text,text,bigint) RESTRICT;
DROP FUNCTION IF EXISTS public.record_publish_package_verification_before_workspace(uuid,text,bigint) RESTRICT;
DROP FUNCTION IF EXISTS public.register_manual_a_roll(uuid,uuid,text,uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.register_manual_b_roll(uuid,uuid,text,uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.shot_composition_playback_duration(jsonb,jsonb) RESTRICT;

DROP FUNCTION IF EXISTS local_identity.input_final_reuse_source(uuid,integer,uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.final_render_reuse_source(uuid,integer,uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.has_current_shot_preparation_snapshot(uuid,uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.shot_duration_decision(text,numeric,numeric,numeric,numeric,integer,numeric) RESTRICT;
DROP FUNCTION IF EXISTS public.shot_tts_configuration_hash(uuid,uuid) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.current_owned_final_render(uuid,uuid) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.owned_delivery_episode(uuid) RESTRICT;

CREATE OR REPLACE FUNCTION local_identity.input_media_connection(p_task_id uuid, p_attempt integer, p_lease_token uuid, p_version_id uuid) RETURNS TABLE(version_id uuid, provider text, adapter text, endpoint text, secret_ref uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM local_identity.assert_current_worker_execution(p_task_id,p_attempt,p_lease_token);
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 IF EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests r WHERE r.task_id=p_task_id) THEN
  IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
  PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
  IF NOT EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests r WHERE r.task_id=p_task_id AND local_identity.workspace_task_preparation_current(p_task_id,r.workspace_id)) THEN RAISE EXCEPTION 'Pexels production preparation is stale' USING ERRCODE='55000';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND t.task_type='generate_soundtrack' AND EXISTS(SELECT 1 FROM local_identity.workspace_audio_requests r WHERE r.task_id=t.id)) THEN
 RETURN QUERY SELECT cv.id,cv.provider,cv.adapter,cv.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.media_enabled
 JOIN public.external_connection_versions cv ON cv.id=p_version_id AND cv.provider=t.provider AND cv.adapter=t.input_snapshot#>>'{executor,adapter}' AND cv.revoked_at IS NULL
 JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=i.owner_id
 JOIN local_identity.connection_bindings b ON b.version_id=cv.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=cv.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.input_snapshot->>'credential_ref'=cv.id::text AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=cv.id AND pe.owner_id=i.owner_id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen audio connection unavailable';END IF;
 ELSIF EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND t.input_snapshot#>>'{production_selection,capability}'='video') THEN
 RETURN QUERY SELECT cv.id,cv.provider,cv.adapter,cv.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.media_enabled
 JOIN public.external_connection_versions cv ON cv.id=p_version_id AND cv.provider=t.provider AND cv.adapter=t.input_snapshot#>>'{executor,adapter}' AND cv.revoked_at IS NULL
 JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=i.owner_id
 JOIN local_identity.connection_bindings b ON b.version_id=cv.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=cv.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.input_snapshot->>'credential_ref'=cv.id::text AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=cv.id AND pe.owner_id=i.owner_id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen video connection unavailable';END IF;
 ELSIF EXISTS(SELECT 1 FROM public.tasks task WHERE task.id=p_task_id AND task.task_type='generate_static_visual' AND task.provider='openai') THEN
 RETURN QUERY SELECT v.id,v.provider,v.adapter,v.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.media_enabled
 JOIN public.external_connection_versions v ON v.id=p_version_id AND v.provider='openai' AND v.adapter='openai_images' AND v.revoked_at IS NULL
 JOIN public.external_connections c ON c.id=v.connection_id AND c.created_by=i.owner_id
 JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=v.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.input_snapshot->>'credential_ref'=v.id::text AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen image connection unavailable';END IF;
 ELSE
 RETURN QUERY SELECT v.id,v.provider,v.adapter,v.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled
 JOIN public.external_connection_versions v ON v.id=p_version_id
 JOIN public.external_connections c ON c.id=v.connection_id AND c.created_by=i.owner_id AND c.current_version_id=v.id
 JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=v.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND v.revoked_at IS NULL AND (
  i.media_enabled AND t.task_type IN ('generate_shot_video','search_shot_video','preview_shot_video','generate_a_roll','generate_b_roll','generate_soundtrack') AND t.provider IN ('pexels','freesound','bailian','volcengine','minimax','kling') AND t.input_snapshot->>'credential_ref'=v.id::text AND v.provider=t.provider AND v.adapter=t.input_snapshot#>>'{media,adapter}'
 ) AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen media connection unavailable' USING ERRCODE='42501'; END IF;
 END IF;
END;

$$;

REVOKE ALL ON FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid) TO loop_worker;
