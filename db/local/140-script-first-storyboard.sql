-- A planning task can begin with the confirmed script alone.
DO $migration$
DECLARE definition text;
 guard constant text := ' IF jsonb_array_length(inputs)<2 THEN RAISE EXCEPTION ''Add visual references before running preparation planning'' USING ERRCODE=''22023''; END IF;';
 insertion constant text := ' INSERT INTO public.tasks(episode_id,task_type,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version)';
 directory_snapshot constant text := '
 SELECT snapshot||jsonb_build_object(
  ''native_episode_relative_path'',location.directory_relative_path,
  ''native_episode_directory_identity'',jsonb_build_object(''deviceId'',location.directory_device_id,''inodeId'',location.directory_inode_id)
 ) INTO STRICT snapshot FROM local_identity.episode_storage_location(e.id) location;
';
BEGIN
 definition:=pg_get_functiondef('local_identity.queue_workspace_planning(uuid,uuid,uuid)'::regprocedure);
 IF strpos(definition,guard)=0 OR strpos(definition,insertion)=0 THEN RAISE EXCEPTION 'Planning visual input guard changed'; END IF;
 EXECUTE replace(replace(definition,guard,''),insertion,directory_snapshot||insertion);
END $migration$;

-- Keep visual provenance mandatory for older flows and tasks with visual inputs.
DO $migration$
DECLARE definition text;
 guard constant text := $guard$
    if not exists (
      select 1
      from jsonb_array_elements(new.input_snapshot -> 'input_artifacts') frozen_input
      join jsonb_array_elements(storyboard_shot -> 'inputBasis') input_basis
        on input_basis ->> 'relativePath' = frozen_input ->> 'relativePath'
       and input_basis ->> 'sha256' = frozen_input ->> 'sha256'
      where frozen_input ->> 'artifactType' <> 'main_script'
    ) then
$guard$;
BEGIN
 definition:=pg_get_functiondef('public.create_storyboard_review_package()'::regprocedure);
 IF strpos(definition,guard)=0 THEN RAISE EXCEPTION 'Storyboard review visual input guard changed'; END IF;
 EXECUTE replace(definition,guard,replace(guard,'    if not exists (',$condition$    if (
      new.input_snapshot->'workspace_preparation' is null or exists (
        select 1 from jsonb_array_elements(new.input_snapshot->'input_artifacts') frozen_input
        where frozen_input->>'artifactType' <> 'main_script'
      )
    ) and not exists ($condition$));
END $migration$;
