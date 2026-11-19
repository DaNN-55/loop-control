-- Local extraction has already produced verified media. Register that real source;
-- do not manufacture a narration or a completed Worker task for a synchronous copy.
ALTER TABLE public.audio_tracks ALTER COLUMN source_task_id DROP NOT NULL;
ALTER TABLE public.audio_tracks ADD CONSTRAINT audio_tracks_registered_local_source CHECK(
 source_task_id IS NOT NULL OR track_kind='source' AND source_material_revision_id IS NOT NULL AND source_artifact_id IS NOT NULL
);
CREATE FUNCTION local_identity.register_workspace_replacement_source(
 p_workspace uuid,p_shot text,p_material uuid,p_sha text,p_size bigint,p_duration numeric,
 p_video_path text,p_video_sha text,p_source_in numeric,p_fps numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE w local_identity.production_workspaces;m public.production_material_revisions;a public.artifacts;track_id uuid;
BEGIN
 w:=local_identity.lock_current_production_workspace(p_workspace);
 IF p_shot IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot)
  OR p_duration IS NULL OR p_duration NOT BETWEEN 0.001 AND 7200
  OR p_source_in IS NULL OR p_source_in NOT BETWEEN 0 AND 7200
  OR p_fps IS NULL OR p_fps NOT BETWEEN 1 AND 240
  OR p_sha IS NULL OR p_sha !~ '^[0-9a-f]{64}$' OR p_size IS NULL OR p_size<=0
  OR p_video_sha IS NULL OR p_video_sha !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Current shot and verified source window required' USING ERRCODE='22023';
 END IF;
 SELECT * INTO m FROM public.production_material_revisions WHERE id=p_material AND episode_id=w.episode_id
  AND material_type='audio' AND material_purpose='general_reference' AND mime_type='audio/mpeg'
  AND sha256=p_sha AND file_size=p_size;
 IF NOT FOUND OR NOT(
  EXISTS(SELECT 1 FROM public.production_material_revisions v WHERE v.episode_id=w.episode_id AND v.material_type='video' AND v.storage_path=p_video_path AND v.sha256=p_video_sha)
  OR EXISTS(SELECT 1 FROM public.artifacts v WHERE v.episode_id=w.episode_id AND v.relative_path=p_video_path AND v.sha256=p_video_sha AND v.relative_path ~ '\.mp4$')
 ) THEN RAISE EXCEPTION 'Verified audio and video must belong to this episode' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM public.artifacts WHERE episode_id=w.episode_id AND relative_path=m.storage_path;
 IF FOUND THEN
  IF a.sha256<>m.sha256 OR a.file_size<>m.file_size OR a.producer_task_id IS NOT NULL THEN
   RAISE EXCEPTION 'Local extracted source identity differs' USING ERRCODE='22023';
  END IF;
 ELSE
  INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id)
   VALUES(w.episode_id,'source_audio',m.storage_path,m.sha256,m.file_size,NULL) RETURNING * INTO a;
 END IF;
 SELECT id INTO track_id FROM public.audio_tracks WHERE episode_id=w.episode_id AND preparation_revision_id=w.preparation_revision_id
  AND source_material_revision_id=m.id AND track_kind='source' AND cue_id=p_shot AND source_task_id IS NULL
  AND source_artifact_id=a.id AND duration_seconds=p_duration;
 IF FOUND THEN RETURN track_id;END IF;
 INSERT INTO public.audio_tracks(episode_id,source_task_id,source_artifact_id,preparation_revision_id,source_material_revision_id,track_kind,cue_id,relative_path,sha256,file_size,start_seconds,duration_seconds)
  VALUES(w.episode_id,NULL,a.id,w.preparation_revision_id,m.id,'source',p_shot,m.storage_path,m.sha256,m.file_size,0,p_duration) RETURNING id INTO track_id;
 -- audio_tracks foreign keys retain both the source material and artifact.
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id)
  SELECT e.account_id,e.id,'workspace_replacement_source_registered',jsonb_build_object('workspace_id',w.id,'shot_id',p_shot,'audio_track_id',track_id,'material_revision_id',m.id,'video_path',p_video_path,'video_sha256',p_video_sha,'source_in_seconds',p_source_in,'frame_rate',p_fps,'duration_seconds',p_duration),local_identity.owner_id()
  FROM public.episodes e WHERE e.id=w.episode_id;
 RETURN track_id;
END $$;
REVOKE ALL ON FUNCTION local_identity.register_workspace_replacement_source(uuid,text,uuid,text,bigint,numeric,text,text,numeric,numeric) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.register_workspace_replacement_source(uuid,text,uuid,text,bigint,numeric,text,text,numeric,numeric) TO loop_app;
