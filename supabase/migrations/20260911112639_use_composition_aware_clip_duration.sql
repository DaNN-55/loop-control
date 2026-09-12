create or replace function public.shot_composition_playback_duration(p_clip_segments jsonb, p_composition jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  segment jsonb;
  slot jsonb;
  segment_index integer;
  segment_duration numeric;
  playback_duration numeric := 0;
begin
  if jsonb_typeof(p_clip_segments) <> 'array' or jsonb_array_length(p_clip_segments) = 0 then
    return 0;
  end if;

  if coalesce(p_composition ->> 'layout', 'full') = 'full' then
    for segment in select value from jsonb_array_elements(p_clip_segments)
    loop
      if jsonb_typeof(segment -> 'start_seconds') = 'number'
        and jsonb_typeof(segment -> 'end_seconds') = 'number'
        and (segment ->> 'end_seconds')::numeric > (segment ->> 'start_seconds')::numeric
      then
        playback_duration := playback_duration + (segment ->> 'end_seconds')::numeric - (segment ->> 'start_seconds')::numeric;
      end if;
    end loop;
    return playback_duration;
  end if;

  playback_duration := null;
  for slot in select value from jsonb_array_elements(coalesce(p_composition -> 'slots', '[]'::jsonb))
  loop
    if jsonb_typeof(slot -> 'clipSegmentIndex') <> 'number' then continue; end if;
    segment_index := (slot ->> 'clipSegmentIndex')::integer;
    segment := p_clip_segments -> segment_index;
    if segment is null
      or jsonb_typeof(segment -> 'start_seconds') <> 'number'
      or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
    then
      continue;
    end if;
    segment_duration := (segment ->> 'end_seconds')::numeric - (segment ->> 'start_seconds')::numeric;
    playback_duration := case when playback_duration is null then segment_duration else least(playback_duration, segment_duration) end;
  end loop;
  return coalesce(playback_duration, 0);
end;
$$;

comment on function public.shot_composition_playback_duration(jsonb, jsonb) is
  'Full-screen clips play sequentially and sum; multi-slot clips play in parallel and use the shortest active slot as the rendered window.';

revoke all on function public.shot_composition_playback_duration(jsonb, jsonb) from public, anon, authenticated;

create function public._required_composition_duration_replace(p_definition text, p_old text, p_new text, p_context text)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if position(p_old in p_definition) = 0 then
    raise exception '% composition-duration patch target was not found', p_context;
  end if;
  return replace(p_definition, p_old, p_new);
end;
$$;

do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.save_shot_workbench_composition_draft(uuid,uuid,text,uuid,jsonb,jsonb,text,text,boolean,text,text,numeric)'::regprocedure);
  definition := public._required_composition_duration_replace(
    definition,
    'set composition = p_composition,',
    'set composition = p_composition, video_duration_seconds = public.shot_composition_playback_duration(p_clip_segments, p_composition),',
    'save_shot_workbench_composition_draft'
  );
  execute definition;

  definition := pg_get_functiondef('public.generate_shot_clip(uuid,uuid,text,boolean)'::regprocedure);
  definition := public._required_composition_duration_replace(definition, 'public.clip_segment_union_duration(draft.clip_segments)', 'public.shot_composition_playback_duration(draft.clip_segments, draft.composition)', 'generate_shot_clip');
  execute definition;

  definition := pg_get_functiondef('public.generate_shot_sync_preview(uuid,uuid,text)'::regprocedure);
  definition := public._required_composition_duration_replace(definition, 'public.clip_segment_union_duration(draft.clip_segments)', 'public.shot_composition_playback_duration(draft.clip_segments, draft.composition)', 'generate_shot_sync_preview');
  execute definition;

  definition := pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure);
  definition := public._required_composition_duration_replace(definition, 'public.clip_segment_union_duration(draft.clip_segments)', 'public.shot_composition_playback_duration(draft.clip_segments, draft.composition)', 'confirm_shot_sync_preview');
  execute definition;
end;
$$;

update public.shot_preparation_drafts draft
set video_duration_seconds = public.shot_composition_playback_duration(draft.clip_segments, draft.composition)
where draft.frozen_at is null
  and jsonb_typeof(draft.clip_segments) = 'array'
  and draft.video_duration_seconds is distinct from public.shot_composition_playback_duration(draft.clip_segments, draft.composition);

drop function public._required_composition_duration_replace(text, text, text, text);
