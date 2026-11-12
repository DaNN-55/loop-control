-- T21: explicit Owner opt-in for Studio review renders; no final/delivery tasks.
ALTER TABLE local_identity.input_episodes ADD COLUMN studio_enabled boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION local_identity.input_task_allowed(p_episode_id uuid,p_task_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=p_episode_id AND e.enabled AND (p_task_type='prepare_visual_brief' OR (e.storyboard_enabled AND p_task_type IN ('draft_storyboard','draft_storyboard_revision')) OR (e.narration_enabled AND p_task_type='generate_narration') OR (e.media_enabled AND p_task_type IN ('generate_a_roll','generate_b_roll','generate_soundtrack','extract_embedded_audio')) OR (e.alignment_enabled AND p_task_type='align_shot_captions') OR (e.preview_enabled AND p_task_type='generate_shot_sync_preview') OR (e.studio_enabled AND p_task_type='generate_review_render')))
$$;
GRANT EXECUTE ON FUNCTION public.generate_shot_review_video(uuid,uuid,jsonb,boolean,text),public.request_review_render_revision(uuid,jsonb,text),public.request_studio_storyboard_revision(uuid,text) TO loop_owner;
CREATE FUNCTION local_identity.studio_audio_members(p_episode_id uuid,p_review_package_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) OR NOT EXISTS(SELECT 1 FROM public.review_packages p JOIN public.approvals a ON a.review_package_id=p.id AND a.stage='storyboard_approved' AND a.decision='approved' WHERE p.id=p_review_package_id AND p.episode_id=p_episode_id AND p.stage='storyboard_review' AND p.invalidated_at IS NULL) THEN RAISE EXCEPTION 'Current approved Owner storyboard required' USING ERRCODE='42501'; END IF;
 RETURN public.storyboard_selected_audio_members(p_episode_id,p_review_package_id);
END $$;
CREATE FUNCTION local_identity.queue_owned_studio_render(p_episode_id uuid) RETURNS SETOF public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) OR NOT EXISTS(SELECT 1 FROM local_identity.input_episodes WHERE episode_id=p_episode_id AND studio_enabled) THEN RAISE EXCEPTION 'Owner Studio Episode required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM public.orchestrate_review_render_tasks(p_episode_id);
END $$;
CREATE FUNCTION local_identity.scope_input_studio_task(p_task_id uuid,p_fingerprint text,p_frozen jsonb) RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tasks; prefix text;
BEGIN
 SELECT * INTO t FROM public.tasks WHERE id=p_task_id;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(t.episode_id) OR NOT local_identity.input_task_allowed(t.episode_id,t.task_type) OR t.task_type<>'generate_review_render' OR t.status<>'ready' OR t.attempt<>0 OR t.created_at<>transaction_timestamp() OR p_fingerprint !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Fresh Owner Studio task required' USING ERRCODE='42501'; END IF;
 IF t.input_snapshot#>'{review_render,adjustments,studio_project}' IS DISTINCT FROM p_frozen THEN RAISE EXCEPTION 'Frozen Studio task differs' USING ERRCODE='22023'; END IF;
 prefix:=format('episodes/%s/review-render/%s',t.episode_id,t.id);
 UPDATE public.tasks SET input_snapshot=jsonb_set(jsonb_set(input_snapshot,'{output,relative_path}',to_jsonb(prefix||'/review-render.mp4')),'{review_render,project_relative_path}',to_jsonb(prefix||'/index.html'))||jsonb_build_object('native_studio_fingerprint',p_fingerprint,'input_artifacts',coalesce(input_snapshot->'input_artifacts','[]'::jsonb)||jsonb_build_array(jsonb_build_object('artifactType','studio_frozen_project','relativePath',p_frozen->>'relative_path','sha256',p_frozen->>'sha256','fileSize',(p_frozen->>'file_size')::bigint))) WHERE id=t.id RETURNING * INTO t;
 INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES(t.episode_id,t.id,'studio_frozen_project',p_frozen->>'relative_path',p_frozen->>'sha256',(p_frozen->>'file_size')::bigint);
 RETURN t;
