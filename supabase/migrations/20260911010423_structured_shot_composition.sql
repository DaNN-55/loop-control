create function public.is_valid_shot_composition(p_composition jsonb, p_clip_segment_count integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  expected_slots text[];
  slot jsonb;
  slot_index integer := 0;
begin
  if coalesce(jsonb_typeof(p_composition), 'null') <> 'object'
    or coalesce(p_composition ->> 'version', '') <> 'shot-composition/v1'
    or coalesce(jsonb_typeof(p_composition -> 'slots'), 'null') <> 'array' then return false;
  end if;
  expected_slots := case p_composition ->> 'layout'
    when 'full' then array['full']
    when '2up-horizontal' then array['left', 'right']
    when '2up-vertical' then array['top', 'bottom']
    when 'pip' then array['main', 'inset']
    when 'grid-4' then array['top-left', 'top-right', 'bottom-left', 'bottom-right']
    else null
  end;
  if expected_slots is null or jsonb_array_length(p_composition -> 'slots') <> cardinality(expected_slots) then return false; end if;
  for slot in select value from jsonb_array_elements(p_composition -> 'slots') loop
    slot_index := slot_index + 1;
    if coalesce(jsonb_typeof(slot), 'null') <> 'object'
      or coalesce(slot ->> 'id', '') <> expected_slots[slot_index]
      or coalesce(slot ->> 'fit', '') not in ('cover', 'contain')
      or coalesce(jsonb_typeof(slot -> 'clipSegmentIndex'), 'null') <> 'number'
      or (slot ->> 'clipSegmentIndex')::numeric <> trunc((slot ->> 'clipSegmentIndex')::numeric)
      or (slot ->> 'clipSegmentIndex')::integer < 0
      or (slot ->> 'clipSegmentIndex')::integer >= greatest(p_clip_segment_count, 1)
      or coalesce(jsonb_typeof(slot -> 'focalPoint'), 'null') <> 'object'
      or coalesce(jsonb_typeof(slot #> '{focalPoint,x}'), 'null') <> 'number'
      or coalesce(jsonb_typeof(slot #> '{focalPoint,y}'), 'null') <> 'number'
      or (slot #>> '{focalPoint,x}')::numeric not between 0 and 1
      or (slot #>> '{focalPoint,y}')::numeric not between 0 and 1 then return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

alter table public.shot_preparation_drafts
  add column composition jsonb not null default '{"version":"shot-composition/v1","layout":"full","slots":[{"id":"full","clipSegmentIndex":0,"fit":"cover","focalPoint":{"x":0.5,"y":0.5}}]}'::jsonb;

alter table public.shot_preparation_drafts
  add constraint shot_preparation_drafts_composition_check
  check (public.is_valid_shot_composition(composition, 2147483647));

create or replace function public.protect_frozen_shot_preparation_inputs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_stage public.episode_stage;
begin
  select stage into current_stage from public.episodes where id = old.episode_id;
  if old.frozen_at is not null
    and current_stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review')
    and (
      old.selected_material_revision_id is distinct from new.selected_material_revision_id
      or old.clip_segments is distinct from new.clip_segments
      or old.composition is distinct from new.composition
      or old.audio_mode is distinct from new.audio_mode
      or old.tts_text is distinct from new.tts_text
      or old.tts_voice is distinct from new.tts_voice
      or old.tts_speaking_rate is distinct from new.tts_speaking_rate
      or old.subtitle_text is distinct from new.subtitle_text
      or old.subtitles_enabled is distinct from new.subtitles_enabled
    ) then
    raise exception 'Frozen shot drafts cannot be edited; create a new storyboard revision' using errcode = '22023';
  end if;
  return new;
end;
$$;

create function public.save_shot_workbench_composition_draft(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_material_revision_id uuid,
  p_clip_segments jsonb,
  p_composition jsonb,
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
begin
  if jsonb_typeof(p_clip_segments) <> 'array'
    or not public.is_valid_shot_composition(p_composition, jsonb_array_length(p_clip_segments)) then
    raise exception 'Shot composition is invalid' using errcode = '22023';
  end if;
  draft := public.save_shot_workbench_draft(p_episode_id, p_review_package_id, p_shot_id, p_material_revision_id, p_clip_segments, p_audio_mode, p_subtitle_text, p_subtitles_enabled, p_tts_text, p_tts_voice, p_tts_speaking_rate);
  composition_changed := draft.composition is distinct from p_composition;
  update public.shot_preparation_drafts target
  set composition = p_composition,
      frozen_at = case when composition_changed then null else target.frozen_at end,
      frozen_by = case when composition_changed then null else target.frozen_by end,
      confirmation_status = case when composition_changed then 'pending' else target.confirmation_status end,
      confirmation_reason = case when composition_changed then null else target.confirmation_reason end,
      confirmed_at = case when composition_changed then null else target.confirmed_at end,
      confirmed_by = case when composition_changed then null else target.confirmed_by end,
      updated_at = now()
  where target.id = draft.id
  returning * into draft;
  return draft;
end;
$$;

create function public.copy_shot_composition_to_revised_draft()
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
    update public.shot_preparation_drafts set composition = previous.composition where id = new.id;
  end if;
  return new;
end;
$$;

create trigger copy_shot_composition_to_revised_draft
after insert on public.shot_preparation_drafts
for each row execute function public.copy_shot_composition_to_revised_draft();

do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef('public.create_shot_preparation_review_package(uuid, uuid)'::regprocedure);
  patched := replace(definition,
    '''clip_segments'', draft.clip_segments, ''duration_seconds'', draft.video_duration_seconds,',
    '''clip_segments'', draft.clip_segments, ''composition'', draft.composition, ''duration_seconds'', draft.video_duration_seconds,');
  patched := replace(patched,
    '''source_material_revision_id'', material.id, ''clip_segments'', draft.clip_segments,',
    '''source_material_revision_id'', material.id, ''clip_segments'', draft.clip_segments, ''composition'', draft.composition,');
  if patched = definition or position('''composition'', draft.composition' in patched) = 0 then
    raise exception 'create_shot_preparation_review_package composition patch target is unknown';
  end if;
  execute patched;

  definition := pg_get_functiondef('public.orchestrate_review_render_tasks(uuid)'::regprocedure);
  patched := replace(definition,
    '''duration_decision'', member.evidence_snapshot -> ''duration_decision'',',
    '''duration_decision'', member.evidence_snapshot -> ''duration_decision'', ''composition'', member.evidence_snapshot -> ''composition'',');
  if patched = definition then raise exception 'orchestrate_review_render_tasks composition patch target is unknown'; end if;
  execute patched;
end;
$$;

revoke all on function public.is_valid_shot_composition(jsonb, integer) from public, anon, authenticated;
revoke all on function public.save_shot_workbench_composition_draft(uuid, uuid, text, uuid, jsonb, jsonb, text, text, boolean, text, text, numeric) from public, anon;
grant execute on function public.save_shot_workbench_composition_draft(uuid, uuid, text, uuid, jsonb, jsonb, text, text, boolean, text, text, numeric) to authenticated;
revoke all on function public.copy_shot_composition_to_revised_draft() from public, anon, authenticated;
