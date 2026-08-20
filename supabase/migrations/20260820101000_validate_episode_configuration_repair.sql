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
  selected_config jsonb;
  executor jsonb;
  allowed_tools jsonb;
  configuration_key text;
begin
  if jsonb_typeof(p_policy) <> 'object' then
    raise exception 'Episode repair policy must be a JSON object' using errcode = '22023';
  end if;

  select episode.*
  into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
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
        select 1
        from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker
        where (p_blocker_code is null or blocker ->> 'code' = p_blocker_code)
          and (p_blocker_detail is null or blocker ->> 'detail' = p_blocker_detail)
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) ~ '(executor|adapter|allowed|asset.?root|budget|voice|scheduling|权限|配置|预算|适配器|工具)'
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) !~ '(provider.?unavailable|credential|network|尚未注册)'
      )
  loop
    configuration_key := null;
    if blocked_task.task_type = 'prepare_visual_brief' then
      selected_config := p_policy #> '{executors,visual_planning}';
    elsif blocked_task.task_type = 'draft_storyboard' then
      selected_config := p_policy #> '{executors,storyboard_planning}';
    elsif blocked_task.task_type = 'draft_script' then
      selected_config := p_policy #> '{executors,script_writing}';
    elsif blocked_task.task_type in ('generate_a_roll', 'generate_b_roll', 'generate_narration', 'generate_soundtrack') then
      configuration_key := case blocked_task.task_type
        when 'generate_a_roll' then 'a_roll'
        when 'generate_b_roll' then 'b_roll'
        when 'generate_narration' then 'narration'
        else 'soundtrack'
      end;
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
    if configuration_key is not null and coalesce(executor ->> 'adapter', '') = '' then
      raise exception '当前生产单的 % 修复配置缺少 Adapter', configuration_key using errcode = '22023';
    end if;
    allowed_tools := coalesce(selected_config -> 'allowed_tools', p_policy -> 'allowed_tools');
    if jsonb_typeof(allowed_tools) <> 'array' or jsonb_array_length(allowed_tools) = 0 then
      raise exception '当前生产单的修复配置至少需要一个允许工具' using errcode = '22023';
    end if;
    if configuration_key = 'a_roll' and (coalesce((selected_config ->> 'budget_cents')::integer, 0) <= 0 or coalesce((selected_config ->> 'max_attempts')::integer, 0) <= 0) then
      raise exception 'A-roll 修复配置需要正数预算和最大尝试次数' using errcode = '22023';
    end if;
    if configuration_key = 'b_roll' and (coalesce((selected_config ->> 'per_shot_budget_cents')::integer, 0) <= 0 or coalesce((selected_config ->> 'total_budget_cents')::integer, 0) <= 0 or coalesce((selected_config ->> 'max_attempts')::integer, 0) <= 0 or coalesce((selected_config ->> 'max_concurrency')::integer, 0) <= 0 or coalesce((selected_config ->> 'provider_max_concurrency')::integer, 0) <= 0) then
      raise exception 'B-roll 修复配置需要正数预算、尝试次数和并发上限' using errcode = '22023';
    end if;
    if configuration_key = 'narration' and (coalesce((selected_config ->> 'budget_cents')::integer, 0) <= 0 or coalesce((selected_config ->> 'max_attempts')::integer, 0) <= 0 or coalesce(selected_config #>> '{voice,language_code}', '') = '' or coalesce(selected_config #>> '{voice,name}', '') = '' or coalesce((selected_config #>> '{voice,speaking_rate}')::numeric, 0) <= 0) then
      raise exception '旁白修复配置需要预算、尝试次数和完整声音参数' using errcode = '22023';
    end if;
  end loop;

  return public.apply_episode_configuration_repair(p_episode_id, p_policy, p_blocker_code, p_blocker_detail);
end;
$$;

revoke all on function public.apply_episode_configuration_repair(uuid, jsonb, text, text) from authenticated;
revoke all on function public.apply_episode_configuration_repair_v2(uuid, jsonb, text, text) from public, anon;
grant execute on function public.apply_episode_configuration_repair_v2(uuid, jsonb, text, text) to authenticated;
