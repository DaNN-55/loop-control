-- Local HyperFrames card video is a registered A/B-roll execution path. It
-- reuses the existing task freezing functions, then promotes only the exact
-- frozen local-card configuration to a ready task.

alter function public.orchestrate_a_roll_tasks()
rename to orchestrate_a_roll_tasks_without_card_adapter;

create function public.orchestrate_a_roll_tasks()
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare created_task public.tasks;
begin
  for created_task in select * from public.orchestrate_a_roll_tasks_without_card_adapter()
  loop
    if created_task.input_snapshot #>> '{executor,provider}' = 'hyperframes'
      and created_task.input_snapshot #>> '{executor,adapter}' = 'hyperframes_card_video'
      and created_task.input_snapshot #>> '{executor,model}' = 'hyperframes@0.7.109' then
      update public.tasks task
      set status = 'ready'::public.task_status,
          last_result = null,
          completed_at = null
      where task.id = created_task.id
      returning task.* into created_task;
    end if;
    return next created_task;
  end loop;
end;
$$;

revoke all on function public.orchestrate_a_roll_tasks() from public, anon, authenticated;
grant execute on function public.orchestrate_a_roll_tasks() to service_role;

alter function public.orchestrate_b_roll_tasks_configured(uuid)
rename to orchestrate_b_roll_tasks_with_connection_ref;

create function public.orchestrate_b_roll_tasks_configured(p_episode_id uuid default null)
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_task public.tasks;
  is_local_card boolean;
begin
  select blueprint.policy #>> '{b_roll,executor,provider}' = 'hyperframes'
    and blueprint.policy #>> '{b_roll,executor,adapter}' = 'hyperframes_card_video'
    and blueprint.policy #>> '{b_roll,executor,model}' = 'hyperframes@0.7.109'
  into is_local_card
  from public.episodes episode
  join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
  where episode.id = p_episode_id;

  if coalesce(is_local_card, false) then
    for created_task in select * from public.orchestrate_b_roll_tasks_without_connection_ref(p_episode_id)
    loop
      update public.tasks task
      set status = 'ready'::public.task_status,
          input_snapshot = jsonb_set(task.input_snapshot - 'credential_ref', '{media}', jsonb_build_object('adapter', 'hyperframes_card_video', 'card_video', jsonb_build_object('shot', task.input_snapshot -> 'shot')), true),
          last_result = null,
          completed_at = null
      where task.id = created_task.id
      returning task.* into created_task;
      return next created_task;
    end loop;
    return;
  end if;

  return query select * from public.orchestrate_b_roll_tasks_with_connection_ref(p_episode_id);
end;
$$;

revoke all on function public.orchestrate_b_roll_tasks_configured(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_b_roll_tasks_configured(uuid) to service_role;
