alter table public.shot_preparation_drafts
  add column if not exists clip_segments jsonb not null default '[]'::jsonb check (jsonb_typeof(clip_segments) = 'array'),
  add column if not exists frozen_at timestamptz,
  add column if not exists frozen_by uuid references auth.users(id) on delete set null;

update public.shot_preparation_drafts
set clip_segments = jsonb_build_array(jsonb_build_object('start_seconds', clip_start_seconds, 'end_seconds', clip_end_seconds))
where jsonb_array_length(clip_segments) = 0 and clip_start_seconds is not null and clip_end_seconds is not null;

create function public.protect_frozen_shot_preparation_inputs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.frozen_at is not null and (
    old.selected_material_revision_id is distinct from new.selected_material_revision_id
    or old.clip_segments is distinct from new.clip_segments
    or old.audio_mode is distinct from new.audio_mode
    or old.tts_text is distinct from new.tts_text
    or old.tts_voice is distinct from new.tts_voice
    or old.tts_speaking_rate is distinct from new.tts_speaking_rate
    or old.subtitle_text is distinct from new.subtitle_text
    or old.subtitles_enabled is distinct from new.subtitles_enabled
  ) then
    raise exception 'Frozen shot drafts cannot be edited; create a new storyboard revision' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger protect_frozen_shot_preparation_inputs
before update on public.shot_preparation_drafts
for each row execute function public.protect_frozen_shot_preparation_inputs();

create function public.save_shot_workbench_draft(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_material_revision_id uuid,
  p_clip_segments jsonb,
  p_audio_mode text,
  p_subtitle_text text,
  p_subtitles_enabled boolean,
  p_tts_text text,
  p_tts_voice text,
  p_tts_speaking_rate numeric
)
returns public.shot_preparation_drafts
language plpgsql security definer set search_path = '' as $$
declare
  draft public.shot_preparation_drafts;
  selected_package public.review_packages;
  selected_shot jsonb;
  segment jsonb;
  total_duration numeric := 0;
  changed boolean;
begin
  select current_draft.* into draft
  from public.shot_preparation_drafts current_draft
  where current_draft.episode_id = p_episode_id and current_draft.review_package_id = p_review_package_id and current_draft.shot_id = btrim(p_shot_id)
  for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.frozen_at is not null then raise exception 'Frozen shot drafts cannot be edited' using errcode = '22023'; end if;
  if p_clip_segments is null or jsonb_typeof(p_clip_segments) <> 'array' or jsonb_array_length(p_clip_segments) = 0 then raise exception 'At least one clip segment is required' using errcode = '22023'; end if;
  for segment in select value from jsonb_array_elements(p_clip_segments) loop
    if jsonb_typeof(segment) <> 'object' or jsonb_typeof(segment -> 'start_seconds') <> 'number' or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'start_seconds')::numeric < 0 or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
      or (segment ->> 'end_seconds')::numeric > 86400 then
      raise exception 'Clip segment is invalid' using errcode = '22023';
    end if;
    total_duration := total_duration + (segment ->> 'end_seconds')::numeric - (segment ->> 'start_seconds')::numeric;
  end loop;

  select package.* into selected_package from public.review_packages package
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  select shot.value into selected_shot from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the current storyboard' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.id = p_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'video'
      and material.material_purpose = case selected_shot ->> 'shotType' when 'a_roll' then 'a_roll' else 'b_roll' end
  ) then raise exception 'Approved video material for this shot is required' using errcode = '22023'; end if;

  perform public.save_shot_preparation_draft(p_episode_id, p_review_package_id, p_shot_id, p_audio_mode, p_subtitle_text, p_subtitles_enabled, p_tts_text, p_tts_voice, p_tts_speaking_rate);
  changed := draft.selected_material_revision_id is distinct from p_material_revision_id or draft.clip_segments is distinct from p_clip_segments;
  update public.shot_preparation_drafts
  set selected_material_revision_id = p_material_revision_id,
      clip_segments = p_clip_segments,
      clip_start_seconds = null,
      clip_end_seconds = null,
      video_duration_seconds = total_duration,
      current_video_artifact_id = case when changed then null else current_video_artifact_id end,
      current_video_task_id = case when changed then null else current_video_task_id end,
      pending_video_task_id = case when changed then null else pending_video_task_id end,
      video_status = case when changed then 'pending' else video_status end,
      video_error = case when changed then null else video_error end,
      current_audio_track_id = case when changed and audio_mode = 'source' then null else current_audio_track_id end,
      pending_source_audio_task_id = case when changed and audio_mode = 'source' then null else pending_source_audio_task_id end,
      audio_status = case when changed and audio_mode = 'source' then 'pending' else audio_status end,
      source_audio_error = case when changed and audio_mode = 'source' then null else source_audio_error end,
      updated_at = now()
  where id = draft.id returning * into draft;
  return draft;
