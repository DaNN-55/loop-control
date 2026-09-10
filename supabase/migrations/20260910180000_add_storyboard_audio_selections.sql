create table public.storyboard_audio_selections (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  review_package_id uuid not null references public.review_packages(id) on delete cascade,
  target_kind text not null check (target_kind in ('episode', 'shot')),
  target_id text not null,
  audio_kind text not null check (audio_kind in ('bgm', 'sfx')),
  cue_id text,
  material_revision_id uuid references public.production_material_revisions(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (episode_id, review_package_id, target_kind, target_id, audio_kind),
  check ((target_kind = 'episode' and audio_kind = 'bgm') or (target_kind = 'shot' and audio_kind = 'sfx')),
  check (num_nonnulls(cue_id, material_revision_id) <= 1)
);

alter table public.storyboard_audio_selections enable row level security;

create policy storyboard_audio_selections_owner_read on public.storyboard_audio_selections
for select to authenticated using (exists (
  select 1
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = storyboard_audio_selections.episode_id
    and membership.user_id = auth.uid()
    and membership.role = 'owner'
));

create function public.save_storyboard_audio_selection(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_target_kind text,
  p_target_id text,
  p_audio_kind text,
  p_cue_id text,
  p_material_revision_id uuid default null
)
returns public.storyboard_audio_selections
language plpgsql security definer set search_path = ''
as $$
declare
  current_episode public.episodes;
  current_package public.review_packages;
  saved public.storyboard_audio_selections;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id
    and membership.user_id = auth.uid()
    and membership.role = 'owner';
  if not found then raise exception 'Episode not found' using errcode = 'P0002'; end if;
  select * into current_package from public.review_packages
  where id = p_review_package_id and episode_id = p_episode_id and stage = 'storyboard_review' and invalidated_at is null;
  if not found then raise exception 'Storyboard review package not found' using errcode = 'P0002'; end if;
  if (p_target_kind = 'episode' and (p_audio_kind <> 'bgm' or p_target_id <> p_episode_id::text))
    or (p_target_kind = 'shot' and p_audio_kind <> 'sfx')
    or p_target_kind not in ('episode', 'shot') then
    raise exception 'Audio selection target is invalid' using errcode = '22023';
  end if;
  if p_target_kind = 'shot' and not exists (
    select 1 from jsonb_array_elements(coalesce(current_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot
    where shot ->> 'id' = p_target_id
  ) then raise exception 'Storyboard shot not found' using errcode = 'P0002'; end if;
  if p_cue_id is not null and not exists (
    select 1 from jsonb_array_elements(coalesce(current_package.context_snapshot #> '{worker_result,storyboard,audioCues}', '[]'::jsonb)) cue
    where cue ->> 'id' = p_cue_id and cue ->> 'kind' = p_audio_kind
  ) then raise exception 'Storyboard audio cue not found' using errcode = 'P0002'; end if;
  if p_material_revision_id is not null and (p_audio_kind <> 'bgm' or not exists (
    select 1 from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.id = p_material_revision_id
      and material.episode_id = p_episode_id
      and material.material_type = 'audio'
      and material.material_purpose = 'background_music'
  )) then raise exception 'Approved background music material is required' using errcode = 'P0002'; end if;
  if num_nonnulls(nullif(btrim(p_cue_id), ''), p_material_revision_id) > 1 then
    raise exception 'Choose either a storyboard cue or an uploaded audio file' using errcode = '22023';
  end if;

  insert into public.storyboard_audio_selections (episode_id, review_package_id, target_kind, target_id, audio_kind, cue_id, material_revision_id, created_by)
  values (p_episode_id, p_review_package_id, p_target_kind, btrim(p_target_id), p_audio_kind, nullif(btrim(p_cue_id), ''), p_material_revision_id, auth.uid())
  on conflict (episode_id, review_package_id, target_kind, target_id, audio_kind) do update
  set cue_id = excluded.cue_id, material_revision_id = excluded.material_revision_id, updated_at = now()
  returning * into saved;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'storyboard_audio_selection_saved', jsonb_build_object('review_package_id', p_review_package_id, 'target_kind', p_target_kind, 'target_id', p_target_id, 'audio_kind', p_audio_kind, 'cue_id', saved.cue_id, 'material_revision_id', saved.material_revision_id), auth.uid());
  return saved;
end;
$$;

revoke all on function public.save_storyboard_audio_selection(uuid, uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.save_storyboard_audio_selection(uuid, uuid, text, text, text, text, uuid) to authenticated;

create function public.storyboard_selected_audio_members(p_episode_id uuid, p_review_package_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  selection public.storyboard_audio_selections;
  cue jsonb;
  audio_task public.tasks;
  audio_track public.audio_tracks;
  material public.production_material_revisions;
  episode_duration numeric;
  members jsonb := '[]'::jsonb;
begin
  for selection in
    select candidate.*
    from public.storyboard_audio_selections candidate
    where candidate.episode_id = p_episode_id
      and candidate.review_package_id = p_review_package_id
      and (candidate.cue_id is not null or candidate.material_revision_id is not null)
    order by candidate.target_kind, candidate.target_id, candidate.audio_kind
  loop
    if selection.material_revision_id is not null then
      select candidate.* into material
      from public.production_material_revisions candidate
      join public.material_revision_approvals approval on approval.material_revision_id = candidate.id
      where candidate.id = selection.material_revision_id
        and candidate.episode_id = p_episode_id
        and candidate.material_type = 'audio'
        and candidate.material_purpose = 'background_music';
      if not found then
        raise exception 'Selected background music material is no longer available' using errcode = '22023';
      end if;
      select coalesce(sum((shot ->> 'durationSeconds')::numeric), 0) into episode_duration
      from public.review_packages package,
        jsonb_array_elements(coalesce(package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot
      where package.id = p_review_package_id and package.episode_id = p_episode_id;
      members := members || jsonb_build_array(jsonb_build_object(
        'member_kind', 'soundtrack',
        'member_key', 'bgm:episode',
        'target_kind', 'episode',
        'target_id', p_episode_id::text,
        'cue', jsonb_build_object('id', 'episode-bgm', 'kind', 'bgm', 'startSeconds', 0, 'durationSeconds', episode_duration, 'description', material.source_path),
        'duration_seconds', episode_duration,
        'source_material', jsonb_build_object('id', material.id, 'artifact_type', 'soundtrack_audio', 'relative_path', material.storage_path, 'sha256', material.sha256, 'file_size', material.file_size)
      ));
      continue;
    end if;
    select value into cue
    from public.review_packages package,
      jsonb_array_elements(coalesce(package.context_snapshot #> '{worker_result,storyboard,audioCues}', '[]'::jsonb)) value
    where package.id = p_review_package_id
      and package.episode_id = p_episode_id
      and value ->> 'id' = selection.cue_id
      and value ->> 'kind' = selection.audio_kind;
    if not found then
      raise exception 'Selected storyboard audio cue is no longer available' using errcode = '22023';
    end if;

    select track.* into audio_track
    from public.audio_tracks track
    join public.tasks task on task.id = track.source_task_id
    where track.episode_id = p_episode_id
      and track.source_review_package_id = p_review_package_id
      and track.cue_id = selection.cue_id
      and track.track_kind = selection.audio_kind
      and track.sha256 is not null
      and track.file_size > 0
      and track.duration_seconds > 0
      and task.status = 'completed'
      and task.invalidated_at is null
    order by track.created_at desc
    limit 1;
    if not found then
      raise exception 'Selected BGM and sound effects must be generated before review video creation' using errcode = '22023';
    end if;
    select task.* into audio_task
    from public.tasks task
    where task.id = audio_track.source_task_id;

    members := members || jsonb_build_array(jsonb_build_object(
      'member_kind', 'soundtrack',
      'member_key', format('%s:%s', selection.audio_kind, selection.target_id),
      'target_kind', selection.target_kind,
      'target_id', selection.target_id,
      'cue', cue,
      'task', jsonb_build_object('id', audio_task.id, 'type', audio_task.task_type, 'attempt', audio_task.attempt, 'provider', audio_task.provider, 'model', audio_task.model, 'prompt_version', audio_task.prompt_version),
      'audio_track', jsonb_build_object('id', audio_track.id, 'kind', audio_track.track_kind, 'cue_id', audio_track.cue_id, 'relative_path', audio_track.relative_path, 'sha256', audio_track.sha256, 'file_size', audio_track.file_size, 'start_seconds', audio_track.start_seconds, 'duration_seconds', audio_track.duration_seconds)
    ));
  end loop;
  return members;
end;
$$;

revoke all on function public.storyboard_selected_audio_members(uuid, uuid) from public, anon, authenticated;

do $$
declare definition text;
begin
  select pg_get_functiondef('public.create_shot_preparation_review_package(uuid, uuid)'::regprocedure) into definition;
  if position('public.storyboard_selected_audio_members' in definition) = 0 then
    if position('  select coalesce(max(revision_number), 0) + 1 into next_revision' in definition) = 0 then
      raise exception 'create_shot_preparation_review_package audio selection patch target is unknown';
    end if;
    definition := replace(
      definition,
      '  select coalesce(max(revision_number), 0) + 1 into next_revision',
      '  members := members || public.storyboard_selected_audio_members(p_episode_id, p_storyboard_review_package_id);' || chr(10) || chr(10) ||
      '  select coalesce(max(revision_number), 0) + 1 into next_revision'
    );
    execute definition;
  end if;
end $$;
