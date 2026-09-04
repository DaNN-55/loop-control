create or replace function public.has_current_shot_preparation_snapshot(p_episode_id uuid, p_storyboard_review_package_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
with storyboard as (
  select package.context_snapshot #> '{worker_result,storyboard,shots}' as shots
  from public.review_packages package
  where package.id = p_storyboard_review_package_id
    and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null
), required_shots as (
  select shot.value
  from storyboard
  cross join lateral jsonb_array_elements(coalesce(storyboard.shots, '[]'::jsonb)) shot(value)
), valid_shots as (
  select required.value
  from required_shots required
  join public.shot_preparation_drafts draft
    on draft.episode_id = p_episode_id
   and draft.review_package_id = p_storyboard_review_package_id
   and draft.shot_id = required.value ->> 'id'
  join public.tasks video_task
    on video_task.id = draft.current_video_task_id
   and video_task.episode_id = p_episode_id
   and video_task.status = 'completed'
   and video_task.invalidated_at is null
   and video_task.input_snapshot #>> '{shot,id}' = required.value ->> 'id'
  join public.artifacts video_artifact
    on video_artifact.id = draft.current_video_artifact_id
   and video_artifact.episode_id = p_episode_id
   and video_artifact.producer_task_id = draft.current_video_task_id
   and video_artifact.artifact_type in ('a_roll_video', 'b_roll_asset', 'shot_video')
   and video_artifact.sha256 is not null
   and video_artifact.file_size > 0
   and video_artifact.relative_path = video_task.input_snapshot #>> '{output,relative_path}'
  where draft.confirmation_status = 'confirmed'
    and draft.input_fingerprint = md5(required.value::text)
    and draft.subtitle_text <> ''
    and (
      draft.audio_mode = 'none'
      or (
        draft.audio_status = 'ready'
        and exists (
          select 1
          from public.audio_tracks audio_track
          join public.tasks audio_task on audio_task.id = audio_track.source_task_id
          where audio_track.id = draft.current_audio_track_id
            and audio_track.episode_id = p_episode_id
            and audio_track.cue_id = draft.shot_id
            and audio_track.source_review_package_id = p_storyboard_review_package_id
            and audio_track.track_kind = case when draft.audio_mode = 'tts' then 'narration' else 'source' end
            and audio_track.sha256 is not null
            and audio_track.file_size > 0
            and audio_track.duration_seconds > 0
            and audio_task.episode_id = p_episode_id
            and audio_task.status = 'completed'
            and audio_task.invalidated_at is null
            and audio_task.input_snapshot #>> '{shot_preparation,shot_id}' = draft.shot_id
            and (
              (draft.audio_mode = 'tts'
                and draft.tts_text is not null
                and audio_task.task_type = 'generate_narration'
                and audio_task.input_snapshot #>> '{media,narration,text}' = draft.tts_text)
              or (draft.audio_mode = 'source'
                and audio_task.task_type = 'extract_embedded_audio'
                and audio_task.input_snapshot #>> '{source_video_artifact,id}' = draft.current_video_artifact_id::text)
            )
        )
      )
    )
)
select exists (select 1 from storyboard where jsonb_typeof(storyboard.shots) = 'array' and jsonb_array_length(storyboard.shots) > 0)
  and (select count(*) from valid_shots) = (select count(*) from required_shots);
$$;

create or replace function public.create_shot_preparation_review_package(p_episode_id uuid, p_storyboard_review_package_id uuid)
returns setof public.review_packages
language plpgsql security definer set search_path = ''
as $$
declare
  episode_record public.episodes;
  storyboard_package public.review_packages;
  existing_package public.review_packages;
  draft public.shot_preparation_drafts;
  media_task public.tasks;
  media_artifact public.artifacts;
  audio_task public.tasks;
  audio_track public.audio_tracks;
  shot jsonb;
  member jsonb;
  confirmed_shot jsonb;
  members jsonb := '[]'::jsonb;
  confirmed_shots jsonb := '[]'::jsonb;
  package_record public.review_packages;
  next_revision integer;
begin
  select episode.* into episode_record from public.episodes episode where episode.id = p_episode_id;
  if not found then return; end if;
  select package.* into storyboard_package
  from public.review_packages package
  where package.id = p_storyboard_review_package_id
    and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null;
  if not found then return; end if;
  if not public.has_current_shot_preparation_snapshot(p_episode_id, p_storyboard_review_package_id) then
    update public.review_packages package
    set invalidated_at = now(), invalidated_reason = 'The confirmed shot preparation snapshot is no longer current.'
    where package.episode_id = p_episode_id
      and package.stage = 'production_ready'
      and package.invalidated_at is null
      and package.context_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text;
    return;
  end if;
  update public.review_packages package
  set invalidated_at = now(), invalidated_reason = 'Superseded by the current confirmed storyboard snapshot.'
  where package.episode_id = p_episode_id
    and package.stage = 'production_ready'
    and package.invalidated_at is null
    and package.context_snapshot ->> 'storyboard_review_package_id' is distinct from p_storyboard_review_package_id::text;
  select package.* into existing_package
  from public.review_packages package
  where package.episode_id = p_episode_id
    and package.stage = 'production_ready'
    and package.invalidated_at is null
    and package.context_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text
  order by package.revision_number desc
  limit 1;
  if found then return next existing_package; return; end if;

  for shot in select value from jsonb_array_elements(coalesce(storyboard_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    select * into draft
    from public.shot_preparation_drafts
    where episode_id = p_episode_id and review_package_id = p_storyboard_review_package_id and shot_id = shot ->> 'id';
    if not found or draft.confirmation_status <> 'confirmed' or draft.input_fingerprint is distinct from md5(shot::text) then return; end if;

    select task.* into media_task
    from public.tasks task
    where task.id = draft.current_video_task_id
      and task.episode_id = p_episode_id
      and task.status = 'completed'
      and task.invalidated_at is null
      and task.input_snapshot #>> '{shot,id}' = shot ->> 'id';
    select artifact.* into media_artifact
    from public.artifacts artifact
    where artifact.id = draft.current_video_artifact_id
      and artifact.episode_id = p_episode_id
      and artifact.producer_task_id = draft.current_video_task_id
      and artifact.artifact_type in ('a_roll_video', 'b_roll_asset', 'shot_video')
      and artifact.sha256 is not null
      and artifact.file_size > 0
      and artifact.relative_path = media_task.input_snapshot #>> '{output,relative_path}';
    if not found or media_task.id is null then return; end if;

    member := jsonb_build_object(
      'member_kind', 'shot_media',
      'member_key', format('shot:%s', shot ->> 'id'),
      'shot', shot,
      'input_fingerprint', draft.input_fingerprint,
      'audio_mode', draft.audio_mode,
      'subtitle_text', draft.subtitle_text,
      'subtitles_enabled', draft.subtitles_enabled,
      'task', jsonb_build_object('id', media_task.id, 'type', media_task.task_type, 'attempt', media_task.attempt, 'provider', media_task.provider, 'model', media_task.model, 'prompt_version', media_task.prompt_version, 'actual_cost_cents', media_task.actual_cost_cents, 'result', media_task.last_result),
      'artifact', jsonb_build_object('id', media_artifact.id, 'artifact_type', media_artifact.artifact_type, 'relative_path', media_artifact.relative_path, 'sha256', media_artifact.sha256, 'file_size', media_artifact.file_size)
    );
    members := members || jsonb_build_array(member);

    if draft.audio_mode <> 'none' then
      select track.* into audio_track
      from public.audio_tracks track
      where track.id = draft.current_audio_track_id
        and track.episode_id = p_episode_id
        and track.cue_id = draft.shot_id
        and track.source_review_package_id = p_storyboard_review_package_id
        and track.track_kind = case when draft.audio_mode = 'tts' then 'narration' else 'source' end
        and track.sha256 is not null
        and track.file_size > 0
        and track.duration_seconds > 0;
      select task.* into audio_task
      from public.tasks task
      where task.id = audio_track.source_task_id
        and task.episode_id = p_episode_id
        and task.status = 'completed'
        and task.invalidated_at is null
        and task.input_snapshot #>> '{shot_preparation,shot_id}' = draft.shot_id;
      if not found or audio_track.id is null then return; end if;
      if draft.audio_mode = 'tts' and audio_task.task_type <> 'generate_narration' then return; end if;
      if draft.audio_mode = 'source' and (audio_task.task_type <> 'extract_embedded_audio' or audio_task.input_snapshot #>> '{source_video_artifact,id}' <> draft.current_video_artifact_id::text) then return; end if;
      if draft.audio_mode = 'tts' and audio_task.input_snapshot #>> '{media,narration,text}' is distinct from coalesce(draft.tts_text, draft.subtitle_text) then return; end if;

      member := jsonb_build_object(
        'member_kind', 'narration',
        'member_key', format('narration:%s', shot ->> 'id'),
        'audio_mode', draft.audio_mode,
        'task', jsonb_build_object('id', audio_task.id, 'type', audio_task.task_type, 'attempt', audio_task.attempt, 'provider', audio_task.provider, 'model', audio_task.model, 'prompt_version', audio_task.prompt_version, 'actual_cost_cents', audio_task.actual_cost_cents, 'result', audio_task.last_result),
        'audio_track', jsonb_build_object('id', audio_track.id, 'kind', audio_track.track_kind, 'cue_id', audio_track.cue_id, 'relative_path', audio_track.relative_path, 'sha256', audio_track.sha256, 'file_size', audio_track.file_size, 'start_seconds', audio_track.start_seconds, 'duration_seconds', audio_track.duration_seconds)
      );
      members := members || jsonb_build_array(member);
    end if;

    confirmed_shot := jsonb_build_object(
      'shot_id', shot ->> 'id',
      'confirmation_status', 'confirmed',
      'input_fingerprint', draft.input_fingerprint,
      'video_artifact_id', media_artifact.id,
      'video_task_id', media_task.id,
      'audio_mode', draft.audio_mode,
      'audio_track_id', draft.current_audio_track_id,
      'subtitle_text', draft.subtitle_text,
      'subtitles_enabled', draft.subtitles_enabled
    );
    confirmed_shots := confirmed_shots || jsonb_build_array(confirmed_shot);
  end loop;

  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.review_packages
  where episode_id = p_episode_id and stage = 'production_ready';
  insert into public.review_packages (episode_id, stage, revision_number, context_snapshot)
  values (
    p_episode_id,
    'production_ready',
    next_revision,
    jsonb_build_object(
      'review_kind', 'pre_render',
      'approval_mode', 'qc_only',
      'confirmation_mode', 'shot_preparation',
      'storyboard_review_package_id', p_storyboard_review_package_id,
      'storyboard', storyboard_package.context_snapshot #> '{worker_result,storyboard}',
      'confirmed_shots', confirmed_shots,
      'members', members
    )
  )
  returning * into package_record;
  insert into public.pre_render_review_members (review_package_id, member_key, member_kind, source_task_id, artifact_id, audio_track_id, evidence_snapshot)
  select package_record.id, evidence ->> 'member_key', evidence ->> 'member_kind', (evidence #>> '{task,id}')::uuid, case when evidence ? 'artifact' then (evidence #>> '{artifact,id}')::uuid else null end, case when evidence ? 'audio_track' then (evidence #>> '{audio_track,id}')::uuid else null end, evidence
  from jsonb_array_elements(members) evidence;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (episode_record.account_id, p_episode_id, 'pre_render_review_package_created', jsonb_build_object('review_package_id', package_record.id, 'storyboard_review_package_id', p_storyboard_review_package_id, 'confirmation_mode', 'shot_preparation', 'approval_mode', 'qc_only', 'confirmed_shot_count', jsonb_array_length(confirmed_shots), 'member_count', jsonb_array_length(members), 'source', 'shot_preparation_confirmations'), null);
  return next package_record;
end;
$$;

create or replace function public.has_required_artifacts(p_episode_id uuid, p_to_stage public.episode_stage)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_to_stage
    when 'script_approved'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'script')
    when 'visual_approved'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'visual_brief')
    when 'storyboard_approved'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'storyboard')
    when 'production_ready'::public.episode_stage then exists (
      select 1 from public.review_packages package
      where package.episode_id = p_episode_id and package.stage = 'production_ready' and package.invalidated_at is null
        and (package.context_snapshot ->> 'confirmation_mode' is distinct from 'shot_preparation'
          or public.has_current_shot_preparation_snapshot(p_episode_id, (package.context_snapshot ->> 'storyboard_review_package_id')::uuid))
    )
    when 'render_ready'::public.episode_stage then exists (
      select 1 from public.review_packages package
      where package.episode_id = p_episode_id and package.stage = 'production_ready' and package.invalidated_at is null
        and (package.context_snapshot ->> 'confirmation_mode' is distinct from 'shot_preparation'
          or public.has_current_shot_preparation_snapshot(p_episode_id, (package.context_snapshot ->> 'storyboard_review_package_id')::uuid))
        and (package.context_snapshot ->> 'approval_mode' = 'qc_only' or not exists (
          select 1 from public.pre_render_review_members member
          where member.review_package_id = package.id and not exists (
            select 1 from public.pre_render_review_member_decisions decision
            where decision.review_package_id = member.review_package_id and decision.member_key = member.member_key and decision.decision = 'approved'
          )
        ))
    )
    when 'qc_passed'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'render')
    else true
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
      coalesce(series_version.rules, '{}'::jsonb) as series_rules,
      coalesce(package.context_snapshot ->> 'approval_mode', '') = 'qc_only' as auto_qc
    from public.episodes episode
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    join lateral (
      select package.* from public.review_packages package
      where package.episode_id = episode.id and package.stage = 'production_ready' and package.invalidated_at is null
        and ((episode.stage = 'production_ready' and package.context_snapshot ->> 'approval_mode' = 'qc_only') or episode.stage = 'render_ready')
      order by package.revision_number desc limit 1
    ) package on true
    where episode.stage in ('production_ready', 'render_ready') and (p_episode_id is null or episode.id = p_episode_id)
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    select * into composition from public.review_render_composition_revisions
    where pre_render_review_package_id = candidate.pre_render_review_package_id
    order by revision_number desc limit 1;
    if candidate.episode_stage = 'production_ready' or not found then
      select coalesce(max(revision_number), 0) + 1 into default_revision
      from public.review_render_composition_revisions
      where pre_render_review_package_id = candidate.pre_render_review_package_id;
      config := coalesce(candidate.series_rules -> 'hyperframes_composition', default_config);
      insert into public.review_render_composition_revisions (episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, composition_config)
      values (candidate.episode_id, candidate.pre_render_review_package_id, default_revision, config ->> 'caption_style', config ->> 'pacing', config ->> 'crop', config ->> 'transition', config ->> 'layout', '系列默认合成配置。', config)
      on conflict (pre_render_review_package_id, revision_number) do nothing;
      select * into composition from public.review_render_composition_revisions
      where pre_render_review_package_id = candidate.pre_render_review_package_id
      order by revision_number desc limit 1;
    end if;
    if exists (select 1 from public.tasks task where task.episode_id = candidate.episode_id and task.task_type = 'generate_review_render' and task.input_snapshot #>> '{review_render,composition_revision_id}' = composition.id::text) then continue; end if;
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'member_key', member.member_key,
      'member_kind', member.member_kind,
      'audio_kind', member.evidence_snapshot #>> '{cue,kind}',
      'task_id', member.source_task_id,
      'artifact_id', member.artifact_id,
      'audio_track_id', member.audio_track_id,
      'audio_mode', member.evidence_snapshot ->> 'audio_mode',
      'subtitle_text', member.evidence_snapshot ->> 'subtitle_text',
      'subtitles_enabled', (member.evidence_snapshot ->> 'subtitles_enabled')::boolean,
      'relative_path', coalesce(member.evidence_snapshot #>> '{artifact,relative_path}', member.evidence_snapshot #>> '{audio_track,relative_path}'),
      'sha256', coalesce(member.evidence_snapshot #>> '{artifact,sha256}', member.evidence_snapshot #>> '{audio_track,sha256}'),
      'input_fingerprint', member.evidence_snapshot #>> '{input_fingerprint}',
      'start_seconds', coalesce((member.evidence_snapshot #>> '{audio_track,start_seconds}')::numeric, 0),
      'duration_seconds', coalesce((member.evidence_snapshot #>> '{audio_track,duration_seconds}')::numeric, (member.evidence_snapshot #>> '{shot,durationSeconds}')::numeric)
    )) order by member.member_key), '[]'::jsonb), coalesce(jsonb_agg(jsonb_build_object('artifactType', case when member.artifact_id is null then 'audio_track' else member.evidence_snapshot #>> '{artifact,artifact_type}' end, 'relativePath', coalesce(member.evidence_snapshot #>> '{artifact,relative_path}', member.evidence_snapshot #>> '{audio_track,relative_path}'), 'sha256', coalesce(member.evidence_snapshot #>> '{artifact,sha256}', member.evidence_snapshot #>> '{audio_track,sha256}'), 'fileSize', coalesce((member.evidence_snapshot #>> '{artifact,file_size}')::bigint, (member.evidence_snapshot #>> '{audio_track,file_size}')::bigint)) order by member.member_key), '[]'::jsonb) into members, inputs
    from public.pre_render_review_members member left join public.pre_render_review_member_decisions decision on decision.review_package_id = member.review_package_id and decision.member_key = member.member_key and decision.decision = 'approved'
    where member.review_package_id = candidate.pre_render_review_package_id and (candidate.auto_qc or decision.member_key is not null);
    if jsonb_array_length(members) = 0 or jsonb_array_length(inputs) <> jsonb_array_length(members) then continue; end if;
    project_path := format('episodes/%s/review-render/v%s/index.html', candidate.episode_id, composition.revision_number);
    render_path := format('episodes/%s/review-render/v%s/review-render.mp4', candidate.episode_id, composition.revision_number);
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (candidate.episode_id, 'generate_review_render', 'ready', jsonb_build_object('capability', 'review_rendering', 'allowed_tools', jsonb_build_array('read', 'write'), 'review_render', jsonb_build_object('pre_render_review_package_id', candidate.pre_render_review_package_id, 'composition_revision_id', composition.id, 'project_revision', composition.revision_number, 'project_relative_path', project_path, 'confirmation_mode', candidate.context_snapshot -> 'confirmation_mode', 'confirmed_shots', candidate.context_snapshot -> 'confirmed_shots', 'storyboard', candidate.context_snapshot -> 'storyboard', 'members', members, 'adjustments', composition.composition_config || jsonb_build_object('reason', composition.reason)), 'input_artifacts', inputs, 'output', jsonb_build_object('required_artifact_types', jsonb_build_array('render', 'review_render_project', 'review_render_runtime', 'review_qc_report'), 'content_type', 'video/mp4', 'relative_path', render_path, 'review_stage', 'qc_review')), 0, 1, 'hyperframes', 'hyperframes@0.7.109', 'review-render-v3')
    returning * into created_task;
    return next created_task;
  end loop;
end;
$$;

revoke all on function public.create_shot_preparation_review_package(uuid, uuid) from public, anon, authenticated;
revoke all on function public.orchestrate_review_render_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_review_render_tasks(uuid) to service_role;

do $$
declare
  definition text;
  old_guard text := '      if exists (select 1 from jsonb_array_elements(coalesce(candidate.storyboard_context #> ''{worker_result,storyboard,shots}'', ''[]''::jsonb)) shot where not exists (select 1 from public.shot_preparation_drafts draft where draft.episode_id = candidate.id and draft.review_package_id = candidate.storyboard_review_package_id and draft.shot_id = shot ->> ''id'' and draft.confirmation_status = ''confirmed'')) then continue; end if;';
  new_guard text := '      if not public.has_current_shot_preparation_snapshot(candidate.id, candidate.storyboard_review_package_id) then continue; end if;';
begin
  select pg_get_functiondef('public.advance_production_ready_episodes(uuid)'::regprocedure) into definition;
  if definition is null or position(old_guard in definition) = 0 then raise exception 'Unable to tighten current shot preparation production gate'; end if;
  execute replace(definition, old_guard, new_guard);
end $$;

revoke all on function public.has_current_shot_preparation_snapshot(uuid, uuid) from public, anon, authenticated;

do $$
declare
  definition text;
  old_block text := $block$
      if not public.has_current_shot_preparation_snapshot(candidate.id, candidate.storyboard_review_package_id) then continue; end if;
      update public.episodes set stage = 'production_ready', updated_at = now() where id = candidate.id returning * into advanced_episode;
      perform public.create_shot_preparation_review_package(candidate.id, candidate.storyboard_review_package_id);
$block$;
  new_block text := $block$
      if not public.has_current_shot_preparation_snapshot(candidate.id, candidate.storyboard_review_package_id) then continue; end if;
      if not exists (select 1 from public.create_shot_preparation_review_package(candidate.id, candidate.storyboard_review_package_id)) then continue; end if;
      update public.episodes set stage = 'production_ready', updated_at = now() where id = candidate.id returning * into advanced_episode;
$block$;
begin
  select pg_get_functiondef('public.advance_production_ready_episodes(uuid)'::regprocedure) into definition;
  if definition is null or position(old_block in definition) = 0 then raise exception 'Unable to make confirmed Studio snapshot creation atomic with production gate'; end if;
  execute replace(definition, old_block, new_block);
end $$;