end;
$$;

create function public.queue_frozen_shot_source_audio(p_draft_id uuid, p_retry boolean default false)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare
  draft public.shot_preparation_drafts;
  prepared_video public.artifacts;
  existing_task public.tasks;
  created_task public.tasks;
  config_hash text;
  output_path text;
begin
  select * into draft from public.shot_preparation_drafts where id = p_draft_id for update;
  if not found or draft.frozen_at is null or draft.audio_mode <> 'source' or draft.current_video_artifact_id is null then return null; end if;
  select artifact.* into prepared_video from public.artifacts artifact
  join public.tasks task on task.id = artifact.producer_task_id and task.status = 'completed' and task.invalidated_at is null
  where artifact.id = draft.current_video_artifact_id and task.id = draft.current_video_task_id;
  if not found then return null; end if;
  config_hash := md5(jsonb_build_object('video_artifact_id', prepared_video.id, 'sha256', prepared_video.sha256)::text);
  select task.* into existing_task from public.tasks task
  where task.episode_id = draft.episode_id and task.task_type = 'extract_embedded_audio'
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text and task.input_snapshot ->> 'configuration_hash' = config_hash
  order by task.created_at desc for update limit 1;
  if found and existing_task.status in ('ready', 'running', 'completed') then return existing_task; end if;
  if found and existing_task.status in ('failed', 'blocked') and not p_retry then return existing_task; end if;
  update public.tasks set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Frozen source audio retry requested.'
  where id = existing_task.id and existing_task.status in ('failed', 'blocked');
  output_path := format('episodes/%s/audio/shot-source-%s-%s.mp3', draft.episode_id, regexp_replace(draft.shot_id, '[^a-zA-Z0-9_-]', '_', 'g'), config_hash);
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (draft.episode_id, 'extract_embedded_audio', 'ready', jsonb_build_object(
    'capability', 'embedded_audio_extraction', 'storyboard_review_package_id', draft.review_package_id, 'configuration_hash', config_hash,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', draft.episode_id, 'review_package_id', draft.review_package_id, 'shot_id', draft.shot_id),
    'source_video_artifact', jsonb_build_object('id', prepared_video.id, 'relative_path', prepared_video.relative_path, 'sha256', prepared_video.sha256, 'file_size', prepared_video.file_size),
    'media', jsonb_build_object('adapter', 'ffmpeg_extract_audio', 'embedded_audio', jsonb_build_object('source_relative_path', prepared_video.relative_path, 'duration_seconds', draft.video_duration_seconds)),
    'audio_track', jsonb_build_object('kind', 'source', 'cue_id', draft.shot_id, 'source_review_package_id', draft.review_package_id, 'start_seconds', 0, 'duration_seconds', 0.001),
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array('shot_source_audio'), 'content_type', 'audio/mpeg', 'relative_path', output_path, 'review_stage', 'production_ready'),
    'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'prepared_shot_video', 'relativePath', prepared_video.relative_path, 'sha256', prepared_video.sha256, 'fileSize', prepared_video.file_size)),
    'allowed_tools', jsonb_build_array('read', 'write')
  ), 0, 2, 'ffmpeg', 'ffmpeg', 'shot-source-audio-v1') returning * into created_task;
  update public.shot_preparation_drafts set audio_status = 'running', pending_source_audio_task_id = created_task.id, source_audio_error = null, updated_at = now() where id = draft.id;
  return created_task;
