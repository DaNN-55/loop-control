do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.save_shot_workbench_draft(uuid, uuid, text, uuid, jsonb, text, text, boolean, text, text, numeric)'::regprocedure) into definition;
  patched := replace(
    definition,
    'current_video_artifact_id = case when changed then null else current_video_artifact_id end,
      current_video_task_id = case when changed then null else current_video_task_id end,
      pending_video_task_id = case when changed then null else pending_video_task_id end,',
    'current_video_artifact_id = current_video_artifact_id,
      current_video_task_id = current_video_task_id,
      pending_video_task_id = null,'
  );
  if patched = definition then raise exception 'save_shot_workbench_draft clip preservation patch target was not found'; end if;
  execute patched;
end;
$$;

create or replace function public.generate_shot_clip(
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
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate a shot clip' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Shot clips can only be generated in the shot workbench' using errcode = '22023'; end if;

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
    total_duration := total_duration + (segment ->> 'end_seconds')::numeric - (segment ->> 'start_seconds')::numeric;
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
  where task.episode_id = p_episode_id and task.task_type = case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
    and task.status in ('ready', 'blocked', 'failed');

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
  values (current_episode.account_id, p_episode_id, 'shot_clip_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'configuration_hash', config_hash, 'retry', p_retry), auth.uid());
  return created_task;
end;
$$;

revoke all on function public.generate_shot_clip(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.generate_shot_clip(uuid, uuid, text, boolean) to authenticated;
