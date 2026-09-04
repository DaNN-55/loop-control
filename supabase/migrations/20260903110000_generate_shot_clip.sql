alter table public.shot_preparation_drafts
  add column if not exists selected_material_revision_id uuid references public.production_material_revisions(id) on delete set null,
  add column if not exists clip_start_seconds numeric(12, 3),
  add column if not exists clip_end_seconds numeric(12, 3),
  add column if not exists current_video_artifact_id uuid references public.artifacts(id) on delete set null,
  add column if not exists current_video_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists pending_video_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists video_error text;

create index if not exists shot_preparation_drafts_current_video_idx
on public.shot_preparation_drafts (current_video_artifact_id);

create or replace function public.save_shot_clip_draft(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_material_revision_id uuid,
  p_clip_start_seconds numeric,
  p_clip_end_seconds numeric
)
returns public.shot_preparation_drafts
language plpgsql security definer set search_path = ''
as $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  selected_shot jsonb;
  selected_material public.production_material_revisions;
  saved_draft public.shot_preparation_drafts;
  target_duration numeric;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to save a shot clip draft' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Shot clip drafts can only be saved in the shot workbench' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the approved storyboard' using errcode = '22023'; end if;
  target_duration := (selected_shot ->> 'durationSeconds')::numeric;

  if p_material_revision_id is not null then
    select material.* into selected_material
    from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.id = p_material_revision_id and material.episode_id = p_episode_id
      and material.material_type = 'video'
      and material.material_purpose = case selected_shot ->> 'shotType' when 'a_roll' then 'a_roll' else 'b_roll' end;
    if not found then raise exception 'Approved video material for this storyboard shot is required' using errcode = '22023'; end if;
    if p_clip_start_seconds is null or p_clip_end_seconds is null or p_clip_start_seconds < 0 or p_clip_end_seconds <= p_clip_start_seconds or p_clip_end_seconds > 86400 then raise exception 'Clip range is invalid' using errcode = '22023'; end if;
    if abs((p_clip_end_seconds - p_clip_start_seconds) - target_duration) > 0.05 then raise exception 'Clip duration must match the approved storyboard duration' using errcode = '22023'; end if;
  end if;

  update public.shot_preparation_drafts
  set selected_material_revision_id = p_material_revision_id,
      clip_start_seconds = p_clip_start_seconds,
      clip_end_seconds = p_clip_end_seconds,
      video_status = case when current_video_artifact_id is null then 'pending' else 'ready' end,
      video_error = null,
      pending_video_task_id = null,
      updated_at = now()
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id)
  returning * into saved_draft;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_clip_draft_saved', jsonb_build_object('shot_id', btrim(p_shot_id), 'material_revision_id', p_material_revision_id, 'clip_start_seconds', p_clip_start_seconds, 'clip_end_seconds', p_clip_end_seconds), auth.uid());
  return saved_draft;
end;
$$;

