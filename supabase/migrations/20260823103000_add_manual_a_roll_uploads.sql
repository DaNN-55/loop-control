alter table public.production_material_revisions
  drop constraint if exists production_material_revisions_material_purpose_check;

alter table public.production_material_revisions
  add constraint production_material_revisions_material_purpose_check
  check (material_purpose in ('main_script', 'supplemental_script', 'general_reference', 'visual_reference', 'a_roll', 'b_roll', 'narration', 'background_music', 'sound_effect'));

create or replace function public.import_production_material(
  p_episode_id uuid,
  p_material_type text,
  p_source_kind text,
  p_source_path text,
  p_storage_path text,
  p_mime_type text,
  p_sha256 text,
  p_file_size bigint,
  p_is_main_script boolean,
  p_material_purpose text
)
returns public.production_material_revisions
language plpgsql security definer set search_path = ''
as $$
declare
  created_revision public.production_material_revisions;
  current_episode public.episodes;
  next_revision integer;
begin
  select episode.*
  into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;

  if not found then raise exception 'Owner membership is required to import production material' using errcode = '42501'; end if;
  if p_material_purpose not in ('main_script', 'supplemental_script', 'general_reference', 'visual_reference', 'a_roll', 'b_roll', 'narration', 'background_music', 'sound_effect') then raise exception 'Unsupported material purpose' using errcode = '22023'; end if;
  if p_material_purpose = 'a_roll' and trim(p_material_type) <> 'video' then raise exception 'A-roll material must have video type' using errcode = '22023'; end if;
  if p_is_main_script and trim(p_material_type) <> 'script' then raise exception 'Main script material must have script type' using errcode = '22023'; end if;
  if p_is_main_script and p_material_purpose <> 'main_script' then raise exception 'Main script material must have main_script purpose' using errcode = '22023'; end if;
  if not p_is_main_script and p_material_purpose = 'main_script' then raise exception 'Only the confirmed main script can use main_script purpose' using errcode = '22023'; end if;
  if p_is_main_script and current_episode.stage <> 'waiting_input' then raise exception 'A main script can only be imported while the episode is waiting for input' using errcode = '22023'; end if;
  if p_is_main_script and current_episode.main_script_revision_id is not null then raise exception 'A main script is already confirmed for this episode' using errcode = '22023'; end if;
  if p_storage_path !~ ('^episodes/' || p_episode_id::text || '/materials/[0-9a-f]{64}-[^/]+$') then raise exception 'Material storage path is outside the episode material directory' using errcode = '22023'; end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.production_material_revisions
  where episode_id = p_episode_id and material_type = trim(p_material_type);

  insert into public.production_material_revisions (episode_id, revision_number, material_type, material_purpose, source_kind, source_path, storage_path, mime_type, sha256, file_size, is_main_script, created_by)
  values (p_episode_id, next_revision, trim(p_material_type), p_material_purpose, p_source_kind, trim(p_source_path), p_storage_path, p_mime_type, p_sha256, p_file_size, p_is_main_script, auth.uid())
  returning * into created_revision;

  insert into public.material_revision_approvals (material_revision_id, approved_by) values (created_revision.id, auth.uid());
  if p_is_main_script then update public.episodes set main_script_revision_id = created_revision.id, updated_at = now() where id = p_episode_id; end if;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'production_material_imported', jsonb_build_object('material_revision_id', created_revision.id, 'material_type', created_revision.material_type, 'material_purpose', created_revision.material_purpose, 'sha256', created_revision.sha256, 'source_kind', created_revision.source_kind, 'is_main_script', created_revision.is_main_script, 'approval_id', (select id from public.material_revision_approvals where material_revision_id = created_revision.id)), auth.uid());
  return created_revision;
end;
$$;

