-- Four-step narration requests retain input provenance independently of the native edit.
CREATE TABLE local_identity.workspace_narrations (
 workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 clip_id uuid NOT NULL, mode text NOT NULL CHECK(mode IN ('tts','manual','none')),
 input_fingerprint text NOT NULL, confirmed_fingerprint text,confirmed_match_fingerprint text,
 task_id uuid REFERENCES public.tasks(id),manual_audio_track_id uuid REFERENCES public.audio_tracks(id),
 adopted_audio_track_id uuid REFERENCES public.audio_tracks(id), requested_project_sha256 text,requested_native_edit_revision bigint,
 PRIMARY KEY(workspace_id,clip_id)
);
CREATE TABLE local_identity.workspace_narration_requests (
 task_id uuid PRIMARY KEY REFERENCES public.tasks(id),workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),
 episode_id uuid NOT NULL REFERENCES public.episodes(id),clip_id uuid NOT NULL,input_fingerprint text NOT NULL,
 authorization_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE local_identity.workspace_narration_submissions (
 task_id uuid PRIMARY KEY REFERENCES public.tasks(id),outcome text NOT NULL CHECK(outcome IN ('started','received','rejected')),
 attempt integer NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.workspace_narrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.workspace_narration_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY owned_workspace_narrations ON local_identity.workspace_narrations TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.input_episodes i WHERE i.episode_id=workspace_narrations.episode_id AND i.owner_id=local_identity.owner_id())) WITH CHECK(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id AND w.episode_id=workspace_narrations.episode_id));
