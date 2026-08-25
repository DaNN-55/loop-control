create function public.register_manual_b_roll(
  p_episode_id uuid,
  p_material_revision_id uuid,
  p_shot_id text,
  p_storyboard_review_package_id uuid
)
returns public.tasks
language plpgsql security definer set search_path = ''
as $$
declare current_episode public.episodes; selected_material public.production_material_revisions; selected_package public.review_packages; selected_shot jsonb; created_task public.tasks;
begin
  select episode.* into current_episode from public.episodes episode join public.account_memberships membership on membership.account_id = episode.account_id where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner' for update of episode;
  if not found then raise exception 'Owner membership is required to register manual B-roll' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual B-roll can only be bound after storyboard approval' using errcode = '22023'; end if;
  select package.* into selected_package from public.review_packages package join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved' where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'Current approved storyboard package is required' using errcode = '22023'; end if;
  select material.* into selected_material from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id where material.id = p_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'video' and material.material_purpose = 'b_roll';
  if not found then raise exception 'Approved B-roll video material is required' using errcode = '22023'; end if;
  select value into selected_shot from jsonb_array_elements(selected_package.context_snapshot #> '{worker_result,storyboard,shots}') as shot(value) where value ->> 'id' = btrim(p_shot_id) and value ->> 'shotType' = 'b_roll';
  if not found then raise exception 'Approved storyboard B-roll shot does not exist' using errcode = '22023'; end if;
  update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner replaced automatic B-roll with an immutable manual upload.' where task.episode_id = p_episode_id and task.task_type = 'generate_b_roll' and task.status in ('ready', 'blocked', 'failed') and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text and task.input_snapshot #>> '{shot,id}' = selected_shot ->> 'id';
  if exists (select 1 from public.tasks task where task.episode_id = p_episode_id and task.task_type = 'generate_b_roll' and task.status <> 'superseded' and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text and task.input_snapshot #>> '{shot,id}' = selected_shot ->> 'id') then raise exception 'This storyboard shot already has frozen B-roll media' using errcode = '22023'; end if;
  if exists (select 1 from public.artifacts artifact where artifact.episode_id = p_episode_id and artifact.artifact_type = 'b_roll_asset' and artifact.relative_path = selected_material.storage_path) then raise exception 'This B-roll material is already bound to another storyboard shot' using errcode = '22023'; end if;
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, actual_cost_cents, completed_at, last_result)
  values (p_episode_id, 'generate_b_roll', 'completed', jsonb_build_object('capability', 'b_roll_manual_upload', 'storyboard_review_package_id', p_storyboard_review_package_id, 'configuration_hash', 'manual', 'shot', selected_shot, 'manual_source', jsonb_build_object('material_revision_id', selected_material.id, 'source_kind', selected_material.source_kind), 'output', jsonb_build_object('required_artifact_types', jsonb_build_array('b_roll_asset'), 'content_type', selected_material.mime_type, 'relative_path', selected_material.storage_path, 'review_stage', 'production_ready'), 'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'manual_b_roll_upload', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size))), 0, 1, 'manual_upload', 'owner-provided-video', 'manual-b-roll-v1', 0, now(), jsonb_build_object('version', 'manual-result/v1', 'status', 'completed', 'artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'b_roll_asset', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size)), 'validation', jsonb_build_object('passed', true, 'checks', jsonb_build_array(jsonb_build_object('name', 'immutable_material_revision', 'passed', true, 'detail', 'Owner-provided B-roll is bound to this approved storyboard shot.'))), 'actualCostCents', 0, 'blockers', jsonb_build_array(), 'retry', jsonb_build_object('shouldRetry', false, 'reason', 'Manual source is immutable.'), 'nextStep', 'Proceed to pre-render review after the remaining media is ready.')) returning * into created_task;
  insert into public.artifacts (episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id) values (p_episode_id, 'b_roll_asset', selected_material.storage_path, selected_material.sha256, selected_material.file_size, created_task.id);
  insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id) values (p_episode_id, 'material_revision', selected_material.id, 'task', created_task.id) on conflict do nothing;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, p_episode_id, 'manual_b_roll_registered', jsonb_build_object('task_id', created_task.id, 'material_revision_id', selected_material.id, 'shot_id', selected_shot ->> 'id', 'storyboard_review_package_id', p_storyboard_review_package_id), auth.uid());
  return created_task;
end;
$$;

