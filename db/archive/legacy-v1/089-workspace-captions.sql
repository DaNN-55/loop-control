-- Evidence references native lanes. The OpenChatCut document owns text/timing/layout.
CREATE TABLE local_identity.workspace_caption_evidence(
 workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),
 clip_id uuid NOT NULL,
 input_fingerprint text NOT NULL CHECK(input_fingerprint~'^[0-9a-f]{64}$'),
 lane_fingerprint text NOT NULL CHECK(lane_fingerprint~'^[0-9a-f]{64}$'),
 method text NOT NULL CHECK(method IN ('manual','alignment','waiting')),
 task_id uuid REFERENCES public.tasks(id),
 alignment_input_version text,
 confirmed_by uuid REFERENCES local_identity.owners(id),
 confirmed_at timestamptz,
 PRIMARY KEY(workspace_id,clip_id)
);
ALTER TABLE local_identity.workspace_caption_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_caption_owner ON local_identity.workspace_caption_evidence TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id)) WITH CHECK(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id));
REVOKE ALL ON local_identity.workspace_caption_evidence FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT,INSERT,UPDATE ON local_identity.workspace_caption_evidence TO loop_app;

-- Workspace editing does not create or require per-shot approvals. Reuse the
-- existing draft and alignment task path while preserving all audio inputs.
CREATE FUNCTION local_identity.save_workspace_caption_input(p_workspace uuid,p_clip uuid,p_contract jsonb) RETURNS public.shot_preparation_drafts
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces; b jsonb; d public.shot_preparation_drafts; BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) OR local_identity.is_historical_episode(w.episode_id) OR NOT EXISTS(SELECT 1 FROM public.episodes e JOIN public.review_packages p ON p.id=w.storyboard_package_id WHERE e.id=w.episode_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND p.invalidated_at IS NULL) THEN RAISE EXCEPTION 'Current Owner workspace required' USING ERRCODE='42501'; END IF;
 SELECT value INTO b FROM jsonb_array_elements(w.bindings) WHERE value->>'id'=p_clip::text;
 IF b IS NULL OR NOT public.is_valid_shot_caption_contract(p_contract) THEN RAISE EXCEPTION 'Workspace caption input invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE episode_id=w.episode_id AND review_package_id=w.storyboard_package_id AND shot_id=b->>'shotId' FOR UPDATE;
 IF p_contract->>'content_mode'='follow_tts' AND (d.audio_mode IS DISTINCT FROM 'tts' OR p_contract->>'text' IS DISTINCT FROM d.tts_text) THEN RAISE EXCEPTION 'Captions must follow current narration text' USING ERRCODE='40001'; END IF;
 IF d.id IS NULL THEN
  INSERT INTO public.shot_preparation_drafts(episode_id,review_package_id,shot_id,audio_mode,subtitle_text,subtitles_enabled,caption_contract)
  VALUES(w.episode_id,w.storyboard_package_id,b->>'shotId','none',p_contract->>'text',(p_contract->>'enabled')::boolean,p_contract) RETURNING * INTO d;
 ELSE
  UPDATE public.shot_preparation_drafts SET frozen_at=NULL,frozen_by=NULL,subtitle_text=p_contract->>'text',subtitles_enabled=(p_contract->>'enabled')::boolean,caption_contract=p_contract,updated_at=clock_timestamp() WHERE id=d.id RETURNING * INTO d;
 END IF;
 RETURN d;
END $$;
REVOKE ALL ON FUNCTION local_identity.save_workspace_caption_input(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.save_workspace_caption_input(uuid,uuid,jsonb) TO loop_app;