CREATE POLICY owned_workspace_narration_requests ON local_identity.workspace_narration_requests TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.input_episodes i WHERE i.episode_id=workspace_narration_requests.episode_id AND i.owner_id=local_identity.owner_id())) WITH CHECK(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id AND w.episode_id=workspace_narration_requests.episode_id));
GRANT SELECT,INSERT,UPDATE ON local_identity.workspace_narrations TO loop_app;
GRANT SELECT,INSERT ON local_identity.workspace_narration_requests TO loop_app;
GRANT SELECT ON local_identity.workspace_narration_submissions TO loop_app;
CREATE FUNCTION local_identity.reserve_workspace_narration_submission(p_task_id uuid,p_attempt integer,p_lease_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE request local_identity.workspace_narration_requests; BEGIN
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 SELECT * INTO request FROM local_identity.workspace_narration_requests WHERE task_id=p_task_id;
 IF NOT FOUND THEN RETURN NOT EXISTS(SELECT 1 FROM public.tasks t JOIN local_identity.production_workspaces w ON w.episode_id=t.episode_id WHERE t.id=p_task_id); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(request.workspace_id::text||request.clip_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM local_identity.workspace_narrations n WHERE n.workspace_id=request.workspace_id AND n.clip_id=request.clip_id AND n.mode='tts' AND n.task_id=p_task_id AND n.input_fingerprint=request.input_fingerprint AND n.confirmed_fingerprint=request.input_fingerprint) THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.script_productions p JOIN public.episodes e ON e.id=p.episode_id WHERE p.episode_id=request.episode_id AND p.enabled AND p.authorized_at IS NOT NULL AND p.authorization_hash=request.authorization_hash AND p.script_revision_id=e.main_script_revision_id AND e.archived_at IS NULL) THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tasks t JOIN public.shot_preparation_drafts d ON d.id=(t.input_snapshot#>>'{shot_preparation,draft_id}')::uuid WHERE t.id=p_task_id AND d.audio_mode='tts' AND coalesce(d.tts_text,d.subtitle_text)=t.input_snapshot#>>'{media,narration,text}' AND d.tts_voice=t.input_snapshot#>>'{media,narration,voice,name}' AND d.tts_speaking_rate=(t.input_snapshot#>>'{media,narration,voice,speaking_rate}')::numeric AND d.tts_language_code=t.input_snapshot#>>'{media,narration,voice,language_code}') THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests r JOIN local_identity.workspace_narration_submissions s ON s.task_id=r.task_id JOIN public.tasks t ON t.id=r.task_id WHERE r.workspace_id=request.workspace_id AND r.clip_id=request.clip_id AND r.task_id<>p_task_id AND s.outcome IN ('started','received') AND t.status<>'completed') THEN RETURN false; END IF;
 INSERT INTO local_identity.workspace_narration_submissions(task_id,attempt,outcome) VALUES(p_task_id,p_attempt,'started') ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
CREATE FUNCTION local_identity.record_workspace_narration_submission(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_outcome text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 IF p_outcome NOT IN ('received','rejected') THEN RAISE EXCEPTION 'Invalid submission result'; END IF;
 UPDATE local_identity.workspace_narration_submissions SET outcome=p_outcome WHERE task_id=p_task_id AND attempt=p_attempt AND outcome='started';
END $$;
REVOKE ALL ON FUNCTION local_identity.reserve_workspace_narration_submission(uuid,integer,uuid),local_identity.record_workspace_narration_submission(uuid,integer,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.reserve_workspace_narration_submission(uuid,integer,uuid),local_identity.record_workspace_narration_submission(uuid,integer,uuid,text) TO loop_worker;

-- Reuse legacy settings validation while preserving independent caption text and fencing late results.
CREATE FUNCTION local_identity.save_workspace_narration_draft(p_episode uuid,p_review uuid,p_shot text,p_mode text,p_text text,p_voice text,p_rate numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE previous public.shot_preparation_drafts; saved public.shot_preparation_drafts; BEGIN
 SELECT * INTO previous FROM public.shot_preparation_drafts WHERE episode_id=p_episode AND review_package_id=p_review AND shot_id=p_shot;
 saved:=public.save_shot_preparation_draft(p_episode,p_review,p_shot,p_mode,coalesce(previous.subtitle_text,p_text),coalesce(previous.subtitles_enabled,true),p_text,p_voice,p_rate);
 IF p_mode='tts' THEN saved:=public.save_shot_tts_override(p_episode,p_review,p_shot,p_voice,p_rate); END IF;
 IF previous.id IS NOT NULL THEN UPDATE public.shot_preparation_drafts SET subtitle_text=previous.subtitle_text WHERE id=saved.id; END IF;
 IF previous.id IS NOT NULL AND (previous.tts_text IS DISTINCT FROM saved.tts_text OR previous.tts_voice IS DISTINCT FROM saved.tts_voice OR previous.tts_speaking_rate IS DISTINCT FROM saved.tts_speaking_rate OR previous.tts_language_code IS DISTINCT FROM saved.tts_language_code) THEN
 UPDATE public.shot_preparation_drafts SET pending_tts_task_id=NULL,current_tts_task_id=NULL,current_audio_track_id=NULL,tts_actual_duration_seconds=NULL,audio_status=CASE WHEN p_mode='tts' THEN 'pending' ELSE 'ready' END WHERE id=saved.id;
 END IF;
END $$;
CREATE FUNCTION local_identity.use_workspace_narration_track(p_episode uuid,p_review uuid,p_shot text,p_track uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE track public.audio_tracks; BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 SELECT * INTO track FROM public.audio_tracks WHERE id=p_track AND episode_id=p_episode AND track_kind='narration';
 IF NOT FOUND THEN RAISE EXCEPTION 'Registered narration track required' USING ERRCODE='22023'; END IF;
 UPDATE public.shot_preparation_drafts SET current_audio_track_id=track.id,audio_status='ready',source_audio_duration_seconds=track.duration_seconds WHERE episode_id=p_episode AND review_package_id=p_review AND shot_id=p_shot AND audio_mode='source';
END $$;
REVOKE ALL ON FUNCTION local_identity.save_workspace_narration_draft(uuid,uuid,text,text,text,text,numeric),local_identity.use_workspace_narration_track(uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.save_workspace_narration_draft(uuid,uuid,text,text,text,text,numeric),local_identity.use_workspace_narration_track(uuid,uuid,text,uuid) TO loop_owner;

-- Actual voice window and Provider billable window have distinct meanings.
ALTER TABLE local_identity.workspace_image_requests ADD COLUMN provider_duration_seconds numeric CHECK(provider_duration_seconds>0),ADD COLUMN narration_target jsonb;
