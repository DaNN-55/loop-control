create or replace function public.restore_completed_shot_tts_track(p_draft_id uuid, p_task_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  draft public.shot_preparation_drafts;
  track public.audio_tracks;
begin
  select * into draft
  from public.shot_preparation_drafts
  where id = p_draft_id
  for update;

  if not found or draft.audio_mode <> 'tts' then return false; end if;

  select * into track
  from public.audio_tracks candidate
  where candidate.episode_id = draft.episode_id
    and candidate.source_review_package_id = draft.review_package_id
    and candidate.cue_id = draft.shot_id
    and candidate.track_kind = 'narration'
    and candidate.source_task_id = p_task_id
  order by candidate.created_at desc
  limit 1;

  if not found then return false; end if;

  update public.shot_preparation_drafts
  set current_audio_track_id = track.id,
      current_tts_task_id = p_task_id,
      pending_tts_task_id = null,
      tts_actual_duration_seconds = track.duration_seconds,
      audio_status = 'ready',
      tts_error = null,
      updated_at = now()
  where id = draft.id;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  select episode.account_id, draft.episode_id, 'shot_tts_completed_track_reused',
    jsonb_build_object('task_id', p_task_id, 'audio_track_id', track.id, 'review_package_id', draft.review_package_id, 'shot_id', draft.shot_id),
    auth.uid()
  from public.episodes episode
  where episode.id = draft.episode_id;

  return true;
end;
$$;

do $migration$
declare
  definition text;
  patched text;
  old_reuse constant text := '  if found and existing_task.status in (''ready'', ''running'', ''completed'') then return existing_task; end if;';
  new_reuse constant text := '  if found and existing_task.status in (''ready'', ''running'') then return existing_task; end if;
  if found and existing_task.status = ''completed'' and public.restore_completed_shot_tts_track(draft.id, existing_task.id) then return existing_task; end if;';
begin
  select pg_get_functiondef('public.generate_shot_tts(uuid,uuid,text,boolean)'::regprocedure) into definition;
  if position(new_reuse in definition) > 0 and position(old_reuse in definition) = 0 then return; end if;
  if position(old_reuse in definition) = 0 then raise exception 'generate_shot_tts completed-task reuse patch target missing'; end if;
  patched := replace(definition, old_reuse, new_reuse);
  if position(new_reuse in patched) = 0 or position(old_reuse in patched) > 0 then raise exception 'generate_shot_tts completed-task reuse patch failed'; end if;
  execute patched;
end;
$migration$;

revoke all on function public.restore_completed_shot_tts_track(uuid,uuid) from public,anon,authenticated;
