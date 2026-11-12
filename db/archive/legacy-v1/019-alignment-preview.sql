-- T20: opt in only newly authorized native Episodes; leave old deferred alignment untouched.
ALTER TABLE local_identity.input_episodes ADD COLUMN alignment_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE local_identity.input_episodes ADD COLUMN preview_enabled boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION local_identity.input_task_allowed(p_episode_id uuid,p_task_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=p_episode_id AND e.enabled AND (p_task_type='prepare_visual_brief' OR (e.storyboard_enabled AND p_task_type IN ('draft_storyboard','draft_storyboard_revision')) OR (e.narration_enabled AND p_task_type='generate_narration') OR (e.media_enabled AND p_task_type IN ('generate_a_roll','generate_b_roll','generate_soundtrack','extract_embedded_audio')) OR (e.alignment_enabled AND p_task_type='align_shot_captions') OR (e.preview_enabled AND p_task_type='generate_shot_sync_preview')))
$$;
GRANT EXECUTE ON FUNCTION public.generate_shot_source_audio(uuid,uuid,text,boolean),public.request_shot_acoustic_alignment(uuid,uuid,text,boolean),public.save_shot_manual_alignment(uuid,uuid,text,jsonb),public.generate_shot_sync_preview(uuid,uuid,text),public.confirm_shot_sync_preview(uuid,uuid,text,text,text) TO loop_owner;
-- Namespace only tasks created by the current Owner transaction. Reuse never mutates a frozen task.
CREATE FUNCTION local_identity.scope_input_post_task(p_task_id uuid) RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tasks; prefix text; BEGIN
 SELECT * INTO t FROM public.tasks WHERE id=p_task_id;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(t.episode_id) OR t.task_type NOT IN ('extract_embedded_audio','align_shot_captions','generate_shot_sync_preview') THEN RAISE EXCEPTION 'Managed Owner post-production task required' USING ERRCODE='42501'; END IF;
 IF t.status<>'ready' OR t.attempt<>0 OR t.created_at<>transaction_timestamp() THEN RETURN t; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.shot_preparation_drafts d JOIN public.review_packages p ON p.id=d.review_package_id JOIN public.approvals a ON a.review_package_id=p.id AND a.stage='storyboard_approved' AND a.decision='approved' WHERE d.id::text=t.input_snapshot#>>'{shot_preparation,draft_id}' AND d.episode_id=t.episode_id AND p.invalidated_at IS NULL) THEN RAISE EXCEPTION 'Approved shot task required' USING ERRCODE='22023'; END IF;
 prefix:=format('episodes/%s/post-production/%s',t.episode_id,t.id);
 UPDATE public.tasks SET input_snapshot=jsonb_set(input_snapshot,'{output,relative_path}',to_jsonb(prefix||CASE t.task_type WHEN 'align_shot_captions' THEN '/alignment.json' WHEN 'extract_embedded_audio' THEN '/source.mp3' ELSE '/proxy.mp4' END)) WHERE id=t.id RETURNING * INTO t;
 IF t.task_type='generate_shot_sync_preview' THEN UPDATE public.tasks SET input_snapshot=jsonb_set(input_snapshot,'{review_render,project_relative_path}',to_jsonb(prefix||'/index.html')) WHERE id=t.id RETURNING * INTO t; END IF;
 RETURN t;
END $$;
REVOKE ALL ON FUNCTION local_identity.scope_input_post_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.scope_input_post_task(uuid) TO loop_owner;

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
 IF previous.task_type='extract_embedded_audio' AND previous.input_snapshot#>>'{shot_preparation,draft_id}' IS NOT NULL THEN UPDATE public.shot_preparation_drafts SET audio_status='running',pending_source_audio_task_id=created.id,source_audio_error=NULL,updated_at=now() WHERE id::text=previous.input_snapshot#>>'{shot_preparation,draft_id}' AND episode_id=p_episode_id; ELSIF previous.input_snapshot#>>'{shot_preparation,draft_id}' IS NOT NULL THEN UPDATE public.shot_preparation_drafts SET video_status='running',pending_video_task_id=created.id,video_error=NULL,updated_at=now() WHERE id::text=previous.input_snapshot#>>'{shot_preparation,draft_id}' AND episode_id=p_episode_id; END IF;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) SELECT e.account_id,e.id,'native_media_retry_requested',jsonb_build_object('previous_task_id',previous.id,'task_id',created.id),local_identity.owner_id() FROM public.episodes e WHERE e.id=p_episode_id;
 RETURN created;
END $$;
