do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean,text,text,numeric)'::regprocedure) into definition;
  if definition is null then raise exception 'save_shot_preparation_draft is required'; end if;
  patched := replace(definition,
    'case when p_audio_mode = ''none'' then ''ready'' when audio_changed then ''pending'' else coalesce(existing_draft.audio_status, ''pending'') end',
    'case when p_audio_mode in (''none'', ''source'') then ''ready'' when audio_changed then ''pending'' else coalesce(existing_draft.audio_status, ''pending'') end');
  patched := replace(patched,
    'case when mode_changed and p_audio_mode <> ''source'' then null else existing_draft.source_audio_error end',
    'case when p_audio_mode = ''source'' then null else existing_draft.source_audio_error end');
  patched := replace(patched,
    'current_audio_track_id = case when excluded.audio_mode = ''none'' or excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.current_audio_track_id end',
    'current_audio_track_id = case when excluded.audio_mode in (''none'', ''source'') or excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.current_audio_track_id end');
  patched := replace(patched,
    'source_audio_error = excluded.source_audio_error,',
    'source_audio_error = null,
    source_audio_duration_seconds = null,');
  patched := replace(patched,
    'pending_source_audio_task_id = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.pending_source_audio_task_id end,',
    'pending_source_audio_task_id = null,');
  if patched = definition then raise exception 'Shot audio mode state clauses were not found'; end if;
  execute patched;
end;
$$;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.save_shot_workbench_draft(uuid,uuid,text,uuid,jsonb,text,text,boolean,text,text,numeric)'::regprocedure) into definition;
  if definition is null then raise exception 'save_shot_workbench_draft is required'; end if;
  patched := replace(definition,
    'audio_status = case when changed and audio_mode = ''source'' then ''pending'' else audio_status end',
    'audio_status = case when audio_mode in (''none'', ''source'') then ''ready'' else audio_status end');
  patched := replace(patched,
    'source_audio_error = case when changed and audio_mode = ''source'' then null else source_audio_error end,',
    'source_audio_error = null,
      source_audio_duration_seconds = null,');
  patched := replace(patched,
    'pending_source_audio_task_id = case when changed and audio_mode = ''source'' then null else pending_source_audio_task_id end,',
    'pending_source_audio_task_id = null,');
  if patched = definition then raise exception 'Shot workbench audio mode state clause was not found'; end if;
  execute patched;
end;
$$;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.create_shot_preparation_review_package(uuid,uuid)'::regprocedure) into definition;
  if definition is null then raise exception 'create_shot_preparation_review_package is required'; end if;
  patched := replace(definition,
    'draft.audio_mode = ''source'' then coalesce(draft.source_audio_duration_seconds, draft.video_duration_seconds)',
    'draft.audio_mode = ''source'' then draft.video_duration_seconds');
  if patched = definition then raise exception 'Package source duration clause was not found'; end if;
  execute patched;

  select pg_get_functiondef('public.freeze_shot_preparation_batch(uuid,uuid)'::regprocedure) into definition;
  if definition is null then raise exception 'freeze_shot_preparation_batch is required'; end if;
  patched := replace(definition,
    'draft.audio_mode = ''source'' then coalesce(draft.source_audio_duration_seconds, draft.video_duration_seconds)',
    'draft.audio_mode = ''source'' then draft.video_duration_seconds');
  if patched = definition then raise exception 'Freeze source duration clause was not found'; end if;
  execute patched;

  select pg_get_functiondef('public.generate_shot_review_video(uuid,uuid,jsonb,boolean,text)'::regprocedure) into definition;
  if definition is null then raise exception 'generate_shot_review_video is required'; end if;
  patched := replace(definition,
    'draft.audio_mode = ''source'' then coalesce(draft.source_audio_duration_seconds, draft.video_duration_seconds)',
    'draft.audio_mode = ''source'' then draft.video_duration_seconds');
  if patched = definition then raise exception 'Review video source duration clause was not found'; end if;
  execute patched;

  select pg_get_functiondef('public.confirm_shot_preparation(uuid,uuid,text,text,boolean)'::regprocedure) into definition;
  if definition is null then raise exception 'confirm_shot_preparation is required'; end if;
  patched := replace(definition,
    '  if draft.audio_mode = ''none'' then' || chr(10) || '    audio_duration := null;' || chr(10) || '  else',
    '  if draft.audio_mode = ''none'' then' || chr(10) || '    audio_duration := null;' || chr(10) || '  elsif draft.audio_mode = ''source'' then' || chr(10) || '    audio_duration := video_duration;' || chr(10) || '  else');
  if patched = definition then raise exception 'Confirm source duration clause was not found'; end if;
  execute patched;
end;
$$;

revoke all on function public.generate_shot_source_audio(uuid, uuid, text, boolean) from public, anon, authenticated;
