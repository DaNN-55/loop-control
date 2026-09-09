create or replace function public.shot_duration_settings(p_episode_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  composition jsonb;
  frame_rate numeric := 30;
  allowed_frames integer := 2;
  candidate numeric;
begin
  select series_version.rules -> 'hyperframes_composition'
    into composition
  from public.episodes episode
  left join public.series_versions series_version on series_version.id = episode.series_version_id
  where episode.id = p_episode_id;

  if jsonb_typeof(composition -> 'frame_rate') = 'number' then
    candidate := (composition ->> 'frame_rate')::numeric;
    if candidate > 0 then frame_rate := candidate; end if;
  end if;
  if jsonb_typeof(composition -> 'allowed_frames') = 'number' then
    candidate := (composition ->> 'allowed_frames')::numeric;
    if candidate >= 0 and candidate = trunc(candidate) then allowed_frames := candidate::integer; end if;
  end if;
  return jsonb_build_object('frame_rate', frame_rate, 'allowed_frames', allowed_frames);
end;
$$;

create or replace function public.shot_duration_decision(
  p_audio_mode text,
  p_actual_audio_duration_seconds numeric,
  p_clip_duration_seconds numeric,
  p_planned_duration_seconds numeric,
  p_frame_rate numeric default 30,
  p_allowed_frames integer default 2,
  p_studio_adopted_duration_seconds numeric default null
)
returns jsonb
language plpgsql
immutable
as $$
declare
  actual_audio numeric := case when p_audio_mode = 'none' or p_actual_audio_duration_seconds is null or p_actual_audio_duration_seconds <= 0 then null else p_actual_audio_duration_seconds end;
  clip_duration numeric := case when p_clip_duration_seconds is null or p_clip_duration_seconds <= 0 then null else p_clip_duration_seconds end;
  studio_duration numeric := case when coalesce(p_studio_adopted_duration_seconds, p_clip_duration_seconds) is null or coalesce(p_studio_adopted_duration_seconds, p_clip_duration_seconds) <= 0 then null else coalesce(p_studio_adopted_duration_seconds, p_clip_duration_seconds) end;
  av_delta numeric := case when p_audio_mode = 'none' or clip_duration is null or actual_audio is null then null else actual_audio - clip_duration end;
  plan_delta numeric := case when studio_duration is null then null else studio_duration - p_planned_duration_seconds end;
  tolerance numeric;
  status text;
begin
  if p_audio_mode not in ('none', 'source', 'tts') or p_planned_duration_seconds is null or p_planned_duration_seconds <= 0 or p_frame_rate is null or p_frame_rate <= 0 or p_allowed_frames is null or p_allowed_frames < 0 then
    raise exception 'Invalid shot duration decision inputs' using errcode = '22023';
  end if;
  tolerance := p_allowed_frames / p_frame_rate;
  status := case
    when clip_duration is null then 'pending'
    when p_audio_mode = 'none' then 'not_applicable'
    when actual_audio is null then 'pending'
    when abs(av_delta) <= tolerance then 'synchronized'
    else 'needs_attention'
  end;
  return jsonb_build_object(
    'version', 'shot-duration/v1',
    'audio_mode', p_audio_mode,
    'planned_duration_seconds', p_planned_duration_seconds,
    'clip_duration_seconds', clip_duration,
    'actual_audio_duration_seconds', actual_audio,
    'studio_adopted_duration_seconds', studio_duration,
    'audio_video_delta_seconds', av_delta,
    'plan_delta_seconds', plan_delta,
    'frame_rate', p_frame_rate,
    'allowed_frames', p_allowed_frames,
    'frame_tolerance_seconds', tolerance,
    'status', status
  );
end;
$$;

create or replace function public._required_text_replace(p_definition text, p_source text, p_replacement text, p_label text)
returns text
language plpgsql
immutable
as $$
begin
  if position(p_source in p_definition) = 0 then
    raise exception 'Migration patch did not match: %', p_label;
  end if;
  return replace(p_definition, p_source, p_replacement);
end;
$$;

do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.request_review_render_revision(uuid, jsonb, text)'::regprocedure);
  definition := public._required_text_replace(definition, '''sfx_gain_db'', ''studio_project''))', '''sfx_gain_db'', ''studio_project'', ''frame_rate'', ''allowed_frames''))', 'studio revision duration keys');
  definition := public._required_text_replace(definition, '    or jsonb_typeof(p_composition -> ''sfx_gain_db'') <> ''number''' || chr(10) || '    or (p_composition ? ''studio_project'' and (', '    or jsonb_typeof(p_composition -> ''sfx_gain_db'') <> ''number''' || chr(10) || '    or jsonb_typeof(p_composition -> ''frame_rate'') <> ''number''' || chr(10) || '    or (p_composition ->> ''frame_rate'')::numeric <= 0' || chr(10) || '    or jsonb_typeof(p_composition -> ''allowed_frames'') <> ''number''' || chr(10) || '    or (p_composition ->> ''allowed_frames'')::numeric < 0' || chr(10) || '    or (p_composition ->> ''allowed_frames'')::numeric <> trunc((p_composition ->> ''allowed_frames'')::numeric)' || chr(10) || '    or (p_composition ? ''studio_project'' and (', 'studio revision duration validation');
  definition := public._required_text_replace(definition, '  select * into selected_episode from public.episodes where id = selected_package.episode_id;', '  select * into selected_episode from public.episodes where id = selected_package.episode_id;' || chr(10) || '  if (p_composition ->> ''frame_rate'')::numeric <> (public.shot_duration_settings(selected_episode.id) ->> ''frame_rate'')::numeric or (p_composition ->> ''allowed_frames'')::integer <> (public.shot_duration_settings(selected_episode.id) ->> ''allowed_frames'')::integer then raise exception ''Studio duration settings must match the frozen shot duration settings'' using errcode = ''22023''; end if;', 'studio revision duration freeze');
  execute definition;

  definition := pg_get_functiondef('public.create_shot_preparation_review_package(uuid, uuid)'::regprocedure);
  definition := public._required_text_replace(definition, '  next_revision integer;', '  next_revision integer;' || chr(10) || '  duration_settings jsonb;' || chr(10) || '  duration_decision jsonb;', 'package duration declarations');
  definition := public._required_text_replace(definition, '  if not found or not public.has_current_shot_preparation_snapshot(p_episode_id, p_storyboard_review_package_id) then return; end if;', '  if not found or not public.has_current_shot_preparation_snapshot(p_episode_id, p_storyboard_review_package_id) then return; end if;' || chr(10) || '  duration_settings := public.shot_duration_settings(p_episode_id);', 'package duration settings');
  definition := public._required_text_replace(definition, '    member := jsonb_build_object(', '    duration_decision := public.shot_duration_decision(draft.audio_mode, case when draft.audio_mode = ''none'' then null when draft.audio_mode = ''source'' then coalesce(draft.source_audio_duration_seconds, draft.video_duration_seconds) else draft.tts_actual_duration_seconds end, draft.video_duration_seconds, (shot ->> ''durationSeconds'')::numeric, (duration_settings ->> ''frame_rate'')::numeric, (duration_settings ->> ''allowed_frames'')::integer, draft.video_duration_seconds);' || chr(10) || '    member := jsonb_build_object(', 'package duration decision');
  definition := public._required_text_replace(definition, '      ''clip_segments'', draft.clip_segments, ''duration_seconds'', draft.video_duration_seconds,', '      ''clip_segments'', draft.clip_segments, ''duration_seconds'', draft.video_duration_seconds, ''duration_decision'', duration_decision,', 'package member decision');
  definition := public._required_text_replace(definition, '      ''subtitle_text'', draft.subtitle_text, ''subtitles_enabled'', draft.subtitles_enabled' || chr(10) || '    ));', '      ''subtitle_text'', draft.subtitle_text, ''subtitles_enabled'', draft.subtitles_enabled, ''duration_decision'', duration_decision' || chr(10) || '    ));', 'package confirmed decision');
  execute definition;

  definition := pg_get_functiondef('public.freeze_shot_preparation_batch(uuid, uuid)'::regprocedure);
  definition := public._required_text_replace(definition, '  delta numeric;', '  duration_settings jsonb;' || chr(10) || '  duration_decision jsonb;', 'freeze duration declarations');
  definition := public._required_text_replace(definition, '  if not found then raise exception ''The current storyboard package is required'' using errcode = ''22023''; end if;', '  if not found then raise exception ''The current storyboard package is required'' using errcode = ''22023''; end if;' || chr(10) || '  duration_settings := public.shot_duration_settings(p_episode_id);', 'freeze duration settings');
  definition := public._required_text_replace(definition, '    delta := draft.video_duration_seconds - (selected_shot ->> ''durationSeconds'')::numeric;', '    duration_decision := public.shot_duration_decision(draft.audio_mode, case when draft.audio_mode = ''none'' then null when draft.audio_mode = ''source'' then coalesce(draft.source_audio_duration_seconds, draft.video_duration_seconds) else draft.tts_actual_duration_seconds end, draft.video_duration_seconds, (selected_shot ->> ''durationSeconds'')::numeric, (duration_settings ->> ''frame_rate'')::numeric, (duration_settings ->> ''allowed_frames'')::integer, draft.video_duration_seconds);', 'freeze duration decision');
  definition := public._required_text_replace(definition, 'abs(delta) > 0.05', '(duration_decision ->> ''status'') = ''needs_attention''', 'freeze duration warning');
  execute definition;

  definition := pg_get_functiondef('public.confirm_shot_preparation(uuid, uuid, text, text, boolean)'::regprocedure);
  definition := public._required_text_replace(definition, '  decision text;', '  decision text;' || chr(10) || '  duration_settings jsonb;' || chr(10) || '  duration_decision jsonb;', 'confirm duration declarations');
  definition := public._required_text_replace(definition, '  video_delta := video_duration - (selected_shot ->> ''durationSeconds'')::numeric;' || chr(10) || '  audio_delta := case when audio_duration is null then null else audio_duration - (selected_shot ->> ''durationSeconds'')::numeric end;' || chr(10) || '  has_warning := abs(video_delta) > 0.05 or coalesce(abs(audio_delta) > 0.05, false);', '  duration_settings := public.shot_duration_settings(p_episode_id);' || chr(10) || '  duration_decision := public.shot_duration_decision(draft.audio_mode, audio_duration, video_duration, (selected_shot ->> ''durationSeconds'')::numeric, (duration_settings ->> ''frame_rate'')::numeric, (duration_settings ->> ''allowed_frames'')::integer, video_duration);' || chr(10) || '  video_delta := (duration_decision ->> ''plan_delta_seconds'')::numeric;' || chr(10) || '  audio_delta := (duration_decision ->> ''audio_video_delta_seconds'')::numeric;' || chr(10) || '  has_warning := (duration_decision ->> ''status'') = ''needs_attention'';', 'confirm duration decision');
  definition := public._required_text_replace(definition, '''audio_delta_seconds'', audio_delta, ''reason'', btrim(p_reason)', '''audio_delta_seconds'', audio_delta, ''duration_decision'', duration_decision, ''reason'', btrim(p_reason)', 'confirm warning audit decision');
  definition := public._required_text_replace(definition, '''warning_decision'', decision, ''reason'', btrim(p_reason)', '''warning_decision'', decision, ''duration_decision'', duration_decision, ''reason'', btrim(p_reason)', 'confirm audit decision');
  execute definition;

  definition := pg_get_functiondef('public.orchestrate_review_render_tasks(uuid)'::regprocedure);
  definition := public._required_text_replace(definition, '''subtitles_enabled'', (member.evidence_snapshot ->> ''subtitles_enabled'')::boolean,', '''subtitles_enabled'', (member.evidence_snapshot ->> ''subtitles_enabled'')::boolean,' || chr(10) || '      ''duration_decision'', member.evidence_snapshot -> ''duration_decision'',', 'worker member decision');
  definition := public._required_text_replace(definition, '"sfx_gain_db":-6}', '"sfx_gain_db":-6,"frame_rate":30,"allowed_frames":2}', 'worker default duration settings');
  execute definition;
end;
$$;

drop function public._required_text_replace(text, text, text, text);

revoke all on function public.shot_duration_settings(uuid) from public, anon, authenticated;
revoke all on function public.shot_duration_decision(text, numeric, numeric, numeric, numeric, integer, numeric) from public, anon, authenticated;
