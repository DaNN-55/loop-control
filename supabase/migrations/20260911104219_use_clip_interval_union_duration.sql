create or replace function public.clip_segment_union_duration(p_clip_segments jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  segment jsonb;
  segment_start numeric;
  segment_end numeric;
  current_start numeric;
  current_end numeric;
  total_duration numeric := 0;
begin
  if p_clip_segments is null or jsonb_typeof(p_clip_segments) <> 'array' then
    return 0;
  end if;

  for segment in
    select value
    from jsonb_array_elements(p_clip_segments)
    where jsonb_typeof(value) = 'object'
    order by
      case when jsonb_typeof(value -> 'start_seconds') = 'number' then (value ->> 'start_seconds')::numeric end,
      case when jsonb_typeof(value -> 'end_seconds') = 'number' then (value ->> 'end_seconds')::numeric end
  loop
    if jsonb_typeof(segment -> 'start_seconds') <> 'number'
      or jsonb_typeof(segment -> 'end_seconds') <> 'number'
    then
      continue;
    end if;
    segment_start := (segment ->> 'start_seconds')::numeric;
    segment_end := (segment ->> 'end_seconds')::numeric;
    if segment_end <= segment_start then
      continue;
    end if;

    if current_start is null then
      current_start := segment_start;
      current_end := segment_end;
    elsif segment_start <= current_end then
      current_end := greatest(current_end, segment_end);
    else
      total_duration := total_duration + current_end - current_start;
      current_start := segment_start;
      current_end := segment_end;
    end if;
  end loop;

  if current_start is not null then
    total_duration := total_duration + current_end - current_start;
  end if;
  return total_duration;
end;
$$;

comment on function public.clip_segment_union_duration(jsonb) is
  'Returns the union duration of source clip intervals so overlapping ranges are counted once.';

revoke all on function public.clip_segment_union_duration(jsonb) from public, anon, authenticated;

create function public._required_clip_duration_replace(p_definition text, p_old text, p_new text, p_context text)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if position(p_old in p_definition) = 0 then
    raise exception '% interval-union patch target was not found', p_context;
  end if;
  return replace(p_definition, p_old, p_new);
end;
$$;

do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.save_shot_workbench_draft(uuid,uuid,text,uuid,jsonb,text,text,boolean,text,text,numeric)'::regprocedure);
  definition := public._required_clip_duration_replace(
    definition,
    'total_duration := total_duration + (segment ->> ''end_seconds'')::numeric - (segment ->> ''start_seconds'')::numeric;',
    'total_duration := public.clip_segment_union_duration(p_clip_segments);',
    'save_shot_workbench_draft'
  );
  execute definition;

  definition := pg_get_functiondef('public.generate_shot_clip(uuid,uuid,text,boolean)'::regprocedure);
  definition := public._required_clip_duration_replace(
    definition,
    'total_duration := total_duration + (segment ->> ''end_seconds'')::numeric - (segment ->> ''start_seconds'')::numeric;',
    'total_duration := public.clip_segment_union_duration(draft.clip_segments);',
    'generate_shot_clip'
  );
  execute definition;

  definition := pg_get_functiondef('public.generate_shot_sync_preview(uuid,uuid,text)'::regprocedure);
  definition := public._required_clip_duration_replace(
    definition,
    'duration_seconds := (select sum((segment ->> ''end_seconds'')::numeric - (segment ->> ''start_seconds'')::numeric) from jsonb_array_elements(draft.clip_segments) segment);',
    'duration_seconds := public.clip_segment_union_duration(draft.clip_segments);',
    'generate_shot_sync_preview duration'
  );
  definition := public._required_clip_duration_replace(
    definition,
    'and task.input_snapshot ->> ''preview_input_fingerprint'' = draft.preparation_input_fingerprint
    and task.status in (''ready'', ''running'', ''completed'')',
    'and task.input_snapshot ->> ''preview_input_fingerprint'' = draft.preparation_input_fingerprint
    and (task.input_snapshot #>> ''{review_render,members,0,duration_seconds}'')::numeric = public.clip_segment_union_duration(draft.clip_segments)
    and task.status in (''ready'', ''running'', ''completed'')',
    'generate_shot_sync_preview cache identity'
  );
  execute definition;

  definition := pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure);
  definition := public._required_clip_duration_replace(
    definition,
    'duration_seconds := (select sum((segment ->> ''end_seconds'')::numeric - (segment ->> ''start_seconds'')::numeric) from jsonb_array_elements(draft.clip_segments) segment);',
    'duration_seconds := public.clip_segment_union_duration(draft.clip_segments);',
    'confirm_shot_sync_preview'
  );
  execute definition;
end;
$$;

update public.shot_preparation_drafts draft
set video_duration_seconds = public.clip_segment_union_duration(draft.clip_segments)
where draft.frozen_at is null
  and jsonb_typeof(draft.clip_segments) = 'array'
  and draft.video_duration_seconds is distinct from public.clip_segment_union_duration(draft.clip_segments);

drop function public._required_clip_duration_replace(text, text, text, text);
