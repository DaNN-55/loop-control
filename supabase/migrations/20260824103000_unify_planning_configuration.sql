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

with normalized as (
  select
    blueprint.id,
    coalesce(
      case when jsonb_typeof(blueprint.policy #> '{executors,storyboard_planning}') = 'object' then blueprint.policy #> '{executors,storyboard_planning}' end,
      blueprint.policy #> '{executors,visual_planning}',
      '{}'::jsonb
    ) as planning_executor,
    coalesce(
      case when jsonb_typeof(blueprint.policy #> '{budgets,storyboard_planning_cents}') = 'number' then blueprint.policy #> '{budgets,storyboard_planning_cents}' end,
      blueprint.policy #> '{budgets,visual_planning_cents}',
      '0'::jsonb
    ) as planning_budget
  from public.account_blueprint_versions blueprint
)
update public.account_blueprint_versions blueprint
set policy = jsonb_set(
  jsonb_set(
    blueprint.policy,
    '{executors}',
    coalesce(blueprint.policy -> 'executors', '{}'::jsonb)
      || jsonb_build_object('visual_planning', normalized.planning_executor, 'storyboard_planning', normalized.planning_executor),
    true
  ),
  '{budgets}',
  coalesce(blueprint.policy -> 'budgets', '{}'::jsonb)
    || jsonb_build_object('visual_planning_cents', normalized.planning_budget, 'storyboard_planning_cents', normalized.planning_budget),
  true
)
from normalized
where blueprint.id = normalized.id
  and not blueprint.is_snapshot;

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
  budget_limit integer;
  planning_capability text;
  planning_executor jsonb;
  adapter text;
  executor_model text;
  harness_id_text text;
  external_visual_inputs jsonb;
  image_generation jsonb;
  task_snapshot jsonb;
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
    planning_capability := case when candidate.blueprint_is_snapshot then 'visual_planning' else 'storyboard_planning' end;
    planning_executor := candidate.policy #> array['executors', planning_capability];
    if jsonb_typeof(candidate.policy #> array['budgets', planning_capability || '_cents']) <> 'number' or (candidate.policy #>> array['budgets', planning_capability || '_cents']) !~ '^[0-9]+$' then
      raise exception 'Blueprint % has invalid visual planning budget', candidate.blueprint_version_id using errcode = '22023';
    end if;
    adapter := nullif(btrim(planning_executor ->> 'adapter'), '');
    executor_model := nullif(btrim(planning_executor ->> 'model'), '');
    harness_id_text := nullif(btrim(planning_executor ->> 'harness_id'), '');
    if adapter <> 'codex' or executor_model is null or harness_id_text is null or harness_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Blueprint % must select a registered Codex storyboard Adapter, model, and Harness', candidate.blueprint_version_id using errcode = '22023';
    end if;
    select harness.* into selected_harness from public.prompt_versions harness where harness.id = harness_id_text::uuid and harness.account_id = candidate.account_id and harness.is_active and (harness.capability = 'storyboard_planning' or candidate.blueprint_is_snapshot and harness.capability = 'visual_planning');
    if not found or coalesce(btrim(selected_harness.instructions), '') = '' then
      raise exception 'Blueprint % must select an active storyboard Harness from its account', candidate.blueprint_version_id using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('artifactType', 'external_visual_input', 'relativePath', material.storage_path, 'sha256', material.sha256, 'fileSize', material.file_size) order by material.created_at, material.id), '[]'::jsonb)
    into external_visual_inputs
    from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.episode_id = candidate.id and material.material_purpose = 'visual_reference' and material.material_type in ('image', 'video', 'reference');

    image_generation := case when coalesce(btrim(candidate.policy #>> '{static_visual,executor,provider}'), '') <> '' and coalesce(btrim(candidate.policy #>> '{static_visual,executor,adapter}'), '') <> '' then jsonb_build_object('provider', candidate.policy #>> '{static_visual,executor,provider}', 'adapter', candidate.policy #>> '{static_visual,executor,adapter}') else null end;
    allowed_tools := candidate.policy -> 'allowed_tools';
    budget_limit := (candidate.policy #>> array['budgets', planning_capability || '_cents'])::integer;
    task_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'capability', 'visual_planning',
      'script_revision', jsonb_build_object('id', candidate.script_revision_id, 'storage_path', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'file_size', candidate.script_file_size, 'mime_type', candidate.script_mime_type),
      'series_baseline', case when candidate.frozen_series_version_id is null then null else jsonb_build_object('version_id', candidate.frozen_series_version_id, 'version', candidate.frozen_series_version, 'rules', candidate.frozen_series_rules) end,
      'visual_assets', jsonb_strip_nulls(jsonb_build_object('external_inputs', external_visual_inputs, 'image_generation', image_generation)),
      'harness', jsonb_build_object('id', selected_harness.id, 'version', selected_harness.version, 'content', selected_harness.instructions, 'content_hash', selected_harness.content_hash, 'adapter', 'codex', 'model', executor_model, 'prompt_version', selected_harness.slug),
      'executor', jsonb_build_object('provider', 'codex', 'adapter', 'codex', 'model', executor_model, 'prompt_version', selected_harness.slug),
      'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', 2),
      'allowed_tools', allowed_tools,
      'output', jsonb_build_object('required_artifact_types', jsonb_build_array('visual_asset_manifest'), 'content_type', 'text/markdown', 'relative_path', format('episodes/%s/visual-assets-v1.md', candidate.id), 'review_stage', 'visual_review'),
      'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'main_script', 'relativePath', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'fileSize', candidate.script_file_size)) || external_visual_inputs
    ));
    task_snapshot := task_snapshot || jsonb_build_object('prompt_context', public.build_prompt_context(candidate.id, task_snapshot));
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (candidate.id, 'prepare_visual_brief', 'ready', task_snapshot, budget_limit, 2, 'codex', executor_model, selected_harness.slug)
    returning * into created_task;
    update public.episodes set stage = 'visual_draft', updated_at = now() where id = candidate.id;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'script_approved', 'visual_draft', 'Orchestrator froze visual asset preparation from the approved script and the shared storyboard planning configuration.', null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'visual_asset_preparation_task_created', jsonb_build_object('task_id', created_task.id, 'script_revision_id', candidate.script_revision_id, 'external_visual_inputs', jsonb_array_length(external_visual_inputs), 'harness_id', selected_harness.id), null);
    return next created_task;
  end loop;
