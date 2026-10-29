-- Preparation provenance only. The actual native document owns adopted placement and gain.
CREATE TABLE local_identity.workspace_audio_preparations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),episode_id uuid NOT NULL REFERENCES public.episodes(id),
 kind text NOT NULL CHECK(kind IN ('bgm','sfx','source')),shot_id text,source_item_id text,source_sha256 text,
 description text NOT NULL,query text,anchor text NOT NULL CHECK(anchor IN ('absolute','shot')),offset_seconds numeric NOT NULL DEFAULT 0 CHECK(offset_seconds>=0),duration_seconds numeric NOT NULL CHECK(duration_seconds>0),
 material_revision_id uuid REFERENCES public.production_material_revisions(id),task_id uuid REFERENCES public.tasks(id),adopted_item_id text,input_fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE local_identity.workspace_audio_requests(
 task_id uuid PRIMARY KEY REFERENCES public.tasks(id),preparation_id uuid NOT NULL REFERENCES local_identity.workspace_audio_preparations(id),workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),episode_id uuid NOT NULL REFERENCES public.episodes(id),
 input_fingerprint text NOT NULL,authorization_hash text,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.workspace_audio_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.workspace_audio_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_audio_owner ON local_identity.workspace_audio_preparations TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.input_episodes i WHERE i.episode_id=workspace_audio_preparations.episode_id AND i.owner_id=local_identity.owner_id())) WITH CHECK(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id AND w.episode_id=workspace_audio_preparations.episode_id));
