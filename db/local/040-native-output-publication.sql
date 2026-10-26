-- #144: only newly inserted native tasks gain private output namespaces.
-- Historical tasks and their frozen inputs are never rewritten by this migration.
CREATE FUNCTION local_identity.namespace_native_task_output() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prefix text; path text; field text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT local_identity.input_task_allowed(NEW.episode_id,NEW.task_type) OR NEW.status<>'ready' OR NEW.attempt<>0 THEN RETURN NEW; END IF;
  NEW.input_snapshot:=NEW.input_snapshot||jsonb_build_object('native_output_namespace',NEW.id::text);
 ELSE
  IF OLD.input_snapshot->>'native_output_namespace' IS DISTINCT FROM OLD.id::text THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.task_type IS DISTINCT FROM OLD.task_type OR NEW.episode_id IS DISTINCT FROM OLD.episode_id OR NEW.input_snapshot->>'native_output_namespace' IS DISTINCT FROM OLD.id::text THEN RAISE EXCEPTION 'Native output identity is immutable' USING ERRCODE='22023'; END IF;
  IF NEW.attempt<>0 OR OLD.attempt<>0 THEN
   IF NEW.input_snapshot#>'{output}' IS DISTINCT FROM OLD.input_snapshot#>'{output}' OR NEW.input_snapshot#>'{review_render,project_relative_path}' IS DISTINCT FROM OLD.input_snapshot#>'{review_render,project_relative_path}' OR NEW.input_snapshot#>'{final_render,project_relative_path}' IS DISTINCT FROM OLD.input_snapshot#>'{final_render,project_relative_path}' THEN RAISE EXCEPTION 'Claimed native output is immutable' USING ERRCODE='22023'; END IF;
   RETURN NEW;
  END IF;
 END IF;
 prefix:=format('episodes/%s/native-tasks/%s/',NEW.episode_id,NEW.id);
 path:=NEW.input_snapshot#>>'{output,relative_path}';
 IF path IS NULL OR path !~ ('^episodes/'||NEW.episode_id::text||'/') OR path ~ '(^|/)\.\.(/|$)' OR path ~ E'\\\\' OR path ~ '/$' THEN RAISE EXCEPTION 'Native output path is invalid' USING ERRCODE='22023'; END IF;
 NEW.input_snapshot:=jsonb_set(NEW.input_snapshot,'{output,relative_path}',to_jsonb(prefix||regexp_replace(path,'^.*/','')));
 FOREACH field IN ARRAY ARRAY['review_render','final_render'] LOOP
  path:=NEW.input_snapshot#>>ARRAY[field,'project_relative_path'];
  IF path IS NOT NULL THEN
   IF path !~ ('^episodes/'||NEW.episode_id::text||'/') OR path ~ '(^|/)\.\.(/|$)' OR path ~ E'\\\\' OR path ~ '/$' THEN RAISE EXCEPTION 'Native output project path is invalid' USING ERRCODE='22023'; END IF;
   NEW.input_snapshot:=jsonb_set(NEW.input_snapshot,ARRAY[field,'project_relative_path'],to_jsonb(prefix||regexp_replace(path,'^.*/','')));
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
-- Run after the existing insert-time snapshot enrichment triggers.
CREATE TRIGGER zz_namespace_native_task_output BEFORE INSERT OR UPDATE OF input_snapshot ON public.tasks
FOR EACH ROW EXECUTE FUNCTION local_identity.namespace_native_task_output();
REVOKE ALL ON FUNCTION local_identity.namespace_native_task_output() FROM PUBLIC;