end;
$$;

create function public.freeze_shot_preparation_batch(p_episode_id uuid, p_review_package_id uuid)
returns setof public.tasks language plpgsql security definer set search_path = '' as $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  selected_shot jsonb;
  draft public.shot_preparation_drafts;
  material public.production_material_revisions;
  existing_task public.tasks;
  created_task public.tasks;
  config_hash text;
  output_type text;
  output_path text;
begin
  select episode.* into current_episode from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id for update of episode;
  if not found or current_episode.stage <> 'storyboard_approved' then raise exception 'Owner shot workbench access is required' using errcode = '42501'; end if;
  select package.* into selected_package from public.review_packages package
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'The current storyboard package is required' using errcode = '22023'; end if;

  for selected_shot in select value from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    select * into draft from public.shot_preparation_drafts
    where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = selected_shot ->> 'id' for update;
    if not found or draft.selected_material_revision_id is null or jsonb_array_length(draft.clip_segments) = 0 or draft.subtitle_text = '' then
      raise exception 'Every shot needs a saved source, clip selection, and subtitle decision before freezing' using errcode = '22023';
    end if;
    if draft.audio_mode = 'tts' and not exists (
      select 1 from public.audio_tracks track join public.tasks task on task.id = track.source_task_id
      where track.id = draft.current_audio_track_id and track.track_kind = 'narration' and track.source_review_package_id = p_review_package_id
        and task.status = 'completed' and task.invalidated_at is null and task.input_snapshot #>> '{media,narration,text}' = draft.tts_text
    ) then raise exception 'Every TTS shot needs its current generated narration before freezing' using errcode = '22023'; end if;
  end loop;

  update public.shot_preparation_drafts set frozen_at = coalesce(frozen_at, now()), frozen_by = coalesce(frozen_by, auth.uid()), updated_at = now()
  where episode_id = p_episode_id and review_package_id = p_review_package_id;

  for selected_shot in select value from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    select * into draft from public.shot_preparation_drafts where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = selected_shot ->> 'id' for update;
    if draft.current_video_task_id is not null and draft.video_status = 'ready' then
      if draft.audio_mode = 'source' and draft.audio_status <> 'ready' then
        created_task := public.queue_frozen_shot_source_audio(draft.id, true);
        if created_task.id is not null then return next created_task; end if;
      end if;
      continue;
    end if;
    select * into material from public.production_material_revisions where id = draft.selected_material_revision_id;
    config_hash := md5(jsonb_build_object('material_revision_id', material.id, 'sha256', material.sha256, 'segments', draft.clip_segments)::text);
    existing_task := null;
    select task.* into existing_task from public.tasks task where task.episode_id = p_episode_id
      and task.task_type = case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
      and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text and task.input_snapshot ->> 'configuration_hash' = config_hash
    order by task.created_at desc for update limit 1;
    if found and existing_task.status in ('ready', 'running', 'completed') then return next existing_task; continue; end if;
    update public.tasks set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Frozen shot generation retry requested.'
    where id = existing_task.id and existing_task.status in ('failed', 'blocked');
    output_type := case selected_shot ->> 'shotType' when 'a_roll' then 'a_roll_video' else 'b_roll_asset' end;
    output_path := format('episodes/%s/shot-clips/%s-%s.mp4', p_episode_id, regexp_replace(draft.shot_id, '[^a-zA-Z0-9_-]', '_', 'g'), config_hash);
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (p_episode_id, case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end, 'ready', jsonb_build_object(
      'capability', 'shot_clip_preparation', 'storyboard_review_package_id', p_review_package_id, 'configuration_hash', config_hash,
      'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', p_episode_id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
      'shot', selected_shot,
      'executor', jsonb_build_object('provider', 'ffmpeg', 'adapter', 'ffmpeg_trim_video', 'model', 'ffmpeg', 'prompt_version', 'shot-clip-v2'),
      'media', jsonb_build_object('adapter', 'ffmpeg_trim_video', 'video_clips', jsonb_build_object('source_relative_path', material.storage_path, 'segments', draft.clip_segments, 'target_duration_seconds', draft.video_duration_seconds)),
      'clip_selection', jsonb_build_object('segments', draft.clip_segments, 'duration_seconds', draft.video_duration_seconds),
      'manual_source', jsonb_build_object('material_revision_id', material.id),
      'output', jsonb_build_object('required_artifact_types', jsonb_build_array(output_type), 'content_type', 'video/mp4', 'relative_path', output_path, 'review_stage', 'production_ready'),
      'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'source_video', 'relativePath', material.storage_path, 'sha256', material.sha256, 'fileSize', material.file_size)),
      'allowed_tools', jsonb_build_array('read', 'write')
    ), 0, 2, 'ffmpeg', 'ffmpeg', 'shot-clip-v2') returning * into created_task;
    update public.shot_preparation_drafts set video_status = 'running', pending_video_task_id = created_task.id, video_error = null, updated_at = now() where id = draft.id;
    return next created_task;
  end loop;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_preparation_batch_frozen', jsonb_build_object('review_package_id', p_review_package_id), auth.uid());
