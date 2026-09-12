drop function public.confirm_shot_sync_preview(uuid, uuid, text);

create function public.confirm_shot_sync_preview(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_confirmation_reason text,
  p_deviation_resolution text
)
returns public.shot_preparation_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  selected_shot jsonb;
  draft public.shot_preparation_drafts;
  preview_task public.tasks;
  duration_settings jsonb;
  duration_seconds numeric;
  duration_decision jsonb;
  has_deviation boolean;
  saved_draft public.shot_preparation_drafts;
begin
  if coalesce(btrim(p_shot_id), '') = '' then
    raise exception 'Shot id is required' using errcode = '22023';
  end if;
  if coalesce(p_deviation_resolution, '') not in ('none', 'confirmation_reason', 'episode_exception') then
    raise exception 'Shot deviation resolution is invalid' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id;
  if not found or current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then
    raise exception 'Owner shot workbench access is required' using errcode = '42501';
  end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval
    on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'The current approved storyboard package is required' using errcode = '22023'; end if;

  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot is not in the immutable approved storyboard' using errcode = '22023'; end if;

  select target.* into draft from public.shot_preparation_drafts target
  where target.episode_id = p_episode_id and target.review_package_id = p_review_package_id
    and target.shot_id = btrim(p_shot_id) for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;

  if draft.preparation_contract is null
    or draft.preparation_input_fingerprint is distinct from draft.preparation_contract ->> 'input_fingerprint'
    or draft.input_fingerprint is distinct from md5(selected_shot::text)
    or draft.selected_material_revision_id is null
    or coalesce(jsonb_typeof(draft.clip_segments), '') <> 'array'
    or jsonb_array_length(draft.clip_segments) = 0
    or draft.video_duration_seconds is null or draft.video_duration_seconds <= 0
    or not public.is_valid_shot_composition(draft.composition, jsonb_array_length(draft.clip_segments))
    or not public.is_valid_shot_caption_contract(draft.caption_contract)
  then raise exception 'Media, layout, and caption contracts must be current and valid' using errcode = '22023'; end if;

  if not exists (
    select 1 from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.id = draft.selected_material_revision_id and material.episode_id = p_episode_id
      and material.material_type = 'video' and material.sha256 ~ '^[0-9a-f]{64}$' and material.file_size > 0
  ) then raise exception 'The current approved video material is required' using errcode = '22023'; end if;

  if exists (
    select 1 from jsonb_array_elements(draft.clip_segments) segment
    where jsonb_typeof(segment) <> 'object'
      or jsonb_typeof(segment -> 'start_seconds') <> 'number'
      or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'start_seconds')::numeric < 0
      or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
      or (segment ->> 'end_seconds')::numeric > draft.video_duration_seconds
  ) then raise exception 'Every media range must be valid for the approved source' using errcode = '22023'; end if;

  if draft.subtitles_enabled and (
    draft.caption_contract ->> 'text' is distinct from draft.subtitle_text
    or coalesce(jsonb_array_length(draft.caption_contract -> 'cues'), 0) = 0
    or draft.acoustic_alignment ->> 'status' <> 'completed'
    or coalesce(jsonb_array_length(draft.acoustic_alignment -> 'cues'), 0) <> jsonb_array_length(draft.caption_contract -> 'cues')
    or exists (
      select 1
      from jsonb_array_elements(coalesce(draft.acoustic_alignment -> 'cues', '[]'::jsonb)) with ordinality as aligned(cue, ordinal)
      join jsonb_array_elements(draft.caption_contract -> 'cues') with ordinality as caption(cue, ordinal) using (ordinal)
      where aligned.cue ->> 'id' is distinct from caption.cue ->> 'id'
        or aligned.cue ->> 'text' is distinct from caption.cue ->> 'text'
        or (aligned.cue ->> 'startMs')::numeric is distinct from (caption.cue ->> 'start_ms')::numeric
        or (aligned.cue ->> 'endMs')::numeric is distinct from (caption.cue ->> 'end_ms')::numeric
    )
  ) then raise exception 'Enabled captions require current content, manual timing, safe-area layout, and completed alignment' using errcode = '22023'; end if;

  if draft.audio_mode <> 'none' and not exists (
    select 1 from public.audio_tracks track
    join public.tasks task on task.id = track.source_task_id
    where track.id = draft.current_audio_track_id and track.episode_id = p_episode_id
      and track.source_review_package_id = p_review_package_id and track.cue_id = draft.shot_id
      and task.status = 'completed' and task.invalidated_at is null
      and ((draft.audio_mode = 'tts' and track.track_kind = 'narration' and task.task_type = 'generate_narration')
        or (draft.audio_mode = 'source' and track.track_kind = 'source' and task.task_type = 'extract_embedded_audio'))
  ) then raise exception 'The current readable audio version is required' using errcode = '22023'; end if;
  if draft.audio_mode <> 'none' and draft.audio_status <> 'ready' then
    raise exception 'The current audio version is not ready' using errcode = '22023';
  end if;

  duration_seconds := (select sum((segment ->> 'end_seconds')::numeric - (segment ->> 'start_seconds')::numeric) from jsonb_array_elements(draft.clip_segments) segment);
  duration_settings := public.shot_duration_settings(p_episode_id);
  duration_decision := public.shot_duration_decision(
    draft.audio_mode,
    case when draft.audio_mode = 'tts' then draft.tts_actual_duration_seconds when draft.audio_mode = 'source' then draft.source_audio_duration_seconds else null end,
    duration_seconds,
    (selected_shot ->> 'durationSeconds')::numeric,
    (duration_settings ->> 'frame_rate')::numeric,
    (duration_settings ->> 'allowed_frames')::integer,
    duration_seconds
  );
  has_deviation := duration_decision ->> 'status' = 'needs_attention';
  if has_deviation and (p_deviation_resolution = 'none' or coalesce(btrim(p_confirmation_reason), '') = '') then
    raise exception 'A non-structural deviation needs an Episode exception or confirmation reason' using errcode = '22023';
  end if;
  if not has_deviation and p_deviation_resolution <> 'none' then
    raise exception 'A deviation resolution cannot be recorded when the current shot has no deviation' using errcode = '22023';
  end if;

  select task.* into preview_task from public.tasks task where task.id = draft.current_preview_task_id;
  if draft.pending_preview_task_id is not null or draft.preview_status <> 'ready'
    or draft.current_preview_input_fingerprint is distinct from draft.preparation_input_fingerprint
    or draft.current_preview_artifact_id is null or draft.current_preview_project_artifact_id is null
    or preview_task.id is null or preview_task.task_type <> 'generate_shot_sync_preview'
    or preview_task.provider <> 'openchatcut' or preview_task.status <> 'completed' or preview_task.invalidated_at is not null
    or preview_task.input_snapshot ->> 'preview_input_fingerprint' is distinct from draft.preparation_input_fingerprint
    or coalesce((preview_task.last_result #>> '{validation,passed}')::boolean, false) is not true
  then raise exception 'Only the current verified OpenChatCut sync preview can be confirmed' using errcode = '22023'; end if;

  if not exists (select 1 from public.artifacts artifact where artifact.id = draft.current_preview_artifact_id and artifact.producer_task_id = preview_task.id and artifact.artifact_type = 'shot_preview_proxy' and artifact.sha256 is not null and artifact.file_size > 0)
    or not exists (select 1 from public.artifacts artifact where artifact.id = draft.current_preview_project_artifact_id and artifact.producer_task_id = preview_task.id and artifact.artifact_type = 'shot_editable_project' and artifact.sha256 is not null and artifact.file_size > 0)
    or not exists (select 1 from public.artifacts artifact where artifact.producer_task_id = preview_task.id and artifact.artifact_type = 'shot_preview_runtime' and artifact.sha256 is not null and artifact.file_size > 0)
    or not exists (select 1 from public.artifacts artifact where artifact.producer_task_id = preview_task.id and artifact.artifact_type = 'shot_preview_qc_report' and artifact.sha256 is not null and artifact.file_size > 0)
  then raise exception 'The OpenChatCut proxy, editable project, runtime, and QC evidence must all exist' using errcode = '22023'; end if;

  if exists (
    select required.name from unnest(array['openchatcut_project', 'openchatcut_render', 'openchatcut_qc']) required(name)
    where not exists (
      select 1 from jsonb_array_elements(coalesce(preview_task.last_result #> '{validation,checks}', '[]'::jsonb)) check_item
      where check_item ->> 'name' = required.name and coalesce((check_item ->> 'passed')::boolean, false)
    )
  ) then raise exception 'OpenChatCut compatibility checks are incomplete' using errcode = '22023'; end if;

  update public.shot_preparation_drafts target
  set confirmation_status = 'confirmed',
      confirmation_reason = coalesce(nullif(btrim(p_confirmation_reason), ''), 'Owner confirmed every current shot acceptance gate.'),
      warning_decision = case when has_deviation then 'accepted' else 'not_required' end,
      warning_reason = case when has_deviation then btrim(p_confirmation_reason) else null end,
      warning_accepted_at = case when has_deviation then now() else null end,
      warning_accepted_by = case when has_deviation then auth.uid() else null end,
      confirmed_at = now(), confirmed_by = auth.uid(), skipped_at = null, skipped_by = null, updated_at = now()
  where target.id = draft.id returning * into saved_draft;

  if has_deviation then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, p_episode_id,
      case when p_deviation_resolution = 'episode_exception' then 'shot_episode_exception_recorded' else 'shot_confirmation_reason_recorded' end,
      jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', draft.shot_id, 'resolution', p_deviation_resolution, 'reason', btrim(p_confirmation_reason), 'duration_decision', duration_decision), auth.uid());
  end if;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_sync_preview_confirmed', jsonb_build_object(
    'review_package_id', p_review_package_id, 'shot_id', draft.shot_id,
    'task_id', draft.current_preview_task_id, 'input_fingerprint', draft.current_preview_input_fingerprint,
    'confirmation_reason', saved_draft.confirmation_reason, 'deviation_resolution', p_deviation_resolution,
    'acceptance_gates', jsonb_build_array('media', 'layout', 'captions', 'alignment', 'deviation', 'preview_fingerprint', 'openchatcut_project')
  ), auth.uid());
  return saved_draft;
end;
$$;

revoke all on function public.confirm_shot_sync_preview(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.confirm_shot_sync_preview(uuid, uuid, text, text, text) to authenticated;
