alter table public.tasks drop constraint tasks_task_type_check;
alter table public.tasks add constraint tasks_task_type_check check (task_type in (
  'draft_brief', 'draft_script', 'prepare_visual_brief', 'draft_storyboard', 'draft_storyboard_revision',
  'generate_a_roll', 'generate_b_roll', 'generate_narration', 'extract_embedded_audio', 'generate_soundtrack',
  'generate_review_render', 'generate_final_render', 'prepare_publish_package', 'verify_publish_package', 'register_publish_input'
));

alter table public.shot_preparation_drafts add column if not exists input_fingerprint text;
update public.shot_preparation_drafts draft
set input_fingerprint = md5(shot.value::text)
from public.review_packages package,
  lateral jsonb_array_elements(coalesce(package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot
where draft.review_package_id = package.id
  and draft.shot_id = shot.value ->> 'id'
  and draft.input_fingerprint is null;

alter table public.audio_tracks
  drop constraint if exists audio_tracks_source_task_id_key,
  drop constraint if exists audio_tracks_source_artifact_id_key;

create or replace function public.request_shot_structure_revision(
  p_episode_id uuid, p_review_package_id uuid, p_operation jsonb, p_reason text
)
returns public.tasks
language plpgsql security definer set search_path = ''
as $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  base_task public.tasks;
  created_task public.tasks;
  storyboard jsonb;
  shots jsonb;
  operation jsonb := p_operation;
  operation_kind text := btrim(coalesce(p_operation ->> 'kind', ''));
  request_hash text;
  shot jsonb;
  other_shot jsonb;
  indexes integer[];
  index_value integer;
  expected_duration numeric;
  part jsonb;
begin
  if btrim(coalesce(p_reason, '')) = '' or jsonb_typeof(p_operation) <> 'object' then
    raise exception 'Storyboard structure revision reason and operation are required' using errcode = '22023';
  end if;
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
    and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
  if not found then raise exception 'Owner membership is required for storyboard structure revision' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Storyboard structure revision requires an approved storyboard' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id
    and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review' and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;
  select task.* into base_task from public.tasks task where task.id = selected_package.task_id and task.episode_id = p_episode_id;
  if not found then raise exception 'The approved storyboard task is required' using errcode = '22023'; end if;
  request_hash := md5(jsonb_build_object('review_package_id', p_review_package_id, 'operation', p_operation, 'reason', btrim(p_reason))::text);
  select task.* into created_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = 'draft_storyboard_revision'
    and task.input_snapshot ->> 'structure_revision_hash' = request_hash
  order by task.created_at desc limit 1;
  if found then return created_task; end if;

  storyboard := selected_package.context_snapshot #> '{worker_result,storyboard}';
  shots := storyboard -> 'shots';
  if jsonb_typeof(shots) <> 'array' or jsonb_array_length(shots) = 0 then raise exception 'The approved storyboard has no shots' using errcode = '22023'; end if;
  if operation_kind = 'add_after' then
    select value into shot from jsonb_array_elements(shots) where value ->> 'id' = p_operation ->> 'afterShotId';
    if not found or jsonb_typeof(p_operation -> 'shot') <> 'object' then raise exception 'Add-after target is invalid' using errcode = '22023'; end if;
    if btrim(coalesce(p_operation #>> '{shot,scriptSegment}', '')) = '' or coalesce((p_operation #>> '{shot,durationSeconds}')::numeric, 0) <= 0 then raise exception 'Added shot is invalid' using errcode = '22023'; end if;
    operation := p_operation || jsonb_build_object('shot', (p_operation -> 'shot') || jsonb_build_object('id', 'shot-' || gen_random_uuid()::text, 'inputBasis', shot -> 'inputBasis'));
  elsif operation_kind = 'delete' then
    if jsonb_array_length(shots) = 1 or not exists (select 1 from jsonb_array_elements(shots) value where value ->> 'id' = p_operation ->> 'shotId') then raise exception 'Delete target is invalid' using errcode = '22023'; end if;
  elsif operation_kind = 'split' then
    select value into shot from jsonb_array_elements(shots) where value ->> 'id' = p_operation ->> 'shotId';
    if not found or jsonb_typeof(p_operation -> 'parts') <> 'array' or jsonb_array_length(p_operation -> 'parts') < 2 then raise exception 'Split operation is invalid' using errcode = '22023'; end if;
    expected_duration := 0;
    for part in select value from jsonb_array_elements(p_operation -> 'parts') loop
      if btrim(coalesce(part ->> 'scriptSegment', '')) = '' or coalesce((part ->> 'durationSeconds')::numeric, 0) <= 0 then raise exception 'Split part is invalid' using errcode = '22023'; end if;
      expected_duration := expected_duration + (part ->> 'durationSeconds')::numeric;
    end loop;
    if abs(expected_duration - (shot ->> 'durationSeconds')::numeric) > 0.05 then raise exception 'Split duration must equal source duration' using errcode = '22023'; end if;
    operation := p_operation || jsonb_build_object('parts', (select jsonb_agg(value || jsonb_build_object('id', 'shot-' || gen_random_uuid()::text)) from jsonb_array_elements(p_operation -> 'parts')));
  elsif operation_kind = 'merge' then
    if jsonb_typeof(p_operation -> 'shotIds') <> 'array' or jsonb_array_length(p_operation -> 'shotIds') < 2 or (select count(distinct value) from jsonb_array_elements_text(p_operation -> 'shotIds')) <> jsonb_array_length(p_operation -> 'shotIds') then raise exception 'Merge operation is invalid' using errcode = '22023'; end if;
    indexes := array[]::integer[];
    for other_shot in select value from jsonb_array_elements(shots) with ordinality as rows(value, ordinality) where value ->> 'id' in (select jsonb_array_elements_text(p_operation -> 'shotIds')) loop
      indexes := indexes || (select ordinality::integer from jsonb_array_elements(shots) with ordinality as rows(value, ordinality) where value ->> 'id' = other_shot ->> 'id');
    end loop;
    if coalesce(array_length(indexes, 1), 0) <> jsonb_array_length(p_operation -> 'shotIds') or (select max(value) - min(value) + 1 from unnest(indexes) value) <> array_length(indexes, 1) then raise exception 'Only adjacent shots can be merged' using errcode = '22023'; end if;
    operation := p_operation || jsonb_build_object('newShotId', 'shot-' || gen_random_uuid()::text);
  elsif operation_kind = 'reorder' then
    if jsonb_typeof(p_operation -> 'shotIds') <> 'array' or jsonb_array_length(p_operation -> 'shotIds') <> jsonb_array_length(shots) or (select count(distinct value) from jsonb_array_elements_text(p_operation -> 'shotIds')) <> jsonb_array_length(shots) or exists (select 1 from jsonb_array_elements_text(p_operation -> 'shotIds') id where not exists (select 1 from jsonb_array_elements(shots) value where value ->> 'id' = id)) then raise exception 'Reorder operation must contain every shot once' using errcode = '22023'; end if;
  elsif operation_kind = 'change_type' then
    if p_operation ->> 'shotType' not in ('a_roll', 'b_roll') or not exists (select 1 from jsonb_array_elements(shots) value where value ->> 'id' = p_operation ->> 'shotId') then raise exception 'Shot type operation is invalid' using errcode = '22023'; end if;
  elsif operation_kind = 'change_duration' then
    if coalesce((p_operation ->> 'durationSeconds')::numeric, 0) <= 0 or not exists (select 1 from jsonb_array_elements(shots) value where value ->> 'id' = p_operation ->> 'shotId') then raise exception 'Shot duration operation is invalid' using errcode = '22023'; end if;
  else raise exception 'Unsupported storyboard structure operation' using errcode = '22023'; end if;

  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (
    p_episode_id, 'draft_storyboard_revision', 'ready',
    base_task.input_snapshot || jsonb_build_object(
      'structure_revision_hash', request_hash,
      'storyboard_revision', jsonb_build_object('version', 'storyboard-revision/v1', 'base_review_package_id', p_review_package_id, 'input_fingerprint', md5(storyboard::text), 'operation', operation, 'storyboard', storyboard),
      'output', jsonb_build_object('required_artifact_types', jsonb_build_array('storyboard'), 'content_type', 'application/json', 'relative_path', format('episodes/%s/storyboard-revision-%s.json', p_episode_id, coalesce((select max(revision_number) + 1 from public.review_packages where episode_id = p_episode_id and stage = 'storyboard_review'), 1)), 'review_stage', 'storyboard_review')
    ),
    base_task.budget_limit_cents, 1, 'codex', base_task.model, 'storyboard-revision-v1'
  ) returning * into created_task;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'storyboard_structure_revision_requested', jsonb_build_object('task_id', created_task.id, 'review_package_id', p_review_package_id, 'input_fingerprint', md5(storyboard::text), 'structure_revision_hash', request_hash, 'operation', operation), auth.uid());
  return created_task;
end;
$$;

create or replace function public.create_storyboard_revision_review_package()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare current_episode public.episodes; completed_run public.task_runs; produced_artifact public.artifacts; package public.review_packages; next_revision integer;
begin
  if new.task_type <> 'draft_storyboard_revision' or new.status <> 'completed' or old.status = 'completed' then return new; end if;
  select * into current_episode from public.episodes where id = new.episode_id for update;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Storyboard revision must complete from storyboard_approved' using errcode = '22023'; end if;
  select * into completed_run from public.task_runs where task_id = new.id and attempt = new.attempt - 1 and status = 'completed';
  if not found or jsonb_typeof(completed_run.result -> 'storyboard') <> 'object' or completed_run.result #>> '{storyboard,version}' <> 'storyboard/v1' or jsonb_typeof(completed_run.result #> '{storyboard,shots}') <> 'array' or jsonb_array_length(completed_run.result #> '{storyboard,shots}') = 0 then raise exception 'Completed storyboard revision result is invalid' using errcode = '22023'; end if;
  if exists (select 1 from (select value ->> 'id' as shot_id from jsonb_array_elements(completed_run.result #> '{storyboard,shots}') value) ids group by shot_id having count(*) > 1) then raise exception 'Completed storyboard revision contains duplicate shot IDs' using errcode = '22023'; end if;
  select * into produced_artifact from public.artifacts where producer_task_id = new.id and artifact_type = 'storyboard' and relative_path = new.input_snapshot #>> '{output,relative_path}';
  if not found or not exists (select 1 from jsonb_array_elements(completed_run.result -> 'artifacts') result_artifact where result_artifact ->> 'artifactType' = produced_artifact.artifact_type and result_artifact ->> 'relativePath' = produced_artifact.relative_path and result_artifact ->> 'sha256' = produced_artifact.sha256 and (result_artifact ->> 'fileSize')::bigint = produced_artifact.file_size) then raise exception 'Storyboard revision artifact is missing or mismatched' using errcode = '22023'; end if;
  select coalesce(max(revision_number), 0) + 1 into next_revision from public.review_packages where episode_id = new.episode_id and stage = 'storyboard_review';
  insert into public.review_packages (episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot)
  values (new.episode_id, new.id, completed_run.id, produced_artifact.id, 'storyboard_review', next_revision, new.input_snapshot || jsonb_build_object('task_package', completed_run.task_package, 'worker_result', completed_run.result, 'artifact', jsonb_build_object('id', produced_artifact.id, 'relative_path', produced_artifact.relative_path, 'sha256', produced_artifact.sha256, 'file_size', produced_artifact.file_size))) returning * into package;
  insert into public.storyboard_review_shots (review_package_id, shot_id) select package.id, value ->> 'id' from jsonb_array_elements(completed_run.result #> '{storyboard,shots}');
  update public.episodes set stage = 'storyboard_review', updated_at = now() where id = new.episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (new.episode_id, 'storyboard_approved', 'storyboard_review', 'Worker submitted a storyboard structure revision for Owner review.', null);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, new.episode_id, 'storyboard_revision_review_package_created', jsonb_build_object('review_package_id', package.id, 'task_id', new.id, 'base_review_package_id', new.input_snapshot #>> '{storyboard_revision,base_review_package_id}', 'input_fingerprint', new.input_snapshot #>> '{storyboard_revision,input_fingerprint}', 'revision_number', next_revision), null);
  return new;
end;
$$;

drop trigger if exists create_storyboard_revision_review_package_after_task on public.tasks;
create trigger create_storyboard_revision_review_package_after_task after update of status on public.tasks for each row execute function public.create_storyboard_revision_review_package();

create or replace function public.seed_shot_preparation_drafts_after_storyboard_approval()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare episode_record public.episodes; package_record public.review_packages; narration_policy jsonb; voice jsonb; shot jsonb; previous public.shot_preparation_drafts;
begin
  if new.stage <> 'storyboard_approved' or new.decision <> 'approved' or new.review_package_id is null then return new; end if;
  select episode.* into episode_record from public.episodes episode where episode.id = new.episode_id;
  select package.* into package_record from public.review_packages package where package.id = new.review_package_id and package.episode_id = new.episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found or episode_record.stage <> 'storyboard_approved' then return new; end if;
  narration_policy := (select blueprint.policy -> 'narration' from public.account_blueprint_versions blueprint where blueprint.id = episode_record.blueprint_version_id); voice := narration_policy -> 'voice';
  for shot in select value from jsonb_array_elements(coalesce(package_record.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    select draft.* into previous from public.shot_preparation_drafts draft where draft.episode_id = episode_record.id and draft.shot_id = shot ->> 'id' and draft.input_fingerprint = md5(shot::text) order by draft.updated_at desc limit 1;
    insert into public.shot_preparation_drafts (episode_id, review_package_id, shot_id, input_fingerprint, audio_mode, video_status, audio_status, confirmation_status, subtitle_text, subtitles_enabled, tts_voice, tts_speaking_rate, current_video_artifact_id, current_video_task_id, current_audio_track_id, current_tts_task_id, selected_material_revision_id, clip_start_seconds, clip_end_seconds, video_duration_seconds, tts_actual_duration_seconds, warning_decision, warning_reason, warning_accepted_at, warning_accepted_by, confirmation_reason, confirmed_at, confirmed_by, skipped_at, skipped_by)
    values (episode_record.id, package_record.id, shot ->> 'id', md5(shot::text), coalesce(previous.audio_mode, 'tts'), case when previous.current_video_artifact_id is not null then 'ready' else 'pending' end, case when coalesce(previous.audio_mode, 'tts') = 'none' or previous.current_audio_track_id is not null then 'ready' else 'pending' end, case when previous.id is not null and previous.confirmation_status in ('confirmed', 'skipped') then previous.confirmation_status else 'pending' end, coalesce(previous.subtitle_text, btrim(shot ->> 'scriptSegment')), coalesce(previous.subtitles_enabled, true), coalesce(previous.tts_voice, nullif(btrim(voice ->> 'name'), '')), coalesce(previous.tts_speaking_rate, case when (voice ->> 'speaking_rate') ~ '^[0-9]+([.][0-9]+)?$' then (voice ->> 'speaking_rate')::numeric else null end), previous.current_video_artifact_id, previous.current_video_task_id, previous.current_audio_track_id, previous.current_tts_task_id, previous.selected_material_revision_id, previous.clip_start_seconds, previous.clip_end_seconds, previous.video_duration_seconds, previous.tts_actual_duration_seconds, coalesce(previous.warning_decision, 'not_required'), previous.warning_reason, previous.warning_accepted_at, previous.warning_accepted_by, previous.confirmation_reason, previous.confirmed_at, previous.confirmed_by, previous.skipped_at, previous.skipped_by)
    on conflict (episode_id, review_package_id, shot_id) do nothing;
  end loop;
  insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds)
  select episode_record.id, old_track.source_task_id, old_track.source_artifact_id, package_record.id, old_track.track_kind, old_track.cue_id, old_track.relative_path, old_track.sha256, old_track.file_size, old_track.start_seconds, old_track.duration_seconds
  from public.shot_preparation_drafts current_draft
  join public.shot_preparation_drafts old_draft on old_draft.episode_id = current_draft.episode_id and old_draft.shot_id = current_draft.shot_id and old_draft.input_fingerprint = current_draft.input_fingerprint and old_draft.review_package_id <> current_draft.review_package_id
  join public.audio_tracks old_track on old_track.id = old_draft.current_audio_track_id
  where current_draft.review_package_id = package_record.id and old_track.source_review_package_id is distinct from package_record.id
  on conflict (episode_id, track_kind, cue_id, source_review_package_id) do nothing;
  update public.shot_preparation_drafts current_draft
  set current_audio_track_id = new_track.id, audio_status = 'ready', updated_at = now()
  from public.shot_preparation_drafts old_draft
  join public.audio_tracks old_track on old_track.id = old_draft.current_audio_track_id
  join public.audio_tracks new_track on new_track.episode_id = episode_record.id and new_track.source_review_package_id = package_record.id and new_track.source_task_id = old_track.source_task_id and new_track.cue_id = old_track.cue_id
  where current_draft.review_package_id = package_record.id and old_draft.episode_id = current_draft.episode_id and old_draft.shot_id = current_draft.shot_id and old_draft.input_fingerprint = current_draft.input_fingerprint and old_draft.review_package_id <> current_draft.review_package_id;
  return new;
end;
$$;

revoke all on function public.request_shot_structure_revision(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.request_shot_structure_revision(uuid, uuid, jsonb, text) to authenticated;
revoke all on function public.create_storyboard_revision_review_package() from public, anon, authenticated;
revoke all on function public.seed_shot_preparation_drafts_after_storyboard_approval() from public, anon, authenticated;
