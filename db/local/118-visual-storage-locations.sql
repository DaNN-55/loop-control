-- New production tasks freeze the persisted account-relative directory. Historical
-- tasks keep their original namespace and inputs; this does not activate layout2.
CREATE OR REPLACE FUNCTION local_identity.namespace_native_task_output() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prefix text; base text; path text; field text; location record;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'ready' OR NEW.attempt<>0
   OR NEW.task_type NOT IN ('prepare_visual_brief','draft_storyboard','draft_storyboard_revision','generate_narration','generate_a_roll','generate_b_roll','generate_soundtrack','extract_embedded_audio','align_shot_captions','generate_shot_sync_preview','generate_review_render','generate_final_render')
   OR NOT EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=NEW.episode_id AND e.enabled) THEN RETURN NEW; END IF;
  SELECT * INTO STRICT location FROM local_identity.episode_storage_location(NEW.episode_id);
  NEW.input_snapshot:=NEW.input_snapshot||jsonb_build_object('native_output_namespace',NEW.id::text,'native_episode_relative_path',location.directory_relative_path,'native_episode_directory_identity',jsonb_build_object('deviceId',location.directory_device_id,'inodeId',location.directory_inode_id));
 ELSE
  IF OLD.input_snapshot->>'native_output_namespace' IS DISTINCT FROM OLD.id::text THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.task_type IS DISTINCT FROM OLD.task_type OR NEW.episode_id IS DISTINCT FROM OLD.episode_id OR NEW.input_snapshot->>'native_output_namespace' IS DISTINCT FROM OLD.id::text OR NEW.input_snapshot->'native_episode_relative_path' IS DISTINCT FROM OLD.input_snapshot->'native_episode_relative_path' OR NEW.input_snapshot->'native_episode_directory_identity' IS DISTINCT FROM OLD.input_snapshot->'native_episode_directory_identity' THEN RAISE EXCEPTION 'Native output identity is immutable' USING ERRCODE='22023'; END IF;
  IF NEW.attempt<>0 OR OLD.attempt<>0 THEN
   IF NEW.input_snapshot#>'{output}' IS DISTINCT FROM OLD.input_snapshot#>'{output}' OR NEW.input_snapshot#>'{review_render,project_relative_path}' IS DISTINCT FROM OLD.input_snapshot#>'{review_render,project_relative_path}' OR NEW.input_snapshot#>'{final_render,project_relative_path}' IS DISTINCT FROM OLD.input_snapshot#>'{final_render,project_relative_path}' THEN RAISE EXCEPTION 'Claimed native output is immutable' USING ERRCODE='22023'; END IF;
   RETURN NEW;
  END IF;
 END IF;
 base:=coalesce(NEW.input_snapshot->>'native_episode_relative_path','episodes/'||NEW.episode_id::text);
 prefix:=format('%s/native-tasks/%s/',base,NEW.id);
 path:=NEW.input_snapshot#>>'{output,relative_path}';
 IF path IS NULL OR (left(path,length(base)+1)<>base||'/' AND left(path,length('episodes/'||NEW.episode_id::text)+1)<>'episodes/'||NEW.episode_id::text||'/') OR path ~ '(^|/)\.\.(/|$)' OR path ~ E'\\\\' OR path ~ '/$' THEN RAISE EXCEPTION 'Native output path is invalid' USING ERRCODE='22023'; END IF;
 NEW.input_snapshot:=jsonb_set(NEW.input_snapshot,'{output,relative_path}',to_jsonb(prefix||regexp_replace(path,'^.*/','')));
 FOREACH field IN ARRAY ARRAY['review_render','final_render'] LOOP
  path:=NEW.input_snapshot#>>ARRAY[field,'project_relative_path'];
  IF path IS NOT NULL THEN
   IF (left(path,length(base)+1)<>base||'/' AND left(path,length('episodes/'||NEW.episode_id::text)+1)<>'episodes/'||NEW.episode_id::text||'/') OR path ~ '(^|/)\.\.(/|$)' OR path ~ E'\\\\' OR path ~ '/$' THEN RAISE EXCEPTION 'Native output project path is invalid' USING ERRCODE='22023'; END IF;
   NEW.input_snapshot:=jsonb_set(NEW.input_snapshot,ARRAY[field,'project_relative_path'],to_jsonb(prefix||regexp_replace(path,'^.*/','')));
  END IF;
 END LOOP;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION local_identity.native_output_authority(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_paths text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected public.tasks; run public.task_runs; path text; prefix text; base text; allowed text[]; indexed jsonb; conflicts jsonb;
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
 base:=coalesce(selected.input_snapshot->>'native_episode_relative_path','episodes/'||selected.episode_id::text);
 prefix:=format('%s/native-tasks/%s/',base,selected.id);
 allowed:=ARRAY[selected.input_snapshot#>>'{output,relative_path}',format('%s/card-video/%s/project.json',base,selected.id)];
 FOREACH path IN ARRAY ARRAY[selected.input_snapshot#>>'{review_render,project_relative_path}',selected.input_snapshot#>>'{final_render,project_relative_path}'] LOOP
  IF path IS NOT NULL THEN allowed:=allowed||ARRAY[path,regexp_replace(path,'[^/]+$','project.json'),regexp_replace(path,'[^/]+$','openchatcut-runtime.json'),regexp_replace(path,'[^/]+$','qc-report.json'),regexp_replace(path,'[^/]+$','final-qc-report.json')]; END IF;
 END LOOP;
 FOR path IN SELECT DISTINCT value FROM unnest(p_paths) value ORDER BY value LOOP
  IF path IS NULL OR left(path,length(base)+1)<>base||'/' OR path ~ '(^|/)\.\.(/|$)' OR path ~ E'\\\\' OR path ~ '/$' THEN RAISE EXCEPTION 'Publication path outside native Episode' USING ERRCODE='22023'; END IF;
  IF left(path,length(prefix))<>prefix AND NOT coalesce(path=ANY(allowed),false) THEN RAISE EXCEPTION 'Publication path is not frozen for this task' USING ERRCODE='42501'; END IF;
  IF selected.input_snapshot->>'native_output_namespace'=selected.id::text AND left(path,length(prefix))<>prefix AND path<>format('%s/card-video/%s/project.json',base,selected.id) THEN RAISE EXCEPTION 'New native output must use its task namespace' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('native-output:'||path,0));
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('artifactType',a.artifact_type,'relativePath',a.relative_path,'sha256',a.sha256,'fileSize',a.file_size)),'[]'::jsonb) INTO indexed FROM public.artifacts a WHERE a.producer_task_id=p_task_id AND a.relative_path=ANY(p_paths);
 SELECT coalesce(jsonb_agg(jsonb_build_object('artifactType',a.artifact_type,'relativePath',a.relative_path,'sha256',a.sha256,'fileSize',a.file_size)),'[]'::jsonb) INTO conflicts FROM public.artifacts a WHERE a.producer_task_id IS DISTINCT FROM p_task_id AND a.relative_path=ANY(p_paths);
 RETURN jsonb_build_object('output',selected.input_snapshot->'output','reviewProjectPath',selected.input_snapshot#>'{review_render,project_relative_path}','finalProjectPath',selected.input_snapshot#>'{final_render,project_relative_path}','status',selected.status,'inputHash',md5(selected.input_snapshot::text),'result',selected.last_result,'artifacts',indexed,'conflicts',conflicts);
END $$;
REVOKE ALL ON FUNCTION local_identity.native_output_authority(uuid,integer,uuid,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.native_output_authority(uuid,integer,uuid,text[]) TO loop_worker;


CREATE OR REPLACE FUNCTION local_identity.namespace_workspace_image_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE location record;
BEGIN
 IF NEW.task_type<>'generate_static_visual' THEN RETURN NEW;END IF;
 IF NEW.provider<>'openai' OR NEW.model<>'gpt-image-2' OR NEW.status<>'ready' OR NEW.attempt<>0 OR NOT EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates v WHERE v.id::text=NEW.input_snapshot->>'workspace_image_request_id' AND v.episode_id=NEW.episode_id AND v.request_snapshot->>'kind'='image') THEN RAISE EXCEPTION 'Explicit workspace image request required';END IF;
 SELECT * INTO STRICT location FROM local_identity.episode_storage_location(NEW.episode_id);
 NEW.input_snapshot:=jsonb_set(NEW.input_snapshot||jsonb_build_object('native_output_namespace',NEW.id::text,'native_episode_relative_path',location.directory_relative_path,'native_episode_directory_identity',jsonb_build_object('deviceId',location.directory_device_id,'inodeId',location.directory_inode_id)),'{output,relative_path}',to_jsonb(format('%s/native-tasks/%s/image.png',location.directory_relative_path,NEW.id)));
 RETURN NEW;
END $$;

DO $adapt$
DECLARE d text;changed text;prefix text:='(SELECT directory_relative_path FROM local_identity.episode_storage_location(p_episode_id))';
BEGIN
 d:=pg_get_functiondef('public.import_production_material(uuid,text,text,text,text,text,text,bigint,boolean,text)'::regprocedure);
 changed:=replace(d,
  'p_storage_path !~ (''^episodes/'' || p_episode_id::text || ''/materials/[0-9a-f]{64}-[^/]+$'')',
  '(left(p_storage_path,length('||prefix||')+11) IS DISTINCT FROM '||prefix||'||''/materials/'' OR substring(p_storage_path from length('||prefix||')+12) !~ ''^[0-9a-f]{64}-[^/]+$'')');
 IF changed<>d THEN EXECUTE changed;
 ELSIF position('episode_storage_location(p_episode_id)' IN d)=0 THEN RAISE EXCEPTION 'Material path guard contract changed';END IF;
END $adapt$;