-- Bounded read authority. The task and sorted path locks remain held by the
-- caller's transaction while it publishes or explicitly reconciles local files.
-- No role receives raw task/artifact table access or an unfenced result writer.
CREATE FUNCTION local_identity.native_output_authority(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_paths text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected public.tasks; run public.task_runs; path text; prefix text; allowed text[]; indexed jsonb; conflicts jsonb;
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO selected FROM public.tasks WHERE id=p_task_id FOR UPDATE;
 IF NOT FOUND OR selected.invalidated_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=selected.episode_id) OR selected.attempt<>p_attempt+1 OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Current native task identity required' USING ERRCODE='42501'; END IF;
 SELECT * INTO run FROM public.task_runs WHERE task_id=p_task_id AND attempt=p_attempt AND lease_token=p_lease_token;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current native attempt identity required' USING ERRCODE='42501'; END IF;
 IF selected.status='running' THEN
  IF NOT local_identity.input_task_allowed(selected.episode_id,selected.task_type) THEN RAISE EXCEPTION 'Native task disabled' USING ERRCODE='42501'; END IF;
  PERFORM public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
 ELSIF selected.status<>'completed' OR run.status<>'completed' OR selected.last_result->>'status' IS DISTINCT FROM 'completed' OR run.result IS DISTINCT FROM selected.last_result THEN RAISE EXCEPTION 'Native task result is not recoverable' USING ERRCODE='42501'; END IF;
 IF p_paths IS NULL OR cardinality(p_paths)=0 OR cardinality(p_paths)>256 THEN RAISE EXCEPTION 'Publication paths required' USING ERRCODE='22023'; END IF;
 prefix:=format('episodes/%s/native-tasks/%s/',selected.episode_id,selected.id);
 allowed:=ARRAY[selected.input_snapshot#>>'{output,relative_path}',format('episodes/%s/card-video/%s/project.json',selected.episode_id,selected.id)];
 FOREACH path IN ARRAY ARRAY[selected.input_snapshot#>>'{review_render,project_relative_path}',selected.input_snapshot#>>'{final_render,project_relative_path}'] LOOP
  IF path IS NOT NULL THEN allowed:=allowed||ARRAY[path,regexp_replace(path,'[^/]+$','project.json'),regexp_replace(path,'[^/]+$','openchatcut-runtime.json'),regexp_replace(path,'[^/]+$','qc-report.json'),regexp_replace(path,'[^/]+$','final-qc-report.json')]; END IF;
 END LOOP;
 FOR path IN SELECT DISTINCT value FROM unnest(p_paths) value ORDER BY value LOOP
  IF path IS NULL OR path !~ ('^episodes/'||selected.episode_id::text||'/') OR path ~ '(^|/)\.\.(/|$)' OR path ~ E'\\\\' OR path ~ '/$' THEN RAISE EXCEPTION 'Publication path outside native Episode' USING ERRCODE='22023'; END IF;
  IF left(path,length(prefix))<>prefix AND NOT coalesce(path=ANY(allowed),false) THEN RAISE EXCEPTION 'Publication path is not frozen for this task' USING ERRCODE='42501'; END IF;
  IF selected.input_snapshot->>'native_output_namespace'=selected.id::text AND left(path,length(prefix))<>prefix AND path<>format('episodes/%s/card-video/%s/project.json',selected.episode_id,selected.id) THEN RAISE EXCEPTION 'New native output must use its task namespace' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('native-output:'||path,0));
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('artifactType',a.artifact_type,'relativePath',a.relative_path,'sha256',a.sha256,'fileSize',a.file_size)),'[]'::jsonb) INTO indexed FROM public.artifacts a WHERE a.producer_task_id=p_task_id AND a.relative_path=ANY(p_paths);
 SELECT coalesce(jsonb_agg(jsonb_build_object('artifactType',a.artifact_type,'relativePath',a.relative_path,'sha256',a.sha256,'fileSize',a.file_size)),'[]'::jsonb) INTO conflicts FROM public.artifacts a WHERE a.producer_task_id IS DISTINCT FROM p_task_id AND a.relative_path=ANY(p_paths);
 RETURN jsonb_build_object('output',selected.input_snapshot->'output','reviewProjectPath',selected.input_snapshot#>'{review_render,project_relative_path}','finalProjectPath',selected.input_snapshot#>'{final_render,project_relative_path}','status',selected.status,'inputHash',md5(selected.input_snapshot::text),'result',selected.last_result,'artifacts',indexed,'conflicts',conflicts);
END $$;
REVOKE ALL ON FUNCTION local_identity.native_output_authority(uuid,integer,uuid,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.native_output_authority(uuid,integer,uuid,text[]) TO loop_worker;

-- Preserve the original native command dispatcher and lease checks. A completed
-- report must register the frozen primary even when a caller bypasses the CLI.
CREATE OR REPLACE FUNCTION local_identity.input_worker_call(p_name text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected_task_id uuid:=(p_args->>'p_task_id')::uuid; frozen jsonb; paths text[]; authority jsonb;
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=selected_task_id AND local_identity.input_task_allowed(t.episode_id,t.task_type)) THEN RAISE EXCEPTION 'Managed input Worker task required' USING ERRCODE='42501'; END IF;
 IF p_name='refresh_worker_task_lease' THEN PERFORM public.refresh_worker_task_lease(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid);
 ELSIF p_name='report_worker_progress' THEN PERFORM public.report_worker_progress(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid,p_args->'p_progress');
 ELSIF p_name='report_worker_result' THEN
  IF p_args#>>'{p_result,status}'='completed' THEN
   PERFORM public.assert_worker_lease(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid);
   SELECT input_snapshot->'output' INTO frozen FROM public.tasks WHERE id=selected_task_id;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_args#>'{p_result,artifacts}') a WHERE a->>'artifactType'=frozen#>>'{required_artifact_types,0}' AND a->>'relativePath'=frozen->>'relative_path') THEN RAISE EXCEPTION 'Completed result requires the frozen primary path' USING ERRCODE='22023'; END IF;
   SELECT array_agg(a->>'relativePath') INTO paths FROM jsonb_array_elements(p_args#>'{p_result,artifacts}') a;
   authority:=local_identity.native_output_authority(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid,paths);
   IF jsonb_array_length(authority->'conflicts')>0 THEN RAISE EXCEPTION 'Output path is indexed by another task' USING ERRCODE='22023'; END IF;
  END IF;
  PERFORM public.report_worker_result(selected_task_id,(p_args->>'p_attempt')::integer,p_args->'p_result',(p_args->>'p_lease_token')::uuid);
 ELSE RAISE EXCEPTION 'Unsupported Worker command' USING ERRCODE='22023'; END IF;
 RETURN 'null'::jsonb;
END $$;
