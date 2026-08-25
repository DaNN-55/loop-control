-- Correct the previous manual-path guard without rewriting its migration:
-- each A-roll Episode is evaluated independently, and narration keeps the
-- source-audio gate from 20260823185000.

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef(to_regprocedure('public.orchestrate_a_roll_tasks_without_card_adapter()')) into definition;
  if definition is null then
    raise exception 'Missing A-roll orchestration implementation';
  end if;
  if position('where episode.stage = ''storyboard_approved''' in definition) = 0 then
    raise exception 'Unable to scope A-roll orchestration by Episode';
  end if;
  definition := regexp_replace(definition, 'CREATE OR REPLACE FUNCTION public\.orchestrate_a_roll_tasks_without_card_adapter\(\)', 'CREATE OR REPLACE FUNCTION public.orchestrate_a_roll_tasks_for_episode(p_episode_id uuid)', 1, 1, 'i');
  definition := replace(definition, 'where episode.stage = ''storyboard_approved''', 'where episode.stage = ''storyboard_approved'' and (p_episode_id is null or episode.id = p_episode_id) and coalesce(blueprint.policy #>> ''{a_roll,execution_path}'', ''external'') <> ''manual''');
  execute definition;
end;
$migration$;

create or replace function public.orchestrate_a_roll_tasks()
returns setof public.tasks
language plpgsql security definer set search_path = ''
as $$
declare
  candidate_id uuid;
  created_task public.tasks;
