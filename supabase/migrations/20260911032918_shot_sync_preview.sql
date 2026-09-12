alter table public.tasks drop constraint tasks_task_type_check;
alter table public.tasks add constraint tasks_task_type_check check (task_type in (
  'draft_brief','draft_script','prepare_visual_brief','draft_storyboard','draft_storyboard_revision',
  'generate_a_roll','generate_b_roll','generate_narration','align_shot_captions','extract_embedded_audio','generate_soundtrack',
  'generate_review_render','generate_shot_sync_preview','generate_final_render','prepare_publish_package','verify_publish_package','register_publish_input'
));

alter table public.shot_preparation_drafts
  add column transition_mode text not null default 'cut'
    check (transition_mode in ('cut', 'fade', 'studio')),
  add column preview_status text not null default 'pending'
    check (preview_status in ('pending', 'running', 'ready', 'failed')),
  add column current_preview_artifact_id uuid references public.artifacts(id) on delete set null,
  add column current_preview_project_artifact_id uuid references public.artifacts(id) on delete set null,
  add column current_preview_task_id uuid references public.tasks(id) on delete set null,
  add column current_preview_input_fingerprint text,
  add column pending_preview_task_id uuid references public.tasks(id) on delete set null,
  add column preview_error text,
  add constraint shot_preparation_drafts_preview_fingerprint_check
    check (current_preview_input_fingerprint is null or current_preview_input_fingerprint ~ '^[0-9a-f]{32}$');

create index shot_preparation_drafts_pending_preview_idx
  on public.shot_preparation_drafts (pending_preview_task_id)
  where pending_preview_task_id is not null;

create or replace function public.build_shot_preparation_contract(p_draft public.shot_preparation_drafts)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  base jsonb;
begin
  base := jsonb_build_object(
    'version', 'shot-preparation/v1',
    'storyboard_fingerprint', p_draft.input_fingerprint,
    'source_material_revision_id', p_draft.selected_material_revision_id,
    'clip_segments', p_draft.clip_segments,
    'composition', p_draft.composition,
    'transition_mode', p_draft.transition_mode,
    'audio_mode', p_draft.audio_mode,
    'audio_track_id', case when p_draft.audio_mode = 'none' then null else p_draft.current_audio_track_id end,
    'tts_text', p_draft.tts_text,
    'tts_voice', p_draft.tts_voice,
    'tts_speaking_rate', p_draft.tts_speaking_rate,
    'audio_mix', public.build_shot_audio_mix(p_draft),
    'captions', p_draft.caption_contract,
    'acoustic_alignment', p_draft.acoustic_alignment
  );
  return base || jsonb_build_object('input_fingerprint', md5(base::text));
end;
$$;

update public.shot_preparation_drafts draft
set preparation_contract = public.build_shot_preparation_contract(draft);

update public.shot_preparation_drafts
set preparation_input_fingerprint = preparation_contract ->> 'input_fingerprint';

create function public.expire_shot_sync_preview()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.preparation_input_fingerprint is distinct from new.preparation_input_fingerprint then
    new.pending_preview_task_id := null;
    new.preview_status := case when old.current_preview_artifact_id is null then 'pending' else 'ready' end;
    new.preview_error := null;
    new.confirmation_status := 'pending';
    new.confirmation_reason := null;
    new.confirmed_at := null;
    new.confirmed_by := null;
  end if;
  return new;
end;
$$;

create trigger zz_expire_shot_sync_preview
before update on public.shot_preparation_drafts
for each row execute function public.expire_shot_sync_preview();

create function public.save_shot_transition_mode(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_transition_mode text
)
returns public.shot_preparation_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.shot_preparation_drafts;
begin
  if p_transition_mode not in ('cut', 'fade', 'studio') then
    raise exception 'Shot transition mode is invalid' using errcode = '22023';
  end if;
  select target.* into draft
  from public.shot_preparation_drafts target
  join public.episodes episode on episode.id = target.episode_id
  join public.account_memberships membership
    on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where target.episode_id = p_episode_id
    and target.review_package_id = p_review_package_id
    and target.shot_id = btrim(p_shot_id)
  for update of target;
  if not found then raise exception 'Owner shot workbench access is required' using errcode = '42501'; end if;

  update public.shot_preparation_drafts target
  set transition_mode = p_transition_mode,
      frozen_at = case when target.transition_mode is distinct from p_transition_mode then null else target.frozen_at end,
      frozen_by = case when target.transition_mode is distinct from p_transition_mode then null else target.frozen_by end,
      updated_at = now()
  where target.id = draft.id
  returning * into draft;
  return draft;
