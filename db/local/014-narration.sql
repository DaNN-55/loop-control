-- T18: explicit opt-in for shot narration; all earlier scopes remain unchanged.
ALTER TABLE local_identity.input_episodes ADD COLUMN narration_enabled boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION local_identity.input_task_allowed(p_episode_id uuid,p_task_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=p_episode_id AND e.enabled AND (p_task_type='prepare_visual_brief' OR (e.storyboard_enabled AND p_task_type IN ('draft_storyboard','draft_storyboard_revision')) OR (e.narration_enabled AND p_task_type='generate_narration'))) $$;
CREATE FUNCTION local_identity.input_task_connection(p_task_id uuid,p_attempt integer,p_lease_token uuid) RETURNS TABLE(version_id uuid,provider text,adapter text,endpoint text,secret_ref uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 RETURN QUERY SELECT v.id,v.provider,v.adapter,v.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.narration_enabled
 JOIN public.external_connection_versions v ON v.id=(t.input_snapshot->>'credential_ref')::uuid
 JOIN public.external_connections c ON c.id=v.connection_id AND c.created_by=i.owner_id AND c.current_version_id=v.id
 JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=v.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.task_type='generate_narration' AND t.provider IN ('google_tts','volcengine_tts') AND v.provider=t.provider AND v.adapter=t.input_snapshot#>>'{media,adapter}' AND v.revoked_at IS NULL
 AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen narration connection unavailable' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION local_identity.input_task_connection(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.input_task_connection(uuid,integer,uuid) TO loop_worker;
GRANT EXECUTE ON FUNCTION public.save_episode_tts_settings(uuid,text,text,numeric),public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean,text,text,numeric),public.save_shot_tts_override(uuid,uuid,text,text,numeric),public.save_shot_caption_contract(uuid,uuid,text,jsonb),public.generate_shot_tts(uuid,uuid,text,boolean) TO loop_owner;
