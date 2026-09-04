alter table public.audio_tracks drop constraint if exists audio_tracks_track_kind_check;
alter table public.audio_tracks add constraint audio_tracks_track_kind_check check (track_kind in ('narration', 'source', 'derived', 'bgm', 'sfx'));
alter table public.audio_tracks drop constraint if exists audio_tracks_episode_id_track_kind_cue_id_source_review_package_id_key;
create index if not exists audio_tracks_shot_history_idx
on public.audio_tracks (episode_id, source_review_package_id, cue_id, created_at desc);

alter table public.shot_preparation_drafts
  add column if not exists source_audio_duration_seconds numeric,
  add column if not exists source_audio_error text,
  add column if not exists pending_source_audio_task_id uuid references public.tasks(id) on delete set null;

create or replace function public.save_shot_preparation_draft(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_audio_mode text,
  p_subtitle_text text,
  p_subtitles_enabled boolean,
  p_tts_text text,
  p_tts_voice text,
  p_tts_speaking_rate numeric
)
returns public.shot_preparation_drafts
language plpgsql security definer set search_path = ''
as $$
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
  if p_audio_mode not in ('tts', 'source', 'none') or coalesce(btrim(p_shot_id), '') = '' or coalesce(btrim(p_subtitle_text), '') = '' or p_subtitles_enabled is null then
    raise exception 'Shot preparation draft is invalid' using errcode = '22023';
  end if;
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to save a shot preparation draft' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Shot preparation drafts can only be saved after storyboard approval' using errcode = '22023'; end if;
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
  next_tts_voice := coalesce(nullif(btrim(p_tts_voice), ''), existing_draft.tts_voice, nullif(btrim(blueprint_policy #>> '{narration,voice,name}'), ''));
  next_tts_rate := coalesce(p_tts_speaking_rate, existing_draft.tts_speaking_rate, case when (blueprint_policy #>> '{narration,voice,speaking_rate}') ~ '^[0-9]+([.][0-9]+)?$' then (blueprint_policy #>> '{narration,voice,speaking_rate}')::numeric else null end);
  next_language_code := coalesce(existing_draft.tts_language_code, nullif(btrim(blueprint_policy #>> '{narration,voice,language_code}'), ''), 'zh-CN');
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
    case when p_audio_mode = 'none' then 'ready' when audio_changed then 'pending' else coalesce(existing_draft.audio_status, 'pending') end,
    case when audio_changed then null else existing_draft.tts_error end,
    case when mode_changed and p_audio_mode <> 'source' then null else existing_draft.source_audio_error end
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
    source_audio_error = excluded.source_audio_error,
    confirmation_status = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode
      or excluded.subtitle_text is distinct from shot_preparation_drafts.subtitle_text
      or excluded.tts_text is distinct from shot_preparation_drafts.tts_text
      or excluded.tts_voice is distinct from shot_preparation_drafts.tts_voice
      or excluded.tts_speaking_rate is distinct from shot_preparation_drafts.tts_speaking_rate
      then 'pending' else shot_preparation_drafts.confirmation_status end,
    current_audio_track_id = case when excluded.audio_mode = 'none' or excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.current_audio_track_id end,
    current_tts_task_id = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.current_tts_task_id end,
    pending_tts_task_id = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.pending_tts_task_id end,
    pending_source_audio_task_id = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.pending_source_audio_task_id end,
    updated_at = now()
  returning * into saved_draft;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, current_episode.id, 'shot_audio_mode_saved', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', btrim(p_shot_id), 'audio_mode', p_audio_mode, 'subtitles_enabled', p_subtitles_enabled, 'audio_changed', audio_changed), auth.uid());
  return saved_draft;
end;
$$;

create function public.generate_shot_source_audio(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_retry boolean default false
)
returns public.tasks
language plpgsql security definer set search_path = ''
as $$
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
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
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
  if found and existing_task.status in ('ready', 'running', 'completed') then return existing_task; end if;
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
  values (current_episode.account_id, p_episode_id, 'shot_source_audio_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'prepared_video_artifact_id', prepared_video.id, 'prepared_video_sha256', prepared_video.sha256, 'configuration_hash', config_hash, 'retry', p_retry), auth.uid());
  return created_task;
end;
$$;

create or replace function public.sync_shot_source_audio_after_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare source_task public.tasks; draft_id uuid;
begin
  select task.* into source_task from public.tasks task where task.id = new.source_task_id;
  if source_task.task_type <> 'extract_embedded_audio' or source_task.input_snapshot #>> '{shot_preparation,draft_id}' is null or new.track_kind <> 'source' then return new; end if;
  draft_id := (source_task.input_snapshot #>> '{shot_preparation,draft_id}')::uuid;
  update public.shot_preparation_drafts
  set current_audio_track_id = new.id, pending_source_audio_task_id = null, audio_status = 'ready', source_audio_duration_seconds = new.duration_seconds, source_audio_error = null, updated_at = now()
  where id = draft_id and audio_mode = 'source' and pending_source_audio_task_id = new.source_task_id
    and current_video_artifact_id = (source_task.input_snapshot #>> '{source_video_artifact,id}')::uuid;
  return new;
end;
$$;

drop trigger if exists sync_shot_source_audio_after_insert on public.audio_tracks;
create trigger sync_shot_source_audio_after_insert after insert on public.audio_tracks for each row execute function public.sync_shot_source_audio_after_insert();

create or replace function public.sync_shot_source_audio_task_after_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare draft_id uuid; failure_reason text;
begin
  if new.task_type <> 'extract_embedded_audio' or new.input_snapshot #>> '{shot_preparation,draft_id}' is null then return new; end if;
  draft_id := (new.input_snapshot #>> '{shot_preparation,draft_id}')::uuid;
  failure_reason := coalesce(new.last_result #>> '{blockers,0,detail}', new.last_result #>> '{retry,reason}', '原声提取任务失败，请重试。');
  update public.shot_preparation_drafts
  set audio_status = case when new.status = 'failed' then 'failed' else 'running' end,
      source_audio_error = case when new.status = 'failed' then failure_reason else null end,
      updated_at = now()
  where id = draft_id and pending_source_audio_task_id = new.id and new.status in ('ready', 'running', 'failed');
  return new;
end;
$$;

drop trigger if exists sync_shot_source_audio_task_after_update on public.tasks;
create trigger sync_shot_source_audio_task_after_update after update of status on public.tasks for each row execute function public.sync_shot_source_audio_task_after_update();

create or replace function public.invalidate_shot_source_audio_after_clip_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.audio_mode = 'source' and (old.selected_material_revision_id is distinct from new.selected_material_revision_id or old.clip_start_seconds is distinct from new.clip_start_seconds or old.clip_end_seconds is distinct from new.clip_end_seconds) then
    update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'The prepared video selection changed.'
    where task.input_snapshot #>> '{shot_preparation,draft_id}' = new.id::text and task.task_type = 'extract_embedded_audio' and task.status in ('ready', 'running', 'blocked', 'failed');
    update public.shot_preparation_drafts set current_audio_track_id = null, pending_source_audio_task_id = null, audio_status = 'pending', source_audio_duration_seconds = null, source_audio_error = null, updated_at = now() where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists invalidate_shot_source_audio_after_clip_change on public.shot_preparation_drafts;
create trigger invalidate_shot_source_audio_after_clip_change after update of selected_material_revision_id, clip_start_seconds, clip_end_seconds on public.shot_preparation_drafts for each row execute function public.invalidate_shot_source_audio_after_clip_change();

revoke all on function public.save_shot_preparation_draft(uuid, uuid, text, text, text, boolean, text, text, numeric) from public, anon;
grant execute on function public.save_shot_preparation_draft(uuid, uuid, text, text, text, boolean, text, text, numeric) to authenticated;
revoke all on function public.generate_shot_source_audio(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.generate_shot_source_audio(uuid, uuid, text, boolean) to authenticated;
revoke all on function public.sync_shot_source_audio_after_insert() from public, anon, authenticated;
revoke all on function public.sync_shot_source_audio_task_after_update() from public, anon, authenticated;
revoke all on function public.invalidate_shot_source_audio_after_clip_change() from public, anon, authenticated;
