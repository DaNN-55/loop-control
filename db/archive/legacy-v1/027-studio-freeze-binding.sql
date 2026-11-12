-- Preserve the explicit frozen project when the shared orchestrator selects a
-- default composition at production_ready. Only a fresh owned native task may
-- bind the exact reference already recorded by the domain command.
CREATE OR REPLACE FUNCTION local_identity.scope_input_studio_task(p_task_id uuid,p_fingerprint text,p_frozen jsonb) RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tasks; prefix text; recorded jsonb; reference jsonb;
BEGIN
 SELECT * INTO t FROM public.tasks WHERE id=p_task_id;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(t.episode_id) OR NOT local_identity.input_task_allowed(t.episode_id,t.task_type) OR t.task_type<>'generate_review_render' OR t.status<>'ready' OR t.attempt<>0 OR t.created_at<>transaction_timestamp() OR p_fingerprint !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Fresh Owner Studio task required' USING ERRCODE='42501'; END IF;
 recorded:=coalesce(t.input_snapshot#>'{review_render,adjustments,studio_project}',t.input_snapshot->'studio_project');
 reference:=jsonb_build_object('relative_path',recorded->'relative_path','sha256',recorded->'sha256','file_size',recorded->'file_size');
 IF p_frozen IS NULL OR reference IS DISTINCT FROM p_frozen OR p_frozen->>'relative_path' !~ format('^episodes/%s/openchatcut-frozen/[0-9a-f-]{36}/project[.]json$',t.episode_id) OR p_frozen->>'sha256' !~ '^[0-9a-f]{64}$' OR (p_frozen->>'file_size')::bigint<1 THEN RAISE EXCEPTION 'Frozen Studio task differs' USING ERRCODE='22023'; END IF;
 prefix:=format('episodes/%s/review-render/%s',t.episode_id,t.id);
 UPDATE public.tasks SET input_snapshot=jsonb_set(jsonb_set(jsonb_set(input_snapshot,'{output,relative_path}',to_jsonb(prefix||'/review-render.mp4')),'{review_render,project_relative_path}',to_jsonb(prefix||'/index.html')),'{review_render,adjustments,studio_project}',coalesce(recorded,'{}'::jsonb)||p_frozen)||jsonb_build_object('native_studio_fingerprint',p_fingerprint,'input_artifacts',coalesce(input_snapshot->'input_artifacts','[]'::jsonb)||jsonb_build_array(jsonb_build_object('artifactType','studio_frozen_project','relativePath',p_frozen->>'relative_path','sha256',p_frozen->>'sha256','fileSize',(p_frozen->>'file_size')::bigint))) WHERE id=t.id RETURNING * INTO t;
 UPDATE public.review_render_composition_revisions SET composition_config=jsonb_set(composition_config,'{studio_project}',coalesce(recorded,'{}'::jsonb)||p_frozen) WHERE id::text=t.input_snapshot#>>'{review_render,composition_revision_id}' AND episode_id=t.episode_id;
 INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES(t.episode_id,t.id,'studio_frozen_project',p_frozen->>'relative_path',p_frozen->>'sha256',(p_frozen->>'file_size')::bigint);
 RETURN t;
END $$;
REVOKE ALL ON FUNCTION local_identity.scope_input_studio_task(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.scope_input_studio_task(uuid,text,jsonb) TO loop_owner;
