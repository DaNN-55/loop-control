-- Register the server-verified frozen source before the domain render command
-- validates it. The task binding follows within the same Owner transaction.
CREATE FUNCTION local_identity.register_owned_studio_freeze(p_episode uuid,p_basis uuid,p_reference jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE package public.review_packages;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned Studio freeze required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e WHERE e.id=p_episode AND e.archived_at IS NULL AND e.stage IN ('storyboard_approved','production_ready','render_ready','qc_review') AND NOT local_identity.is_historical_episode(e.id)) THEN RAISE EXCEPTION 'Current editable Studio required' USING ERRCODE='55000';END IF;
 SELECT * INTO package FROM public.review_packages WHERE id=p_basis AND episode_id=p_episode AND invalidated_at IS NULL AND stage IN ('storyboard_review','production_ready','qc_review');
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.review_packages newer WHERE newer.episode_id=p_episode AND newer.stage=package.stage AND newer.invalidated_at IS NULL AND newer.revision_number>package.revision_number) THEN RAISE EXCEPTION 'Current Studio basis required' USING ERRCODE='55000';END IF;
 IF p_reference IS NULL OR jsonb_typeof(p_reference)<>'object' OR p_reference->>'relative_path' IS NULL OR p_reference->>'relative_path' !~ '/openchatcut-frozen/[0-9a-f-]{36}/project[.]json$'
  OR local_identity.episode_current_reference(p_episode,p_reference->>'relative_path') IS NULL
  OR coalesce(p_reference->>'sha256','') !~ '^[0-9a-f]{64}$' OR coalesce(p_reference->>'file_size','') !~ '^[1-9][0-9]{0,15}$'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_reference) key WHERE key NOT IN ('relative_path','sha256','file_size')) THEN RAISE EXCEPTION 'Invalid owned frozen Studio reference' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.artifacts a WHERE a.episode_id=p_episode AND a.relative_path=p_reference->>'relative_path' AND (a.sha256<>p_reference->>'sha256' OR a.file_size<>(p_reference->>'file_size')::bigint OR a.artifact_type<>'studio_frozen_project')) THEN RAISE EXCEPTION 'Frozen Studio identity changed' USING ERRCODE='55000';END IF;
 INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size)
 SELECT p_episode,'studio_frozen_project',p_reference->>'relative_path',p_reference->>'sha256',(p_reference->>'file_size')::bigint
 WHERE NOT EXISTS(SELECT 1 FROM public.artifacts a WHERE a.episode_id=p_episode AND a.relative_path=p_reference->>'relative_path');
END $$;
REVOKE ALL ON FUNCTION local_identity.register_owned_studio_freeze(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.register_owned_studio_freeze(uuid,uuid,jsonb) TO loop_owner;

DO $$DECLARE original text;changed text;BEGIN
 original:=pg_get_functiondef('local_identity.scope_input_studio_task(uuid,text,jsonb)'::regprocedure);
 changed:=replace(original,$old$INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES(t.episode_id,t.id,'studio_frozen_project',p_frozen->>'relative_path',p_frozen->>'sha256',(p_frozen->>'file_size')::bigint);$old$,
 $new$UPDATE public.artifacts SET producer_task_id=t.id WHERE episode_id=t.episode_id AND artifact_type='studio_frozen_project' AND relative_path=p_frozen->>'relative_path' AND sha256=p_frozen->>'sha256' AND file_size=(p_frozen->>'file_size')::bigint AND producer_task_id IS NULL;
 IF NOT FOUND THEN INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) SELECT t.episode_id,t.id,'studio_frozen_project',p_frozen->>'relative_path',p_frozen->>'sha256',(p_frozen->>'file_size')::bigint WHERE NOT EXISTS(SELECT 1 FROM public.artifacts a WHERE a.episode_id=t.episode_id AND a.producer_task_id=t.id AND a.artifact_type='studio_frozen_project' AND a.relative_path=p_frozen->>'relative_path' AND a.sha256=p_frozen->>'sha256' AND a.file_size=(p_frozen->>'file_size')::bigint);END IF;$new$);
 IF changed=original THEN RAISE EXCEPTION 'Studio frozen artifact binding contract changed';END IF;
 EXECUTE changed;
END $$;