create function public.register_manual_audio(
  p_episode_id uuid,
  p_material_revision_id uuid,
  p_target_id text,
  p_storyboard_review_package_id uuid
)
returns public.tasks
language plpgsql security definer set search_path = ''
as $$
declare current_episode public.episodes; selected_material public.production_material_revisions; selected_package public.review_packages; target jsonb; item jsonb; created_task public.tasks; created_artifact public.artifacts; target_kind text; target_task_type text; target_artifact_type text; target_start numeric := 0; target_duration numeric;
begin
  select episode.* into current_episode from public.episodes episode join public.account_memberships membership on membership.account_id = episode.account_id where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner' for update of episode;
  if not found then raise exception 'Owner membership is required to register manual audio' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual audio can only be bound after storyboard approval' using errcode = '22023'; end if;
  select package.* into selected_package from public.review_packages package join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved' where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'Current approved storyboard package is required' using errcode = '22023'; end if;
  select material.* into selected_material from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id where material.id = p_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'audio' and material.material_purpose in ('narration', 'background_music', 'sound_effect');
  if not found then raise exception 'Approved narration, music, or sound effect material is required' using errcode = '22023'; end if;
  if selected_material.material_purpose = 'narration' then
    for item in select value from jsonb_array_elements(selected_package.context_snapshot #> '{worker_result,storyboard,shots}') loop
      if item ->> 'id' = btrim(p_target_id) then target := item; exit; end if;
      if coalesce(item ->> 'durationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'Approved storyboard shot duration is invalid' using errcode = '22023'; end if;
      target_start := target_start + (item ->> 'durationSeconds')::numeric;
    end loop;
    target_kind := 'narration'; target_task_type := 'generate_narration'; target_artifact_type := 'narration_audio';
  else
    target_kind := case selected_material.material_purpose when 'background_music' then 'bgm' else 'sfx' end;
    select value into target from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,audioCues}', '[]'::jsonb)) as cue(value) where value ->> 'id' = btrim(p_target_id) and value ->> 'kind' = target_kind;
    target_task_type := 'generate_soundtrack'; target_artifact_type := 'soundtrack_audio';
    if found then target_start := (target ->> 'startSeconds')::numeric; end if;
  end if;
  if target is null or coalesce(target ->> 'durationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$' or (target ->> 'durationSeconds')::numeric <= 0 then raise exception 'Approved storyboard audio target does not exist or is invalid' using errcode = '22023'; end if;
  target_duration := (target ->> 'durationSeconds')::numeric;
  update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner replaced automatic audio with an immutable manual upload.' where task.episode_id = p_episode_id and task.task_type = target_task_type and task.status in ('ready', 'blocked', 'failed') and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text and task.input_snapshot #>> '{audio_track,cue_id}' = target ->> 'id';
  if exists (select 1 from public.tasks task where task.episode_id = p_episode_id and task.task_type = target_task_type and task.status <> 'superseded' and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text and task.input_snapshot #>> '{audio_track,cue_id}' = target ->> 'id') then raise exception 'This storyboard audio target already has frozen media' using errcode = '22023'; end if;
  if exists (select 1 from public.artifacts artifact where artifact.episode_id = p_episode_id and artifact.relative_path = selected_material.storage_path) then raise exception 'This audio material is already bound to another storyboard target' using errcode = '22023'; end if;
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, actual_cost_cents, completed_at, last_result)
  values (p_episode_id, target_task_type, 'completed', jsonb_build_object('capability', case when target_kind = 'narration' then 'narration_manual_upload' else 'soundtrack_manual_upload' end, 'storyboard_review_package_id', p_storyboard_review_package_id, 'configuration_hash', 'manual', 'audio_track', jsonb_build_object('kind', target_kind, 'cue_id', target ->> 'id', 'source_review_package_id', p_storyboard_review_package_id, 'source_material_revision_id', selected_material.id, 'start_seconds', target_start, 'duration_seconds', target_duration), 'manual_source', jsonb_build_object('material_revision_id', selected_material.id, 'source_kind', selected_material.source_kind), 'output', jsonb_build_object('required_artifact_types', jsonb_build_array(target_artifact_type), 'content_type', selected_material.mime_type, 'relative_path', selected_material.storage_path, 'review_stage', 'production_ready'), 'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'manual_audio_upload', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size))), 0, 1, 'manual_upload', 'owner-provided-audio', 'manual-audio-v1', 0, now(), jsonb_build_object('version', 'manual-result/v1', 'status', 'completed', 'artifacts', jsonb_build_array(jsonb_build_object('artifactType', target_artifact_type, 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size)), 'validation', jsonb_build_object('passed', true, 'checks', jsonb_build_array(jsonb_build_object('name', 'immutable_material_revision', 'passed', true, 'detail', 'Owner-provided audio is bound to this approved storyboard target.'))), 'actualCostCents', 0, 'blockers', jsonb_build_array(), 'retry', jsonb_build_object('shouldRetry', false, 'reason', 'Manual source is immutable.'), 'nextStep', 'Proceed to pre-render review after the remaining media is ready.')) returning * into created_task;
  insert into public.artifacts (episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id) values (p_episode_id, target_artifact_type, selected_material.storage_path, selected_material.sha256, selected_material.file_size, created_task.id) returning * into created_artifact;
  insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, source_material_revision_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds) values (p_episode_id, created_task.id, created_artifact.id, p_storyboard_review_package_id, selected_material.id, target_kind, target ->> 'id', selected_material.storage_path, selected_material.sha256, selected_material.file_size, target_start, target_duration);
  insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id) values (p_episode_id, 'material_revision', selected_material.id, 'task', created_task.id) on conflict do nothing;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, p_episode_id, 'manual_audio_registered', jsonb_build_object('task_id', created_task.id, 'material_revision_id', selected_material.id, 'target_id', target ->> 'id', 'track_kind', target_kind, 'storyboard_review_package_id', p_storyboard_review_package_id), auth.uid());
  return created_task;
end;
$$;

create or replace function public.advance_production_ready_episodes(p_episode_id uuid default null)
returns setof public.episodes
language plpgsql security definer set search_path = ''
as $$
declare candidate record; advanced_episode public.episodes;
begin
  for candidate in
    select episode.id, episode.account_id, package.id as storyboard_review_package_id, package.context_snapshot as storyboard_context
    from public.episodes episode
    join lateral (
      select review_package.* from public.review_packages review_package
      join public.approvals approval on approval.review_package_id = review_package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
      where review_package.episode_id = episode.id and review_package.stage = 'storyboard_review' and review_package.invalidated_at is null
      order by review_package.revision_number desc limit 1
    ) package on true
    where episode.stage = 'storyboard_approved' and (p_episode_id is null or episode.id = p_episode_id)
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    if jsonb_typeof(candidate.storyboard_context #> '{worker_result,storyboard,shots}') <> 'array' or jsonb_array_length(candidate.storyboard_context #> '{worker_result,storyboard,shots}') = 0 then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') shot
      where shot ->> 'shotType' not in ('a_roll', 'b_roll') or coalesce(btrim(shot ->> 'id'), '') = '' or not exists (
        select 1 from public.tasks task join public.artifacts artifact on artifact.producer_task_id = task.id and artifact.relative_path = task.input_snapshot #>> '{output,relative_path}' and artifact.artifact_type = any (array(select jsonb_array_elements_text(task.input_snapshot #> '{output,required_artifact_types}')))
        where task.episode_id = candidate.id and task.status = 'completed' and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text and task.input_snapshot #>> '{shot,id}' = shot ->> 'id' and task.task_type = case shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
      )
    ) then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') shot
      where not exists (
        select 1 from public.audio_tracks track where track.episode_id = candidate.id and track.track_kind = 'narration' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = shot ->> 'id'
      )
    ) and exists (
      select 1 from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where material.episode_id = candidate.id and material.material_type = 'video' and material.storage_path ~* '[.](mp4|mov|webm)$'
    ) and not exists (
      select 1 from public.audio_tracks track join public.production_material_revisions material on material.id = track.source_material_revision_id join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where track.episode_id = candidate.id and track.track_kind = 'derived'
    ) then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') shot
      where not exists (select 1 from public.audio_tracks track where track.episode_id = candidate.id and track.track_kind = 'narration' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = shot ->> 'id')
    ) and not exists (
      select 1 from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where material.episode_id = candidate.id and material.material_type = 'video' and material.storage_path ~* '[.](mp4|mov|webm)$'
    ) then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(candidate.storyboard_context #> '{worker_result,storyboard,audioCues}', '[]'::jsonb)) cue
      where cue ->> 'kind' not in ('bgm', 'sfx') or coalesce(btrim(cue ->> 'id'), '') = '' or not exists (
        select 1 from public.audio_tracks track where track.episode_id = candidate.id and track.track_kind = cue ->> 'kind' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = cue ->> 'id'
      )
    ) then continue; end if;
    update public.episodes set stage = 'production_ready', updated_at = now() where id = candidate.id returning * into advanced_episode;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'storyboard_approved', 'production_ready', '所有冻结镜头媒体、旁白及声明声轨均已验证完成。', null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'stage_transition', jsonb_build_object('from_stage', 'storyboard_approved', 'to_stage', 'production_ready', 'reason', '所有冻结镜头媒体、旁白及声明声轨均已验证完成。'), null);
    return next advanced_episode;
  end loop;
