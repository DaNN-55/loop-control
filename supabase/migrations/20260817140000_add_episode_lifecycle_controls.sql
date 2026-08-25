alter table public.episodes
  add column if not exists is_test boolean not null default false;

drop function if exists public.create_episode(uuid, uuid, uuid, text);

create function public.create_episode(
  p_account_id uuid,
  p_blueprint_version_id uuid,
  p_series_version_id uuid,
  p_title text,
  p_is_test boolean default false
)
returns public.episodes
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_episode public.episodes;
  membership_role public.member_role;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to create an episode' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.accounts account
    join public.account_blueprint_versions blueprint
      on blueprint.account_id = account.id
     and blueprint.id = account.current_blueprint_version_id
     and blueprint.is_active
    where account.id = p_account_id and blueprint.id = p_blueprint_version_id
  ) then
    raise exception 'Episode blueprint must be the account active blueprint' using errcode = '22023';
  end if;
  if p_series_version_id is not null and not exists (
    select 1 from public.series_versions
    where account_id = p_account_id and id = p_series_version_id
  ) then
    raise exception 'Series version must belong to the episode account' using errcode = '22023';
  end if;

  insert into public.episodes (account_id, blueprint_version_id, series_version_id, title, stage, is_test)
  values (p_account_id, p_blueprint_version_id, p_series_version_id, coalesce(p_title, ''), 'waiting_input', p_is_test)
  returning * into created_episode;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    p_account_id,
    created_episode.id,
    'episode_created',
    jsonb_build_object('blueprint_version_id', p_blueprint_version_id, 'series_version_id', p_series_version_id, 'is_test', p_is_test),
    auth.uid()
  );
  return created_episode;
end;
$$;

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

create function public.delete_episode(p_episode_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  membership_role public.member_role;
  deleted_at timestamptz := now();
  task_count bigint;
  artifact_count bigint;
  approval_count bigint;
  transition_count bigint;
  audit_event_count bigint;
  material_count bigint;
  review_package_count bigint;
  audio_track_count bigint;
  audio_annotation_count bigint;
  composition_revision_count bigint;
  review_annotation_count bigint;
  pre_render_member_count bigint;
  pre_render_decision_count bigint;
  dependency_count bigint;
  invalidation_count bigint;
  experiment_count bigint;
  metric_snapshot_count bigint;
  asset_lock_count bigint;
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
  where account_id = current_episode.account_id and user_id = p_actor_id;
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to delete an episode' using errcode = '42501';
  end if;
  if not current_episode.is_test then
    raise exception 'Only test Episodes can be permanently deleted' using errcode = '42501';
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

  select count(*) into task_count from public.tasks where episode_id = p_episode_id;
  select count(*) into artifact_count from public.artifacts where episode_id = p_episode_id;
  select count(*) into approval_count from public.approvals where episode_id = p_episode_id;
  select count(*) into transition_count from public.state_transitions where episode_id = p_episode_id;
  select count(*) into audit_event_count from public.audit_events where episode_id = p_episode_id;
  select count(*) into material_count from public.production_material_revisions where episode_id = p_episode_id;
  select count(*) into review_package_count from public.review_packages where episode_id = p_episode_id;
  select count(*) into audio_track_count from public.audio_tracks where episode_id = p_episode_id;
  select count(*) into audio_annotation_count from public.audio_track_annotations where audio_track_id in (select id from public.audio_tracks where episode_id = p_episode_id);
  select count(*) into composition_revision_count from public.review_render_composition_revisions where episode_id = p_episode_id;
  select count(*) into review_annotation_count from public.review_annotations where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into pre_render_member_count from public.pre_render_review_members where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into pre_render_decision_count from public.pre_render_review_member_decisions where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into dependency_count from public.production_dependencies where episode_id = p_episode_id;
  select count(*) into invalidation_count from public.production_invalidations where episode_id = p_episode_id;
  select count(*) into experiment_count from public.experiments where episode_id = p_episode_id;
  select count(*) into metric_snapshot_count from public.metric_snapshots where episode_id = p_episode_id;
  select count(*) into asset_lock_count from public.asset_locks where episode_id = p_episode_id;

  delete from public.pre_render_review_member_decisions
  where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  delete from public.pre_render_review_members
  where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  delete from public.audio_track_annotations
  where audio_track_id in (select id from public.audio_tracks where episode_id = p_episode_id);
  delete from public.audio_tracks where episode_id = p_episode_id;
  delete from public.review_render_composition_revisions where episode_id = p_episode_id;
  delete from public.approvals where episode_id = p_episode_id;
  delete from public.review_packages where episode_id = p_episode_id;

  update public.episodes
  set main_script_revision_id = null
  where id = p_episode_id;
  delete from public.episodes where id = p_episode_id;

  return jsonb_build_object(
    'episode_id', p_episode_id,
    'account_id', current_episode.account_id,
    'title', current_episode.title,
    'deleted_at', deleted_at,
    'counts', jsonb_build_object(
      'tasks', task_count,
      'artifacts', artifact_count,
      'approvals', approval_count,
      'state_transitions', transition_count,
      'audit_events', audit_event_count,
      'production_material_revisions', material_count,
      'review_packages', review_package_count,
      'audio_tracks', audio_track_count,
      'audio_track_annotations', audio_annotation_count,
      'review_render_composition_revisions', composition_revision_count,
      'review_annotations', review_annotation_count,
      'pre_render_review_members', pre_render_member_count,
      'pre_render_review_member_decisions', pre_render_decision_count,
      'production_dependencies', dependency_count,
      'production_invalidations', invalidation_count,
      'experiments', experiment_count,
      'metric_snapshots', metric_snapshot_count,
      'asset_locks', asset_lock_count
    )
  );
end;
$$;

revoke execute on function public.create_episode(uuid, uuid, uuid, text, boolean) from public, anon;
revoke execute on function public.set_episode_archived(uuid, boolean) from public, anon;
revoke execute on function public.delete_episode(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_episode(uuid, uuid, uuid, text, boolean) to authenticated;
grant execute on function public.set_episode_archived(uuid, boolean) to authenticated;
grant execute on function public.delete_episode(uuid, uuid) to service_role;
