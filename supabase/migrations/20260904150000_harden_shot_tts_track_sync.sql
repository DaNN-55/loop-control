create or replace function public.sync_shot_tts_audio_after_insert()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  source_task public.tasks;
begin
  select task.* into source_task
  from public.tasks task
  where task.id = new.source_task_id;
  if not found then return new; end if;

  if source_task.task_type <> 'generate_narration'
    or source_task.status <> 'completed'
    or new.track_kind <> 'narration'
    or source_task.input_snapshot #>> '{shot_preparation,draft_id}' is null then
    return new;
  end if;

  update public.shot_preparation_drafts
  set current_audio_track_id = new.id,
      current_tts_task_id = new.source_task_id,
      pending_tts_task_id = null,
      audio_status = 'ready',
      tts_actual_duration_seconds = new.duration_seconds,
      tts_error = null,
      updated_at = now()
  where id = (source_task.input_snapshot #>> '{shot_preparation,draft_id}')::uuid
    and episode_id = source_task.episode_id
    and audio_mode = 'tts'
    and pending_tts_task_id = new.source_task_id
    and new.episode_id = source_task.episode_id
    and new.source_review_package_id is not distinct from review_package_id
    and new.cue_id is not distinct from shot_id;
  return new;
end;
$$;

revoke all on function public.sync_shot_tts_audio_after_insert() from public, anon, authenticated;
