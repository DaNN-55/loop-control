create table public.shot_preparation_drafts (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  review_package_id uuid not null references public.review_packages(id) on delete restrict,
  shot_id text not null check (char_length(btrim(shot_id)) > 0),
  audio_mode text not null default 'tts' check (audio_mode in ('tts', 'source', 'none')),
  video_status text not null default 'pending' check (video_status in ('pending', 'running', 'ready', 'failed')),
  audio_status text not null default 'pending' check (audio_status in ('pending', 'running', 'ready', 'failed')),
  confirmation_status text not null default 'pending' check (confirmation_status in ('pending', 'confirmed')),
  subtitle_text text not null check (char_length(btrim(subtitle_text)) > 0),
  subtitles_enabled boolean not null default true,
  tts_voice text,
  tts_speaking_rate numeric(5, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (episode_id, review_package_id, shot_id)
);

create index shot_preparation_drafts_episode_idx
on public.shot_preparation_drafts (episode_id, review_package_id, shot_id);

alter table public.shot_preparation_drafts enable row level security;
create policy "members can read shot preparation drafts" on public.shot_preparation_drafts
for select to authenticated
using (
  exists (
    select 1 from public.episodes episode
    where episode.id = shot_preparation_drafts.episode_id
      and public.is_account_member(episode.account_id)
  )
);

revoke all on public.shot_preparation_drafts from anon, authenticated;
grant select on public.shot_preparation_drafts to authenticated;

create function public.seed_shot_preparation_drafts_after_storyboard_approval()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  episode_record public.episodes;
  package_record public.review_packages;
  narration_policy jsonb;
  voice jsonb;
begin
  if new.stage <> 'storyboard_approved' or new.decision <> 'approved' or new.review_package_id is null then return new; end if;

  select episode.* into episode_record from public.episodes episode where episode.id = new.episode_id;
  select package.* into package_record
  from public.review_packages package
  where package.id = new.review_package_id
    and package.episode_id = new.episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null;
  if not found or episode_record.stage <> 'storyboard_approved' then return new; end if;

  narration_policy := (select blueprint.policy -> 'narration' from public.account_blueprint_versions blueprint where blueprint.id = episode_record.blueprint_version_id);
  voice := narration_policy -> 'voice';
  insert into public.shot_preparation_drafts (episode_id, review_package_id, shot_id, audio_mode, subtitle_text, subtitles_enabled, tts_voice, tts_speaking_rate)
  select
    episode_record.id,
    package_record.id,
    shot ->> 'id',
    'tts',
    btrim(shot ->> 'scriptSegment'),
    true,
    nullif(btrim(voice ->> 'name'), ''),
    case when (voice ->> 'speaking_rate') ~ '^[0-9]+([.][0-9]+)?$' then (voice ->> 'speaking_rate')::numeric else null end
  from jsonb_array_elements(coalesce(package_record.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot
  where coalesce(btrim(shot ->> 'id'), '') <> ''
    and coalesce(btrim(shot ->> 'scriptSegment'), '') <> ''
  on conflict (episode_id, review_package_id, shot_id) do nothing;
  return new;
end;
$$;

create trigger seed_shot_preparation_drafts_after_storyboard_approval
after insert on public.approvals
for each row execute function public.seed_shot_preparation_drafts_after_storyboard_approval();

create function public.save_shot_preparation_draft(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_audio_mode text,
  p_subtitle_text text,
  p_subtitles_enabled boolean
)
returns public.shot_preparation_drafts
language plpgsql
security definer set search_path = ''
as $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  existing_draft public.shot_preparation_drafts;
  saved_draft public.shot_preparation_drafts;
  selected_shot jsonb;
begin
  if p_audio_mode not in ('tts', 'source', 'none')
    or coalesce(btrim(p_shot_id), '') = ''
    or coalesce(btrim(p_subtitle_text), '') = ''
    or p_subtitles_enabled is null then
    raise exception 'Shot preparation draft is invalid' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to save a shot preparation draft' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Shot preparation drafts can only be saved after storyboard approval' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id
    and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the approved storyboard' using errcode = '22023'; end if;

  select draft.* into existing_draft
  from public.shot_preparation_drafts draft
  where draft.episode_id = p_episode_id and draft.review_package_id = p_review_package_id and draft.shot_id = btrim(p_shot_id)
  for update;

  insert into public.shot_preparation_drafts (episode_id, review_package_id, shot_id, audio_mode, subtitle_text, subtitles_enabled, tts_voice, tts_speaking_rate)
  select p_episode_id, p_review_package_id, btrim(p_shot_id), p_audio_mode, btrim(p_subtitle_text), p_subtitles_enabled,
    nullif(btrim((blueprint.policy #>> '{narration,voice,name}')), ''),
    case when (blueprint.policy #>> '{narration,voice,speaking_rate}') ~ '^[0-9]+([.][0-9]+)?$' then (blueprint.policy #>> '{narration,voice,speaking_rate}')::numeric else null end
  from public.account_blueprint_versions blueprint
  where blueprint.id = current_episode.blueprint_version_id
  on conflict (episode_id, review_package_id, shot_id) do update set
    audio_mode = excluded.audio_mode,
    subtitle_text = excluded.subtitle_text,
    subtitles_enabled = excluded.subtitles_enabled,
    updated_at = now()
  returning * into saved_draft;

  if existing_draft.id is null or existing_draft.audio_mode is distinct from saved_draft.audio_mode or existing_draft.subtitle_text is distinct from saved_draft.subtitle_text or existing_draft.subtitles_enabled is distinct from saved_draft.subtitles_enabled then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, current_episode.id, 'shot_preparation_draft_saved', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', btrim(p_shot_id), 'audio_mode', p_audio_mode, 'subtitles_enabled', p_subtitles_enabled), auth.uid());
  end if;
  return saved_draft;
end;
$$;

revoke all on function public.seed_shot_preparation_drafts_after_storyboard_approval() from public, anon, authenticated;
revoke all on function public.save_shot_preparation_draft(uuid, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.save_shot_preparation_draft(uuid, uuid, text, text, text, boolean) to authenticated;
