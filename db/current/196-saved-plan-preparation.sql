-- D: freeze a verified saved plan as current preparation; never revive its execution grant.
CREATE FUNCTION local_identity.register_saved_plan_preparation(p_episode uuid,p_script uuid,p_id uuid,p_file jsonb,p_manifest jsonb,p_source text,p_plan_sha text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved local_identity.script_productions; source public.production_material_revisions;
 existing local_identity.production_preparation_revisions; identity jsonb; shot jsonb; segment jsonb;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e WHERE e.id=p_episode AND e.main_script_revision_id=p_script AND e.archived_at IS NULL
  AND e.stage IN ('script_approved','storyboard_review','storyboard_approved','production_ready','render_ready','qc_review')
  AND NOT local_identity.is_historical_episode(e.id)) OR NOT local_identity.script_material_is_approved(p_script) THEN
  RAISE EXCEPTION 'Current confirmed script required' USING ERRCODE='40001';
 END IF;
 SELECT * INTO saved FROM local_identity.script_productions WHERE episode_id=p_episode AND owner_id=local_identity.owner_id() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned saved plan required' USING ERRCODE='42501';END IF;
 identity:=jsonb_build_object('version','legacy-production-plan/v1','episodeId',p_episode,'scriptRevisionId',saved.script_revision_id,'scriptSha256',saved.script_sha256,'plan',saved.plan);
 IF p_plan_sha IS NULL OR p_plan_sha !~ '^[a-f0-9]{64}$' OR p_source IS NULL
  OR p_source::jsonb IS DISTINCT FROM identity OR encode(extensions.digest(convert_to(p_source,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_plan_sha
  OR saved.plan->>'version' IS DISTINCT FROM '2' OR jsonb_typeof(saved.plan->'segments') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Saved plan identity changed or unsupported' USING ERRCODE='40001';
 END IF;
 SELECT * INTO source FROM public.production_material_revisions WHERE id=p_script AND episode_id=p_episode AND material_type='script';
 IF NOT FOUND OR source.sha256 IS DISTINCT FROM saved.script_sha256 OR NOT EXISTS(
  SELECT 1 FROM public.production_material_revisions original WHERE original.id=saved.script_revision_id AND original.episode_id=p_episode AND original.material_type='script' AND original.sha256=saved.script_sha256
 ) THEN RAISE EXCEPTION 'Saved script bytes and current script must agree' USING ERRCODE='40001';END IF;
 IF p_manifest#>>'{savedPlan,sha256}' IS DISTINCT FROM p_plan_sha
  OR p_manifest#>>'{savedPlan,scriptRevisionId}' IS DISTINCT FROM saved.script_revision_id::text
  OR jsonb_typeof(p_manifest->'shots') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_manifest->'shots')<>jsonb_array_length(saved.plan->'segments') THEN
  RAISE EXCEPTION 'Saved plan preparation required' USING ERRCODE='22023';
 END IF;
 FOR shot,segment IN SELECT a.value,b.value FROM jsonb_array_elements(p_manifest->'shots') WITH ORDINALITY a
  JOIN jsonb_array_elements(saved.plan->'segments') WITH ORDINALITY b USING(ordinality) LOOP
  IF shot->>'id' IS DISTINCT FROM segment->>'id' OR shot->>'scriptSegment' IS DISTINCT FROM segment->>'narration'
   OR shot->'savedSettings' IS DISTINCT FROM segment->'settings' THEN RAISE EXCEPTION 'Saved segment changed' USING ERRCODE='40001';END IF;
 END LOOP;
 SELECT * INTO existing FROM local_identity.production_preparation_revisions WHERE id=p_id;
 IF FOUND THEN
  IF existing.origin<>'plan-import' OR existing.episode_id IS DISTINCT FROM p_episode OR existing.script_revision_id IS DISTINCT FROM p_script
   OR existing.file_reference IS DISTINCT FROM p_file OR existing.manifest IS DISTINCT FROM p_manifest
   OR existing.source_evidence->>'plan_sha256' IS DISTINCT FROM p_plan_sha THEN RAISE EXCEPTION 'Preparation identity already used' USING ERRCODE='40001';END IF;
  RETURN p_id;
 END IF;
 PERFORM local_identity.register_production_preparation(p_episode,p_script,p_id,p_file,p_manifest);
 UPDATE local_identity.production_preparation_revisions SET origin='plan-import',source_reference_id=saved.script_revision_id,
  source_evidence=jsonb_build_object('version','saved-production-plan/v1','plan_sha256',p_plan_sha,'record',to_jsonb(saved)) WHERE id=p_id;
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION local_identity.register_saved_plan_preparation(uuid,uuid,uuid,jsonb,jsonb,text,text) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.register_saved_plan_preparation(uuid,uuid,uuid,jsonb,jsonb,text,text) TO loop_app;
COMMENT ON FUNCTION local_identity.register_saved_plan_preparation(uuid,uuid,uuid,jsonb,jsonb,text,text) IS 'Controller verifies actual script/material/preparation files before registration. Saved settings and authorization are evidence only; no task or execution authorization is created.';
