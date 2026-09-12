alter table public.shot_preparation_drafts
  add column source_video_duration_seconds numeric,
  add constraint shot_preparation_drafts_source_video_duration_check
    check (source_video_duration_seconds is null or source_video_duration_seconds > 0 and source_video_duration_seconds <= 86400);

comment on column public.shot_preparation_drafts.source_video_duration_seconds is
  'Duration of the approved source video. This bounds source ranges and is distinct from video_duration_seconds, the composed shot playback duration.';

update public.shot_preparation_drafts draft
set source_video_duration_seconds = (
  select max((segment ->> 'end_seconds')::numeric) as duration_seconds
  from jsonb_array_elements(draft.clip_segments) segment
  where jsonb_typeof(segment) = 'object'
    and jsonb_typeof(segment -> 'end_seconds') = 'number'
)
where draft.selected_material_revision_id is not null
  and jsonb_typeof(draft.clip_segments) = 'array';

create function public.save_shot_workbench_composition_draft(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_material_revision_id uuid,
  p_clip_segments jsonb,
  p_composition jsonb,
  p_source_video_duration_seconds numeric,
  p_audio_mode text,
  p_subtitle_text text,
  p_subtitles_enabled boolean,
  p_tts_text text,
  p_tts_voice text,
  p_tts_speaking_rate numeric
)
returns public.shot_preparation_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.shot_preparation_drafts;
  composition_changed boolean;
  source_duration_changed boolean;
begin
  if jsonb_typeof(p_clip_segments) <> 'array'
    or not public.is_valid_shot_composition(p_composition, jsonb_array_length(p_clip_segments)) then
    raise exception 'Shot composition is invalid' using errcode = '22023';
  end if;
  if p_source_video_duration_seconds is null
    or p_source_video_duration_seconds <= 0
    or p_source_video_duration_seconds > 86400 then
    raise exception 'Approved source video duration is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_clip_segments) segment
    where jsonb_typeof(segment) <> 'object'
      or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'end_seconds')::numeric > p_source_video_duration_seconds
  ) then
    raise exception 'Every media range must be valid for the approved source' using errcode = '22023';
  end if;

  draft := public.save_shot_workbench_draft(
    p_episode_id, p_review_package_id, p_shot_id, p_material_revision_id, p_clip_segments,
    p_audio_mode, p_subtitle_text, p_subtitles_enabled, p_tts_text, p_tts_voice, p_tts_speaking_rate
  );
  composition_changed := draft.composition is distinct from p_composition;
  source_duration_changed := draft.source_video_duration_seconds is distinct from p_source_video_duration_seconds;
  update public.shot_preparation_drafts target
  set composition = p_composition,
      video_duration_seconds = public.shot_composition_playback_duration(p_clip_segments, p_composition),
      source_video_duration_seconds = p_source_video_duration_seconds,
      frozen_at = case when composition_changed or source_duration_changed then null else target.frozen_at end,
      frozen_by = case when composition_changed or source_duration_changed then null else target.frozen_by end,
      confirmation_status = case when composition_changed or source_duration_changed then 'pending' else target.confirmation_status end,
      confirmation_reason = case when composition_changed or source_duration_changed then null else target.confirmation_reason end,
      confirmed_at = case when composition_changed or source_duration_changed then null else target.confirmed_at end,
      confirmed_by = case when composition_changed or source_duration_changed then null else target.confirmed_by end,
      updated_at = now()
  where target.id = draft.id
  returning * into draft;
  return draft;
end;
$$;

revoke all on function public.save_shot_workbench_composition_draft(uuid, uuid, text, uuid, jsonb, jsonb, numeric, text, text, boolean, text, text, numeric) from public, anon;
grant execute on function public.save_shot_workbench_composition_draft(uuid, uuid, text, uuid, jsonb, jsonb, numeric, text, text, boolean, text, text, numeric) to authenticated;

revoke all on function public.save_shot_workbench_composition_draft(uuid, uuid, text, uuid, jsonb, jsonb, text, text, boolean, text, text, numeric) from authenticated;
drop function public.save_shot_workbench_composition_draft(uuid, uuid, text, uuid, jsonb, jsonb, text, text, boolean, text, text, numeric);

create or replace function public.copy_shot_composition_to_revised_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.shot_preparation_drafts;
begin
  select draft.* into previous
  from public.shot_preparation_drafts draft
  where draft.episode_id = new.episode_id
    and draft.shot_id = new.shot_id
    and draft.review_package_id <> new.review_package_id
  order by (draft.input_fingerprint = new.input_fingerprint) desc, draft.updated_at desc, draft.id desc
  limit 1;
  if found then
    update public.shot_preparation_drafts
    set composition = previous.composition,
        source_video_duration_seconds = previous.source_video_duration_seconds
    where id = new.id;
  end if;
  return new;
end;
$$;

create function public._required_source_duration_replace(p_definition text, p_old text, p_new text, p_context text)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if position(p_old in p_definition) = 0 then
    raise exception '% source-duration patch target was not found', p_context;
  end if;
  return replace(p_definition, p_old, p_new);
end;
$$;

do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure);
  definition := public._required_source_duration_replace(
    definition,
    'or draft.video_duration_seconds is null or draft.video_duration_seconds <= 0',
    'or draft.video_duration_seconds is null or draft.video_duration_seconds <= 0 or draft.source_video_duration_seconds is null or draft.source_video_duration_seconds <= 0',
    'confirm_shot_sync_preview source duration presence'
  );
  definition := public._required_source_duration_replace(
    definition,
    '(segment ->> ''end_seconds'')::numeric > draft.video_duration_seconds',
    '(segment ->> ''end_seconds'')::numeric > draft.source_video_duration_seconds',
    'confirm_shot_sync_preview source range bound'
  );
  execute definition;
end;
$$;

drop function public._required_source_duration_replace(text, text, text, text);
