alter function public.orchestrate_b_roll_tasks_configured(uuid)
rename to orchestrate_b_roll_tasks_without_connection_ref;

create function public.orchestrate_b_roll_tasks_configured(p_episode_id uuid default null)
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_task public.tasks;
  frozen_credential_ref text;
begin
  for created_task in
    select * from public.orchestrate_b_roll_tasks_without_connection_ref(p_episode_id)
  loop
    select nullif(btrim(blueprint.policy #>> '{b_roll,credential_ref}'), '')
    into frozen_credential_ref
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where episode.id = created_task.episode_id;

    if frozen_credential_ref is null then
      raise exception 'B-roll task is missing a frozen credential reference' using errcode = '22023';
    end if;

    update public.tasks task
    set input_snapshot = jsonb_set(task.input_snapshot, '{credential_ref}', to_jsonb(frozen_credential_ref))
    where task.id = created_task.id
    returning task.* into created_task;

    return next created_task;
  end loop;
end;
$$;

revoke all on function public.orchestrate_b_roll_tasks_configured(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_b_roll_tasks_configured(uuid) to service_role;
