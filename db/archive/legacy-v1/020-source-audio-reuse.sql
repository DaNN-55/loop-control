-- T20: caption-only edits retain immutable source audio; reuse rebinds the verified completed extraction.
CREATE OR REPLACE FUNCTION public.save_shot_preparation_draft(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_audio_mode text, p_subtitle_text text, p_subtitles_enabled boolean, p_tts_text text, p_tts_voice text, p_tts_speaking_rate numeric)
 RETURNS shot_preparation_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  existing_draft public.shot_preparation_drafts;
  saved_draft public.shot_preparation_drafts;
  blueprint_policy jsonb;
  selected_shot jsonb;
  next_tts_text text;
  next_tts_voice text;
  next_tts_rate numeric;
  next_language_code text;
  mode_changed boolean;
  audio_changed boolean;
begin
  if p_audio_mode not in ('tts', 'source', 'none') or coalesce(btrim(p_shot_id), '') = '' or (p_subtitles_enabled and coalesce(btrim(p_subtitle_text), '') = '') or p_subtitles_enabled is null then
    raise exception 'Shot preparation draft is invalid' using errcode = '22023';
  end if;
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = local_identity.owner_id() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to save a shot preparation draft' using errcode = '42501'; end if;
  if current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then raise exception 'Shot preparation drafts can only be saved after storyboard approval' using errcode = '22023'; end if;
  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;
  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the approved storyboard' using errcode = '22023'; end if;
  select draft.* into existing_draft from public.shot_preparation_drafts draft
  where draft.episode_id = p_episode_id and draft.review_package_id = p_review_package_id and draft.shot_id = btrim(p_shot_id)
  for update;
  select blueprint.policy into blueprint_policy from public.account_blueprint_versions blueprint where blueprint.id = current_episode.blueprint_version_id;
  next_tts_text := coalesce(nullif(btrim(p_tts_text), ''), nullif(btrim(p_subtitle_text), ''), nullif(btrim(selected_shot ->> 'scriptSegment'), ''));
  next_tts_voice := coalesce(existing_draft.tts_override_voice, current_episode.tts_voice, nullif(btrim(p_tts_voice), ''), existing_draft.tts_voice);
  next_tts_rate := coalesce(existing_draft.tts_override_speaking_rate, current_episode.tts_speaking_rate, p_tts_speaking_rate, existing_draft.tts_speaking_rate);
  next_language_code := coalesce(current_episode.tts_language_code, existing_draft.tts_language_code, 'zh-CN');
  if p_audio_mode = 'tts' and (coalesce(next_tts_text, '') = '' or coalesce(next_tts_voice, '') = '' or next_tts_rate is null or next_tts_rate <= 0) then
    raise exception 'TTS 草稿必须包含口播内容、声音和有效语速' using errcode = '22023';
  end if;
  mode_changed := existing_draft.id is null or existing_draft.audio_mode is distinct from p_audio_mode;
  audio_changed := mode_changed or (p_audio_mode = 'tts' and (existing_draft.tts_text is distinct from next_tts_text or existing_draft.tts_voice is distinct from next_tts_voice or existing_draft.tts_speaking_rate is distinct from next_tts_rate));
  if mode_changed and existing_draft.id is not null then
    update public.tasks task
    set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner switched this shot to another audio mode.'
    where task.input_snapshot #>> '{shot_preparation,draft_id}' = existing_draft.id::text and task.status in ('ready', 'running', 'blocked', 'failed');
  end if;
  insert into public.shot_preparation_drafts (
    episode_id, review_package_id, shot_id, audio_mode, subtitle_text, subtitles_enabled,
    tts_text, tts_voice, tts_speaking_rate, tts_language_code, audio_status, tts_error, source_audio_error
  ) values (
    p_episode_id, p_review_package_id, btrim(p_shot_id), p_audio_mode,
    case when p_audio_mode = 'tts' then next_tts_text else btrim(p_subtitle_text) end,
    p_subtitles_enabled, next_tts_text, next_tts_voice, next_tts_rate, next_language_code,
    case when p_audio_mode in ('none', 'source') then 'ready' when audio_changed then 'pending' else coalesce(existing_draft.audio_status, 'pending') end,
    case when audio_changed then null else existing_draft.tts_error end,
    case when p_audio_mode = 'source' then null else existing_draft.source_audio_error end
  )
  on conflict (episode_id, review_package_id, shot_id) do update set
    audio_mode = excluded.audio_mode,
    subtitle_text = excluded.subtitle_text,
    subtitles_enabled = excluded.subtitles_enabled,
    tts_text = excluded.tts_text,
    tts_voice = excluded.tts_voice,
    tts_speaking_rate = excluded.tts_speaking_rate,
    tts_language_code = excluded.tts_language_code,
    audio_status = excluded.audio_status,
    tts_error = excluded.tts_error,
    source_audio_error = null,
    source_audio_duration_seconds = case when excluded.audio_mode = 'source' and shot_preparation_drafts.audio_mode = 'source' then shot_preparation_drafts.source_audio_duration_seconds else null end,
    confirmation_status = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode
      or excluded.subtitle_text is distinct from shot_preparation_drafts.subtitle_text
      or excluded.tts_text is distinct from shot_preparation_drafts.tts_text
      or excluded.tts_voice is distinct from shot_preparation_drafts.tts_voice
      or excluded.tts_speaking_rate is distinct from shot_preparation_drafts.tts_speaking_rate
      then 'pending' else shot_preparation_drafts.confirmation_status end,
    current_audio_track_id = case when excluded.audio_mode = 'none' or excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.current_audio_track_id end,
    current_tts_task_id = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.current_tts_task_id end,
    pending_tts_task_id = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.pending_tts_task_id end,
    pending_source_audio_task_id = null,
    updated_at = now()
  returning * into saved_draft;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, current_episode.id, 'shot_audio_mode_saved', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', btrim(p_shot_id), 'audio_mode', p_audio_mode, 'subtitles_enabled', p_subtitles_enabled, 'audio_changed', audio_changed), local_identity.owner_id());
  return saved_draft;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_shot_source_audio(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_retry boolean DEFAULT false)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_episode public.episodes;
  draft public.shot_preparation_drafts;
  selected_package public.review_packages;
  prepared_video public.artifacts;
  existing_task public.tasks;
  created_task public.tasks;
  config_hash text;
  task_snapshot jsonb;
  output_path text;
  safe_shot_id text;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = local_identity.owner_id() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate shot source audio' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Shot source audio can only be generated in the shot workbench' using errcode = '22023'; end if;
  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;
  select * into draft from public.shot_preparation_drafts where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id) for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.audio_mode <> 'source' then raise exception 'Only source audio shots can extract original audio' using errcode = '22023'; end if;
  select artifact.* into prepared_video
  from public.artifacts artifact
  join public.tasks task on task.id = artifact.producer_task_id and task.status = 'completed'
  where artifact.id = draft.current_video_artifact_id and task.id = draft.current_video_task_id and artifact.episode_id = p_episode_id;
  if not found then raise exception '请先生成并校验当前准备片段，再提取原声。' using errcode = '22023'; end if;
  config_hash := md5(jsonb_build_object('video_artifact_id', prepared_video.id, 'sha256', prepared_video.sha256, 'file_size', prepared_video.file_size)::text);
  select task.* into existing_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = 'extract_embedded_audio'
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text and task.input_snapshot ->> 'configuration_hash' = config_hash
  order by task.created_at desc for update limit 1;
  if found and existing_task.status in ('ready', 'running', 'completed') then
    if existing_task.status='completed' then
      update public.shot_preparation_drafts d set current_audio_track_id=t.id, audio_status='ready', source_audio_duration_seconds=t.duration_seconds, source_audio_error=null, pending_source_audio_task_id=null, updated_at=now()
      from public.audio_tracks t where d.id=draft.id and t.source_task_id=existing_task.id and t.episode_id=p_episode_id and t.track_kind='source' and t.source_review_package_id=p_review_package_id;
    else
      update public.shot_preparation_drafts set pending_source_audio_task_id=existing_task.id, audio_status='running', source_audio_error=null, updated_at=now() where id=draft.id;
    end if;
    return existing_task;
  end if;
  if found and existing_task.status in ('failed', 'blocked') and not p_retry then return existing_task; end if;
  update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'A newer prepared video became current.'
  where task.episode_id = p_episode_id and task.task_type = 'extract_embedded_audio' and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text and task.status in ('ready', 'blocked', 'failed');
  safe_shot_id := regexp_replace(btrim(p_shot_id), '[^a-zA-Z0-9_-]', '_', 'g');
  output_path := format('episodes/%s/audio/shot-source-%s-%s.mp3', p_episode_id, safe_shot_id, config_hash);
  task_snapshot := jsonb_build_object(
    'capability', 'embedded_audio_extraction',
    'storyboard_review_package_id', p_review_package_id,
    'configuration_hash', config_hash,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', p_episode_id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
    'source_video_artifact', jsonb_build_object('id', prepared_video.id, 'relative_path', prepared_video.relative_path, 'sha256', prepared_video.sha256, 'file_size', prepared_video.file_size),
    'media', jsonb_build_object('adapter', 'ffmpeg_extract_audio', 'embedded_audio', jsonb_build_object('source_relative_path', prepared_video.relative_path, 'duration_seconds', greatest(coalesce(draft.clip_end_seconds - draft.clip_start_seconds, 0.001), 0.001))),
    'audio_track', jsonb_build_object('kind', 'source', 'cue_id', draft.shot_id, 'source_review_package_id', p_review_package_id, 'start_seconds', 0, 'duration_seconds', 0.001),
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array('shot_source_audio'), 'content_type', 'audio/mpeg', 'relative_path', output_path, 'review_stage', 'production_ready'),
    'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'prepared_shot_video', 'relativePath', prepared_video.relative_path, 'sha256', prepared_video.sha256, 'fileSize', prepared_video.file_size)),
    'allowed_tools', jsonb_build_array('read', 'write')
  );
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, 'extract_embedded_audio', 'ready', task_snapshot, 0, 2, 'ffmpeg', 'ffmpeg', 'shot-source-audio-v1')
  returning * into created_task;
  update public.shot_preparation_drafts set audio_status = 'running', pending_source_audio_task_id = created_task.id, source_audio_error = null, updated_at = now() where id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_source_audio_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'prepared_video_artifact_id', prepared_video.id, 'prepared_video_sha256', prepared_video.sha256, 'configuration_hash', config_hash, 'retry', p_retry), local_identity.owner_id());
  return created_task;
end;
$function$;
