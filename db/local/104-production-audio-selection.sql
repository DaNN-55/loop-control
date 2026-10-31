-- Preparation intent is frozen once; the native document owns all adopted timing and gain.
ALTER TABLE local_identity.workspace_audio_preparations ADD COLUMN request_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE OR REPLACE FUNCTION local_identity.queue_workspace_audio(p_preparation uuid,p_retry boolean DEFAULT false,p_source jsonb DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prep local_identity.workspace_audio_preparations; workspace local_identity.production_workspaces; previous public.tasks; created public.tasks; policy jsonb; config jsonb; executor jsonb; auth local_identity.script_productions; frozen jsonb; nonce text:=gen_random_uuid()::text; budget integer:=0; attempts integer:=2; BEGIN
 SELECT * INTO prep FROM local_identity.workspace_audio_preparations WHERE id=p_preparation FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(prep.episode_id) THEN RAISE EXCEPTION 'Owned preparation required' USING ERRCODE='42501'; END IF;
 SELECT * INTO workspace FROM local_identity.production_workspaces WHERE id=prep.workspace_id;
 PERFORM 1 FROM public.episodes e WHERE e.id=prep.episode_id AND e.main_script_revision_id=workspace.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed';
 IF NOT FOUND OR prep.material_revision_id IS NOT NULL THEN RAISE EXCEPTION 'Current generated preparation required' USING ERRCODE='22023'; END IF;
 IF prep.task_id IS NOT NULL THEN
  SELECT * INTO previous FROM public.tasks WHERE id=prep.task_id;
  IF previous.status IN ('ready','running','completed') OR NOT p_retry THEN RETURN previous.id; END IF;
  p_source:=previous.input_snapshot->'workspace_source';
 END IF;
 IF previous.id IS NOT NULL THEN
  frozen:=previous.input_snapshot;budget:=previous.budget_limit_cents;attempts:=previous.max_attempts;executor:=frozen->'executor';
  SELECT * INTO auth FROM local_identity.script_productions WHERE episode_id=prep.episode_id AND script_revision_id=workspace.script_revision_id AND enabled AND authorized_at IS NOT NULL;
  IF prep.kind<>'source' AND auth.authorization_hash IS NULL THEN RAISE EXCEPTION 'Current production authorization required' USING ERRCODE='42501';END IF;
 ELSIF prep.kind='source' THEN
  IF p_source IS NULL OR p_source->>'sha256' IS DISTINCT FROM prep.source_sha256 OR coalesce(p_source->>'startSeconds','') !~ '^[0-9]+([.][0-9]+)?$' OR (p_source->>'startSeconds')::numeric>7200 OR (p_source->>'durationSeconds')::numeric IS DISTINCT FROM prep.duration_seconds OR coalesce(p_source->>'relativePath','') NOT LIKE 'episodes/'||prep.episode_id::text||'/%' THEN RAISE EXCEPTION 'Current native source required' USING ERRCODE='22023'; END IF;
  frozen:=jsonb_build_object('capability','embedded_audio_extraction','workspace_source',p_source,'storyboard_review_package_id',workspace.storyboard_package_id,'media',jsonb_build_object('adapter','ffmpeg_extract_audio','embedded_audio',jsonb_build_object('source_relative_path',p_source->>'relativePath','duration_seconds',prep.duration_seconds,'start_seconds',(p_source->>'startSeconds')::numeric)),'input_artifacts',jsonb_build_array(jsonb_build_object('artifactType','source_video','relativePath',p_source->>'relativePath','sha256',p_source->>'sha256','fileSize',(p_source->>'fileSize')::bigint)),'allowed_tools',jsonb_build_array('read','write'));
 ELSE
  config:=prep.request_snapshot->'execution';executor:=config->'executor';
  IF prep.request_snapshot->>'selectionVersion' IS DISTINCT FROM '1' OR prep.request_snapshot#>>'{selection,capability}' IS DISTINCT FROM 'music_sound' OR config->>'credential_ref' IS DISTINCT FROM prep.request_snapshot#>>'{selection,connectionVersionId}' OR NOT EXISTS(SELECT 1 FROM public.external_connection_versions cv JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=local_identity.owner_id() AND cn.current_version_id=cv.id JOIN local_identity.connection_bindings cb ON cb.version_id=cv.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=cv.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE cv.id::text=config->>'credential_ref' AND cv.provider='freesound' AND cv.adapter='freesound_preview' AND cv.revoked_at IS NULL AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=cv.id AND pe.owner_id=cn.created_by AND pe.mode='live' AND pe.outcome='verified')) THEN RAISE EXCEPTION 'Validated owned Freesound selection required' USING ERRCODE='22023';END IF;
  IF config->>'execution_path' IS DISTINCT FROM 'external' OR executor->>'provider' IS DISTINCT FROM 'freesound' OR executor->>'adapter' IS DISTINCT FROM 'freesound_preview' OR executor->>'model' IS DISTINCT FROM 'freesound-preview-v1' THEN RAISE EXCEPTION 'Selected Freesound execution required' USING ERRCODE='22023'; END IF;
  SELECT * INTO auth FROM local_identity.script_productions WHERE episode_id=prep.episode_id AND script_revision_id=workspace.script_revision_id AND enabled AND authorized_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current production authorization required' USING ERRCODE='42501'; END IF;
  IF coalesce(config->>'budget_cents','') !~ '^[0-9]+$' OR coalesce(config->>'max_attempts','') !~ '^[1-9][0-9]*$' OR jsonb_typeof(config->'allowed_tools') IS DISTINCT FROM 'array' OR jsonb_array_length(config->'allowed_tools')=0 THEN RAISE EXCEPTION 'Frozen soundtrack budget and tools required' USING ERRCODE='22023'; END IF;
  budget:=(config->>'budget_cents')::integer;attempts:=(config->>'max_attempts')::integer;
  frozen:=jsonb_build_object('production_selection',prep.request_snapshot->'selection','production_context',prep.request_snapshot->'context','workspace_target',prep.request_snapshot->'target','cost_basis',prep.request_snapshot->'costBasis','capability','soundtrack_generation','storyboard_review_package_id',workspace.storyboard_package_id,'credential_ref',config->>'credential_ref','executor',executor,'media',jsonb_build_object('adapter','freesound_preview','soundtrack',jsonb_build_object('query',prep.query,'target_duration_seconds',prep.duration_seconds,'cue',jsonb_build_object('id',prep.id,'kind',prep.kind,'description',prep.description,'search_query',prep.query,'start_seconds',prep.offset_seconds,'duration_seconds',prep.duration_seconds))),'allowed_tools',config->'allowed_tools','input_artifacts','[]'::jsonb);
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

ALTER FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid) RENAME TO input_media_connection_before_audio_selection;
CREATE FUNCTION local_identity.input_media_connection(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_version_id uuid) RETURNS TABLE(version_id uuid,provider text,adapter text,endpoint text,secret_ref uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND t.task_type='generate_soundtrack' AND EXISTS(SELECT 1 FROM local_identity.workspace_audio_requests r WHERE r.task_id=t.id)) THEN RETURN QUERY SELECT * FROM local_identity.input_media_connection_before_audio_selection(p_task_id,p_attempt,p_lease_token,p_version_id);RETURN;END IF;
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 RETURN QUERY SELECT cv.id,cv.provider,cv.adapter,cv.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.media_enabled
 JOIN public.external_connection_versions cv ON cv.id=p_version_id AND cv.provider=t.provider AND cv.adapter=t.input_snapshot#>>'{executor,adapter}' AND cv.revoked_at IS NULL
 JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=i.owner_id
 JOIN local_identity.connection_bindings b ON b.version_id=cv.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=cv.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.input_snapshot->>'credential_ref'=cv.id::text AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=cv.id AND pe.owner_id=i.owner_id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen audio connection unavailable';END IF;
END $$;
REVOKE ALL ON FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid),local_identity.input_media_connection_before_audio_selection(uuid,integer,uuid,uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid) TO loop_worker;
