alter table public.episodes
  add column worker_preflight_at timestamptz;

create or replace function public.record_episode_worker_preflight(p_episode_id uuid, p_owner_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.episodes episode
    join public.account_memberships membership on membership.account_id = episode.account_id
    where episode.id = p_episode_id and membership.user_id = p_owner_id and membership.role = 'owner'
  ) then raise exception 'Owner membership is required to record Worker preflight' using errcode = '42501'; end if;
  update public.episodes set worker_preflight_at = now() where id = p_episode_id;
end;
$$;

create or replace function public.start_episode_production(p_episode_id uuid)
returns public.episodes
language plpgsql security definer set search_path = ''
as $$
declare current_episode public.episodes;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;

  if not found then raise exception 'Owner membership is required to start episode production' using errcode = '42501'; end if;
  if current_episode.stage <> 'waiting_input' then raise exception 'Episode production can only start while the episode is waiting for input' using errcode = '22023'; end if;
  if current_episode.main_script_revision_id is null then raise exception 'A confirmed main script is required before starting production' using errcode = '22023'; end if;
  if current_episode.worker_preflight_at is null or current_episode.worker_preflight_at < now() - interval '10 minutes' then raise exception 'A fresh Worker preflight is required before starting episode production' using errcode = '42501'; end if;

  update public.episodes
  set stage = 'script_approved', worker_preflight_at = null, updated_at = now()
  where id = p_episode_id;

  insert into public.state_transitions (episode_id,from_stage,to_stage,reason,actor_id)
  values (p_episode_id,'waiting_input','script_approved','Owner confirmed all production materials are ready; start production.',auth.uid());
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id)
  values (current_episode.account_id,p_episode_id,'episode_production_started',jsonb_build_object('main_script_revision_id',current_episode.main_script_revision_id),auth.uid());

  select episode.* into current_episode from public.episodes episode where episode.id = p_episode_id;
  return current_episode;
end;
$$;

revoke all on function public.record_episode_worker_preflight(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_episode_worker_preflight(uuid, uuid) to service_role;
revoke all on function public.start_episode_production(uuid) from public, anon;
grant execute on function public.start_episode_production(uuid) to authenticated;