END $$;
REVOKE ALL ON FUNCTION local_identity.studio_audio_members(uuid,uuid),local_identity.queue_owned_studio_render(uuid),local_identity.scope_input_studio_task(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.studio_audio_members(uuid,uuid),local_identity.queue_owned_studio_render(uuid),local_identity.scope_input_studio_task(uuid,text,jsonb) TO loop_owner;

-- The existing editable shot workbench also serves input revision from QC.
CREATE OR REPLACE FUNCTION public.generate_shot_clip(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_retry boolean DEFAULT false)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_episode public.episodes;
  draft public.shot_preparation_drafts;
  selected_material public.production_material_revisions;
  selected_package public.review_packages;
  selected_shot jsonb;
  segment jsonb;
  existing_task public.tasks;
  created_task public.tasks;
  config_hash text;
  output_type text;
  output_path text;
  task_snapshot jsonb;
  safe_shot_id text;
  total_duration numeric := 0;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = local_identity.owner_id() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate a shot clip' using errcode = '42501'; end if;
  if current_episode.stage not in ('storyboard_approved','production_ready','render_ready','qc_review') then raise exception 'Shot clips can only be generated in the shot workbench' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;
  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the approved storyboard' using errcode = '22023'; end if;

  select * into draft from public.shot_preparation_drafts
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id)
  for update;
  if not found or draft.selected_material_revision_id is null or jsonb_typeof(draft.clip_segments) <> 'array' or jsonb_array_length(draft.clip_segments) = 0 then raise exception 'Please save a source video and valid clip segments before generating' using errcode = '22023'; end if;
  for segment in select value from jsonb_array_elements(draft.clip_segments) loop
    if jsonb_typeof(segment) <> 'object' or jsonb_typeof(segment -> 'start_seconds') <> 'number' or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'start_seconds')::numeric < 0 or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
      or (segment ->> 'end_seconds')::numeric > 86400 then
      raise exception 'Clip segment is invalid' using errcode = '22023';
    end if;
    total_duration := public.shot_composition_playback_duration(draft.clip_segments, draft.composition);
  end loop;
  select material.* into selected_material
  from public.production_material_revisions material
  join public.material_revision_approvals approval on approval.material_revision_id = material.id
  where material.id = draft.selected_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'video'
    and material.material_purpose = case selected_shot ->> 'shotType' when 'a_roll' then 'a_roll' else 'b_roll' end;
  if not found then raise exception 'The selected source video is no longer approved for this shot' using errcode = '22023'; end if;

  config_hash := md5(jsonb_build_object('material_revision_id', selected_material.id, 'sha256', selected_material.sha256, 'clip_segments', draft.clip_segments)::text);
  select task.* into existing_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
    and task.input_snapshot ->> 'configuration_hash' = config_hash
  order by task.created_at desc for update limit 1;
  if found and existing_task.status in ('ready', 'running', 'completed') then return existing_task; end if;
  if found and existing_task.status in ('failed', 'blocked') and not p_retry then return existing_task; end if;

  update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'A newer shot clip generation was requested.'
  where task.episode_id = p_episode_id
    and task.task_type = case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
    and task.input_snapshot ->> 'storyboard_review_package_id' = p_review_package_id::text
    and task.input_snapshot #>> '{shot,id}' = draft.shot_id
    and coalesce(task.input_snapshot ->> 'pre_render_revision', '') = ''
    and task.status <> 'superseded';

  output_type := case selected_shot ->> 'shotType' when 'a_roll' then 'a_roll_video' else 'b_roll_asset' end;
  safe_shot_id := regexp_replace(btrim(p_shot_id), '[^a-zA-Z0-9_-]', '_', 'g');
  output_path := format('episodes/%s/shot-clips/%s-%s.mp4', p_episode_id, safe_shot_id, config_hash);
  task_snapshot := jsonb_build_object(
    'capability', 'shot_clip_preparation',
    'storyboard_review_package_id', p_review_package_id,
    'configuration_hash', config_hash,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', p_episode_id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
    'shot', selected_shot,
    'executor', jsonb_build_object('provider', 'ffmpeg', 'adapter', 'ffmpeg_trim_video', 'model', 'ffmpeg', 'prompt_version', 'shot-clip-v2'),
    'media', jsonb_build_object('adapter', 'ffmpeg_trim_video', 'video_clips', jsonb_build_object('source_relative_path', selected_material.storage_path, 'segments', draft.clip_segments, 'target_duration_seconds', total_duration)),
    'clip_selection', jsonb_build_object('segments', draft.clip_segments, 'duration_seconds', total_duration),
    'manual_source', jsonb_build_object('material_revision_id', selected_material.id),
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array(output_type), 'content_type', 'video/mp4', 'relative_path', output_path, 'review_stage', 'production_ready'),
    'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'source_video', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size)),
    'allowed_tools', jsonb_build_array('read', 'write')
  );
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end, 'ready', task_snapshot, 0, 2, 'ffmpeg', 'ffmpeg', 'shot-clip-v2')
  returning * into created_task;
  update public.shot_preparation_drafts
  set video_status = 'running', pending_video_task_id = created_task.id, video_error = null, updated_at = now()
  where id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_clip_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'configuration_hash', config_hash, 'retry', p_retry), local_identity.owner_id());
  return created_task;
end;
$function$;

-- The existing editable shot workbench also serves input revision from QC.
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
  if current_episode.stage not in ('storyboard_approved','production_ready','render_ready','qc_review') then raise exception 'Shot source audio can only be generated in the shot workbench' using errcode = '22023'; end if;
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