end;
$$;

create function public.queue_source_audio_after_frozen_clip()
returns trigger language plpgsql security definer set search_path = '' as $$
declare draft_id uuid;
begin
  if new.status <> 'completed' or new.task_type not in ('generate_a_roll', 'generate_b_roll') or new.input_snapshot #>> '{shot_preparation,draft_id}' is null then return new; end if;
  draft_id := (new.input_snapshot #>> '{shot_preparation,draft_id}')::uuid;
  perform public.queue_frozen_shot_source_audio(draft_id, false);
  return new;
end;
$$;

create trigger zz_queue_source_audio_after_frozen_clip
after update of status on public.tasks
for each row execute function public.queue_source_audio_after_frozen_clip();

create function public.confirm_frozen_shot_when_ready()
returns trigger language plpgsql security definer set search_path = '' as $$
declare current_episode public.episodes; selected_shot jsonb; delta numeric;
begin
  if new.frozen_at is null or new.confirmation_status = 'confirmed' or new.video_status <> 'ready'
    or (new.audio_mode <> 'none' and new.audio_status <> 'ready') then return new; end if;
  if not exists (select 1 from public.tasks task join public.artifacts artifact on artifact.producer_task_id = task.id
    where task.id = new.current_video_task_id and artifact.id = new.current_video_artifact_id and task.status = 'completed' and task.invalidated_at is null) then return new; end if;
  if new.audio_mode <> 'none' and not exists (select 1 from public.audio_tracks track join public.tasks task on task.id = track.source_task_id
    where track.id = new.current_audio_track_id and task.status = 'completed' and task.invalidated_at is null) then return new; end if;
  select episode.* into current_episode from public.episodes episode where episode.id = new.episode_id;
  select shot.value into selected_shot from public.review_packages package,
    lateral jsonb_array_elements(coalesce(package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
    where package.id = new.review_package_id and shot.value ->> 'id' = new.shot_id;
  delta := new.video_duration_seconds - (selected_shot ->> 'durationSeconds')::numeric;
  update public.shot_preparation_drafts set confirmation_status = 'confirmed', confirmation_reason = 'Owner froze all shot drafts for generation.',
    confirmed_at = now(), confirmed_by = new.frozen_by,
    warning_decision = case when abs(delta) > 0.05 then 'accepted' else 'not_required' end,
    warning_reason = case when abs(delta) > 0.05 then 'Actual clip duration accepted instead of storyboard suggestion.' else null end,
    warning_accepted_at = case when abs(delta) > 0.05 then now() else null end,
    warning_accepted_by = case when abs(delta) > 0.05 then new.frozen_by else null end,
    updated_at = now() where id = new.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, new.episode_id, 'frozen_shot_preparation_completed', jsonb_build_object('review_package_id', new.review_package_id, 'shot_id', new.shot_id, 'duration_seconds', new.video_duration_seconds), new.frozen_by);
  return new;
end;
$$;

create trigger confirm_frozen_shot_when_ready
after update on public.shot_preparation_drafts
for each row execute function public.confirm_frozen_shot_when_ready();

create function public.copy_clip_segments_to_revised_shot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare previous public.shot_preparation_drafts;
begin
  if jsonb_array_length(new.clip_segments) > 0 then return new; end if;
  select draft.* into previous from public.shot_preparation_drafts draft
  where draft.episode_id = new.episode_id and draft.shot_id = new.shot_id and draft.input_fingerprint = new.input_fingerprint and draft.id <> new.id
  order by draft.updated_at desc limit 1;
  if found then update public.shot_preparation_drafts set clip_segments = previous.clip_segments, video_duration_seconds = previous.video_duration_seconds where id = new.id; end if;
  return new;
end;
$$;

create trigger copy_clip_segments_to_revised_shot
after insert on public.shot_preparation_drafts
for each row execute function public.copy_clip_segments_to_revised_shot();

do $$
declare definition text;
begin
  select pg_get_functiondef('public.create_shot_preparation_review_package(uuid,uuid)'::regprocedure) into definition;
  if definition is null or position('''subtitles_enabled'', draft.subtitles_enabled' in definition) = 0 then
    raise exception 'Unable to add actual shot duration to frozen review members';
  end if;
  execute replace(definition, '''subtitles_enabled'', draft.subtitles_enabled', '''subtitles_enabled'', draft.subtitles_enabled, ''duration_seconds'', draft.video_duration_seconds');

  select pg_get_functiondef('public.orchestrate_review_render_tasks(uuid)'::regprocedure) into definition;
  if definition is null or position('coalesce((member.evidence_snapshot #>> ''{audio_track,duration_seconds}'')::numeric, (member.evidence_snapshot #>> ''{shot,durationSeconds}'')::numeric)' in definition) = 0 then
    raise exception 'Unable to use actual shot duration in review rendering';
  end if;
  execute replace(definition,
    'coalesce((member.evidence_snapshot #>> ''{audio_track,duration_seconds}'')::numeric, (member.evidence_snapshot #>> ''{shot,durationSeconds}'')::numeric)',
    'coalesce((member.evidence_snapshot #>> ''{audio_track,duration_seconds}'')::numeric, (member.evidence_snapshot ->> ''duration_seconds'')::numeric, (member.evidence_snapshot #>> ''{shot,durationSeconds}'')::numeric)');
end $$;

revoke all on function public.save_shot_workbench_draft(uuid, uuid, text, uuid, jsonb, text, text, boolean, text, text, numeric) from public, anon;
grant execute on function public.save_shot_workbench_draft(uuid, uuid, text, uuid, jsonb, text, text, boolean, text, text, numeric) to authenticated;
revoke all on function public.freeze_shot_preparation_batch(uuid, uuid) from public, anon;
grant execute on function public.freeze_shot_preparation_batch(uuid, uuid) to authenticated;
revoke all on function public.protect_frozen_shot_preparation_inputs() from public, anon, authenticated;
revoke all on function public.queue_frozen_shot_source_audio(uuid, boolean) from public, anon, authenticated;
revoke all on function public.queue_source_audio_after_frozen_clip() from public, anon, authenticated;
revoke all on function public.confirm_frozen_shot_when_ready() from public, anon, authenticated;
revoke all on function public.copy_clip_segments_to_revised_shot() from public, anon, authenticated;
