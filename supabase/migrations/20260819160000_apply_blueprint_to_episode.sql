alter type public.task_status add value if not exists 'superseded';

create or replace function public.apply_blueprint_to_episode(
  p_episode_id uuid,
  p_blueprint_version_id uuid,
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
  selected_blueprint public.account_blueprint_versions;
  selected_series_rules jsonb;
  blocked_task public.tasks;
  created_task public.tasks;
  selected_config jsonb;
  executor jsonb;
  allowed_tools jsonb;
  next_snapshot jsonb;
  next_budget integer;
  next_max_attempts integer;
  next_provider text;
  next_model text;
  next_prompt_version text;
  configuration_key text;
  superseded_count integer := 0;
  recreated_count integer := 0;
begin
  select episode.*
  into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;

  if not found then
    raise exception 'Owner membership is required to apply a blueprint to an episode' using errcode = '42501';
  end if;

  select blueprint.*
  into selected_blueprint
  from public.account_blueprint_versions blueprint
  where blueprint.id = p_blueprint_version_id
    and blueprint.account_id = current_episode.account_id
    and blueprint.archived_at is null;

  if not found then
    raise exception 'Blueprint version does not belong to the episode account or is archived' using errcode = '22023';
  end if;

  select coalesce(series_version.rules, '{}'::jsonb)
  into selected_series_rules
  from public.series_versions series_version
  where series_version.id = current_episode.series_version_id
    and series_version.account_id = current_episode.account_id;

  update public.episodes
  set blueprint_version_id = p_blueprint_version_id,
      updated_at = now()
  where id = p_episode_id;

  for blocked_task in
    select task.*
    from public.tasks task
    where task.episode_id = p_episode_id
      and task.status = 'blocked'::public.task_status
      and not (task.input_snapshot ? 'superseded_by_blueprint_version_id')
      and exists (
        select 1
        from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker
        where (p_blocker_code is null or blocker ->> 'code' = p_blocker_code)
          and (p_blocker_detail is null or blocker ->> 'detail' = p_blocker_detail)
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) ~ '(executor|adapter|allowed|asset.?root|budget|voice|scheduling|权限|配置|预算|适配器|工具)'
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) !~ '(provider.?unavailable|credential|network|尚未注册)'
      )
    order by task.created_at, task.id
    for update of task
  loop
    selected_config := null;
    configuration_key := null;
    next_budget := blocked_task.budget_limit_cents;
    next_max_attempts := blocked_task.max_attempts;

    if blocked_task.task_type = 'prepare_visual_brief' then
      selected_config := selected_blueprint.policy #> '{executors,visual_planning}';
      allowed_tools := selected_blueprint.policy -> 'allowed_tools';
      next_budget := case when jsonb_typeof(selected_blueprint.policy #> '{budgets,visual_planning_cents}') = 'number' then (selected_blueprint.policy #>> '{budgets,visual_planning_cents}')::integer else 0 end;
      next_max_attempts := 2;
    elsif blocked_task.task_type = 'draft_storyboard' then
      selected_config := selected_blueprint.policy #> '{executors,storyboard_planning}';
      allowed_tools := selected_blueprint.policy -> 'allowed_tools';
      next_budget := case when jsonb_typeof(selected_blueprint.policy #> '{budgets,storyboard_planning_cents}') = 'number' then (selected_blueprint.policy #>> '{budgets,storyboard_planning_cents}')::integer else 0 end;
      next_max_attempts := 2;
    elsif blocked_task.task_type = 'draft_script' then
      selected_config := selected_blueprint.policy #> '{executors,script_writing}';
      allowed_tools := selected_blueprint.policy -> 'allowed_tools';
      next_budget := case when jsonb_typeof(selected_blueprint.policy #> '{budgets,script_writing_cents}') = 'number' then (selected_blueprint.policy #>> '{budgets,script_writing_cents}')::integer else 0 end;
      next_max_attempts := 2;
    elsif blocked_task.task_type in ('generate_a_roll', 'generate_b_roll', 'generate_narration', 'generate_soundtrack') then
      configuration_key := case blocked_task.task_type
        when 'generate_a_roll' then 'a_roll'
        when 'generate_b_roll' then 'b_roll'
        when 'generate_narration' then 'narration'
        else 'soundtrack'
      end;
      selected_config := coalesce(selected_series_rules -> configuration_key, selected_blueprint.policy -> configuration_key);
      if selected_series_rules ? configuration_key then
        raise exception '当前生产单的系列规则覆盖了账号蓝图中的 % 配置，请先修正系列规则后再应用蓝图', configuration_key using errcode = '22023';
      end if;
      allowed_tools := coalesce(selected_config -> 'allowed_tools', selected_blueprint.policy -> 'allowed_tools');
      next_budget := case
        when blocked_task.task_type = 'generate_b_roll' and jsonb_typeof(selected_config -> 'per_shot_budget_cents') = 'number' then (selected_config ->> 'per_shot_budget_cents')::integer
        when jsonb_typeof(selected_config -> 'budget_cents') = 'number' then (selected_config ->> 'budget_cents')::integer
        else blocked_task.budget_limit_cents
      end;
      next_max_attempts := case when jsonb_typeof(selected_config -> 'max_attempts') = 'number' then (selected_config ->> 'max_attempts')::integer else blocked_task.max_attempts end;
    else
      continue;
    end if;

    executor := coalesce(selected_config -> 'executor', selected_config, '{}'::jsonb);
    next_provider := coalesce(executor ->> 'provider', blocked_task.provider, 'unconfigured');
    next_model := coalesce(executor ->> 'model', blocked_task.model, 'unconfigured');
    next_prompt_version := coalesce(executor ->> 'prompt_version', blocked_task.prompt_version, 'unconfigured');
    next_snapshot := blocked_task.input_snapshot;
    next_snapshot := jsonb_set(next_snapshot, '{executor}', executor, true);
    next_snapshot := jsonb_set(next_snapshot, '{allowed_tools}', coalesce(allowed_tools, '[]'::jsonb), true);
    next_snapshot := jsonb_set(next_snapshot, '{budget}', coalesce(next_snapshot -> 'budget', '{}'::jsonb) || jsonb_build_object('limit_cents', next_budget, 'max_attempts', next_max_attempts), true);
    if configuration_key = 'b_roll' then
      next_snapshot := jsonb_set(next_snapshot, '{scheduling}', coalesce(next_snapshot -> 'scheduling', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'max_concurrency', selected_config -> 'max_concurrency',
        'provider_max_concurrency', selected_config -> 'provider_max_concurrency'
      )), true);
      next_snapshot := jsonb_set(next_snapshot, '{budget}', coalesce(next_snapshot -> 'budget', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'total_limit_cents', selected_config -> 'total_budget_cents'
      )), true);
    end if;
    next_snapshot := jsonb_set(next_snapshot, '{blueprint_version_id}', to_jsonb(p_blueprint_version_id::text), true);
    next_snapshot := jsonb_set(next_snapshot, '{configuration_repair}', jsonb_build_object('source_task_id', blocked_task.id, 'source_blueprint_version_id', current_episode.blueprint_version_id, 'target_blueprint_version_id', p_blueprint_version_id), true);
    if configuration_key is not null then
      next_snapshot := jsonb_set(next_snapshot, '{configuration_hash}', to_jsonb(md5(coalesce(selected_config::text, 'null'))), true);
    end if;
    if blocked_task.task_type = 'generate_narration' and jsonb_typeof(selected_config -> 'voice') = 'object' then
      next_snapshot := jsonb_set(next_snapshot, '{media,narration,voice}', selected_config -> 'voice', true);
    end if;

    update public.tasks
    set status = 'superseded'::public.task_status,
        budget_limit_cents = 0,
        claimed_at = null,
        completed_at = coalesce(completed_at, now()),
        input_snapshot = (input_snapshot - 'configuration_hash') || jsonb_build_object(
          'superseded_configuration_hash', input_snapshot -> 'configuration_hash',
          'superseded_by_blueprint_version_id', p_blueprint_version_id,
          'superseded_at', now(),
          'superseded_from_blueprint_version_id', current_episode.blueprint_version_id
        ),
        last_result = coalesce(last_result, '{}'::jsonb) || jsonb_build_object(
          'status', 'superseded',
          'superseded_by_blueprint_version_id', p_blueprint_version_id,
          'nextStep', '配置已修订，系统已为当前生产单重新排队。'
        )
    where id = blocked_task.id;
    superseded_count := superseded_count + 1;

    insert into public.tasks (
      episode_id, task_type, status, input_snapshot, budget_limit_cents,
      max_attempts, provider, model, prompt_version
    ) values (
      p_episode_id,
      blocked_task.task_type,
      'ready'::public.task_status,
      next_snapshot,
      greatest(next_budget, 0),
      greatest(next_max_attempts, 1),
      next_provider,
      next_model,
      next_prompt_version
    ) returning * into created_task;
    recreated_count := recreated_count + 1;
  end loop;

  if superseded_count = 0 then
    raise exception '当前生产单没有可通过蓝图修复的阻塞任务' using errcode = '22023';
  end if;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    p_episode_id,
    'blueprint_applied_to_episode',
    jsonb_build_object(
      'from_blueprint_version_id', current_episode.blueprint_version_id,
      'to_blueprint_version_id', p_blueprint_version_id,
      'blocker_code', p_blocker_code,
      'superseded_task_count', superseded_count,
      'recreated_task_count', recreated_count
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'episode_id', p_episode_id,
    'blueprint_version_id', p_blueprint_version_id,
    'superseded_task_count', superseded_count,
    'recreated_task_count', recreated_count
  );
end;
$$;

revoke all on function public.apply_blueprint_to_episode(uuid, uuid, text, text) from public, anon;
grant execute on function public.apply_blueprint_to_episode(uuid, uuid, text, text) to authenticated;
