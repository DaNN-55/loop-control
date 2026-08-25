-- Visual asset preparation is an internal Worker step. Account blueprints only
-- configure the static-visual media capability and the storyboard planner.
with referenced as (
  select
    blueprint.id as source_blueprint_id,
    blueprint.account_id,
    blueprint.policy,
    (select max(existing.version) from public.account_blueprint_versions existing where existing.account_id = blueprint.account_id) as current_max_version,
    row_number() over (partition by blueprint.account_id order by blueprint.version, blueprint.id) as snapshot_rank
  from public.account_blueprint_versions blueprint
  where not blueprint.is_snapshot
    and exists (select 1 from public.episodes episode where episode.blueprint_version_id = blueprint.id)
), inserted_snapshots as (
  insert into public.account_blueprint_versions (account_id, version, policy, is_active, archived_at, is_snapshot)
  select account_id, current_max_version + snapshot_rank, policy, false, now(), true
  from referenced
  returning id, account_id, version
)
update public.episodes episode
set blueprint_version_id = snapshot.id
from referenced
join inserted_snapshots snapshot
  on snapshot.account_id = referenced.account_id
 and snapshot.version = referenced.current_max_version + referenced.snapshot_rank
where episode.blueprint_version_id = referenced.source_blueprint_id;

update public.account_blueprint_versions blueprint
set policy = jsonb_set(
  jsonb_set(
    blueprint.policy,
    '{executors}',
    coalesce(blueprint.policy -> 'executors', '{}'::jsonb) - 'visual_planning',
    true
  ),
  '{budgets}',
  coalesce(blueprint.policy -> 'budgets', '{}'::jsonb) - 'visual_planning_cents',
  true
)
where not blueprint.is_snapshot;

create or replace function public.orchestrate_provided_script_tasks_for_episode(p_episode_id uuid)
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
  legacy_executor jsonb;
  external_visual_inputs jsonb;
  image_generation jsonb;
  task_snapshot jsonb;
  executor_model text := 'gpt-5.6-luna';
  prompt_version text := 'visual-preparation-v1';
  budget_limit integer := 0;
