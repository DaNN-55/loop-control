-- Sound use is distinct from candidate selection and from paid generation requests.
-- No backfill, new table, or change to the general event payload/type allowlists.
CREATE FUNCTION local_identity.record_workspace_sound_use(p_workspace uuid,p_revision bigint,p_role text,p_action text,p_source_kind text,p_source uuid,p_sha text,p_instance text,p_usage text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces;
BEGIN
 SELECT * INTO w FROM local_identity.lock_current_production_workspace(p_workspace);
 IF NOT local_identity.production_metrics_enabled() THEN RETURN false;END IF;
 IF p_revision IS DISTINCT FROM w.revision OR p_role IS NULL OR p_role NOT IN('bgm','sfx','source','ambience','narration','other')
  OR p_action IS NULL OR p_action NOT IN('used','withdrawn','changed') OR p_source_kind IS NULL OR p_source_kind NOT IN('material','audio_track','task_artifact','unresolved')
  OR coalesce(p_instance,'') !~ '^[0-9a-f]{64}$' OR coalesce(p_usage,'') !~ '^[0-9a-f]{64}$'
  OR (p_source_kind='unresolved' AND (p_source IS NOT NULL OR p_sha IS NOT NULL))
  OR (p_source_kind<>'unresolved' AND (p_source IS NULL OR coalesce(p_sha,'') !~ '^[0-9a-f]{64}$')) THEN
  RAISE EXCEPTION 'Invalid sound observation' USING ERRCODE='22023';END IF;
 IF p_source_kind='material' THEN
  IF NOT EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id=p_source AND episode_id=w.episode_id AND material_type IN('audio','video') AND sha256=p_sha) THEN RAISE EXCEPTION 'Sound material scope mismatch' USING ERRCODE='42501';END IF;
 ELSIF p_source_kind='audio_track' THEN
  IF NOT EXISTS(SELECT 1 FROM public.audio_tracks WHERE id=p_source AND episode_id=w.episode_id AND sha256=p_sha) THEN RAISE EXCEPTION 'Sound track scope mismatch' USING ERRCODE='42501';END IF;
 ELSIF p_source_kind='task_artifact' THEN
  IF NOT EXISTS(SELECT 1 FROM public.artifacts WHERE id=p_source AND episode_id=w.episode_id AND sha256=p_sha AND artifact_type IN('narration_audio','soundtrack_audio','source_audio','shot_source_audio','legacy_recovered_media','shot_video','a_roll_video','b_roll_asset','render','shot_clip','generated_video')) THEN RAISE EXCEPTION 'Sound artifact scope mismatch' USING ERRCODE='42501';END IF;
 END IF;
 -- Role describes the saved native use, not a generation/preparation entitlement.
 -- An Owner can replace a native sound with another registered source directly.
 RETURN local_identity.append_production_metric(local_identity.owner_id(),w.episode_id,CASE WHEN p_source_kind='unresolved' THEN 'sound_unresolved' ELSE 'sound_'||p_action END,'sound:'||w.id||':'||p_revision||':'||p_instance||':'||p_action,
  jsonb_build_object('version','sound-use/v1','workspace_id',w.id,'project_revision',p_revision,'content_sha256',w.content_sha256,'role',p_role,'action',p_action,'source_kind',p_source_kind,'source_id',p_source,'source_sha256',p_sha,'instance_sha256',p_instance,'use_sha256',p_usage));
END $$;
REVOKE ALL ON FUNCTION local_identity.record_workspace_sound_use(uuid,bigint,text,text,text,uuid,text,text,text) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.record_workspace_sound_use(uuid,bigint,text,text,text,uuid,text,text,text) TO loop_app;
