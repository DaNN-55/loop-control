CREATE OR REPLACE FUNCTION public.apply_episode_configuration_repair_v2(p_episode_id uuid, p_policy jsonb, p_blocker_code text DEFAULT NULL::text, p_blocker_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = local_identity.owner_id() and membership.role = 'owner'
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
  values (current_episode.account_id, p_episode_id, 'episode_configuration_repaired', jsonb_build_object('source_blueprint_version_id', current_episode.blueprint_version_id, 'repair_policy_hash', md5(p_policy::text), 'blocker_code', p_blocker_code, 'superseded_task_count', 1, 'recreated_task_count', case when created_task.id is null then 0 else 1 end), local_identity.owner_id());
  return jsonb_build_object('episode_id', p_episode_id, 'source_blueprint_version_id', current_episode.blueprint_version_id, 'repair_policy_hash', md5(p_policy::text), 'superseded_task_count', 1, 'recreated_task_count', case when created_task.id is null then 0 else 1 end);
end;
$function$