end;
$$;

create function public.generate_shot_sync_preview(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text
)
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  selected_shot jsonb;
  draft public.shot_preparation_drafts;
  material public.production_material_revisions;
  narration_track public.audio_tracks;
  narration_task public.tasks;
  selected_audio jsonb;
  audio_member jsonb;
  created_task public.tasks;
  existing_task public.tasks;
  storyboard jsonb;
  members jsonb := '[]'::jsonb;
  inputs jsonb := '[]'::jsonb;
  confirmed_shots jsonb;
  duration_seconds numeric;
  shot_offset_seconds numeric := 0;
  duration_decision jsonb;
  project_path text;
  proxy_path text;
  transition_value text;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
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

  storyboard := selected_package.context_snapshot #> '{worker_result,storyboard}';
  select shot.value into selected_shot
  from jsonb_array_elements(storyboard -> 'shots') shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The selected shot is not in the approved storyboard' using errcode = '22023'; end if;
  select coalesce(sum((candidate.value ->> 'durationSeconds')::numeric), 0) into shot_offset_seconds
  from jsonb_array_elements(storyboard -> 'shots') with ordinality candidate(value, position)
  where candidate.position < (
    select selected.position
    from jsonb_array_elements(storyboard -> 'shots') with ordinality selected(value, position)
    where selected.value ->> 'id' = btrim(p_shot_id)
  );

  select target.* into draft from public.shot_preparation_drafts target
  where target.episode_id = p_episode_id and target.review_package_id = p_review_package_id
    and target.shot_id = btrim(p_shot_id) for update;
  if not found or draft.preparation_contract is null
    or draft.input_fingerprint is distinct from md5(selected_shot::text)
    or draft.preparation_input_fingerprint is distinct from draft.preparation_contract ->> 'input_fingerprint'
    or draft.selected_material_revision_id is null
    or coalesce(jsonb_typeof(draft.clip_segments), '') <> 'array'
    or jsonb_array_length(draft.clip_segments) = 0
    or draft.video_duration_seconds is null or draft.video_duration_seconds <= 0 then
    raise exception 'The shot needs a current preparation contract and valid media ranges' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(draft.clip_segments) segment
    where jsonb_typeof(segment) <> 'object'
      or jsonb_typeof(segment -> 'start_seconds') <> 'number'
      or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'start_seconds')::numeric < 0
      or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
  ) then raise exception 'The shot needs valid clip segment boundaries' using errcode = '22023'; end if;
  if draft.subtitles_enabled and (
    coalesce(draft.caption_contract ->> 'text', '') = ''
    or coalesce(jsonb_array_length(draft.caption_contract -> 'cues'), 0) = 0
    or draft.acoustic_alignment ->> 'status' <> 'completed'
  ) then raise exception 'Enabled captions need completed acoustic or manual timing cues' using errcode = '22023'; end if;
  if draft.audio_mode = 'tts' and (draft.audio_status <> 'ready' or draft.current_audio_track_id is null) then
    raise exception 'The TTS shot needs its current successful narration' using errcode = '22023';
  end if;
  if draft.audio_mode = 'source' and (draft.audio_status <> 'ready' or draft.current_audio_track_id is null or draft.source_audio_duration_seconds is null or draft.source_audio_duration_seconds <= 0) then
    raise exception 'The source-audio shot needs its current extracted audio evidence' using errcode = '22023';
  end if;

  select revision.* into material
  from public.production_material_revisions revision
  join public.material_revision_approvals approval on approval.material_revision_id = revision.id
  where revision.id = draft.selected_material_revision_id and revision.episode_id = p_episode_id and revision.material_type = 'video';
  if not found then raise exception 'The shot needs an approved immutable video material' using errcode = '22023'; end if;

  select task.* into existing_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = 'generate_shot_sync_preview'
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
    and task.input_snapshot ->> 'preview_input_fingerprint' = draft.preparation_input_fingerprint
    and task.status in ('ready', 'running', 'completed')
  order by task.created_at desc limit 1;
  if found then return next existing_task; return; end if;

  duration_seconds := (select sum((segment ->> 'end_seconds')::numeric - (segment ->> 'start_seconds')::numeric) from jsonb_array_elements(draft.clip_segments) segment);
  duration_decision := public.shot_duration_decision(
    draft.audio_mode,
    case when draft.audio_mode = 'tts' then draft.tts_actual_duration_seconds when draft.audio_mode = 'source' then coalesce(draft.source_audio_duration_seconds, duration_seconds) else null end,
    duration_seconds,
    (selected_shot ->> 'durationSeconds')::numeric,
    30, 2, duration_seconds
  );
  transition_value := case when draft.transition_mode = 'fade' then 'fade' else 'cut' end;
  project_path := format('episodes/%s/shot-previews/%s/%s/index.html', p_episode_id, regexp_replace(draft.shot_id, '[^a-zA-Z0-9_-]', '-', 'g'), draft.preparation_input_fingerprint);
  proxy_path := format('episodes/%s/shot-previews/%s/%s/proxy.mp4', p_episode_id, regexp_replace(draft.shot_id, '[^a-zA-Z0-9_-]', '-', 'g'), draft.preparation_input_fingerprint);

  members := jsonb_build_array(jsonb_build_object(
    'member_key', format('shot:%s', draft.shot_id), 'member_kind', 'shot_media',
    'source_material_revision_id', material.id, 'clip_segments', draft.clip_segments,
    'composition', draft.composition, 'preparation_contract', draft.preparation_contract,
    'audio_track_id', case when draft.audio_mode = 'none' then null else draft.current_audio_track_id end,
    'input_fingerprint', draft.preparation_input_fingerprint, 'audio_mode', draft.audio_mode,
    'subtitle_text', draft.subtitle_text, 'subtitles_enabled', draft.subtitles_enabled,
    'relative_path', material.storage_path, 'sha256', material.sha256,
    'start_seconds', 0, 'duration_seconds', duration_seconds, 'duration_decision', duration_decision
  ));
  inputs := jsonb_build_array(jsonb_build_object('artifactType', 'source_video', 'relativePath', material.storage_path, 'sha256', material.sha256, 'fileSize', material.file_size));

  if draft.audio_mode = 'tts' then
    select track.* into narration_track
    from public.audio_tracks track join public.tasks task on task.id = track.source_task_id
    where track.id = draft.current_audio_track_id and track.episode_id = p_episode_id
      and track.source_review_package_id = p_review_package_id and track.cue_id = draft.shot_id
      and track.track_kind = 'narration' and task.id = coalesce(draft.current_tts_task_id, track.source_task_id)
      and task.task_type = 'generate_narration' and task.status = 'completed' and task.invalidated_at is null
      and task.input_snapshot #>> '{media,narration,text}' = draft.tts_text
      and task.input_snapshot ->> 'configuration_hash' = public.shot_tts_configuration_hash(p_episode_id, draft.id);
    if not found then raise exception 'The current narration track is not readable' using errcode = '22023'; end if;
    select task.* into narration_task from public.tasks task where task.id = narration_track.source_task_id;
    members := members || jsonb_build_array(jsonb_build_object(
      'member_key', format('narration:%s', draft.shot_id), 'member_kind', 'narration',
      'task_id', narration_task.id, 'audio_track_id', narration_track.id, 'audio_mode', 'tts',
      'relative_path', narration_track.relative_path, 'sha256', narration_track.sha256,
      'start_seconds', 0, 'duration_seconds', narration_track.duration_seconds
    ));
    inputs := inputs || jsonb_build_array(jsonb_build_object('artifactType', 'audio_track', 'relativePath', narration_track.relative_path, 'sha256', narration_track.sha256, 'fileSize', narration_track.file_size));
  end if;

  selected_audio := public.storyboard_selected_audio_members(p_episode_id, p_review_package_id);
  for audio_member in select value from jsonb_array_elements(selected_audio) loop
    if (audio_member ->> 'target_kind' = 'episode' and audio_member #>> '{cue,kind}' = 'bgm')
      or (audio_member ->> 'target_kind' = 'shot' and audio_member ->> 'target_id' = draft.shot_id and audio_member #>> '{cue,kind}' = 'sfx') then
      members := members || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'member_key', audio_member ->> 'member_key', 'member_kind', 'soundtrack',
        'audio_kind', audio_member #>> '{cue,kind}', 'task_id', audio_member #>> '{task,id}',
        'audio_track_id', audio_member #>> '{audio_track,id}',
        'relative_path', coalesce(audio_member #>> '{audio_track,relative_path}', audio_member #>> '{source_material,relative_path}'),
        'sha256', coalesce(audio_member #>> '{audio_track,sha256}', audio_member #>> '{source_material,sha256}'),
        'start_seconds', case when audio_member #>> '{cue,kind}' = 'bgm' then 0 else greatest(0, coalesce((audio_member #>> '{audio_track,start_seconds}')::numeric, 0) - shot_offset_seconds) end,
        'duration_seconds', least(duration_seconds, coalesce((audio_member #>> '{audio_track,duration_seconds}')::numeric, (audio_member ->> 'duration_seconds')::numeric))
      )));
      inputs := inputs || jsonb_build_array(jsonb_build_object(
        'artifactType', case when audio_member ? 'source_material' then 'soundtrack_audio' else 'audio_track' end,
        'relativePath', coalesce(audio_member #>> '{audio_track,relative_path}', audio_member #>> '{source_material,relative_path}'),
        'sha256', coalesce(audio_member #>> '{audio_track,sha256}', audio_member #>> '{source_material,sha256}'),
        'fileSize', coalesce((audio_member #>> '{audio_track,file_size}')::bigint, (audio_member #>> '{source_material,file_size}')::bigint)
      ));
    end if;
  end loop;

  confirmed_shots := jsonb_build_array(jsonb_build_object(
    'shot_id', draft.shot_id, 'confirmation_status', 'confirmed',
    'input_fingerprint', draft.preparation_input_fingerprint, 'preparation_contract', draft.preparation_contract,
    'source_material_revision_id', material.id, 'clip_segments', draft.clip_segments, 'composition', draft.composition,
    'audio_mode', draft.audio_mode, 'audio_track_id', case when draft.audio_mode = 'none' then null else draft.current_audio_track_id end,
    'subtitle_text', draft.subtitle_text, 'subtitles_enabled', draft.subtitles_enabled, 'duration_decision', duration_decision
  ));

  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, 'generate_shot_sync_preview', 'ready', jsonb_build_object(
    'capability', 'review_rendering', 'allowed_tools', jsonb_build_array('read', 'write'),
    'preview_input_fingerprint', draft.preparation_input_fingerprint,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
    'review_render', jsonb_build_object(
      'pre_render_review_package_id', p_review_package_id, 'project_revision', 1, 'project_relative_path', project_path,
      'confirmation_mode', 'shot_preparation', 'confirmed_shots', confirmed_shots,
      'storyboard', jsonb_build_object('version', 'storyboard/v1', 'shots', jsonb_build_array(selected_shot), 'audioCues', '[]'::jsonb),
      'members', members,
      'adjustments', jsonb_build_object('aspect_ratio', '9:16', 'width', 1080, 'height', 1920, 'captions_enabled', draft.subtitles_enabled,
        'caption_style', 'minimal', 'pacing', 'standard', 'crop', 'cover', 'transition', transition_value, 'layout', 'center',
        'narration_gain_db', 0, 'bgm_gain_db', -12, 'sfx_gain_db', -6, 'frame_rate', 30, 'allowed_frames', 2,
        'reason', '当前镜头输入的同步预览与可编辑工程描述。')
    ),
    'input_artifacts', inputs,
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array('shot_preview_proxy', 'shot_editable_project', 'shot_preview_runtime', 'shot_preview_qc_report'),
      'content_type', 'video/mp4', 'relative_path', proxy_path, 'review_stage', 'storyboard_approved')
  ), 0, 1, 'openchatcut', 'openchatcut@0.2.14', 'shot-sync-preview-v1')
  returning * into created_task;

  update public.shot_preparation_drafts target
  set pending_preview_task_id = created_task.id, preview_status = 'running', preview_error = null,
      confirmation_status = 'pending', confirmation_reason = null, confirmed_at = null, confirmed_by = null, updated_at = now()
  where target.id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_sync_preview_requested', jsonb_build_object(
    'review_package_id', p_review_package_id, 'shot_id', draft.shot_id, 'task_id', created_task.id,
    'input_fingerprint', draft.preparation_input_fingerprint, 'transition_mode', draft.transition_mode
  ), auth.uid());
  return next created_task;
end;
$$;

create function public.sync_shot_preview_after_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_id uuid;
  proxy public.artifacts;
  project public.artifacts;
begin
  if new.task_type <> 'generate_shot_sync_preview' or new.status not in ('completed', 'failed', 'blocked') then return new; end if;
  draft_id := nullif(new.input_snapshot #>> '{shot_preparation,draft_id}', '')::uuid;
  if draft_id is null then return new; end if;
  if new.status = 'completed' then
    select artifact.* into proxy from public.artifacts artifact where artifact.producer_task_id = new.id and artifact.artifact_type = 'shot_preview_proxy';
    select artifact.* into project from public.artifacts artifact where artifact.producer_task_id = new.id and artifact.artifact_type = 'shot_editable_project';
    if proxy.id is null or project.id is null then return new; end if;
    update public.shot_preparation_drafts target
    set current_preview_artifact_id = proxy.id, current_preview_project_artifact_id = project.id,
        current_preview_task_id = new.id, current_preview_input_fingerprint = new.input_snapshot ->> 'preview_input_fingerprint',
        pending_preview_task_id = null, preview_status = 'ready', preview_error = null, updated_at = now()
    where target.id = draft_id and target.pending_preview_task_id = new.id
      and target.preparation_input_fingerprint = new.input_snapshot ->> 'preview_input_fingerprint';
  else
    update public.shot_preparation_drafts target
    set pending_preview_task_id = null, preview_status = 'failed',
        preview_error = coalesce(new.last_result #>> '{retry,reason}', '同步预览生成失败；上一版可播放代理已保留。'), updated_at = now()
    where target.id = draft_id and target.pending_preview_task_id = new.id;
  end if;
  return new;
end;
$$;

create trigger sync_shot_preview_after_task_update
after update of status on public.tasks
for each row execute function public.sync_shot_preview_after_task_update();

create function public.confirm_shot_sync_preview(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text
)
returns public.shot_preparation_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  draft public.shot_preparation_drafts;
begin
  select episode.* into current_episode from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id;
  if not found then raise exception 'Owner shot workbench access is required' using errcode = '42501'; end if;
  select target.* into draft from public.shot_preparation_drafts target
  where target.episode_id = p_episode_id and target.review_package_id = p_review_package_id and target.shot_id = btrim(p_shot_id)
  for update;
  if not found or draft.pending_preview_task_id is not null or draft.preview_status <> 'ready'
    or draft.current_preview_input_fingerprint is distinct from draft.preparation_input_fingerprint
    or draft.current_preview_artifact_id is null or draft.current_preview_project_artifact_id is null
    or not exists (select 1 from public.tasks task where task.id = draft.current_preview_task_id and task.status = 'completed' and task.invalidated_at is null)
  then raise exception 'Only the current verified sync preview can be confirmed' using errcode = '22023'; end if;

  update public.shot_preparation_drafts target
  set confirmation_status = 'confirmed', confirmation_reason = 'Owner confirmed the current verified sync preview.',
      confirmed_at = now(), confirmed_by = auth.uid(), updated_at = now()
  where target.id = draft.id returning * into draft;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_sync_preview_confirmed', jsonb_build_object(
    'review_package_id', p_review_package_id, 'shot_id', draft.shot_id,
    'task_id', draft.current_preview_task_id, 'input_fingerprint', draft.current_preview_input_fingerprint
  ), auth.uid());
  return draft;
end;
$$;

do $$
declare definition text; patched text;
begin
  definition := pg_get_functiondef('public.protect_frozen_shot_preparation_inputs()'::regprocedure);
  patched := replace(definition, 'or old.bgm_ducking_level is distinct from new.bgm_ducking_level', 'or old.bgm_ducking_level is distinct from new.bgm_ducking_level or old.transition_mode is distinct from new.transition_mode');
  if patched = definition then raise exception 'protect_frozen_shot_preparation_inputs transition patch target is unknown'; end if;
  execute patched;
end $$;

do $$
declare definition text; patched text;
begin
  definition := pg_get_functiondef('public.save_shot_manual_alignment(uuid,uuid,text,jsonb)'::regprocedure);
  patched := replace(definition, 'order by ordinal', 'order by ordinality');
  if patched = definition then raise exception 'save_shot_manual_alignment ordinality patch target is unknown'; end if;
  execute patched;
end $$;

revoke all on function public.build_shot_preparation_contract(public.shot_preparation_drafts) from public, anon, authenticated;
revoke all on function public.expire_shot_sync_preview() from public, anon, authenticated;
revoke all on function public.save_shot_transition_mode(uuid, uuid, text, text) from public, anon;
grant execute on function public.save_shot_transition_mode(uuid, uuid, text, text) to authenticated;
revoke all on function public.generate_shot_sync_preview(uuid, uuid, text) from public, anon;
grant execute on function public.generate_shot_sync_preview(uuid, uuid, text) to authenticated;
revoke all on function public.sync_shot_preview_after_task_update() from public, anon, authenticated;
grant execute on function public.sync_shot_preview_after_task_update() to service_role;
revoke all on function public.confirm_shot_sync_preview(uuid, uuid, text) from public, anon;
grant execute on function public.confirm_shot_sync_preview(uuid, uuid, text) to authenticated;
