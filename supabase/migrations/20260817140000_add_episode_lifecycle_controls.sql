create or replace function public.update_episode_title(p_episode_id uuid, p_title text)
returns public.episodes
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  updated_episode public.episodes;
  next_title text := btrim(coalesce(p_title, ''));
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
  if not found then
    raise exception 'Owner membership is required to update an episode title' using errcode = '42501';
  end if;

  update public.episodes
  set title = next_title, updated_at = now()
  where id = p_episode_id
  returning * into updated_episode;

  if current_episode.title is distinct from updated_episode.title then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (
      current_episode.account_id,
      current_episode.id,
      'episode_title_updated',
      jsonb_build_object('previous_title', current_episode.title, 'title', updated_episode.title),
      auth.uid()
    );
  end if;
  return updated_episode;
end;
$$;

create function public.set_episode_archived(p_episode_id uuid, p_archived boolean)
returns public.episodes
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  updated_episode public.episodes;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
  if not found then
    raise exception 'Owner membership is required to archive an episode' using errcode = '42501';
  end if;

  update public.episodes
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
      updated_at = now()
  where id = p_episode_id
  returning * into updated_episode;

  if current_episode.archived_at is distinct from updated_episode.archived_at then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (
      current_episode.account_id,
      current_episode.id,
      case when p_archived then 'episode_archived' else 'episode_restored' end,
      jsonb_build_object('archived_at', updated_episode.archived_at),
      auth.uid()
    );
  end if;
  return updated_episode;
end;
$$;

create function public.delete_episode(p_episode_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  membership_role public.member_role;
  deleted_at timestamptz := now();
begin
  select episode.* into current_episode
  from public.episodes episode
  where episode.id = p_episode_id
  for update;
  if not found then
    raise exception 'Episode % does not exist', p_episode_id using errcode = 'P0002';
  end if;

  select role into membership_role
  from public.account_memberships
  where account_id = current_episode.account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to delete an episode' using errcode = '42501';
  end if;
  if current_episode.archived_at is null then
    raise exception 'Episode must be archived before it can be permanently deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.tasks where episode_id = p_episode_id and status = 'running') then
    raise exception 'Episode has a running Worker task; wait for it to finish before deleting' using errcode = '55000';
  end if;
  if exists (select 1 from public.asset_locks where episode_id = p_episode_id and expires_at > now()) then
    raise exception 'Episode has an active asset lock; wait for it to expire before deleting' using errcode = '55000';
  end if;

  delete from public.pre_render_review_member_decisions
  where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  delete from public.pre_render_review_members
  where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  delete from public.audio_track_annotations
  where audio_track_id in (select id from public.audio_tracks where episode_id = p_episode_id);
  delete from public.audio_tracks where episode_id = p_episode_id;
  delete from public.review_render_composition_revisions where episode_id = p_episode_id;
  delete from public.review_packages where episode_id = p_episode_id;

  update public.episodes
  set main_script_revision_id = null
  where id = p_episode_id;
  delete from public.episodes where id = p_episode_id;

  return jsonb_build_object(
    'episode_id', p_episode_id,
    'account_id', current_episode.account_id,
    'title', current_episode.title,
    'deleted_at', deleted_at
  );
end;
$$;

revoke execute on function public.set_episode_archived(uuid, boolean) from public, anon;
revoke execute on function public.delete_episode(uuid) from public, anon;
grant execute on function public.set_episode_archived(uuid, boolean) to authenticated;
grant execute on function public.delete_episode(uuid) to authenticated;
