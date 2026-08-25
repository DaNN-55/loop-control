-- Manual execution paths are fulfilled by the material checklist and explicit
-- material binding. They must not enter the Worker task orchestration path.

create or replace function public.orchestrate_b_roll_tasks(p_episode_id uuid default null)
returns setof public.tasks
language plpgsql security definer set search_path = ''
as $$
declare candidate_id uuid;
begin
  for candidate_id in
    select episode.id
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where (p_episode_id is null or episode.id = p_episode_id)
      and (blueprint.policy -> 'b_roll') is not null
      and jsonb_typeof(blueprint.policy -> 'b_roll') <> 'null'
      and coalesce(blueprint.policy #>> '{b_roll,execution_path}', 'external') <> 'manual'
  loop
    return query select * from public.orchestrate_b_roll_tasks_configured(candidate_id);
  end loop;
end;
$$;

create or replace function public.orchestrate_narration_tasks(p_episode_id uuid default null)
returns setof public.tasks
language plpgsql security definer set search_path = ''
as $$
declare candidate_id uuid;
begin
  for candidate_id in
    select episode.id
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where (p_episode_id is null or episode.id = p_episode_id)
      and (blueprint.policy -> 'narration') is not null
      and jsonb_typeof(blueprint.policy -> 'narration') <> 'null'
      and coalesce(blueprint.policy #>> '{narration,execution_path}', 'external') <> 'manual'
  loop
    return query select * from public.orchestrate_narration_tasks_configured(candidate_id);
  end loop;
end;
$$;

alter function public.orchestrate_soundtrack_tasks(uuid)
rename to orchestrate_soundtrack_tasks_without_manual_path;

create function public.orchestrate_soundtrack_tasks(p_episode_id uuid default null)
returns setof public.tasks
language plpgsql security definer set search_path = ''
as $$
declare candidate_id uuid;
begin
  for candidate_id in
    select episode.id
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where (p_episode_id is null or episode.id = p_episode_id)
      and coalesce(blueprint.policy #>> '{soundtrack,execution_path}', 'external') <> 'manual'
  loop
    return query select * from public.orchestrate_soundtrack_tasks_without_manual_path(candidate_id);
  end loop;
end;
$$;

-- A-roll has no scoped RPC in the current schema. Keep the conservative guard
-- until that function is scoped; this prevents a mixed global dispatch from
-- creating manual-path A-roll tasks.
alter function public.orchestrate_a_roll_tasks()
rename to orchestrate_a_roll_tasks_without_manual_path;

create function public.orchestrate_a_roll_tasks()
returns setof public.tasks
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where coalesce(blueprint.policy #>> '{a_roll,execution_path}', 'external') = 'manual'
  ) then
    return;
  end if;
  return query select * from public.orchestrate_a_roll_tasks_without_manual_path();
end;
$$;

revoke all on function public.orchestrate_b_roll_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_b_roll_tasks(uuid) to service_role;
revoke all on function public.orchestrate_narration_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_narration_tasks(uuid) to service_role;
revoke all on function public.orchestrate_soundtrack_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_soundtrack_tasks(uuid) to service_role;
revoke all on function public.orchestrate_a_roll_tasks() from public, anon, authenticated;
grant execute on function public.orchestrate_a_roll_tasks() to service_role;