create function public.register_manual_a_roll(
  p_episode_id uuid,
  p_material_revision_id uuid,
  p_shot_id text,
  p_storyboard_review_package_id uuid
)
returns public.tasks
language plpgsql security definer set search_path = ''
as $$
declare
  current_episode public.episodes;
  selected_material public.production_material_revisions;
  selected_package public.review_packages;
  selected_shot jsonb;
  created_task public.tasks;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to register manual A-roll' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual A-roll can only be bound after storyboard approval' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'Current approved storyboard package is required' using errcode = '22023'; end if;

  select material.* into selected_material
  from public.production_material_revisions material
  join public.material_revision_approvals approval on approval.material_revision_id = material.id
  where material.id = p_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'video' and material.material_purpose = 'a_roll';
  if not found then raise exception 'Approved A-roll video material is required' using errcode = '22023'; end if;

  select shot into selected_shot
  from jsonb_array_elements(selected_package.context_snapshot #> '{worker_result,storyboard,shots}') shot
  where shot ->> 'id' = btrim(p_shot_id) and shot ->> 'shotType' = 'a_roll';
  if not found then raise exception 'Approved storyboard A-roll shot does not exist' using errcode = '22023'; end if;
  if exists (
    select 1 from public.tasks task
    where task.episode_id = p_episode_id
      and task.task_type = 'generate_a_roll'
      and task.status <> 'superseded'
      and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text
      and task.input_snapshot #>> '{shot,id}' = selected_shot ->> 'id'
  ) then raise exception 'This storyboard shot already has frozen A-roll media' using errcode = '22023'; end if;
  if exists (
    select 1 from public.artifacts artifact
    where artifact.episode_id = p_episode_id and artifact.artifact_type = 'a_roll_video' and artifact.relative_path = selected_material.storage_path
  ) then raise exception 'This A-roll material is already bound to another storyboard shot' using errcode = '22023'; end if;

  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, actual_cost_cents, completed_at, last_result)
  values (
    p_episode_id,
    'generate_a_roll',
    'completed',
    jsonb_build_object(
      'capability', 'a_roll_manual_upload',
      'storyboard_review_package_id', p_storyboard_review_package_id,
      'shot', selected_shot,
      'manual_source', jsonb_build_object('material_revision_id', selected_material.id, 'source_kind', selected_material.source_kind),
      'output', jsonb_build_object('required_artifact_types', jsonb_build_array('a_roll_video'), 'content_type', selected_material.mime_type, 'relative_path', selected_material.storage_path, 'review_stage', 'production_ready'),
      'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'manual_a_roll_upload', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size))
    ),
    0, 1, 'manual_upload', 'owner-provided-video', 'manual-a-roll-v1', 0, now(),
    jsonb_build_object('version', 'manual-result/v1', 'status', 'completed', 'artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'a_roll_video', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size)), 'validation', jsonb_build_object('passed', true, 'checks', jsonb_build_array(jsonb_build_object('name', 'immutable_material_revision', 'passed', true, 'detail', 'Owner-provided A-roll is bound to this approved storyboard shot.'))), 'actualCostCents', 0, 'blockers', jsonb_build_array(), 'retry', jsonb_build_object('shouldRetry', false, 'reason', 'Manual source is immutable.'), 'nextStep', 'Proceed to pre-render review after the remaining media is ready.')
  ) returning * into created_task;

  insert into public.artifacts (episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id)
  values (p_episode_id, 'a_roll_video', selected_material.storage_path, selected_material.sha256, selected_material.file_size, created_task.id);
  insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
  values (p_episode_id, 'material_revision', selected_material.id, 'task', created_task.id)
  on conflict do nothing;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'manual_a_roll_registered', jsonb_build_object('task_id', created_task.id, 'material_revision_id', selected_material.id, 'shot_id', selected_shot ->> 'id', 'storyboard_review_package_id', p_storyboard_review_package_id), auth.uid());
  return created_task;
end;
$$;

revoke all on function public.import_production_material(uuid, text, text, text, text, text, text, bigint, boolean, text) from public, anon;
grant execute on function public.import_production_material(uuid, text, text, text, text, text, text, bigint, boolean, text) to authenticated;
revoke all on function public.register_manual_a_roll(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.register_manual_a_roll(uuid, uuid, text, uuid) to authenticated;
