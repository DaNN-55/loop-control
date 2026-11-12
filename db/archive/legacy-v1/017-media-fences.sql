-- T19 forward hardening: static images require explicit start authorization.
ALTER TABLE local_identity.input_episodes ADD COLUMN visual_media_enabled boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION local_identity.input_media_connection(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_version_id uuid) RETURNS TABLE(version_id uuid,provider text,adapter text,endpoint text,secret_ref uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  (i.visual_media_enabled AND t.task_type='prepare_visual_brief' AND v.provider IN ('openai','cloudflare') AND t.input_snapshot#>>'{visual_assets,image_generation,credential_ref}'=v.id::text AND v.provider=t.input_snapshot#>>'{visual_assets,image_generation,provider}' AND v.adapter=t.input_snapshot#>>'{visual_assets,image_generation,adapter}')
 ) AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen media connection unavailable' USING ERRCODE='42501'; END IF;
END $$;
CREATE OR REPLACE FUNCTION local_identity.retry_input_media(p_episode_id uuid,p_task_id uuid) RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.tasks; created public.tasks; frozen jsonb; nonce text:=gen_random_uuid()::text; path text; BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RAISE EXCEPTION 'Owner managed Episode required' USING ERRCODE='42501'; END IF;
 SELECT t.* INTO previous FROM public.tasks t JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.media_enabled JOIN public.episodes e ON e.id=t.episode_id AND e.stage='storyboard_approved' WHERE t.id=p_task_id AND t.episode_id=p_episode_id AND t.task_type IN ('generate_a_roll','generate_b_roll','generate_soundtrack','extract_embedded_audio') AND t.status IN ('failed','blocked') AND t.invalidated_at IS NULL FOR UPDATE OF t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current failed media task required' USING ERRCODE='22023'; END IF;
 IF previous.task_type <> 'extract_embedded_audio' AND NOT EXISTS(SELECT 1 FROM public.review_packages p JOIN public.approvals a ON a.review_package_id=p.id AND a.stage='storyboard_approved' AND a.decision='approved' WHERE p.id::text=previous.input_snapshot->>'storyboard_review_package_id' AND p.episode_id=p_episode_id AND p.stage='storyboard_review' AND p.invalidated_at IS NULL AND p.revision_number=(SELECT max(q.revision_number) FROM public.review_packages q WHERE q.episode_id=p_episode_id AND q.stage='storyboard_review' AND q.invalidated_at IS NULL)) THEN RAISE EXCEPTION 'Current approved media package required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.tasks t WHERE t.episode_id=p_episode_id AND t.input_snapshot->>'native_media_retry_of'=p_task_id::text AND t.status IN ('ready','running','completed')) THEN SELECT * INTO created FROM public.tasks t WHERE t.episode_id=p_episode_id AND t.input_snapshot->>'native_media_retry_of'=p_task_id::text AND t.status IN ('ready','running','completed') ORDER BY created_at DESC LIMIT 1; RETURN created; END IF;
 frozen:=previous.input_snapshot-'runtime_constraints';path:=frozen#>>'{output,relative_path}';
 frozen:=frozen||jsonb_build_object('native_media_retry_of',p_task_id,'configuration_hash',coalesce(frozen->>'configuration_hash','')||'-retry-'||nonce);
 frozen:=jsonb_set(frozen,'{output,relative_path}',to_jsonb(regexp_replace(path,'(\.[^/.]+)$','-retry-'||nonce||'\1')));
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(p_episode_id,previous.task_type,'ready',frozen,previous.budget_limit_cents,previous.max_attempts,previous.provider,previous.model,previous.prompt_version) RETURNING * INTO created;
 IF previous.input_snapshot#>>'{shot_preparation,draft_id}' IS NOT NULL THEN UPDATE public.shot_preparation_drafts SET video_status='running',pending_video_task_id=created.id,video_error=NULL,updated_at=now() WHERE id::text=previous.input_snapshot#>>'{shot_preparation,draft_id}' AND episode_id=p_episode_id; END IF;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) SELECT e.account_id,e.id,'native_media_retry_requested',jsonb_build_object('previous_task_id',previous.id,'task_id',created.id),local_identity.owner_id() FROM public.episodes e WHERE e.id=p_episode_id;
 RETURN created;
END $$;
GRANT EXECUTE ON FUNCTION public.save_shot_audio_mix(uuid,uuid,text,text),public.save_shot_transition_mode(uuid,uuid,text,text) TO loop_owner;