create function public.generate_shot_clip(
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
  existing_task public.tasks;
  created_task public.tasks;
  config_hash text;
  output_type text;
  output_path text;
  task_snapshot jsonb;
  safe_shot_id text;
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
  if not found or draft.selected_material_revision_id is null or draft.clip_start_seconds is null or draft.clip_end_seconds is null then raise exception 'Please save a source video and valid clip range before generating' using errcode = '22023'; end if;
  if draft.clip_start_seconds < 0 or draft.clip_end_seconds <= draft.clip_start_seconds or draft.clip_end_seconds > 86400 or abs((draft.clip_end_seconds - draft.clip_start_seconds) - (selected_shot ->> 'durationSeconds')::numeric) > 0.05 then raise exception 'Clip duration must match the approved storyboard duration' using errcode = '22023'; end if;

  select material.* into selected_material
  from public.production_material_revisions material
  join public.material_revision_approvals approval on approval.material_revision_id = material.id
  where material.id = draft.selected_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'video'
    and material.material_purpose = case selected_shot ->> 'shotType' when 'a_roll' then 'a_roll' else 'b_roll' end;
  if not found then raise exception 'The selected source video is no longer approved for this shot' using errcode = '22023'; end if;

  config_hash := md5(jsonb_build_object('material_revision_id', selected_material.id, 'sha256', selected_material.sha256, 'start_seconds', draft.clip_start_seconds, 'end_seconds', draft.clip_end_seconds)::text);
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
    'executor', jsonb_build_object('provider', 'ffmpeg', 'adapter', 'ffmpeg_trim_video', 'model', 'ffmpeg', 'prompt_version', 'shot-clip-v1'),
    'media', jsonb_build_object('adapter', 'ffmpeg_trim_video', 'video_clip', jsonb_build_object('source_relative_path', selected_material.storage_path, 'start_seconds', draft.clip_start_seconds, 'end_seconds', draft.clip_end_seconds, 'target_duration_seconds', draft.clip_end_seconds - draft.clip_start_seconds)),
    'clip_selection', jsonb_build_object('start_seconds', draft.clip_start_seconds, 'end_seconds', draft.clip_end_seconds, 'duration_seconds', draft.clip_end_seconds - draft.clip_start_seconds),
    'manual_source', jsonb_build_object('material_revision_id', selected_material.id),
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array(output_type), 'content_type', 'video/mp4', 'relative_path', output_path, 'review_stage', 'production_ready'),
    'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'source_video', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size)),
    'allowed_tools', jsonb_build_array('read', 'write')
  );
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end, 'ready', task_snapshot, 0, 2, 'ffmpeg', 'ffmpeg', 'shot-clip-v1')
  returning * into created_task;
  update public.shot_preparation_drafts
  set video_status = 'running', pending_video_task_id = created_task.id, video_error = null, updated_at = now()
  where id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_clip_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'configuration_hash', config_hash, 'retry', p_retry), auth.uid());
  return created_task;
end;
$$;

create or replace function public.sync_shot_clip_task_after_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  draft_id uuid;
  previous_task_id uuid;
  output_artifact public.artifacts;
begin
  if new.task_type not in ('generate_a_roll', 'generate_b_roll') or new.input_snapshot #>> '{shot_preparation,draft_id}' is null then return new; end if;
  draft_id := (new.input_snapshot #>> '{shot_preparation,draft_id}')::uuid;
  select current_video_task_id into previous_task_id from public.shot_preparation_drafts where id = draft_id;
  if new.status = 'completed' then
    select artifact.* into output_artifact from public.artifacts artifact where artifact.producer_task_id = new.id and artifact.relative_path = new.input_snapshot #>> '{output,relative_path}';
    if not found then raise exception 'Completed shot clip task is missing its output artifact' using errcode = '22023'; end if;
    update public.shot_preparation_drafts
    set current_video_artifact_id = output_artifact.id, current_video_task_id = new.id, pending_video_task_id = null, video_status = 'ready', video_error = null, updated_at = now()
    where id = draft_id and pending_video_task_id = new.id;
    update public.tasks old_task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'A newer validated shot clip became current.'
    where old_task.id = previous_task_id and old_task.id <> new.id and old_task.status = 'completed';
  elsif new.status in ('failed', 'blocked') then
    update public.shot_preparation_drafts
    set video_status = 'failed', pending_video_task_id = null, video_error = coalesce(new.last_result #>> '{retry,reason}', '镜头裁剪任务失败。'), updated_at = now()
    where id = draft_id and pending_video_task_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_shot_clip_task_after_update on public.tasks;
create trigger sync_shot_clip_task_after_update
after update of status on public.tasks
for each row execute function public.sync_shot_clip_task_after_update();

revoke all on function public.save_shot_clip_draft(uuid, uuid, text, uuid, numeric, numeric) from public, anon;
grant execute on function public.save_shot_clip_draft(uuid, uuid, text, uuid, numeric, numeric) to authenticated;
revoke all on function public.generate_shot_clip(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.generate_shot_clip(uuid, uuid, text, boolean) to authenticated;
revoke all on function public.sync_shot_clip_task_after_update() from public, anon, authenticated;
