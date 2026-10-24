-- T19: explicit per-Episode media opt-in, preserving imported and prior scopes.
ALTER TABLE local_identity.input_episodes ADD COLUMN media_enabled boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION local_identity.input_task_allowed(p_episode_id uuid,p_task_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=p_episode_id AND e.enabled AND (p_task_type='prepare_visual_brief' OR (e.storyboard_enabled AND p_task_type IN ('draft_storyboard','draft_storyboard_revision')) OR (e.narration_enabled AND p_task_type='generate_narration') OR (e.media_enabled AND p_task_type IN ('generate_a_roll','generate_b_roll','generate_soundtrack','extract_embedded_audio'))))
$$;
CREATE FUNCTION local_identity.input_media_connection(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_version_id uuid) RETURNS TABLE(version_id uuid,provider text,adapter text,endpoint text,secret_ref uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 RETURN QUERY SELECT v.id,v.provider,v.adapter,v.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled
 JOIN public.external_connection_versions v ON v.id=p_version_id
 JOIN public.external_connections c ON c.id=v.connection_id AND c.created_by=i.owner_id AND c.current_version_id=v.id
 JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=v.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND v.revoked_at IS NULL AND (
  (i.media_enabled AND t.task_type IN ('generate_b_roll','generate_soundtrack') AND t.provider IN ('pexels','freesound') AND t.input_snapshot->>'credential_ref'=v.id::text AND v.provider=t.provider AND v.adapter=t.input_snapshot#>>'{media,adapter}') OR
  (t.task_type='prepare_visual_brief' AND v.provider IN ('openai','cloudflare') AND t.input_snapshot#>>'{visual_assets,image_generation,credential_ref}'=v.id::text AND v.provider=t.input_snapshot#>>'{visual_assets,image_generation,provider}' AND v.adapter=t.input_snapshot#>>'{visual_assets,image_generation,adapter}')
 ) AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen media connection unavailable' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid) TO loop_worker;
CREATE OR REPLACE FUNCTION local_identity.plan_input_tasks(p_episode_id uuid DEFAULT NULL) RETURNS SETOF public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; created public.tasks; BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 FOR candidate IN SELECT e.id,e.stage,i.storyboard_enabled,i.media_enabled FROM public.episodes e JOIN local_identity.input_episodes i ON i.episode_id=e.id AND i.enabled WHERE (p_episode_id IS NULL OR e.id=p_episode_id) AND (e.stage='script_approved' OR (i.storyboard_enabled AND e.stage='visual_approved') OR (i.media_enabled AND e.stage='storyboard_approved')) LOOP
  IF candidate.stage='script_approved' THEN
   RETURN QUERY SELECT * FROM public.orchestrate_provided_script_tasks_for_episode(candidate.id);
  ELSIF candidate.stage='visual_approved' THEN
   RETURN QUERY SELECT * FROM public.orchestrate_storyboard_tasks_for_episode(candidate.id);
  ELSE
   RETURN QUERY SELECT * FROM public.orchestrate_a_roll_tasks_for_episode(candidate.id);
   RETURN QUERY SELECT * FROM public.orchestrate_b_roll_tasks(candidate.id);
   RETURN QUERY SELECT * FROM public.orchestrate_soundtrack_tasks(candidate.id);
   RETURN QUERY SELECT * FROM public.orchestrate_embedded_audio_tasks(candidate.id);
  END IF;
 END LOOP; END $$;
GRANT EXECUTE ON FUNCTION public.save_manual_shot_clip(uuid,uuid,text,uuid,text,numeric,numeric),public.register_manual_audio(uuid,uuid,text,uuid),public.register_manual_episode_narration(uuid,uuid,uuid),public.save_storyboard_audio_selection(uuid,uuid,text,text,text,text,uuid),public.save_shot_workbench_composition_draft(uuid,uuid,text,uuid,jsonb,jsonb,numeric,text,text,boolean,text,text,numeric),public.generate_shot_clip(uuid,uuid,text,boolean) TO loop_owner;
CREATE FUNCTION local_identity.retry_input_media(p_episode_id uuid,p_task_id uuid) RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.tasks; created public.tasks; frozen jsonb; nonce text:=gen_random_uuid()::text; path text; BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RAISE EXCEPTION 'Owner managed Episode required' USING ERRCODE='42501'; END IF;
 SELECT t.* INTO previous FROM public.tasks t JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.media_enabled JOIN public.episodes e ON e.id=t.episode_id AND e.stage='storyboard_approved' WHERE t.id=p_task_id AND t.episode_id=p_episode_id AND t.task_type IN ('generate_a_roll','generate_b_roll','generate_soundtrack','extract_embedded_audio') AND t.status IN ('failed','blocked') AND t.invalidated_at IS NULL FOR UPDATE OF t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current failed media task required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.tasks t WHERE t.episode_id=p_episode_id AND t.input_snapshot->>'native_media_retry_of'=p_task_id::text AND t.status IN ('ready','running','completed')) THEN SELECT * INTO created FROM public.tasks t WHERE t.episode_id=p_episode_id AND t.input_snapshot->>'native_media_retry_of'=p_task_id::text AND t.status IN ('ready','running','completed') ORDER BY created_at DESC LIMIT 1; RETURN created; END IF;
 frozen:=previous.input_snapshot-'runtime_constraints';path:=frozen#>>'{output,relative_path}';
 frozen:=frozen||jsonb_build_object('native_media_retry_of',p_task_id,'configuration_hash',coalesce(frozen->>'configuration_hash','')||'-retry-'||nonce);
 frozen:=jsonb_set(frozen,'{output,relative_path}',to_jsonb(regexp_replace(path,'(\.[^/.]+)$','-retry-'||nonce||'\1')));
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(p_episode_id,previous.task_type,'ready',frozen,previous.budget_limit_cents,previous.max_attempts,previous.provider,previous.model,previous.prompt_version) RETURNING * INTO created;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) SELECT e.account_id,e.id,'native_media_retry_requested',jsonb_build_object('previous_task_id',previous.id,'task_id',created.id),local_identity.owner_id() FROM public.episodes e WHERE e.id=p_episode_id;
 RETURN created;
END $$;
REVOKE ALL ON FUNCTION local_identity.retry_input_media(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.retry_input_media(uuid,uuid) TO loop_owner;