CREATE POLICY workspace_audio_request_owner ON local_identity.workspace_audio_requests TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.input_episodes i WHERE i.episode_id=workspace_audio_requests.episode_id AND i.owner_id=local_identity.owner_id())) WITH CHECK(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id AND w.episode_id=workspace_audio_requests.episode_id));
GRANT SELECT,INSERT,UPDATE ON local_identity.workspace_audio_preparations TO loop_app;
GRANT SELECT,INSERT ON local_identity.workspace_audio_requests TO loop_app;
CREATE FUNCTION local_identity.queue_workspace_audio(p_preparation uuid,p_retry boolean DEFAULT false,p_source jsonb DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prep local_identity.workspace_audio_preparations; workspace local_identity.production_workspaces; previous public.tasks; created public.tasks; policy jsonb; config jsonb; executor jsonb; auth local_identity.script_productions; frozen jsonb; nonce text:=gen_random_uuid()::text; budget integer:=0; attempts integer:=2; BEGIN
 SELECT * INTO prep FROM local_identity.workspace_audio_preparations WHERE id=p_preparation FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(prep.episode_id) THEN RAISE EXCEPTION 'Owned preparation required' USING ERRCODE='42501'; END IF;
 SELECT * INTO workspace FROM local_identity.production_workspaces WHERE id=prep.workspace_id;
 SELECT b.policy INTO policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=prep.episode_id AND e.main_script_revision_id=workspace.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed';
 IF NOT FOUND OR prep.material_revision_id IS NOT NULL THEN RAISE EXCEPTION 'Current generated preparation required' USING ERRCODE='22023'; END IF;
 IF prep.task_id IS NOT NULL THEN
  SELECT * INTO previous FROM public.tasks WHERE id=prep.task_id;
  IF previous.status IN ('ready','running','completed') OR NOT p_retry THEN RETURN previous.id; END IF;
  p_source:=previous.input_snapshot->'workspace_source';
 END IF;
 IF prep.kind='source' THEN
  IF p_source IS NULL OR p_source->>'sha256' IS DISTINCT FROM prep.source_sha256 OR coalesce(p_source->>'relativePath','') NOT LIKE 'episodes/'||prep.episode_id::text||'/%' THEN RAISE EXCEPTION 'Current native source required' USING ERRCODE='22023'; END IF;
  frozen:=jsonb_build_object('capability','embedded_audio_extraction','workspace_source',p_source,'storyboard_review_package_id',workspace.storyboard_package_id,'media',jsonb_build_object('adapter','ffmpeg_extract_audio','embedded_audio',jsonb_build_object('source_relative_path',p_source->>'relativePath','duration_seconds',prep.duration_seconds-0.04)),'input_artifacts',jsonb_build_array(jsonb_build_object('artifactType','source_video','relativePath',p_source->>'relativePath','sha256',p_source->>'sha256','fileSize',(p_source->>'fileSize')::bigint)),'allowed_tools',jsonb_build_array('read','write'));
 ELSE
  config:=policy->'soundtrack';executor:=config->'executor';
  IF config->>'execution_path' IS DISTINCT FROM 'external' OR executor->>'provider' IS DISTINCT FROM 'freesound' OR executor->>'adapter' IS DISTINCT FROM 'freesound_preview' OR executor->>'model' IS DISTINCT FROM 'freesound-preview-v1' THEN RAISE EXCEPTION 'Selected Freesound execution required' USING ERRCODE='22023'; END IF;
  SELECT * INTO auth FROM local_identity.script_productions WHERE episode_id=prep.episode_id AND script_revision_id=workspace.script_revision_id AND enabled AND authorized_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current production authorization required' USING ERRCODE='42501'; END IF;
  IF coalesce(config->>'budget_cents','') !~ '^[0-9]+$' OR coalesce(config->>'max_attempts','') !~ '^[1-9][0-9]*$' OR jsonb_typeof(config->'allowed_tools') IS DISTINCT FROM 'array' OR jsonb_array_length(config->'allowed_tools')=0 THEN RAISE EXCEPTION 'Frozen soundtrack budget and tools required' USING ERRCODE='22023'; END IF;
  budget:=(config->>'budget_cents')::integer;attempts:=(config->>'max_attempts')::integer;
  frozen:=jsonb_build_object('capability','soundtrack_generation','storyboard_review_package_id',workspace.storyboard_package_id,'credential_ref',config->>'credential_ref','executor',executor,'media',jsonb_build_object('adapter','freesound_preview','soundtrack',jsonb_build_object('query',prep.query,'target_duration_seconds',prep.duration_seconds,'cue',jsonb_build_object('id',prep.id,'kind',prep.kind,'description',prep.description,'search_query',prep.query,'start_seconds',prep.offset_seconds,'duration_seconds',prep.duration_seconds))),'allowed_tools',config->'allowed_tools','input_artifacts','[]'::jsonb);
 END IF;
 frozen:=frozen||jsonb_build_object('configuration_hash',prep.input_fingerprint||'-'||nonce,'workspace_audio',jsonb_build_object('preparation_id',prep.id,'input_fingerprint',prep.input_fingerprint),'budget',jsonb_build_object('limit_cents',budget,'max_attempts',attempts),'audio_track',jsonb_build_object('kind',prep.kind,'cue_id',coalesce(prep.shot_id,prep.id::text),'source_review_package_id',workspace.storyboard_package_id,'start_seconds',0,'duration_seconds',0.001),'output',jsonb_build_object('required_artifact_types',jsonb_build_array(CASE WHEN prep.kind='source' THEN 'shot_source_audio' ELSE 'soundtrack_audio' END),'content_type','audio/mpeg','relative_path',format('episodes/%s/workspace-audio/%s/%s.mp3',prep.episode_id,prep.id,nonce),'review_stage','production_ready'));
 UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=prep.episode_id;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(prep.episode_id,CASE WHEN prep.kind='source' THEN 'extract_embedded_audio' ELSE 'generate_soundtrack' END,'ready',frozen,budget,attempts,CASE WHEN prep.kind='source' THEN 'ffmpeg' ELSE 'freesound' END,CASE WHEN prep.kind='source' THEN 'ffmpeg' ELSE executor->>'model' END,CASE WHEN prep.kind='source' THEN 'workspace-source-audio-v1' ELSE executor->>'prompt_version' END) RETURNING * INTO created;
 UPDATE local_identity.workspace_audio_preparations SET task_id=created.id WHERE id=prep.id;
 INSERT INTO local_identity.workspace_audio_requests(task_id,preparation_id,workspace_id,episode_id,input_fingerprint,authorization_hash) VALUES(created.id,prep.id,workspace.id,prep.episode_id,prep.input_fingerprint,auth.authorization_hash);
 RETURN created.id;
END $$;
REVOKE ALL ON FUNCTION local_identity.queue_workspace_audio(uuid,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.queue_workspace_audio(uuid,boolean,jsonb) TO loop_owner;
CREATE FUNCTION local_identity.workspace_audio_task_current(p_task uuid,p_attempt integer,p_lease uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE request local_identity.workspace_audio_requests; BEGIN
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO request FROM local_identity.workspace_audio_requests WHERE task_id=p_task;
 IF NOT FOUND THEN RETURN true; END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.workspace_audio_preparations p JOIN local_identity.production_workspaces w ON w.id=p.workspace_id JOIN public.episodes e ON e.id=w.episode_id WHERE p.id=request.preparation_id AND p.task_id=p_task AND p.input_fingerprint=request.input_fingerprint AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed') THEN RETURN false; END IF;
 RETURN request.authorization_hash IS NULL OR EXISTS(SELECT 1 FROM local_identity.script_productions p JOIN public.episodes e ON e.id=p.episode_id WHERE p.episode_id=request.episode_id AND p.enabled AND p.authorized_at IS NOT NULL AND p.authorization_hash=request.authorization_hash AND p.script_revision_id=e.main_script_revision_id);
END $$;
REVOKE ALL ON FUNCTION local_identity.workspace_audio_task_current(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.workspace_audio_task_current(uuid,integer,uuid) TO loop_worker;
CREATE FUNCTION local_identity.use_workspace_source_track(p_episode uuid,p_review uuid,p_shot text,p_track uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE track public.audio_tracks; draft public.shot_preparation_drafts; BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 SELECT * INTO track FROM public.audio_tracks WHERE id=p_track AND episode_id=p_episode AND track_kind='source' AND source_review_package_id=p_review;
 IF NOT FOUND THEN RAISE EXCEPTION 'Real registered source track required' USING ERRCODE='22023'; END IF;
 SELECT * INTO draft FROM public.shot_preparation_drafts WHERE episode_id=p_episode AND review_package_id=p_review AND shot_id=p_shot;
 IF draft.id IS NULL THEN PERFORM public.save_shot_preparation_draft(p_episode,p_review,p_shot,'source','',true,NULL,NULL,NULL); END IF;
 UPDATE public.shot_preparation_drafts SET audio_mode=CASE WHEN audio_mode='none' THEN 'source' ELSE audio_mode END,current_audio_track_id=track.id,audio_status='ready',source_audio_duration_seconds=track.duration_seconds WHERE episode_id=p_episode AND review_package_id=p_review AND shot_id=p_shot;
END $$;
REVOKE ALL ON FUNCTION local_identity.use_workspace_source_track(uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.use_workspace_source_track(uuid,uuid,text,uuid) TO loop_owner;
