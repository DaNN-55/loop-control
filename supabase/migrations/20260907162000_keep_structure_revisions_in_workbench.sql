do $$
declare
  definition text;
  patched_definition text;
begin
  select pg_get_functiondef('public.request_shot_structure_revision(uuid,uuid,jsonb,text)'::regprocedure) into definition;
  if definition is null then raise exception 'request_shot_structure_revision is required'; end if;

  patched_definition := replace(definition,
    $old$  if found then return created_task; end if;

  storyboard := selected_package.context_snapshot #> '{worker_result,storyboard}';$old$,
    $new$  if found then return created_task; end if;
  if exists (
    select 1 from public.tasks task
    where task.episode_id = p_episode_id
      and task.task_type = 'draft_storyboard_revision'
      and task.status in ('ready', 'running')
  ) then
    raise exception 'A storyboard structure revision is already running' using errcode = '22023';
  end if;

  storyboard := selected_package.context_snapshot #> '{worker_result,storyboard}';$new$);
  if patched_definition = definition then raise exception 'Storyboard structure revision concurrency guard target was not found'; end if;
  execute patched_definition;
end;
$$;

create or replace function public.create_storyboard_revision_review_package()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  completed_run public.task_runs;
  produced_artifact public.artifacts;
  package public.review_packages;
  next_revision integer;
  requested_by uuid;
begin
  if new.task_type <> 'draft_storyboard_revision' or new.status <> 'completed' or old.status = 'completed' then return new; end if;

  select * into current_episode from public.episodes where id = new.episode_id for update;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Storyboard revision must complete from storyboard_approved' using errcode = '22023'; end if;
  if not exists (
    select 1
    from public.review_packages base_package
    join public.approvals base_approval
      on base_approval.review_package_id = base_package.id
     and base_approval.stage = 'storyboard_approved'
     and base_approval.decision = 'approved'
    where base_package.id = (new.input_snapshot #>> '{storyboard_revision,base_review_package_id}')::uuid
      and base_package.episode_id = new.episode_id
      and base_package.stage = 'storyboard_review'
      and base_package.invalidated_at is null
      and base_package.revision_number = (
        select max(current_package.revision_number)
        from public.review_packages current_package
        join public.approvals current_approval
          on current_approval.review_package_id = current_package.id
         and current_approval.stage = 'storyboard_approved'
         and current_approval.decision = 'approved'
        where current_package.episode_id = new.episode_id
          and current_package.stage = 'storyboard_review'
          and current_package.invalidated_at is null
      )
  ) then
    raise exception 'Storyboard structure revision base package is stale' using errcode = '22023';
  end if;

  select * into completed_run from public.task_runs where task_id = new.id and attempt = new.attempt - 1 and status = 'completed';
  if not found or jsonb_typeof(completed_run.result -> 'storyboard') <> 'object' or completed_run.result #>> '{storyboard,version}' <> 'storyboard/v1' or jsonb_typeof(completed_run.result #> '{storyboard,shots}') <> 'array' or jsonb_array_length(completed_run.result #> '{storyboard,shots}') = 0 then raise exception 'Completed storyboard revision result is invalid' using errcode = '22023'; end if;
  if exists (select 1 from (select value ->> 'id' as shot_id from jsonb_array_elements(completed_run.result #> '{storyboard,shots}') value) ids group by shot_id having count(*) > 1) then raise exception 'Completed storyboard revision contains duplicate shot IDs' using errcode = '22023'; end if;

  select * into produced_artifact from public.artifacts where producer_task_id = new.id and artifact_type = 'storyboard' and relative_path = new.input_snapshot #>> '{output,relative_path}';
  if not found or not exists (select 1 from jsonb_array_elements(completed_run.result -> 'artifacts') result_artifact where result_artifact ->> 'artifactType' = produced_artifact.artifact_type and result_artifact ->> 'relativePath' = produced_artifact.relative_path and result_artifact ->> 'sha256' = produced_artifact.sha256 and (result_artifact ->> 'fileSize')::bigint = produced_artifact.file_size) then raise exception 'Storyboard revision artifact is missing or mismatched' using errcode = '22023'; end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision from public.review_packages where episode_id = new.episode_id and stage = 'storyboard_review';
  insert into public.review_packages (episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot)
  values (new.episode_id, new.id, completed_run.id, produced_artifact.id, 'storyboard_review', next_revision, new.input_snapshot || jsonb_build_object('task_package', completed_run.task_package, 'worker_result', completed_run.result, 'artifact', jsonb_build_object('id', produced_artifact.id, 'relative_path', produced_artifact.relative_path, 'sha256', produced_artifact.sha256, 'file_size', produced_artifact.file_size)))
  returning * into package;

  insert into public.storyboard_review_shots (review_package_id, shot_id)
  select package.id, value ->> 'id' from jsonb_array_elements(completed_run.result #> '{storyboard,shots}');

  select event.actor_id into requested_by
  from public.audit_events event
  where event.episode_id = new.episode_id
    and event.event_type = 'storyboard_structure_revision_requested'
    and event.payload ->> 'task_id' = new.id::text
    and event.actor_id is not null
  order by event.created_at desc, event.id desc
  limit 1;
  if requested_by is null then
    raise exception 'Storyboard structure revision requester is missing' using errcode = '22023';
  end if;

  insert into public.approvals (episode_id, stage, decision, reason, actor_id, review_package_id)
  values (new.episode_id, 'storyboard_approved', 'approved', 'Owner applied a deterministic storyboard structure revision.', requested_by, package.id);

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, new.episode_id, 'storyboard_structure_revision_applied', jsonb_build_object('review_package_id', package.id, 'task_id', new.id, 'base_review_package_id', new.input_snapshot #>> '{storyboard_revision,base_review_package_id}', 'input_fingerprint', new.input_snapshot #>> '{storyboard_revision,input_fingerprint}', 'revision_number', next_revision, 'operation', new.input_snapshot #> '{storyboard_revision,operation}'), requested_by);
  return new;
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
  operation_kind text;
  operation_shot_id text;
  preserve_duration_inputs boolean;
  preserve_type_inputs boolean;
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

  operation_kind := coalesce(package_record.context_snapshot #>> '{storyboard_revision,operation,kind}', '');
  operation_shot_id := nullif(btrim(package_record.context_snapshot #>> '{storyboard_revision,operation,shotId}'), '');

  for shot in select value from jsonb_array_elements(coalesce(package_record.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    preserve_duration_inputs := operation_kind = 'change_duration' and operation_shot_id = shot ->> 'id';
    preserve_type_inputs := operation_kind = 'change_type' and operation_shot_id = shot ->> 'id';

    select draft.* into previous
    from public.shot_preparation_drafts draft
    where draft.episode_id = episode_record.id
      and draft.shot_id = shot ->> 'id'
      and draft.review_package_id <> package_record.id
      and (
        draft.input_fingerprint = md5(shot::text)
        or preserve_duration_inputs
        or preserve_type_inputs
      )
    order by (draft.input_fingerprint = md5(shot::text)) desc, draft.updated_at desc, draft.id desc
    limit 1;
    if not found then continue; end if;

    reusable_video := not preserve_type_inputs
      and previous.current_video_artifact_id is not null
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
    where (not preserve_type_inputs or previous.audio_mode = 'tts')
      and track.id = previous.current_audio_track_id
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
      select episode_record.id, old_track.source_task_id, old_track.source_artifact_id, package_record.id, old_track.track_kind, old_track.cue_id, old_track.relative_path, old_track.sha256, old_track.file_size, old_track.start_seconds, old_track.duration_seconds
      where not exists (
        select 1 from public.audio_tracks existing
        where existing.episode_id = episode_record.id
          and existing.source_review_package_id = package_record.id
          and existing.track_kind = old_track.track_kind
          and existing.cue_id = old_track.cue_id
          and existing.source_task_id = old_track.source_task_id
          and existing.source_artifact_id = old_track.source_artifact_id
      );
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
        confirmation_status = case when preserve_duration_inputs or preserve_type_inputs then 'pending' else previous.confirmation_status end,
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
        selected_material_revision_id = case when preserve_type_inputs then null else previous.selected_material_revision_id end,
        clip_start_seconds = case when preserve_type_inputs then null else previous.clip_start_seconds end,
        clip_end_seconds = case when preserve_type_inputs then null else previous.clip_end_seconds end,
        clip_segments = case when preserve_type_inputs then '[]'::jsonb else previous.clip_segments end,
        video_duration_seconds = case when preserve_type_inputs then null else previous.video_duration_seconds end,
        current_video_artifact_id = case when reusable_video then previous.current_video_artifact_id else null end,
        current_video_task_id = case when reusable_video then previous.current_video_task_id else null end,
        current_audio_track_id = case when new_track.id is not null then new_track.id else null end,
        current_tts_task_id = case when previous.audio_mode = 'tts' and new_track.id is not null then new_track.source_task_id else null end,
        pending_video_task_id = null,
        pending_tts_task_id = null,
        pending_source_audio_task_id = null,
        video_error = null,
        tts_actual_duration_seconds = case when reusable_audio then previous.tts_actual_duration_seconds else null end,
        tts_error = case when reusable_audio then previous.tts_error else null end,
        source_audio_duration_seconds = case when reusable_audio then previous.source_audio_duration_seconds else null end,
        source_audio_error = case when reusable_audio then previous.source_audio_error else null end,
        warning_decision = case when preserve_duration_inputs or preserve_type_inputs then 'not_required' else previous.warning_decision end,
        warning_reason = case when preserve_duration_inputs or preserve_type_inputs then null else previous.warning_reason end,
        warning_accepted_at = case when preserve_duration_inputs or preserve_type_inputs then null else previous.warning_accepted_at end,
        warning_accepted_by = case when preserve_duration_inputs or preserve_type_inputs then null else previous.warning_accepted_by end,
        confirmation_reason = case when preserve_duration_inputs or preserve_type_inputs then null else previous.confirmation_reason end,
        confirmed_at = case when preserve_duration_inputs or preserve_type_inputs then null else previous.confirmed_at end,
        confirmed_by = case when preserve_duration_inputs or preserve_type_inputs then null else previous.confirmed_by end,
        skipped_at = case when preserve_duration_inputs or preserve_type_inputs then null else previous.skipped_at end,
        skipped_by = case when preserve_duration_inputs or preserve_type_inputs then null else previous.skipped_by end,
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

revoke all on function public.create_storyboard_revision_review_package() from public, anon, authenticated;
revoke all on function public.reuse_shot_preparation_history_after_storyboard_approval() from public, anon, authenticated;

do $$
declare
  candidate record;
begin
  for candidate in
    select distinct on (episode.id)
      episode.id as episode_id,
      episode.account_id,
      package.id as review_package_id,
      task.id as task_id,
      event.actor_id
    from public.episodes episode
    join public.review_packages package
      on package.episode_id = episode.id
     and package.stage = 'storyboard_review'
     and package.invalidated_at is null
    join public.tasks task
      on task.id = package.task_id
     and task.task_type = 'draft_storyboard_revision'
     and task.status = 'completed'
    join public.audit_events event
      on event.episode_id = episode.id
     and event.event_type = 'storyboard_structure_revision_requested'
     and event.payload ->> 'task_id' = task.id::text
     and event.actor_id is not null
    join public.account_memberships membership
      on membership.account_id = episode.account_id
     and membership.user_id = event.actor_id
     and membership.role = 'owner'
    where episode.id = '92b3067d-ced9-4e85-bc44-1968fa83695a'::uuid
      and episode.stage = 'storyboard_review'
      and not exists (
        select 1 from public.approvals approval
        where approval.review_package_id = package.id
          and approval.stage = 'storyboard_approved'
          and approval.decision = 'approved'
      )
      and package.revision_number = (
        select max(latest.revision_number)
        from public.review_packages latest
        where latest.episode_id = episode.id
          and latest.stage = 'storyboard_review'
          and latest.invalidated_at is null
      )
    order by episode.id, package.revision_number desc, event.created_at desc, event.id desc
  loop
    update public.episodes
    set stage = 'storyboard_approved', updated_at = now()
    where id = candidate.episode_id;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
    values (candidate.episode_id, 'storyboard_review', 'storyboard_approved', 'Recovered completed deterministic storyboard structure revision in the workbench.', candidate.actor_id);
    insert into public.approvals (episode_id, stage, decision, reason, actor_id, review_package_id)
    values (candidate.episode_id, 'storyboard_approved', 'approved', 'Recovered Owner-approved deterministic storyboard structure revision.', candidate.actor_id, candidate.review_package_id);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (candidate.account_id, candidate.episode_id, 'storyboard_structure_revision_backfilled', jsonb_build_object('review_package_id', candidate.review_package_id, 'task_id', candidate.task_id), candidate.actor_id);
  end loop;
end;
$$;
