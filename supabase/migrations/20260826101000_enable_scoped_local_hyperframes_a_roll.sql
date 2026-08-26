alter function public.orchestrate_a_roll_tasks_for_episode(uuid)
rename to orchestrate_a_roll_tasks_for_episode_without_card_adapter;

create function public.orchestrate_a_roll_tasks_for_episode(p_episode_id uuid)
returns setof public.tasks
language plpgsql security definer set search_path = ''
as $$
declare created_task public.tasks;
begin
  for created_task in select * from public.orchestrate_a_roll_tasks_for_episode_without_card_adapter(p_episode_id)
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

update public.tasks task
set status = 'ready'::public.task_status,
    last_result = null,
    completed_at = null
where task.task_type = 'generate_a_roll'
  and task.status = 'blocked'
  and task.input_snapshot #>> '{executor,provider}' = 'hyperframes'
  and task.input_snapshot #>> '{executor,adapter}' = 'hyperframes_card_video'
  and task.input_snapshot #>> '{executor,model}' = 'hyperframes@0.7.109'
  and task.last_result -> 'blockers' @> jsonb_build_array(jsonb_build_object('code', 'a_roll_executor_unavailable'));

revoke all on function public.orchestrate_a_roll_tasks_for_episode(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_a_roll_tasks_for_episode(uuid) to service_role;