end;
$$;

revoke all on function public.orchestrate_provided_script_tasks_for_episode(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_provided_script_tasks_for_episode(uuid) to service_role;

create or replace function public.freeze_shared_planning_harness()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  planning_executor jsonb;
  planning_capability text;
  selected_harness public.prompt_versions;
begin
  if new.task_type <> 'prepare_visual_brief' or new.input_snapshot ->> 'capability' <> 'visual_planning' or new.input_snapshot ? 'harness' then
    return new;
  end if;

  select blueprint.policy #> array['executors', case when blueprint.is_snapshot then 'visual_planning' else 'storyboard_planning' end],
         case when blueprint.is_snapshot then 'visual_planning' else 'storyboard_planning' end
  into planning_executor, planning_capability
  from public.episodes episode
  join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
  where episode.id = new.episode_id;

  if coalesce(btrim(planning_executor ->> 'adapter'), '') <> 'codex'
    or coalesce(btrim(planning_executor ->> 'model'), '') = ''
    or coalesce(btrim(planning_executor ->> 'harness_id'), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Visual preparation requires the shared storyboard Adapter, model, and Harness' using errcode = '22023';
  end if;

  select harness.*
  into selected_harness
  from public.prompt_versions harness
  join public.episodes episode on episode.account_id = harness.account_id
  where episode.id = new.episode_id
    and harness.id = (planning_executor ->> 'harness_id')::uuid
     and (harness.capability = 'storyboard_planning' or planning_capability = 'visual_planning' and harness.capability = 'visual_planning')
    and harness.is_active;

  if not found or coalesce(btrim(selected_harness.instructions), '') = '' then
    raise exception 'Visual preparation requires an active shared storyboard Harness' using errcode = '22023';
  end if;

  new.input_snapshot := jsonb_set(new.input_snapshot, '{harness}', jsonb_build_object(
    'id', selected_harness.id,
    'version', selected_harness.version,
    'content', selected_harness.instructions,
    'content_hash', selected_harness.content_hash,
    'adapter', 'codex',
    'model', planning_executor ->> 'model',
    'prompt_version', selected_harness.slug
  ), true);
  new.input_snapshot := jsonb_set(new.input_snapshot, '{executor}', jsonb_build_object(
    'provider', 'codex',
    'adapter', 'codex',
    'model', planning_executor ->> 'model',
    'prompt_version', selected_harness.slug
  ), true);
  new.model := planning_executor ->> 'model';
  new.prompt_version := selected_harness.slug;
  return new;
end;
$$;

drop trigger if exists freeze_shared_planning_harness_before_insert on public.tasks;
create trigger freeze_shared_planning_harness_before_insert
before insert on public.tasks
for each row execute function public.freeze_shared_planning_harness();

revoke all on function public.freeze_shared_planning_harness() from public, anon, authenticated;

create or replace function public.apply_episode_configuration_repair_v2(
  p_episode_id uuid,
  p_policy jsonb,
  p_blocker_code text default null,
  p_blocker_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  blocked_task public.tasks;
  planning_task public.tasks;
  selected_config jsonb;
  executor jsonb;
  allowed_tools jsonb;
  configuration_key text;
  planning_harness public.prompt_versions;
  next_snapshot jsonb;
  next_budget integer;
  next_max_attempts integer;
  created_task public.tasks;
begin
  if jsonb_typeof(p_policy) <> 'object' then
    raise exception 'Episode repair policy must be a JSON object' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id;
  if not found then
    raise exception 'Owner membership is required to repair an episode' using errcode = '42501';
  end if;

  for blocked_task in
    select task.*
    from public.tasks task
    where task.episode_id = p_episode_id
      and task.status = 'blocked'::public.task_status
      and not (task.input_snapshot ? 'superseded_by_episode_repair_policy_hash')
      and exists (
        select 1 from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker
        where (p_blocker_code is null or blocker ->> 'code' = p_blocker_code)
          and (p_blocker_detail is null or blocker ->> 'detail' = p_blocker_detail)
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) ~ '(executor|adapter|allowed|asset.?root|budget|voice|scheduling|权限|配置|预算|适配器|工具)'
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) !~ '(provider.?unavailable|credential|network|尚未注册)'
      )
  loop
    configuration_key := null;
    if blocked_task.task_type in ('prepare_visual_brief', 'draft_storyboard') then
      if planning_task.id is not null then
        raise exception '请一次修复一个分镜规划阻塞项' using errcode = '22023';
      end if;
      selected_config := p_policy #> '{executors,storyboard_planning}';
      planning_task := blocked_task;
    elsif blocked_task.task_type = 'draft_script' then
      selected_config := p_policy #> '{executors,script_writing}';
    elsif blocked_task.task_type in ('generate_a_roll', 'generate_b_roll', 'generate_narration', 'generate_soundtrack') then
      configuration_key := case blocked_task.task_type when 'generate_a_roll' then 'a_roll' when 'generate_b_roll' then 'b_roll' when 'generate_narration' then 'narration' else 'soundtrack' end;
      selected_config := p_policy -> configuration_key;
    else
      continue;
    end if;

    if jsonb_typeof(selected_config) <> 'object' then
      raise exception '当前生产单缺少 % 的修复配置', coalesce(configuration_key, blocked_task.task_type::text) using errcode = '22023';
    end if;
    executor := coalesce(selected_config -> 'executor', selected_config);
    if jsonb_typeof(executor) <> 'object' or coalesce(executor ->> 'provider', '') = '' or coalesce(executor ->> 'model', '') = '' or coalesce(executor ->> 'prompt_version', '') = '' then
      raise exception '当前生产单的 % 修复配置缺少 Provider、模型或 Prompt 版本', coalesce(configuration_key, blocked_task.task_type::text) using errcode = '22023';
    end if;
    if blocked_task.task_type in ('prepare_visual_brief', 'draft_storyboard') then
      if executor ->> 'adapter' <> 'codex' or coalesce(executor ->> 'harness_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception '分镜规划修复配置必须选择已登记的 Codex Adapter 和 Harness' using errcode = '22023';
      end if;
      select harness.* into planning_harness
      from public.prompt_versions harness
      where harness.id = (executor ->> 'harness_id')::uuid
        and harness.account_id = current_episode.account_id
        and harness.capability = 'storyboard_planning'
        and harness.is_active;
      if not found or coalesce(btrim(planning_harness.instructions), '') = '' then
        raise exception '分镜规划修复配置必须选择已启用的 Harness' using errcode = '22023';
      end if;
    elsif configuration_key is not null and coalesce(executor ->> 'adapter', '') = '' then
      raise exception '当前生产单的 % 修复配置缺少 Adapter', configuration_key using errcode = '22023';
    end if;
    allowed_tools := coalesce(selected_config -> 'allowed_tools', p_policy -> 'allowed_tools');
    if jsonb_typeof(allowed_tools) <> 'array' or jsonb_array_length(allowed_tools) = 0 then
      raise exception '当前生产单的修复配置至少需要一个允许工具' using errcode = '22023';
    end if;
  end loop;

  if planning_task.id is null then
    return public.apply_episode_configuration_repair(p_episode_id, p_policy, p_blocker_code, p_blocker_detail);
  end if;

  if exists (
    select 1 from public.tasks task
    where task.episode_id = p_episode_id and task.status = 'blocked'::public.task_status and task.id <> planning_task.id
      and exists (select 1 from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker where (p_blocker_code is null or blocker ->> 'code' = p_blocker_code) and (p_blocker_detail is null or blocker ->> 'detail' = p_blocker_detail))
  ) then
    raise exception '请一次修复一个生产单阻塞项' using errcode = '22023';
  end if;

  select task.* into planning_task from public.tasks task where task.id = planning_task.id and task.status = 'blocked'::public.task_status for update;
  next_budget := case when jsonb_typeof(p_policy #> '{budgets,storyboard_planning_cents}') = 'number' then (p_policy #>> '{budgets,storyboard_planning_cents}')::integer else 0 end;
  next_max_attempts := 2;
  next_snapshot := jsonb_set(planning_task.input_snapshot - 'prompt_context', '{executor}', executor, true);
  next_snapshot := jsonb_set(next_snapshot, '{harness}', jsonb_build_object('id', planning_harness.id, 'version', planning_harness.version, 'content', planning_harness.instructions, 'content_hash', planning_harness.content_hash, 'adapter', 'codex', 'model', executor ->> 'model', 'prompt_version', planning_harness.slug), true);
  next_snapshot := jsonb_set(next_snapshot, '{allowed_tools}', allowed_tools, true);
  next_snapshot := jsonb_set(next_snapshot, '{budget}', coalesce(next_snapshot -> 'budget', '{}'::jsonb) || jsonb_build_object('limit_cents', next_budget, 'max_attempts', next_max_attempts), true);
  next_snapshot := jsonb_set(next_snapshot, '{configuration_repair}', jsonb_build_object('source_task_id', planning_task.id, 'source_blueprint_version_id', current_episode.blueprint_version_id, 'episode_repair_policy_hash', md5(p_policy::text)), true);
  next_snapshot := next_snapshot || jsonb_build_object('prompt_context', public.build_prompt_context(p_episode_id, next_snapshot));

  update public.tasks
  set status = 'superseded'::public.task_status, budget_limit_cents = 0, claimed_at = null, completed_at = coalesce(completed_at, now()),
      input_snapshot = input_snapshot || jsonb_build_object('superseded_by_episode_repair_policy_hash', md5(p_policy::text), 'superseded_at', now(), 'source_blueprint_version_id', current_episode.blueprint_version_id),
      last_result = coalesce(last_result, '{}'::jsonb) || jsonb_build_object('status', 'superseded', 'nextStep', '配置已直接修订，系统已为当前生产单重新排队。')
  where id = planning_task.id;

  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, planning_task.task_type, 'ready'::public.task_status, next_snapshot, greatest(next_budget, 0), next_max_attempts, executor ->> 'provider', executor ->> 'model', planning_harness.slug)
  on conflict do nothing
  returning * into created_task;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'episode_configuration_repaired', jsonb_build_object('source_blueprint_version_id', current_episode.blueprint_version_id, 'repair_policy_hash', md5(p_policy::text), 'blocker_code', p_blocker_code, 'superseded_task_count', 1, 'recreated_task_count', case when created_task.id is null then 0 else 1 end), auth.uid());
  return jsonb_build_object('episode_id', p_episode_id, 'source_blueprint_version_id', current_episode.blueprint_version_id, 'repair_policy_hash', md5(p_policy::text), 'superseded_task_count', 1, 'recreated_task_count', case when created_task.id is null then 0 else 1 end);
end;
$$;

revoke all on function public.apply_episode_configuration_repair_v2(uuid, jsonb, text, text) from public, anon;
grant execute on function public.apply_episode_configuration_repair_v2(uuid, jsonb, text, text) to authenticated;
