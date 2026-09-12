create or replace function public.sync_shot_acoustic_alignment_after_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.shot_preparation_drafts;
  track public.audio_tracks;
  created_task public.tasks;
  text_fingerprint text;
  input_version text;
begin
  if new.task_type <> 'generate_narration'
    or old.status is not distinct from new.status
    or new.input_snapshot -> 'acoustic_alignment' is null then
    return new;
  end if;

  select preparation.* into draft
  from public.shot_preparation_drafts preparation
  where preparation.id = nullif(new.input_snapshot #>> '{shot_preparation,draft_id}', '')::uuid
  for update;
  if not found or (
    draft.pending_tts_task_id is distinct from new.id
    and draft.current_tts_task_id is distinct from new.id
  ) then return new; end if;

  if new.status = 'running' then
    update public.shot_preparation_drafts
    set acoustic_alignment = acoustic_alignment || jsonb_build_object(
          'status', 'waiting',
          'detail', '正在生成口播音频；音频可用后再单独执行声学对齐。',
          'generatedAt', now()
        ),
        updated_at = now()
    where id = draft.id;
    return new;
  end if;

  if new.status in ('failed', 'blocked') then
    update public.shot_preparation_drafts
    set acoustic_alignment = acoustic_alignment || jsonb_build_object(
          'status', 'failed', 'method', 'none', 'granularity', 'none',
          'cues', '[]'::jsonb, 'wordCount', 0,
          'detail', coalesce(new.last_result #>> '{retry,reason}', new.last_result #>> '{blockers,0,detail}', '口播音频生成失败。'),
          'generatedAt', now()
        ),
        updated_at = now()
    where id = draft.id;
    return new;
  end if;

  if new.status <> 'completed' then return new; end if;

  select audio.* into track
  from public.audio_tracks audio
  where audio.source_task_id = new.id
    and audio.episode_id = new.episode_id
    and audio.track_kind = 'narration'
    and audio.cue_id is not distinct from draft.shot_id
  order by audio.created_at desc
  limit 1;
  if not found or not draft.subtitles_enabled or btrim(draft.subtitle_text) = '' then return new; end if;

  text_fingerprint := encode(extensions.digest(convert_to(draft.subtitle_text, 'UTF8'), 'sha256'), 'hex');
  input_version := encode(extensions.digest(convert_to(jsonb_build_object(
    'audioSha256', track.sha256,
    'textFingerprint', text_fingerprint,
    'voice', coalesce(draft.tts_voice, ''),
    'speakingRate', coalesce(draft.tts_speaking_rate, 1),
    'provider', 'whisperx',
    'model', 'large-v3',
    'connectionVersionId', null
  )::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.tasks (
    episode_id, task_type, status, input_snapshot, budget_limit_cents,
    max_attempts, provider, model, prompt_version
  ) values (
    new.episode_id, 'align_shot_captions', 'ready', jsonb_build_object(
      'capability', 'acoustic_alignment',
      'shot_preparation', jsonb_build_object(
        'draft_id', draft.id,
        'review_package_id', draft.review_package_id,
        'shot_id', draft.shot_id
      ),
      'executor', jsonb_build_object(
        'provider', 'whisperx', 'adapter', 'whisperx_local',
        'model', 'large-v3', 'prompt_version', 'whisperx-alignment-v1'
      ),
      'acoustic_alignment', jsonb_build_object(
        'confirmed_text', draft.subtitle_text,
        'text_fingerprint', text_fingerprint,
        'audio_relative_path', track.relative_path,
        'audio_sha256', track.sha256,
        'input_version', input_version,
        'voice', coalesce(draft.tts_voice, ''),
        'speaking_rate', coalesce(draft.tts_speaking_rate, 1),
        'strategy', 'auto'
      ),
      'input_artifacts', jsonb_build_array(jsonb_build_object(
        'artifactType', 'audio_track', 'relativePath', track.relative_path,
        'sha256', track.sha256, 'fileSize', track.file_size
      )),
      'output', jsonb_build_object(
        'required_artifact_types', jsonb_build_array('acoustic_alignment_evidence'),
        'content_type', 'application/json',
        'relative_path', format('episodes/%s/alignment/%s-%s.json', new.episode_id, draft.shot_id, input_version),
        'review_stage', 'production_ready'
      ),
      'allowed_tools', jsonb_build_array('read', 'write')
    ), 0, 2, 'whisperx', 'large-v3', 'whisperx-alignment-v1'
  ) returning * into created_task;

  update public.shot_preparation_drafts
  set pending_alignment_task_id = created_task.id,
      acoustic_alignment = jsonb_build_object(
        'version', 'acoustic-alignment/v1', 'status', 'waiting',
        'method', 'none', 'granularity', 'none',
        'inputVersion', input_version, 'audioSha256', track.sha256,
        'textFingerprint', text_fingerprint, 'provider', 'whisperx',
        'model', 'large-v3', 'connectionVersionId', null,
        'wordCount', 0, 'cues', '[]'::jsonb, 'reviewIssues', '[]'::jsonb,
        'attempts', '[]'::jsonb,
        'detail', '口播音频已可试听；声学对齐正在后台排队。',
        'generatedAt', now()
      ),
      updated_at = now()
  where id = draft.id;

  return new;
end;
$$;

revoke all on function public.sync_shot_acoustic_alignment_after_task_update() from public, anon, authenticated;
grant execute on function public.sync_shot_acoustic_alignment_after_task_update() to service_role;
