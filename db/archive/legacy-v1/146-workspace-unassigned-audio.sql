-- Allow unassigned episode audio to be explicitly selected as manual narration.
CREATE OR REPLACE FUNCTION local_identity.register_workspace_manual_narration(p_workspace uuid,p_shot text,p_material uuid,p_duration numeric,p_text text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces;e public.episodes;m public.production_material_revisions;t public.tasks;a public.artifacts;track_id uuid;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned narration workspace required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id;
 IF e.archived_at IS NOT NULL OR e.stage='production_completed' OR e.main_script_revision_id IS DISTINCT FROM w.script_revision_id OR NOT EXISTS(SELECT 1 FROM public.review_packages WHERE id=w.storyboard_package_id AND invalidated_at IS NULL) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot) THEN RAISE EXCEPTION 'Current workspace shot required' USING ERRCODE='22023';END IF;
 SELECT * INTO m FROM public.production_material_revisions WHERE id=p_material AND episode_id=e.id AND material_type='audio' AND material_purpose IN ('narration','general_reference');
 IF NOT FOUND OR p_duration IS NULL OR p_duration<=0 OR p_duration>7200 OR p_text IS NULL OR length(p_text)>100000 THEN RAISE EXCEPTION 'Verified narration material required' USING ERRCODE='22023';END IF;
 SELECT existing_audio.id INTO track_id FROM public.audio_tracks existing_audio JOIN public.tasks existing_task ON existing_task.id=existing_audio.source_task_id WHERE existing_audio.episode_id=e.id AND existing_audio.source_material_revision_id=m.id AND existing_audio.track_kind='narration' AND existing_audio.cue_id=p_shot AND existing_task.input_snapshot#>>'{workspace_manual_narration,workspace_id}'=w.id::text AND existing_task.input_snapshot#>>'{media,narration,text}'=p_text;
 IF FOUND THEN RETURN track_id;END IF;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version,actual_cost_cents,completed_at,last_result)
 VALUES(e.id,'generate_narration','completed',jsonb_build_object('capability','narration_manual_upload','workspace_manual_narration',jsonb_build_object('workspace_id',w.id,'shot_id',p_shot),'storyboard_review_package_id',w.storyboard_package_id,'media',jsonb_build_object('narration',jsonb_build_object('text',p_text)),'manual_source',jsonb_build_object('material_revision_id',m.id),'audio_track',jsonb_build_object('kind','narration','cue_id',p_shot,'source_review_package_id',w.storyboard_package_id,'source_material_revision_id',m.id,'start_seconds',0,'duration_seconds',p_duration)),0,1,'manual_upload','owner-provided-audio','workspace-manual-narration-v1',0,clock_timestamp(),jsonb_build_object('version','manual-result/v1','status','completed','actualCostCents',0,'validation',jsonb_build_object('passed',true),'artifacts',jsonb_build_array(jsonb_build_object('artifactType','narration_audio','relativePath',m.storage_path,'sha256',m.sha256,'fileSize',m.file_size)))) RETURNING * INTO t;
 SELECT * INTO a FROM public.artifacts WHERE episode_id=e.id AND relative_path=m.storage_path;
 IF FOUND THEN
  IF a.sha256<>m.sha256 OR a.file_size<>m.file_size THEN RAISE EXCEPTION 'Registered audio identity differs' USING ERRCODE='22023';END IF;
 ELSE
  INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id) VALUES(e.id,'narration_audio',m.storage_path,m.sha256,m.file_size,t.id) RETURNING * INTO a;
 END IF;
 INSERT INTO public.audio_tracks(episode_id,source_task_id,source_artifact_id,source_review_package_id,source_material_revision_id,track_kind,cue_id,relative_path,sha256,file_size,start_seconds,duration_seconds) VALUES(e.id,t.id,a.id,w.storyboard_package_id,m.id,'narration',p_shot,m.storage_path,m.sha256,m.file_size,0,p_duration) RETURNING id INTO track_id;
 INSERT INTO public.production_dependencies(episode_id,upstream_kind,upstream_id,downstream_kind,downstream_id) VALUES(e.id,'material_revision',m.id,'task',t.id) ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,e.id,'workspace_manual_narration_registered',jsonb_build_object('workspace_id',w.id,'shot_id',p_shot,'material_revision_id',m.id,'task_id',t.id,'audio_track_id',track_id),local_identity.owner_id());
 RETURN track_id;
END $$;
