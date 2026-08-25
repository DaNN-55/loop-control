-- Series rules may override an enabled blueprint capability, but cannot enable
-- an optional media capability that the blueprint has disabled.
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
  loop
    return query select * from public.orchestrate_narration_tasks_configured(candidate_id);
  end loop;
end;
$$;