begin
  for candidate_id in
    select episode.id
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where coalesce(blueprint.policy #>> '{a_roll,execution_path}', 'external') <> 'manual'
  loop
    for created_task in select * from public.orchestrate_a_roll_tasks_for_episode(candidate_id)
    loop
      if created_task.input_snapshot #>> '{executor,provider}' = 'hyperframes'
        and created_task.input_snapshot #>> '{executor,adapter}' = 'hyperframes_card_video'
        and created_task.input_snapshot #>> '{executor,model}' = 'hyperframes@0.7.109' then
        update public.tasks task
        set status = 'ready'::public.task_status,
            last_result = null,
            completed_at = null
        where task.id = created_task.id
        returning task.* into created_task;
      end if;
      return next created_task;
    end loop;
  end loop;
end;
$$;

create or replace function public.orchestrate_narration_tasks(p_episode_id uuid default null)
returns setof public.tasks
language plpgsql security definer set search_path = ''
as $$
declare candidate_id uuid;
begin
  for candidate_id in
    select episode.id
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where (p_episode_id is null or episode.id = p_episode_id)
      and episode.audio_source_mode = 'tts'
      and (blueprint.policy -> 'narration') is not null
      and jsonb_typeof(blueprint.policy -> 'narration') <> 'null'
      and coalesce(blueprint.policy #>> '{narration,execution_path}', 'external') <> 'manual'
  loop
    return query select * from public.orchestrate_narration_tasks_configured(candidate_id);
  end loop;
end;
$$;

create function public.register_manual_episode_narration(
  p_episode_id uuid,
  p_material_revision_id uuid,
  p_storyboard_review_package_id uuid
)
returns public.tasks
language plpgsql security definer set search_path = ''
as $$
declare
  current_episode public.episodes;
  selected_material public.production_material_revisions;
  selected_package public.review_packages;
  created_task public.tasks;
  created_artifact public.artifacts;
  total_duration numeric;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to register manual Episode narration' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual Episode narration can only be bound after storyboard approval' using errcode = '22023'; end if;
  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'Current approved storyboard package is required' using errcode = '22023'; end if;
  select material.* into selected_material
  from public.production_material_revisions material
  join public.material_revision_approvals approval on approval.material_revision_id = material.id
  where material.id = p_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'audio' and material.material_purpose = 'narration';
  if not found then raise exception 'Approved narration audio material is required' using errcode = '22023'; end if;
  select sum((shot ->> 'durationSeconds')::numeric) into total_duration
  from jsonb_array_elements(selected_package.context_snapshot #> '{worker_result,storyboard,shots}') shot
  where (shot ->> 'durationSeconds') ~ '^[0-9]+([.][0-9]+)?$' and (shot ->> 'durationSeconds')::numeric > 0;
  if total_duration is null or total_duration <= 0 then raise exception 'Approved storyboard narration duration is invalid' using errcode = '22023'; end if;
  update public.tasks task
  set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner replaced automatic narration with an immutable Episode manual upload.'
  where task.episode_id = p_episode_id and task.task_type = 'generate_narration' and task.status in ('ready', 'blocked', 'failed') and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text;
  if exists (select 1 from public.audio_tracks track where track.episode_id = p_episode_id and track.source_review_package_id = p_storyboard_review_package_id and track.track_kind = 'narration' and track.cue_id = p_episode_id::text) then raise exception 'This Episode already has frozen narration' using errcode = '22023'; end if;
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, actual_cost_cents, completed_at, last_result)
  values (p_episode_id, 'generate_narration', 'completed', jsonb_build_object('capability', 'narration_manual_upload', 'storyboard_review_package_id', p_storyboard_review_package_id, 'configuration_hash', 'manual', 'audio_track', jsonb_build_object('kind', 'narration', 'cue_id', p_episode_id::text, 'source_review_package_id', p_storyboard_review_package_id, 'start_seconds', 0, 'duration_seconds', total_duration), 'manual_source', jsonb_build_object('material_revision_id', selected_material.id, 'source_kind', selected_material.source_kind), 'output', jsonb_build_object('required_artifact_types', jsonb_build_array('narration_audio'), 'content_type', selected_material.mime_type, 'relative_path', selected_material.storage_path, 'review_stage', 'production_ready'), 'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'manual_audio_upload', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size))), 0, 1, 'manual_upload', 'owner-provided-audio', 'manual-episode-narration-v1', 0, now(), jsonb_build_object('version', 'manual-result/v1', 'status', 'completed', 'artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'narration_audio', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size)), 'validation', jsonb_build_object('passed', true, 'checks', jsonb_build_array()), 'actualCostCents', 0, 'blockers', jsonb_build_array(), 'retry', jsonb_build_object('shouldRetry', false, 'reason', 'Manual source is immutable.'), 'nextStep', 'Proceed after the remaining media is ready.')) returning * into created_task;
  insert into public.artifacts (episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id) values (p_episode_id, 'narration_audio', selected_material.storage_path, selected_material.sha256, selected_material.file_size, created_task.id) returning * into created_artifact;
  insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, source_material_revision_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds) values (p_episode_id, created_task.id, created_artifact.id, p_storyboard_review_package_id, selected_material.id, 'narration', p_episode_id::text, selected_material.storage_path, selected_material.sha256, selected_material.file_size, 0, total_duration);
  insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id) values (p_episode_id, 'material_revision', selected_material.id, 'task', created_task.id) on conflict do nothing;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, p_episode_id, 'manual_episode_narration_registered', jsonb_build_object('task_id', created_task.id, 'material_revision_id', selected_material.id, 'storyboard_review_package_id', selected_package.id), auth.uid());
  return created_task;
end;
$$;

do $migration$
declare
  definition text;
  old_check text := 'track.cue_id = shot ->> ''id''';
  episode_check text := '(track.cue_id = shot ->> ''id'' or track.cue_id = candidate.id::text)';
begin
  select pg_get_functiondef(to_regprocedure('public.advance_production_ready_episodes(uuid)')) into definition;
  if definition is null or position(old_check in definition) = 0 then
    raise exception 'Unable to accept Episode-level manual narration';
  end if;
  execute replace(definition, old_check, episode_check);
end;
$migration$;

revoke all on function public.orchestrate_a_roll_tasks() from public, anon, authenticated;
grant execute on function public.orchestrate_a_roll_tasks() to service_role;
revoke all on function public.orchestrate_narration_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_narration_tasks(uuid) to service_role;
revoke all on function public.register_manual_episode_narration(uuid, uuid, uuid) from public, anon;
grant execute on function public.register_manual_episode_narration(uuid, uuid, uuid) to authenticated;
