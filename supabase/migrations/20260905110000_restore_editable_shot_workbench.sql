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
    and current_stage is distinct from 'storyboard_approved'
    and (
      old.selected_material_revision_id is distinct from new.selected_material_revision_id
      or old.clip_segments is distinct from new.clip_segments
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

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.save_shot_workbench_draft(uuid, uuid, text, uuid, jsonb, text, text, boolean, text, text, numeric)'::regprocedure) into definition;
  patched := replace(
    definition,
    'if draft.frozen_at is not null then raise exception ''Frozen shot drafts cannot be edited'' using errcode = ''22023''; end if;',
    'if draft.frozen_at is not null and not exists (select 1 from public.episodes episode where episode.id = p_episode_id and episode.stage = ''storyboard_approved'') then raise exception ''Frozen shot drafts cannot be edited'' using errcode = ''22023''; end if;'
  );
  if patched = definition then
    raise exception 'save_shot_workbench_draft freeze guard was not found';
  end if;
  execute patched;
end;
$$;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.save_shot_tts_override(uuid, uuid, text, text, numeric)'::regprocedure) into definition;
  patched := replace(
    definition,
    'if draft.frozen_at is not null then raise exception ''Frozen shot drafts cannot be edited'' using errcode = ''22023''; end if;',
    'if draft.frozen_at is not null and not exists (select 1 from public.episodes episode where episode.id = p_episode_id and episode.stage = ''storyboard_approved'') then raise exception ''Frozen shot drafts cannot be edited'' using errcode = ''22023''; end if;'
  );
  if patched = definition then
    raise exception 'save_shot_tts_override freeze guard was not found';
  end if;
  execute patched;
end;
$$;
