create or replace function public.orchestrate_provided_script_tasks()
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  created_task public.tasks;
  allowed_tools jsonb;
  budget_limit integer;
  executor_model text;
  prompt_version text;
  external_visual_inputs jsonb;
  image_generation jsonb;
  task_snapshot jsonb;
begin
  for candidate in
    select
      episode.*,
      blueprint.policy,
      script_revision.id as script_revision_id,
      script_revision.storage_path as script_storage_path,
      script_revision.sha256 as script_sha256,
      script_revision.file_size as script_file_size,
      script_revision.mime_type as script_mime_type,
      series_version.id as frozen_series_version_id,
      series_version.version as frozen_series_version,
      series_version.rules as frozen_series_rules
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join public.production_material_revisions script_revision
      on script_revision.id = episode.main_script_revision_id
      and script_revision.episode_id = episode.id
      and script_revision.is_main_script
    left join public.series_versions series_version
      on series_version.id = episode.series_version_id
      and series_version.account_id = episode.account_id
    where episode.stage = 'script_approved'
      and not exists (
        select 1
        from public.tasks task
        where task.episode_id = episode.id and task.task_type = 'prepare_visual_brief'
      )
    order by episode.updated_at, episode.id
    for update of episode skip locked
  loop
    if jsonb_typeof(candidate.policy -> 'allowed_tools') <> 'array'
      or jsonb_array_length(candidate.policy -> 'allowed_tools') = 0
      or exists (
        select 1
        from jsonb_array_elements(candidate.policy -> 'allowed_tools') tool
        where jsonb_typeof(tool) <> 'string' or coalesce(btrim(tool #>> '{}'), '') = ''
      ) then
      raise exception 'Blueprint % has invalid allowed_tools', candidate.blueprint_version_id using errcode = '22023';
    end if;
    if jsonb_typeof(candidate.policy #> '{budgets,visual_planning_cents}') <> 'number'
      or candidate.policy #>> '{budgets,visual_planning_cents}' !~ '^[0-9]+$' then
      raise exception 'Blueprint % has invalid visual planning budget', candidate.blueprint_version_id using errcode = '22023';
    end if;
    if candidate.policy #>> '{executors,visual_planning,provider}' <> 'codex'
      or coalesce(btrim(candidate.policy #>> '{executors,visual_planning,model}'), '') = ''
      or coalesce(btrim(candidate.policy #>> '{executors,visual_planning,prompt_version}'), '') = '' then
      raise exception 'Blueprint % has invalid visual planning executor', candidate.blueprint_version_id using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'artifactType', 'external_visual_input',
      'relativePath', material.storage_path,
      'sha256', material.sha256,
      'fileSize', material.file_size
    ) order by material.created_at, material.id), '[]'::jsonb)
    into external_visual_inputs
    from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.episode_id = candidate.id
      and material.material_purpose = 'visual_reference'
      and material.material_type in ('image', 'video', 'reference');

    image_generation := case
      when coalesce(btrim(candidate.policy #>> '{static_visual,executor,provider}'), '') <> ''
       and coalesce(btrim(candidate.policy #>> '{static_visual,executor,adapter}'), '') <> ''
      then jsonb_build_object(
        'provider', candidate.policy #>> '{static_visual,executor,provider}',
        'adapter', candidate.policy #>> '{static_visual,executor,adapter}'
      )
      else null
    end;
    allowed_tools := candidate.policy -> 'allowed_tools';
    budget_limit := (candidate.policy #>> '{budgets,visual_planning_cents}')::integer;
    executor_model := candidate.policy #>> '{executors,visual_planning,model}';
    prompt_version := candidate.policy #>> '{executors,visual_planning,prompt_version}';
    task_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'capability', 'visual_planning',
      'script_revision', jsonb_build_object(
        'id', candidate.script_revision_id,
        'storage_path', candidate.script_storage_path,
        'sha256', candidate.script_sha256,
        'file_size', candidate.script_file_size,
        'mime_type', candidate.script_mime_type
      ),
      'series_baseline', case when candidate.frozen_series_version_id is null then null else jsonb_build_object(
        'version_id', candidate.frozen_series_version_id,
        'version', candidate.frozen_series_version,
        'rules', candidate.frozen_series_rules
      ) end,
      'visual_assets', jsonb_strip_nulls(jsonb_build_object(
        'external_inputs', external_visual_inputs,
        'image_generation', image_generation
      )),
      'executor', jsonb_build_object(
        'provider', 'codex',
        'model', executor_model,
        'prompt_version', prompt_version
      ),
      'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', 2),
      'allowed_tools', allowed_tools,
      'output', jsonb_build_object(
        'required_artifact_types', jsonb_build_array('visual_asset_manifest'),
        'content_type', 'text/markdown',
        'relative_path', format('episodes/%s/visual-assets-v1.md', candidate.id),
        'review_stage', 'visual_review'
      ),
      'input_artifacts', jsonb_build_array(jsonb_build_object(
        'artifactType', 'main_script',
        'relativePath', candidate.script_storage_path,
        'sha256', candidate.script_sha256,
        'fileSize', candidate.script_file_size
      )) || external_visual_inputs
    ));
    task_snapshot := task_snapshot || jsonb_build_object('prompt_context', public.build_prompt_context(candidate.id, task_snapshot));

    insert into public.tasks (
      episode_id, task_type, status, input_snapshot, budget_limit_cents,
      max_attempts, provider, model, prompt_version
    ) values (
      candidate.id,
      'prepare_visual_brief',
      'ready',
      task_snapshot,
      budget_limit,
      2,
      'codex',
      executor_model,
      prompt_version
    ) returning * into created_task;

    update public.episodes set stage = 'visual_draft', updated_at = now() where id = candidate.id;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
    values (candidate.id, 'script_approved', 'visual_draft', 'Orchestrator froze visual asset preparation from the approved script and imported visual inputs.', null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (
      candidate.account_id,
      candidate.id,
      'visual_asset_preparation_task_created',
      jsonb_build_object('task_id', created_task.id, 'script_revision_id', candidate.script_revision_id, 'external_visual_inputs', jsonb_array_length(external_visual_inputs)),
      null
    );
    return next created_task;
  end loop;
end;
$$;

create or replace function public.create_visual_review_package()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  produced_artifact public.artifacts;
  completed_run public.task_runs;
  required_artifact_type text;
  primary_artifact_type text;
  next_revision integer;
  created_package public.review_packages;
begin
  if new.task_type <> 'prepare_visual_brief' or new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  select * into current_episode from public.episodes where id = new.episode_id for update;
  if current_episode.stage <> 'visual_draft' then
    raise exception 'Visual asset preparation can only complete from visual_draft' using errcode = '22023';
  end if;
  select * into completed_run
  from public.task_runs
  where task_id = new.id and attempt = new.attempt - 1 and status = 'completed';
  if not found then
    raise exception 'Completed visual asset preparation task run is missing' using errcode = '22023';
  end if;
  if jsonb_typeof(new.input_snapshot #> '{output,required_artifact_types}') <> 'array' then
    raise exception 'Visual asset preparation task has invalid required artifact types' using errcode = '22023';
  end if;
  for required_artifact_type in
    select jsonb_array_elements_text(new.input_snapshot #> '{output,required_artifact_types}')
  loop
    if coalesce(btrim(required_artifact_type), '') = '' then
      raise exception 'Visual asset preparation task has an empty required artifact type' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.artifacts artifact
      join lateral jsonb_array_elements(completed_run.result -> 'artifacts') result_artifact on true
      where artifact.producer_task_id = new.id
        and artifact.artifact_type = required_artifact_type
        and result_artifact ->> 'artifactType' = artifact.artifact_type
        and result_artifact ->> 'relativePath' = artifact.relative_path
        and result_artifact ->> 'sha256' = artifact.sha256
        and (result_artifact ->> 'fileSize')::bigint = artifact.file_size
    ) then
      raise exception 'Visual asset preparation task is missing required % artifact revision', required_artifact_type using errcode = '22023';
    end if;
  end loop;

  primary_artifact_type := case
    when new.input_snapshot #> '{output,required_artifact_types}' @> jsonb_build_array('visual_asset_manifest') then 'visual_asset_manifest'
    else 'visual_brief'
  end;
  select * into produced_artifact
  from public.artifacts
  where producer_task_id = new.id
    and artifact_type = primary_artifact_type
    and relative_path = new.input_snapshot #>> '{output,relative_path}';
  if not found then
    raise exception 'Visual asset preparation task is missing its frozen % artifact revision', primary_artifact_type using errcode = '22023';
  end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.review_packages
  where episode_id = new.episode_id and stage = 'visual_review';

  insert into public.review_packages (
    episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot
  ) values (
    new.episode_id,
    new.id,
    completed_run.id,
    produced_artifact.id,
    'visual_review',
    next_revision,
    new.input_snapshot || jsonb_build_object(
      'task_package', completed_run.task_package,
      'worker_result', completed_run.result,
      'artifact', jsonb_build_object(
        'id', produced_artifact.id,
        'relative_path', produced_artifact.relative_path,
        'sha256', produced_artifact.sha256,
        'file_size', produced_artifact.file_size
      ),
      'generated_artifacts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', artifact.id,
          'artifact_type', artifact.artifact_type,
          'relative_path', artifact.relative_path,
          'sha256', artifact.sha256,
          'file_size', artifact.file_size
        ) order by artifact.created_at, artifact.id)
        from public.artifacts artifact
        where artifact.producer_task_id = new.id
      ), '[]'::jsonb)
    )
  ) returning * into created_package;

  update public.episodes set stage = 'visual_review', updated_at = now() where id = new.episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (new.episode_id, 'visual_draft', 'visual_review', 'Worker submitted a frozen visual asset review package.', null);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    new.episode_id,
    'visual_review_package_created',
    jsonb_build_object(
      'review_package_id', created_package.id,
      'task_id', new.id,
      'artifact_id', produced_artifact.id,
      'revision_number', next_revision
    ),
    null
  );
  return new;
end;
$$;

create or replace function public.create_visual_revision_task_after_changes_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_package public.review_packages;
  previous_task public.tasks;
  created_task public.tasks;
  next_output_path text;
begin
  if new.stage <> 'visual_review' or new.decision <> 'changes_requested' then
    return new;
  end if;
  select * into previous_package
  from public.review_packages
  where episode_id = new.episode_id and stage = 'visual_review'
  order by revision_number desc
  limit 1;
  if not found then
    raise exception 'Visual review package is required before requesting changes' using errcode = '22023';
  end if;
  select * into previous_task from public.tasks where id = previous_package.task_id;
  next_output_path := case
    when previous_task.input_snapshot #> '{output,required_artifact_types}' @> jsonb_build_array('visual_asset_manifest')
    then format('episodes/%s/visual-assets-v%s.md', new.episode_id, previous_package.revision_number + 1)
    else format('episodes/%s/visual-brief-v%s.md', new.episode_id, previous_package.revision_number + 1)
  end;

  insert into public.tasks (
    episode_id, task_type, status, input_snapshot, budget_limit_cents,
    max_attempts, provider, model, prompt_version
  ) values (
    previous_task.episode_id,
    previous_task.task_type,
    'ready',
    jsonb_set(
      previous_task.input_snapshot || jsonb_build_object(
        'review_feedback', jsonb_build_object(
          'review_package_id', previous_package.id,
          'reason', new.reason,
          'actor_id', new.actor_id
        )
      ),
      '{output,relative_path}',
      to_jsonb(next_output_path)
    ),
    previous_task.budget_limit_cents,
    previous_task.max_attempts,
    previous_task.provider,
    previous_task.model,
    previous_task.prompt_version
  ) returning * into created_task;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  select
    episode.account_id,
    episode.id,
    'visual_revision_task_created',
    jsonb_build_object('task_id', created_task.id, 'review_package_id', previous_package.id, 'reason', new.reason),
    new.actor_id
  from public.episodes episode where episode.id = new.episode_id;
  return new;
end;
$$;

create or replace function public.orchestrate_storyboard_tasks()
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  created_task public.tasks;
  selected_harness public.prompt_versions;
  allowed_tools jsonb;
  budget_limit integer;
  adapter text;
  executor_model text;
  harness_id_text text;
  visual_inputs jsonb;
  task_snapshot jsonb;
begin
  for candidate in
    select episode.*, blueprint.policy, script_revision.id as script_revision_id, script_revision.storage_path as script_storage_path, script_revision.sha256 as script_sha256, script_revision.file_size as script_file_size, visual_package.id as visual_review_package_id, visual_package.revision_number as visual_review_revision_number, visual_package.task_id as visual_task_id, visual_package.context_snapshot -> 'series_baseline' as frozen_series_baseline, visual_package.context_snapshot as visual_context
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join public.production_material_revisions script_revision on script_revision.id = episode.main_script_revision_id and script_revision.episode_id = episode.id and script_revision.is_main_script
    join lateral (
      select review_package.* from public.review_packages review_package join public.approvals approval on approval.review_package_id = review_package.id and approval.stage = 'visual_approved' and approval.decision = 'approved'
      where review_package.episode_id = episode.id and review_package.stage = 'visual_review' order by review_package.revision_number desc limit 1
    ) visual_package on true
    where episode.stage = 'visual_approved' and not exists (select 1 from public.tasks task where task.episode_id = episode.id and task.task_type = 'draft_storyboard')
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    if jsonb_typeof(candidate.policy -> 'allowed_tools') <> 'array' or jsonb_array_length(candidate.policy -> 'allowed_tools') = 0 or exists (select 1 from jsonb_array_elements(candidate.policy -> 'allowed_tools') tool where jsonb_typeof(tool) <> 'string' or coalesce(btrim(tool #>> '{}'), '') = '') then raise exception 'Blueprint % has invalid allowed_tools', candidate.blueprint_version_id using errcode = '22023'; end if;
    if jsonb_typeof(candidate.policy #> '{budgets,storyboard_planning_cents}') <> 'number' or candidate.policy #>> '{budgets,storyboard_planning_cents}' !~ '^[0-9]+$' then raise exception 'Blueprint % has invalid storyboard planning budget', candidate.blueprint_version_id using errcode = '22023'; end if;
    adapter := nullif(btrim(candidate.policy #>> '{executors,storyboard_planning,adapter}'), '');
    executor_model := nullif(btrim(candidate.policy #>> '{executors,storyboard_planning,model}'), '');
    harness_id_text := nullif(btrim(candidate.policy #>> '{executors,storyboard_planning,harness_id}'), '');
    if adapter <> 'codex' or executor_model is null or harness_id_text is null or harness_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Blueprint % must select a registered Codex storyboard Adapter, model, and Harness', candidate.blueprint_version_id using errcode = '22023'; end if;
    select harness.* into selected_harness from public.prompt_versions harness where harness.id = harness_id_text::uuid and harness.account_id = candidate.account_id and harness.capability = 'storyboard_planning' and harness.is_active;
    if not found or coalesce(btrim(selected_harness.instructions), '') = '' then raise exception 'Blueprint % must select an active storyboard Harness from its account', candidate.blueprint_version_id using errcode = '22023'; end if;

    visual_inputs := case
      when candidate.visual_context #> '{output,required_artifact_types}' @> jsonb_build_array('visual_asset_manifest')
      then coalesce((select jsonb_agg(jsonb_build_object('artifactType', artifact.artifact_type, 'relativePath', artifact.relative_path, 'sha256', artifact.sha256, 'fileSize', artifact.file_size) order by artifact.created_at, artifact.id) from public.artifacts artifact where artifact.producer_task_id = candidate.visual_task_id and artifact.artifact_type = 'visual_asset_manifest'), '[]'::jsonb)
      else coalesce((select jsonb_agg(jsonb_build_object('artifactType', artifact.artifact_type, 'relativePath', artifact.relative_path, 'sha256', artifact.sha256, 'fileSize', artifact.file_size) order by artifact.created_at, artifact.id) from public.artifacts artifact where artifact.producer_task_id = candidate.visual_task_id), '[]'::jsonb)
    end;
    if jsonb_array_length(visual_inputs) = 0 then raise exception 'Approved visual asset manifest is missing' using errcode = '22023'; end if;

    allowed_tools := candidate.policy -> 'allowed_tools';
    budget_limit := (candidate.policy #>> '{budgets,storyboard_planning_cents}')::integer;
    task_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'capability', 'storyboard_planning',
      'script_revision', jsonb_build_object('id', candidate.script_revision_id, 'storage_path', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'file_size', candidate.script_file_size),
      'series_baseline', candidate.frozen_series_baseline,
      'visual_review_package', jsonb_build_object('id', candidate.visual_review_package_id, 'revision_number', candidate.visual_review_revision_number),
      'harness', jsonb_build_object('id', selected_harness.id, 'version', selected_harness.version, 'content', selected_harness.instructions, 'content_hash', selected_harness.content_hash, 'adapter', 'codex', 'model', executor_model, 'prompt_version', selected_harness.slug),
      'executor', jsonb_build_object('provider', 'codex', 'adapter', 'codex', 'model', executor_model, 'prompt_version', selected_harness.slug),
      'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', 2),
      'allowed_tools', allowed_tools,
      'output', jsonb_build_object('required_artifact_types', jsonb_build_array('storyboard'), 'content_type', 'application/json', 'relative_path', format('episodes/%s/storyboard-v1.json', candidate.id), 'review_stage', 'storyboard_review'),
      'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'main_script', 'relativePath', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'fileSize', candidate.script_file_size)) || visual_inputs
    ));
    task_snapshot := task_snapshot || jsonb_build_object('prompt_context', public.build_prompt_context(candidate.id, task_snapshot));
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (candidate.id, 'draft_storyboard', 'ready', task_snapshot, budget_limit, 2, 'codex', executor_model, selected_harness.slug)
    returning * into created_task;
    update public.episodes set stage = 'storyboard_draft', updated_at = now() where id = candidate.id;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'visual_approved', 'storyboard_draft', 'Orchestrator froze the storyboard Adapter, Harness, and approved visual asset manifest.', null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'storyboard_task_created', jsonb_build_object('task_id', created_task.id, 'visual_review_package_id', candidate.visual_review_package_id, 'script_revision_id', candidate.script_revision_id, 'harness_id', selected_harness.id), null);
    return next created_task;
  end loop;
end;
$$;

revoke all on function public.orchestrate_provided_script_tasks() from public, anon, authenticated;
grant execute on function public.orchestrate_provided_script_tasks() to service_role;
revoke all on function public.create_visual_review_package() from public, anon, authenticated;
revoke all on function public.create_visual_revision_task_after_changes_requested() from public, anon, authenticated;
revoke all on function public.orchestrate_storyboard_tasks() from public, anon, authenticated;
grant execute on function public.orchestrate_storyboard_tasks() to service_role;
