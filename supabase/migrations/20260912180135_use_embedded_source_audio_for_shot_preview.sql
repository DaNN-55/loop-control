create function public._required_embedded_source_audio_replace(
  p_definition text,
  p_old text,
  p_new text,
  p_context text
)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if position(p_old in p_definition) = 0 then
    raise exception '% embedded-source-audio patch target was not found', p_context;
  end if;
  return replace(p_definition, p_old, p_new);
end;
$$;

do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.generate_shot_sync_preview(uuid,uuid,text)'::regprocedure);
  definition := public._required_embedded_source_audio_replace(
    definition,
    E'if draft.audio_mode = \'source\' and (draft.audio_status <> \'ready\' or draft.current_audio_track_id is null or draft.source_audio_duration_seconds is null or draft.source_audio_duration_seconds <= 0) then\n    raise exception \'The source-audio shot needs its current extracted audio evidence\' using errcode = \'22023\';\n  end if;',
    '',
    'generate_shot_sync_preview obsolete extracted-audio gate'
  );
  definition := public._required_embedded_source_audio_replace(
    definition,
    E'case when draft.audio_mode = \'tts\' then draft.tts_actual_duration_seconds when draft.audio_mode = \'source\' then coalesce(draft.source_audio_duration_seconds, duration_seconds) else null end',
    E'case when draft.audio_mode = \'tts\' then draft.tts_actual_duration_seconds when draft.audio_mode = \'source\' then duration_seconds else null end',
    'generate_shot_sync_preview source playback duration'
  );
  definition := public._required_embedded_source_audio_replace(
    definition,
    E'\'audio_track_id\', case when draft.audio_mode = \'none\' then null else draft.current_audio_track_id end',
    E'\'audio_track_id\', case when draft.audio_mode = \'tts\' then draft.current_audio_track_id else null end',
    'generate_shot_sync_preview source audio member'
  );
  execute definition;

  definition := pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure);
  definition := public._required_embedded_source_audio_replace(
    definition,
    E'if draft.audio_mode <> \'none\' and not exists (',
    E'if draft.audio_mode = \'tts\' and not exists (',
    'confirm_shot_sync_preview readable TTS gate'
  );
  definition := public._required_embedded_source_audio_replace(
    definition,
    E'if draft.audio_mode <> \'none\' and draft.audio_status <> \'ready\' then',
    E'if draft.audio_mode = \'tts\' and draft.audio_status <> \'ready\' then',
    'confirm_shot_sync_preview ready TTS gate'
  );
  definition := public._required_embedded_source_audio_replace(
    definition,
    E'case when draft.audio_mode = \'tts\' then draft.tts_actual_duration_seconds when draft.audio_mode = \'source\' then draft.source_audio_duration_seconds else null end',
    E'case when draft.audio_mode = \'tts\' then draft.tts_actual_duration_seconds when draft.audio_mode = \'source\' then duration_seconds else null end',
    'confirm_shot_sync_preview source playback duration'
  );
  execute definition;
end;
$$;

revoke all on function public.generate_shot_sync_preview(uuid, uuid, text) from public, anon;
grant execute on function public.generate_shot_sync_preview(uuid, uuid, text) to authenticated;
revoke all on function public.confirm_shot_sync_preview(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.confirm_shot_sync_preview(uuid, uuid, text, text, text) to authenticated;

comment on function public.generate_shot_sync_preview(uuid, uuid, text) is
  'Queues a synchronized OpenChatCut proxy and editable project. Source mode reads embedded audio directly from the approved video ranges.';

drop function public._required_embedded_source_audio_replace(text, text, text, text);