end;
$$;

do $$
declare definition text; scoped_definition text; replacement text := 'if has_approved_video and exists (select 1 from jsonb_array_elements(candidate.storyboard_context #> ''{worker_result,storyboard,shots}'') shot where not exists (select 1 from public.audio_tracks track where track.episode_id = candidate.episode_id and track.track_kind = ''narration'' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = shot ->> ''id'')) then';
begin
  select pg_get_functiondef('public.create_pre_render_review_packages()'::regprocedure) into definition;
  if position('if has_approved_video then' in definition) = 0 then raise exception 'Unable to prioritize manual narration in pre-render packages'; end if;
  execute replace(definition, 'if has_approved_video then', replacement);
  select pg_get_functiondef('public.create_pre_render_review_packages_for_episode(uuid)'::regprocedure) into scoped_definition;
  if position('if has_approved_video then' in scoped_definition) = 0 then raise exception 'Unable to prioritize manual narration in scoped pre-render packages'; end if;
  execute replace(scoped_definition, 'if has_approved_video then', replacement);
end;
$$;

revoke all on function public.register_manual_b_roll(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.register_manual_b_roll(uuid, uuid, text, uuid) to authenticated;
revoke all on function public.register_manual_audio(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.register_manual_audio(uuid, uuid, text, uuid) to authenticated;
