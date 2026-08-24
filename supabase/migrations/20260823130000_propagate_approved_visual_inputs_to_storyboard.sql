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
    visual_inputs := visual_inputs || coalesce((
      select jsonb_agg(input_artifact)
      from jsonb_array_elements(candidate.visual_context -> 'input_artifacts') input_artifact
      where input_artifact ->> 'artifactType' <> 'main_script'
        and not exists (
          select 1 from jsonb_array_elements(visual_inputs) existing
          where existing ->> 'relativePath' = input_artifact ->> 'relativePath'
            and existing ->> 'sha256' = input_artifact ->> 'sha256'
        )
    ), '[]'::jsonb);
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
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'visual_approved', 'storyboard_draft', 'Orchestrator froze the storyboard Adapter, Harness, approved visual asset manifest, and approved visual inputs.', null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'storyboard_task_created', jsonb_build_object('task_id', created_task.id, 'visual_review_package_id', candidate.visual_review_package_id, 'script_revision_id', candidate.script_revision_id, 'harness_id', selected_harness.id), null);
    return next created_task;
  end loop;
end;
$$;

update public.tasks task
set status = 'superseded'::public.task_status,
    budget_limit_cents = 0,
    completed_at = coalesce(completed_at, now()),
    input_snapshot = input_snapshot || jsonb_build_object('superseded_reason', 'Storyboard task omitted approved visual input artifacts.', 'superseded_at', now()),
    last_result = coalesce(last_result, '{}'::jsonb) || jsonb_build_object('status', 'superseded', 'nextStep', 'A replacement storyboard task will freeze the approved visual inputs.')
where task.task_type = 'draft_storyboard'
  and task.status = 'ready'::public.task_status
  and task.attempt > 0
  and task.last_result #>> '{retry,reason}' = '分镜镜头引用了未冻结输入。';

update public.episodes episode
set stage = 'visual_approved', updated_at = now()
where episode.stage = 'storyboard_draft'
  and exists (
    select 1 from public.tasks task
    where task.episode_id = episode.id
      and task.task_type = 'draft_storyboard'
      and task.status = 'superseded'::public.task_status
      and task.input_snapshot ->> 'superseded_reason' = 'Storyboard task omitted approved visual input artifacts.'
  )
  and not exists (
    select 1 from public.tasks task
    where task.episode_id = episode.id
      and task.task_type = 'draft_storyboard'
      and task.status in ('ready'::public.task_status, 'running'::public.task_status)
  );

revoke all on function public.orchestrate_storyboard_tasks() from public, anon, authenticated;
grant execute on function public.orchestrate_storyboard_tasks() to service_role;