begin
  for candidate in
    select episode.*, blueprint.is_snapshot as blueprint_is_snapshot, blueprint.policy, script_revision.id as script_revision_id, script_revision.storage_path as script_storage_path, script_revision.sha256 as script_sha256, script_revision.file_size as script_file_size, script_revision.mime_type as script_mime_type, series_version.id as frozen_series_version_id, series_version.version as frozen_series_version, series_version.rules as frozen_series_rules
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join public.production_material_revisions script_revision on script_revision.id = episode.main_script_revision_id and script_revision.episode_id = episode.id and script_revision.is_main_script
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    where episode.id = p_episode_id
      and episode.stage = 'script_approved'
      and not exists (select 1 from public.tasks task where task.episode_id = episode.id and task.task_type = 'prepare_visual_brief')
    for update of episode skip locked
  loop
    if jsonb_typeof(candidate.policy -> 'allowed_tools') <> 'array' or jsonb_array_length(candidate.policy -> 'allowed_tools') = 0 or exists (select 1 from jsonb_array_elements(candidate.policy -> 'allowed_tools') tool where jsonb_typeof(tool) <> 'string' or coalesce(btrim(tool #>> '{}'), '') = '') then
      raise exception 'Blueprint % has invalid allowed_tools', candidate.blueprint_version_id using errcode = '22023';
    end if;

    -- Existing episodes retain their already-frozen visual planning Harness.
    legacy_executor := case when candidate.blueprint_is_snapshot then candidate.policy #> '{executors,visual_planning}' else null end;
    if jsonb_typeof(legacy_executor) = 'object'
      and legacy_executor ->> 'adapter' = 'codex'
      and coalesce(btrim(legacy_executor ->> 'model'), '') <> ''
      and coalesce(legacy_executor ->> 'harness_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select harness.* into selected_harness
      from public.prompt_versions harness
      where harness.id = (legacy_executor ->> 'harness_id')::uuid
        and harness.account_id = candidate.account_id
        and harness.capability = 'visual_planning'
        and harness.is_active;
      if found and coalesce(btrim(selected_harness.instructions), '') <> '' then
        executor_model := legacy_executor ->> 'model';
        prompt_version := selected_harness.slug;
        budget_limit := case when candidate.policy #>> '{budgets,visual_planning_cents}' ~ '^[0-9]+$' then (candidate.policy #>> '{budgets,visual_planning_cents}')::integer else 0 end;
      else
        selected_harness := null;
      end if;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('artifactType', 'external_visual_input', 'relativePath', material.storage_path, 'sha256', material.sha256, 'fileSize', material.file_size) order by material.created_at, material.id), '[]'::jsonb)
    into external_visual_inputs
    from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.episode_id = candidate.id and material.material_purpose = 'visual_reference' and material.material_type in ('image', 'video', 'reference');

    image_generation := case when coalesce(btrim(candidate.policy #>> '{static_visual,executor,provider}'), '') <> '' and coalesce(btrim(candidate.policy #>> '{static_visual,executor,adapter}'), '') <> '' then jsonb_build_object('provider', candidate.policy #>> '{static_visual,executor,provider}', 'adapter', candidate.policy #>> '{static_visual,executor,adapter}') else null end;
    allowed_tools := candidate.policy -> 'allowed_tools';
    task_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'capability', 'visual_planning',
      'execution_mode', case when selected_harness.id is null then 'worker_default' else 'legacy_frozen' end,
      'script_revision', jsonb_build_object('id', candidate.script_revision_id, 'storage_path', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'file_size', candidate.script_file_size, 'mime_type', candidate.script_mime_type),
      'series_baseline', case when candidate.frozen_series_version_id is null then null else jsonb_build_object('version_id', candidate.frozen_series_version_id, 'version', candidate.frozen_series_version, 'rules', candidate.frozen_series_rules) end,
      'visual_assets', jsonb_strip_nulls(jsonb_build_object('external_inputs', external_visual_inputs, 'image_generation', image_generation)),
      'harness', case when selected_harness.id is null then null else jsonb_build_object('id', selected_harness.id, 'version', selected_harness.version, 'content', selected_harness.instructions, 'content_hash', selected_harness.content_hash, 'adapter', 'codex', 'model', executor_model, 'prompt_version', prompt_version) end,
      'executor', jsonb_build_object('provider', 'codex', 'adapter', 'codex', 'model', executor_model, 'prompt_version', prompt_version),
      'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', 2),
      'allowed_tools', allowed_tools,
      'output', jsonb_build_object('required_artifact_types', jsonb_build_array('visual_asset_manifest'), 'content_type', 'text/markdown', 'relative_path', format('episodes/%s/visual-assets-v1.md', candidate.id), 'review_stage', 'visual_review'),
      'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'main_script', 'relativePath', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'fileSize', candidate.script_file_size)) || external_visual_inputs
    ));
    task_snapshot := task_snapshot || jsonb_build_object('prompt_context', public.build_prompt_context(candidate.id, task_snapshot));
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (candidate.id, 'prepare_visual_brief', 'ready', task_snapshot, budget_limit, 2, 'codex', executor_model, prompt_version)
    returning * into created_task;
    update public.episodes set stage = 'visual_draft', updated_at = now() where id = candidate.id;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'script_approved', 'visual_draft', 'Orchestrator froze visual asset preparation from the approved script.', null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'visual_asset_preparation_task_created', jsonb_build_object('task_id', created_task.id, 'script_revision_id', candidate.script_revision_id, 'external_visual_inputs', jsonb_array_length(external_visual_inputs), 'execution_mode', task_snapshot ->> 'execution_mode'), null);
    return next created_task;
  end loop;
end;
$$;

revoke all on function public.orchestrate_provided_script_tasks_for_episode(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_provided_script_tasks_for_episode(uuid) to service_role;

drop trigger if exists freeze_shared_planning_harness_before_insert on public.tasks;
