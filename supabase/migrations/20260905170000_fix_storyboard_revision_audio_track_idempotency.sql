create or replace function public.seed_shot_preparation_drafts_after_storyboard_approval()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  episode_record public.episodes;
  package_record public.review_packages;
  narration_policy jsonb;
  voice jsonb;
  shot jsonb;
  previous public.shot_preparation_drafts;
begin
  if new.stage <> 'storyboard_approved' or new.decision <> 'approved' or new.review_package_id is null then return new; end if;
  select episode.* into episode_record from public.episodes episode where episode.id = new.episode_id;
  select package.* into package_record
  from public.review_packages package
  where package.id = new.review_package_id
    and package.episode_id = new.episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null;
  if not found or episode_record.stage <> 'storyboard_approved' then return new; end if;

  narration_policy := (select blueprint.policy -> 'narration' from public.account_blueprint_versions blueprint where blueprint.id = episode_record.blueprint_version_id);
  voice := narration_policy -> 'voice';
  for shot in select value from jsonb_array_elements(coalesce(package_record.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    select draft.* into previous
    from public.shot_preparation_drafts draft
    where draft.episode_id = episode_record.id
      and draft.shot_id = shot ->> 'id'
      and draft.input_fingerprint = md5(shot::text)
    order by draft.updated_at desc
    limit 1;
    insert into public.shot_preparation_drafts (episode_id, review_package_id, shot_id, input_fingerprint, audio_mode, video_status, audio_status, confirmation_status, subtitle_text, subtitles_enabled, tts_voice, tts_speaking_rate, current_video_artifact_id, current_video_task_id, current_audio_track_id, current_tts_task_id, selected_material_revision_id, clip_start_seconds, clip_end_seconds, video_duration_seconds, tts_actual_duration_seconds, warning_decision, warning_reason, warning_accepted_at, warning_accepted_by, confirmation_reason, confirmed_at, confirmed_by, skipped_at, skipped_by)
    values (episode_record.id, package_record.id, shot ->> 'id', md5(shot::text), coalesce(previous.audio_mode, 'tts'), case when previous.current_video_artifact_id is not null then 'ready' else 'pending' end, case when coalesce(previous.audio_mode, 'tts') = 'none' or previous.current_audio_track_id is not null then 'ready' else 'pending' end, case when previous.id is not null and previous.confirmation_status in ('confirmed', 'skipped') then previous.confirmation_status else 'pending' end, coalesce(previous.subtitle_text, btrim(shot ->> 'scriptSegment')), coalesce(previous.subtitles_enabled, true), coalesce(previous.tts_voice, nullif(btrim(voice ->> 'name'), '')), coalesce(previous.tts_speaking_rate, case when (voice ->> 'speaking_rate') ~ '^[0-9]+([.][0-9]+)?$' then (voice ->> 'speaking_rate')::numeric else null end), previous.current_video_artifact_id, previous.current_video_task_id, previous.current_audio_track_id, previous.current_tts_task_id, previous.selected_material_revision_id, previous.clip_start_seconds, previous.clip_end_seconds, previous.video_duration_seconds, previous.tts_actual_duration_seconds, coalesce(previous.warning_decision, 'not_required'), previous.warning_reason, previous.warning_accepted_at, previous.warning_accepted_by, previous.confirmation_reason, previous.confirmed_at, previous.confirmed_by, previous.skipped_at, previous.skipped_by)
    on conflict (episode_id, review_package_id, shot_id) do nothing;
  end loop;

  insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds)
  select episode_record.id, old_track.source_task_id, old_track.source_artifact_id, package_record.id, old_track.track_kind, old_track.cue_id, old_track.relative_path, old_track.sha256, old_track.file_size, old_track.start_seconds, old_track.duration_seconds
  from public.shot_preparation_drafts current_draft
  join public.shot_preparation_drafts old_draft on old_draft.episode_id = current_draft.episode_id and old_draft.shot_id = current_draft.shot_id and old_draft.input_fingerprint = current_draft.input_fingerprint and old_draft.review_package_id <> current_draft.review_package_id
  join public.audio_tracks old_track on old_track.id = old_draft.current_audio_track_id
  where current_draft.review_package_id = package_record.id
    and not exists (
      select 1 from public.audio_tracks existing
      where existing.episode_id = episode_record.id
        and existing.source_review_package_id = package_record.id
        and existing.track_kind = old_track.track_kind
        and existing.cue_id = old_track.cue_id
        and existing.source_task_id = old_track.source_task_id
        and existing.source_artifact_id = old_track.source_artifact_id
    );

  update public.shot_preparation_drafts current_draft
  set current_audio_track_id = new_track.id, audio_status = 'ready', updated_at = now()
  from public.shot_preparation_drafts old_draft
  join public.audio_tracks old_track on old_track.id = old_draft.current_audio_track_id
  join public.audio_tracks new_track on new_track.episode_id = episode_record.id and new_track.source_review_package_id = package_record.id and new_track.source_task_id = old_track.source_task_id and new_track.cue_id = old_track.cue_id
  where current_draft.review_package_id = package_record.id
    and old_draft.episode_id = current_draft.episode_id
    and old_draft.shot_id = current_draft.shot_id
    and old_draft.input_fingerprint = current_draft.input_fingerprint
    and old_draft.review_package_id <> current_draft.review_package_id;
  return new;
end;
$$;

do $$
declare
  definition text;
  patched text;
  old_audio_insert text;
  new_audio_insert text;
begin
  select pg_get_functiondef('public.reuse_shot_preparation_history_after_storyboard_approval()'::regprocedure) into definition;
  if definition is null then raise exception 'reuse_shot_preparation_history_after_storyboard_approval is required'; end if;
  old_audio_insert := $old$      insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds)
      values (episode_record.id, old_track.source_task_id, old_track.source_artifact_id, package_record.id, old_track.track_kind, old_track.cue_id, old_track.relative_path, old_track.sha256, old_track.file_size, old_track.start_seconds, old_track.duration_seconds)
      on conflict (episode_id, track_kind, cue_id, source_review_package_id) do nothing;$old$;
  new_audio_insert := $new$      insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds)
      select episode_record.id, old_track.source_task_id, old_track.source_artifact_id, package_record.id, old_track.track_kind, old_track.cue_id, old_track.relative_path, old_track.sha256, old_track.file_size, old_track.start_seconds, old_track.duration_seconds
      where not exists (
        select 1 from public.audio_tracks existing
        where existing.episode_id = episode_record.id
          and existing.source_review_package_id = package_record.id
          and existing.track_kind = old_track.track_kind
          and existing.cue_id = old_track.cue_id
          and existing.source_task_id = old_track.source_task_id
          and existing.source_artifact_id = old_track.source_artifact_id
      );$new$;
  patched := replace(definition, old_audio_insert, new_audio_insert);
  if patched = definition and position(new_audio_insert in definition) = 0 then raise exception 'Audio track idempotency patch target was not found'; end if;
  if patched <> definition then execute patched; end if;
end;
$$;
