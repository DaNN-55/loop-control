alter table public.pre_render_review_members
  alter column source_task_id drop not null,
  add column if not exists source_material_revision_id uuid references public.production_material_revisions(id) on delete restrict;

alter table public.pre_render_review_members drop constraint if exists pre_render_review_members_check;
alter table public.pre_render_review_members drop constraint if exists pre_render_review_members_source_check;
alter table public.pre_render_review_members add constraint pre_render_review_members_source_check
  check (num_nonnulls(artifact_id, audio_track_id, source_material_revision_id) = 1);

drop trigger if exists zz_queue_source_audio_after_frozen_clip on public.tasks;
drop trigger if exists confirm_frozen_shot_when_ready on public.shot_preparation_drafts;

create or replace function public.record_pre_render_member_dependencies()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  package public.review_packages;
  source_task public.tasks;
  source_input jsonb;
  material public.production_material_revisions;
  series_version_id uuid;
begin
  select * into package from public.review_packages where id = new.review_package_id;
  if coalesce(package.context_snapshot ->> 'storyboard_review_package_id', '') <> '' then
    insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
    values (package.episode_id, 'review_package', (package.context_snapshot ->> 'storyboard_review_package_id')::uuid, 'review_package', package.id)
    on conflict do nothing;
  end if;
  if new.source_material_revision_id is not null then
    insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
    values (package.episode_id, 'material_revision', new.source_material_revision_id, 'review_package', package.id)
    on conflict do nothing;
    return new;
  end if;
  select * into source_task from public.tasks where id = new.source_task_id;
  if not found then raise exception 'Pre-render member source task is missing' using errcode = '22023'; end if;
  for source_input in select value from jsonb_array_elements(coalesce(source_task.input_snapshot -> 'input_artifacts', '[]'::jsonb)) loop
    select revision.* into material from public.production_material_revisions revision
    where revision.episode_id = package.episode_id and revision.storage_path = source_input ->> 'relativePath' and revision.sha256 = source_input ->> 'sha256' limit 1;
    if found then
      insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
      values (package.episode_id, 'material_revision', material.id, 'task', source_task.id), (package.episode_id, 'material_revision', material.id, 'review_package', package.id)
      on conflict do nothing;
    end if;
  end loop;
  if coalesce(source_task.input_snapshot #>> '{series_baseline,version_id}', '') <> '' then
    series_version_id := (source_task.input_snapshot #>> '{series_baseline,version_id}')::uuid;
    insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
    values (package.episode_id, 'series_version', series_version_id, 'task', source_task.id), (package.episode_id, 'series_version', series_version_id, 'review_package', package.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.has_current_shot_preparation_snapshot(p_episode_id uuid, p_storyboard_review_package_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
with storyboard as (
  select package.context_snapshot #> '{worker_result,storyboard,shots}' as shots
  from public.review_packages package
  where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review' and package.invalidated_at is null
), required_shots as (
  select shot.value from storyboard cross join lateral jsonb_array_elements(coalesce(storyboard.shots, '[]'::jsonb)) shot(value)
), valid_shots as (
  select required.value
  from required_shots required
  join public.shot_preparation_drafts draft on draft.episode_id = p_episode_id
    and draft.review_package_id = p_storyboard_review_package_id and draft.shot_id = required.value ->> 'id'
  join public.production_material_revisions material on material.id = draft.selected_material_revision_id
    and material.episode_id = p_episode_id and material.material_type = 'video'
  join public.material_revision_approvals approval on approval.material_revision_id = material.id
  where draft.frozen_at is not null and draft.confirmation_status = 'confirmed'
    and draft.input_fingerprint = md5(required.value::text) and draft.subtitle_text <> ''
    and jsonb_typeof(draft.clip_segments) = 'array' and jsonb_array_length(draft.clip_segments) > 0
    and not exists (
      select 1 from jsonb_array_elements(draft.clip_segments) segment
      where jsonb_typeof(segment) <> 'object'
        or jsonb_typeof(segment -> 'start_seconds') <> 'number'
        or jsonb_typeof(segment -> 'end_seconds') <> 'number'
        or (segment ->> 'start_seconds')::numeric < 0
        or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
    )
    and (draft.audio_mode <> 'tts' or exists (
      select 1 from public.audio_tracks track join public.tasks task on task.id = track.source_task_id
      where track.id = draft.current_audio_track_id and track.episode_id = p_episode_id
        and track.cue_id = draft.shot_id and track.source_review_package_id = p_storyboard_review_package_id
        and track.track_kind = 'narration' and track.sha256 is not null and track.file_size > 0
        and task.status = 'completed' and task.invalidated_at is null
        and task.input_snapshot #>> '{media,narration,text}' = draft.tts_text
    ))
)
select exists (select 1 from storyboard where jsonb_typeof(storyboard.shots) = 'array' and jsonb_array_length(storyboard.shots) > 0)
  and (select count(*) from valid_shots) = (select count(*) from required_shots);
$$;

create or replace function public.create_shot_preparation_review_package(p_episode_id uuid, p_storyboard_review_package_id uuid)
returns setof public.review_packages language plpgsql security definer set search_path = '' as $$
declare
  episode_record public.episodes;
  storyboard_package public.review_packages;
  existing_package public.review_packages;
  draft public.shot_preparation_drafts;
  material public.production_material_revisions;
  audio_task public.tasks;
  audio_track public.audio_tracks;
  shot jsonb;
  member jsonb;
  members jsonb := '[]'::jsonb;
  confirmed_shots jsonb := '[]'::jsonb;
  package_record public.review_packages;
  next_revision integer;
begin
  select * into episode_record from public.episodes where id = p_episode_id;
  select * into storyboard_package from public.review_packages
  where id = p_storyboard_review_package_id and episode_id = p_episode_id and stage = 'storyboard_review' and invalidated_at is null;
  if not found or not public.has_current_shot_preparation_snapshot(p_episode_id, p_storyboard_review_package_id) then return; end if;

  select * into existing_package from public.review_packages
  where episode_id = p_episode_id and stage = 'production_ready' and invalidated_at is null
    and context_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text
  order by revision_number desc limit 1;
  if found then return next existing_package; return; end if;

  update public.review_packages set invalidated_at = now(), invalidated_reason = 'Superseded by the current frozen marker snapshot.'
  where episode_id = p_episode_id and stage = 'production_ready' and invalidated_at is null;

  for shot in select value from jsonb_array_elements(storyboard_package.context_snapshot #> '{worker_result,storyboard,shots}') loop
    select * into draft from public.shot_preparation_drafts
    where episode_id = p_episode_id and review_package_id = p_storyboard_review_package_id and shot_id = shot ->> 'id';
    select material_revision.* into material from public.production_material_revisions material_revision
    join public.material_revision_approvals approval on approval.material_revision_id = material_revision.id
    where material_revision.id = draft.selected_material_revision_id and material_revision.episode_id = p_episode_id;
    if not found then return; end if;

    member := jsonb_build_object(
      'member_kind', 'shot_media', 'member_key', format('shot:%s', shot ->> 'id'), 'shot', shot,
      'input_fingerprint', draft.input_fingerprint, 'audio_mode', draft.audio_mode,
      'subtitle_text', draft.subtitle_text, 'subtitles_enabled', draft.subtitles_enabled,
      'clip_segments', draft.clip_segments, 'duration_seconds', draft.video_duration_seconds,
      'source_material', jsonb_build_object('id', material.id, 'artifact_type', 'source_video', 'relative_path', material.storage_path, 'sha256', material.sha256, 'file_size', material.file_size)
    );
    members := members || jsonb_build_array(member);

    if draft.audio_mode = 'tts' then
      select * into audio_track from public.audio_tracks where id = draft.current_audio_track_id;
      select * into audio_task from public.tasks where id = audio_track.source_task_id and status = 'completed' and invalidated_at is null;
      if not found then return; end if;
      members := members || jsonb_build_array(jsonb_build_object(
        'member_kind', 'narration', 'member_key', format('narration:%s', shot ->> 'id'), 'audio_mode', 'tts',
        'task', jsonb_build_object('id', audio_task.id, 'type', audio_task.task_type, 'attempt', audio_task.attempt, 'provider', audio_task.provider, 'model', audio_task.model, 'prompt_version', audio_task.prompt_version),
        'audio_track', jsonb_build_object('id', audio_track.id, 'kind', audio_track.track_kind, 'cue_id', audio_track.cue_id, 'relative_path', audio_track.relative_path, 'sha256', audio_track.sha256, 'file_size', audio_track.file_size, 'start_seconds', audio_track.start_seconds, 'duration_seconds', audio_track.duration_seconds)
      ));
    end if;

    confirmed_shots := confirmed_shots || jsonb_build_array(jsonb_build_object(
      'shot_id', shot ->> 'id', 'confirmation_status', 'confirmed', 'input_fingerprint', draft.input_fingerprint,
      'source_material_revision_id', material.id, 'clip_segments', draft.clip_segments,
      'audio_mode', draft.audio_mode, 'audio_track_id', case when draft.audio_mode = 'tts' then draft.current_audio_track_id else null end,
      'subtitle_text', draft.subtitle_text, 'subtitles_enabled', draft.subtitles_enabled
    ));
  end loop;

  select coalesce(max(revision_number), 0) + 1 into next_revision from public.review_packages
  where episode_id = p_episode_id and stage = 'production_ready';
  insert into public.review_packages (episode_id, stage, revision_number, context_snapshot)
  values (p_episode_id, 'production_ready', next_revision, jsonb_build_object(
    'review_kind', 'pre_render', 'approval_mode', 'qc_only', 'confirmation_mode', 'shot_preparation',
    'storyboard_review_package_id', p_storyboard_review_package_id,
    'storyboard', storyboard_package.context_snapshot #> '{worker_result,storyboard}',
    'confirmed_shots', confirmed_shots, 'members', members
  )) returning * into package_record;

  insert into public.pre_render_review_members (review_package_id, member_key, member_kind, source_task_id, artifact_id, audio_track_id, source_material_revision_id, evidence_snapshot)
  select package_record.id, evidence ->> 'member_key', evidence ->> 'member_kind',
    case when evidence ? 'task' then (evidence #>> '{task,id}')::uuid else null end,
    null, case when evidence ? 'audio_track' then (evidence #>> '{audio_track,id}')::uuid else null end,
    case when evidence ? 'source_material' then (evidence #>> '{source_material,id}')::uuid else null end, evidence
  from jsonb_array_elements(members) evidence;
  return next package_record;
end;
$$;

create or replace function public.freeze_shot_preparation_batch(p_episode_id uuid, p_review_package_id uuid)
returns setof public.tasks language plpgsql security definer set search_path = '' as $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  selected_shot jsonb;
  draft public.shot_preparation_drafts;
  delta numeric;
begin
  select episode.* into current_episode from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id for update of episode;
  if not found or current_episode.stage <> 'storyboard_approved' then raise exception 'Owner shot workbench access is required' using errcode = '42501'; end if;
  select * into selected_package from public.review_packages
  where id = p_review_package_id and episode_id = p_episode_id and stage = 'storyboard_review' and invalidated_at is null;
  if not found then raise exception 'The current storyboard package is required' using errcode = '22023'; end if;

  for selected_shot in select value from jsonb_array_elements(selected_package.context_snapshot #> '{worker_result,storyboard,shots}') loop
    select * into draft from public.shot_preparation_drafts
    where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = selected_shot ->> 'id' for update;
    if not found or draft.selected_material_revision_id is null or jsonb_array_length(draft.clip_segments) = 0 or draft.subtitle_text = '' then
      raise exception 'Every shot needs a saved source, marker selection, and subtitle decision before freezing' using errcode = '22023';
    end if;
    if draft.audio_mode = 'tts' and not exists (
      select 1 from public.audio_tracks track join public.tasks task on task.id = track.source_task_id
      where track.id = draft.current_audio_track_id and track.track_kind = 'narration' and task.status = 'completed'
        and task.invalidated_at is null and task.input_snapshot #>> '{media,narration,text}' = draft.tts_text
    ) then raise exception 'Every TTS shot needs its current generated narration before freezing' using errcode = '22023'; end if;
    delta := draft.video_duration_seconds - (selected_shot ->> 'durationSeconds')::numeric;
    update public.shot_preparation_drafts set frozen_at = now(), frozen_by = auth.uid(), confirmation_status = 'confirmed',
      confirmation_reason = 'Owner froze source and marker configuration for Studio.', confirmed_at = now(), confirmed_by = auth.uid(),
      video_status = 'ready', audio_status = case when audio_mode = 'tts' then audio_status else 'ready' end,
      warning_decision = case when abs(delta) > 0.05 then 'accepted' else 'not_required' end,
      warning_reason = case when abs(delta) > 0.05 then 'Marker duration accepted as an editable Studio starting point.' else null end,
      warning_accepted_at = case when abs(delta) > 0.05 then now() else null end,
      warning_accepted_by = case when abs(delta) > 0.05 then auth.uid() else null end, updated_at = now()
    where id = draft.id;
  end loop;

  if not exists (select 1 from public.create_shot_preparation_review_package(p_episode_id, p_review_package_id)) then
    raise exception 'Unable to freeze the source marker snapshot' using errcode = '22023';
  end if;
  update public.episodes set stage = 'production_ready', updated_at = now() where id = p_episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (p_episode_id, 'storyboard_approved', 'production_ready', '原片、片段标记和音频配置已冻结并进入 Studio。', auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_marker_batch_frozen', jsonb_build_object('review_package_id', p_review_package_id), auth.uid());
  perform public.orchestrate_review_render_tasks(p_episode_id);
  return;
end;
$$;

create or replace function public.orchestrate_review_render_tasks(p_episode_id uuid default null)
returns setof public.tasks language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  created_task public.tasks;
  members jsonb;
  inputs jsonb;
  composition public.review_render_composition_revisions;
  default_revision integer;
  config jsonb;
  project_path text;
  render_path text;
  default_config constant jsonb := '{"aspect_ratio":"9:16","width":1080,"height":1920,"captions_enabled":true,"caption_style":"cinematic","crop":"cover","pacing":"standard","transition":"fade","layout":"lower_third","narration_gain_db":0,"bgm_gain_db":-12,"sfx_gain_db":-6}'::jsonb;
begin
  for candidate in
    select episode.id as episode_id, episode.stage as episode_stage, package.id as pre_render_review_package_id, package.context_snapshot,
      coalesce(series_version.rules, '{}'::jsonb) as series_rules, coalesce(package.context_snapshot ->> 'approval_mode', '') = 'qc_only' as auto_qc
    from public.episodes episode
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    join lateral (select package.* from public.review_packages package where package.episode_id = episode.id and package.stage = 'production_ready' and package.invalidated_at is null
      and ((episode.stage = 'production_ready' and package.context_snapshot ->> 'approval_mode' = 'qc_only') or episode.stage = 'render_ready') order by package.revision_number desc limit 1) package on true
    where episode.stage in ('production_ready', 'render_ready') and (p_episode_id is null or episode.id = p_episode_id)
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    select * into composition from public.review_render_composition_revisions where pre_render_review_package_id = candidate.pre_render_review_package_id order by revision_number desc limit 1;
    if candidate.episode_stage = 'production_ready' or not found then
      select coalesce(max(revision_number), 0) + 1 into default_revision from public.review_render_composition_revisions where pre_render_review_package_id = candidate.pre_render_review_package_id;
      config := coalesce(candidate.series_rules -> 'hyperframes_composition', default_config);
      insert into public.review_render_composition_revisions (episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, composition_config)
      values (candidate.episode_id, candidate.pre_render_review_package_id, default_revision, config ->> 'caption_style', config ->> 'pacing', config ->> 'crop', config ->> 'transition', config ->> 'layout', '系列默认合成配置。', config)
      on conflict (pre_render_review_package_id, revision_number) do nothing;
      select * into composition from public.review_render_composition_revisions where pre_render_review_package_id = candidate.pre_render_review_package_id order by revision_number desc limit 1;
    end if;
    if exists (select 1 from public.tasks where episode_id = candidate.episode_id and task_type = 'generate_review_render' and input_snapshot #>> '{review_render,composition_revision_id}' = composition.id::text) then continue; end if;

    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'member_key', member.member_key, 'member_kind', member.member_kind, 'audio_kind', member.evidence_snapshot #>> '{cue,kind}',
      'task_id', member.source_task_id, 'artifact_id', member.artifact_id, 'audio_track_id', member.audio_track_id,
      'source_material_revision_id', member.source_material_revision_id, 'clip_segments', member.evidence_snapshot -> 'clip_segments',
      'audio_mode', member.evidence_snapshot ->> 'audio_mode', 'subtitle_text', member.evidence_snapshot ->> 'subtitle_text',
      'subtitles_enabled', (member.evidence_snapshot ->> 'subtitles_enabled')::boolean,
      'relative_path', coalesce(member.evidence_snapshot #>> '{source_material,relative_path}', member.evidence_snapshot #>> '{artifact,relative_path}', member.evidence_snapshot #>> '{audio_track,relative_path}'),
      'sha256', coalesce(member.evidence_snapshot #>> '{source_material,sha256}', member.evidence_snapshot #>> '{artifact,sha256}', member.evidence_snapshot #>> '{audio_track,sha256}'),
      'input_fingerprint', member.evidence_snapshot ->> 'input_fingerprint',
      'start_seconds', coalesce((member.evidence_snapshot #>> '{audio_track,start_seconds}')::numeric, 0),
      'duration_seconds', coalesce((member.evidence_snapshot #>> '{audio_track,duration_seconds}')::numeric, (member.evidence_snapshot ->> 'duration_seconds')::numeric, (member.evidence_snapshot #>> '{shot,durationSeconds}')::numeric)
    )) order by member.member_key), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'artifactType', case when member.source_material_revision_id is not null then 'source_video' when member.artifact_id is null then 'audio_track' else member.evidence_snapshot #>> '{artifact,artifact_type}' end,
      'relativePath', coalesce(member.evidence_snapshot #>> '{source_material,relative_path}', member.evidence_snapshot #>> '{artifact,relative_path}', member.evidence_snapshot #>> '{audio_track,relative_path}'),
      'sha256', coalesce(member.evidence_snapshot #>> '{source_material,sha256}', member.evidence_snapshot #>> '{artifact,sha256}', member.evidence_snapshot #>> '{audio_track,sha256}'),
      'fileSize', coalesce((member.evidence_snapshot #>> '{source_material,file_size}')::bigint, (member.evidence_snapshot #>> '{artifact,file_size}')::bigint, (member.evidence_snapshot #>> '{audio_track,file_size}')::bigint)
    ) order by member.member_key), '[]'::jsonb) into members, inputs
    from public.pre_render_review_members member left join public.pre_render_review_member_decisions decision
      on decision.review_package_id = member.review_package_id and decision.member_key = member.member_key and decision.decision = 'approved'
    where member.review_package_id = candidate.pre_render_review_package_id and (candidate.auto_qc or decision.member_key is not null);
    if jsonb_array_length(members) = 0 or jsonb_array_length(inputs) <> jsonb_array_length(members) then continue; end if;

    project_path := format('episodes/%s/review-render/v%s/index.html', candidate.episode_id, composition.revision_number);
    render_path := format('episodes/%s/review-render/v%s/review-render.mp4', candidate.episode_id, composition.revision_number);
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (candidate.episode_id, 'generate_review_render', 'ready', jsonb_build_object(
      'capability', 'review_rendering', 'allowed_tools', jsonb_build_array('read', 'write'),
      'review_render', jsonb_build_object('pre_render_review_package_id', candidate.pre_render_review_package_id, 'composition_revision_id', composition.id, 'project_revision', composition.revision_number, 'project_relative_path', project_path, 'confirmation_mode', candidate.context_snapshot -> 'confirmation_mode', 'confirmed_shots', candidate.context_snapshot -> 'confirmed_shots', 'storyboard', candidate.context_snapshot -> 'storyboard', 'members', members, 'adjustments', composition.composition_config || jsonb_build_object('reason', composition.reason)),
      'input_artifacts', inputs, 'output', jsonb_build_object('required_artifact_types', jsonb_build_array('render', 'review_render_project', 'review_render_runtime', 'review_qc_report'), 'content_type', 'video/mp4', 'relative_path', render_path, 'review_stage', 'qc_review')
    ), 0, 1, 'hyperframes', 'hyperframes@0.7.109', 'review-render-v4') returning * into created_task;
    return next created_task;
  end loop;
end;
$$;

revoke all on function public.has_current_shot_preparation_snapshot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_shot_preparation_review_package(uuid, uuid) from public, anon, authenticated;
revoke all on function public.freeze_shot_preparation_batch(uuid, uuid) from public, anon;
grant execute on function public.freeze_shot_preparation_batch(uuid, uuid) to authenticated;
revoke all on function public.orchestrate_review_render_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_review_render_tasks(uuid) to service_role;
