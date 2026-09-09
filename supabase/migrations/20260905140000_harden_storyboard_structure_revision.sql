create or replace function public.canonical_storyboard_structure_revision_operation(p_operation jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  case p_operation ->> 'kind'
    when 'add_after' then
      return p_operation || jsonb_build_object('shot', coalesce(p_operation -> 'shot', '{}'::jsonb) - 'id' - 'inputBasis');
    when 'split' then
      return p_operation || jsonb_build_object('parts', coalesce((
        select jsonb_agg(value - 'id' order by ordinality)
        from jsonb_array_elements(coalesce(p_operation -> 'parts', '[]'::jsonb)) with ordinality as part(value, ordinality)
      ), '[]'::jsonb));
    when 'merge' then
      return p_operation - 'newShotId';
    else
      return p_operation;
  end case;
end;
$$;

do $$
declare
  definition text;
  patched_definition text;
begin
  select pg_get_functiondef('public.request_shot_structure_revision(uuid,uuid,jsonb,text)'::regprocedure) into definition;
  if definition is null then raise exception 'request_shot_structure_revision is required'; end if;

  patched_definition := replace(definition,
    $old$request_hash := md5(jsonb_build_object('review_package_id', p_review_package_id, 'operation', p_operation, 'reason', btrim(p_reason))::text);$old$,
    $new$request_hash := md5(jsonb_build_object('review_package_id', p_review_package_id, 'operation', public.canonical_storyboard_structure_revision_operation(p_operation), 'reason', btrim(p_reason))::text);$new$);
  patched_definition := replace(patched_definition,
    $old$  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;
  select task.* into base_task$old$,
    $new$  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;
  if selected_package.revision_number <> (select max(revision_number) from public.review_packages where episode_id = p_episode_id and stage = 'storyboard_review' and invalidated_at is null) then
    raise exception 'The storyboard review package is stale' using errcode = '22023';
  end if;
  select task.* into base_task$new$);
  patched_definition := replace(patched_definition,
    $old$'id', 'shot-' || gen_random_uuid()::text, 'inputBasis', shot -> 'inputBasis'$old$,
    $new$'id', 'shot-' || substr(md5(request_hash || ':add'), 1, 24), 'inputBasis', shot -> 'inputBasis'$new$);
  patched_definition := replace(patched_definition,
    $old$operation := p_operation || jsonb_build_object('parts', (select jsonb_agg(value || jsonb_build_object('id', 'shot-' || gen_random_uuid()::text)) from jsonb_array_elements(p_operation -> 'parts')));$old$,
    $new$operation := p_operation || jsonb_build_object('parts', (select jsonb_agg(value || jsonb_build_object('id', 'shot-' || substr(md5(request_hash || ':split:' || ordinality::text), 1, 24)) order by ordinality) from jsonb_array_elements(p_operation -> 'parts') with ordinality as part(value, ordinality)));$new$);
  patched_definition := replace(patched_definition,
    $old$operation := p_operation || jsonb_build_object('newShotId', 'shot-' || gen_random_uuid()::text);$old$,
    $new$operation := p_operation || jsonb_build_object('newShotId', 'shot-' || substr(md5(request_hash || ':merge'), 1, 24));$new$);
  patched_definition := replace(patched_definition,
    $old$if coalesce(array_length(indexes, 1), 0) <> jsonb_array_length(p_operation -> 'shotIds') or (select max(value) - min(value) + 1 from unnest(indexes) value) <> array_length(indexes, 1) then raise exception 'Only adjacent shots can be merged' using errcode = '22023'; end if;$old$,
    $new$if coalesce(array_length(indexes, 1), 0) <> jsonb_array_length(p_operation -> 'shotIds') or (select max(value) - min(value) + 1 from unnest(indexes) value) <> array_length(indexes, 1) or exists (select 1 from unnest(indexes) with ordinality selected(index_value, position) where index_value <> indexes[1] + position - 1) then raise exception 'Only adjacent shots in storyboard order can be merged' using errcode = '22023'; end if;$new$);
  if patched_definition = definition then raise exception 'Storyboard revision hardening clauses were not found'; end if;
  execute patched_definition;
end;
$$;

create or replace function public.reuse_shot_preparation_history_after_storyboard_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_record public.review_packages;
  episode_record public.episodes;
  shot jsonb;
  previous public.shot_preparation_drafts;
  old_track public.audio_tracks;
  reusable_video boolean;
  reusable_audio boolean;
  new_track public.audio_tracks;
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

  for shot in select value from jsonb_array_elements(coalesce(package_record.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    select draft.* into previous
    from public.shot_preparation_drafts draft
    where draft.episode_id = episode_record.id
      and draft.shot_id = shot ->> 'id'
      and draft.input_fingerprint = md5(shot::text)
      and draft.review_package_id <> package_record.id
    order by draft.updated_at desc, draft.id desc
    limit 1;
    if not found then continue; end if;

    reusable_video := previous.current_video_artifact_id is not null
      and previous.current_video_task_id is not null
      and exists (
        select 1
        from public.artifacts artifact
        join public.tasks task on task.id = previous.current_video_task_id
        where artifact.id = previous.current_video_artifact_id
          and artifact.producer_task_id = task.id
          and artifact.episode_id = episode_record.id
          and task.episode_id = episode_record.id
          and task.status = 'completed'
          and task.invalidated_at is null
      );

    select track.* into old_track
    from public.audio_tracks track
    join public.tasks task on task.id = track.source_task_id
    join public.artifacts artifact on artifact.id = track.source_artifact_id
    where track.id = previous.current_audio_track_id
      and track.episode_id = episode_record.id
      and track.cue_id = previous.shot_id
      and task.status = 'completed'
      and task.invalidated_at is null
      and artifact.episode_id = episode_record.id
      and artifact.sha256 = track.sha256
      and artifact.file_size = track.file_size;
    reusable_audio := found;

    if reusable_audio then
      insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds)
      values (episode_record.id, old_track.source_task_id, old_track.source_artifact_id, package_record.id, old_track.track_kind, old_track.cue_id, old_track.relative_path, old_track.sha256, old_track.file_size, old_track.start_seconds, old_track.duration_seconds)
      on conflict (episode_id, track_kind, cue_id, source_review_package_id) do nothing;
      select track.* into new_track
      from public.audio_tracks track
      where track.episode_id = episode_record.id
        and track.source_review_package_id = package_record.id
        and track.source_task_id = old_track.source_task_id
        and track.cue_id = old_track.cue_id
      order by track.created_at desc, track.id desc
      limit 1;
    else
      new_track := null;
    end if;

    update public.shot_preparation_drafts draft
    set audio_mode = previous.audio_mode,
        video_status = case when reusable_video then 'ready' else 'pending' end,
        audio_status = case when previous.audio_mode = 'none' or reusable_audio then 'ready' else 'pending' end,
        confirmation_status = previous.confirmation_status,
        subtitle_text = previous.subtitle_text,
        subtitles_enabled = previous.subtitles_enabled,
        tts_voice = previous.tts_voice,
        tts_speaking_rate = previous.tts_speaking_rate,
        tts_text = previous.tts_text,
        tts_language_code = previous.tts_language_code,
        tts_override_voice = previous.tts_override_voice,
        tts_override_speaking_rate = previous.tts_override_speaking_rate,
        tts_text_confirmation_fingerprint = previous.tts_text_confirmation_fingerprint,
        tts_text_confirmed_at = previous.tts_text_confirmed_at,
        tts_text_confirmed_by = previous.tts_text_confirmed_by,
        selected_material_revision_id = previous.selected_material_revision_id,
        clip_start_seconds = previous.clip_start_seconds,
        clip_end_seconds = previous.clip_end_seconds,
        clip_segments = previous.clip_segments,
        video_duration_seconds = previous.video_duration_seconds,
        current_video_artifact_id = case when reusable_video then previous.current_video_artifact_id else null end,
        current_video_task_id = case when reusable_video then previous.current_video_task_id else null end,
        current_audio_track_id = case when new_track.id is not null then new_track.id else null end,
        current_tts_task_id = case when previous.audio_mode = 'tts' and new_track.id is not null then new_track.source_task_id else null end,
        pending_video_task_id = null,
        pending_tts_task_id = null,
        pending_source_audio_task_id = null,
        video_error = case when reusable_video then previous.video_error else null end,
        tts_actual_duration_seconds = case when reusable_audio then previous.tts_actual_duration_seconds else null end,
        tts_error = case when reusable_audio then previous.tts_error else null end,
        source_audio_duration_seconds = case when reusable_audio then previous.source_audio_duration_seconds else null end,
        source_audio_error = case when reusable_audio then previous.source_audio_error else null end,
        warning_decision = previous.warning_decision,
        warning_reason = previous.warning_reason,
        warning_accepted_at = previous.warning_accepted_at,
        warning_accepted_by = previous.warning_accepted_by,
        confirmation_reason = previous.confirmation_reason,
        confirmed_at = previous.confirmed_at,
        confirmed_by = previous.confirmed_by,
        skipped_at = previous.skipped_at,
        skipped_by = previous.skipped_by,
        frozen_at = null,
        frozen_by = null,
        updated_at = now()
    where draft.episode_id = episode_record.id
      and draft.review_package_id = package_record.id
      and draft.shot_id = shot ->> 'id';
  end loop;
  return new;
end;
$$;

drop trigger if exists zz_reuse_shot_preparation_history_after_storyboard_approval on public.approvals;
create trigger zz_reuse_shot_preparation_history_after_storyboard_approval
after insert on public.approvals
for each row execute function public.reuse_shot_preparation_history_after_storyboard_approval();

revoke all on function public.canonical_storyboard_structure_revision_operation(jsonb) from public, anon, authenticated;
revoke all on function public.reuse_shot_preparation_history_after_storyboard_approval() from public, anon, authenticated;
