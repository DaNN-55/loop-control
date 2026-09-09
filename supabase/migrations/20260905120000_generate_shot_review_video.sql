create or replace function public.generate_shot_review_video(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_studio_project jsonb,
  p_accept_duration_risk boolean default false,
  p_risk_reason text default null
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
  created_package public.review_packages;
  created_task public.tasks;
  storyboard jsonb;
  duration_settings jsonb;
  duration_decision jsonb;
  blueprint_policy jsonb;
  series_rules jsonb;
  risk_count integer := 0;
  risk_reason text := btrim(coalesce(p_risk_reason, ''));
  runtime_constraints jsonb;
  composition_config jsonb;
  studio_revision text;
  default_composition constant jsonb := '{"aspect_ratio":"9:16","width":1080,"height":1920,"captions_enabled":true,"caption_style":"cinematic","crop":"cover","pacing":"standard","transition":"fade","layout":"lower_third","narration_gain_db":0,"bgm_gain_db":-12,"sfx_gain_db":-6}'::jsonb;
begin
  if p_studio_project is null
    or jsonb_typeof(p_studio_project) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_studio_project) key where key not in ('relative_path', 'sha256', 'file_size'))
    or jsonb_typeof(p_studio_project -> 'relative_path') <> 'string'
    or jsonb_typeof(p_studio_project -> 'sha256') <> 'string'
    or jsonb_typeof(p_studio_project -> 'file_size') <> 'number'
    or p_accept_duration_risk is null
    or (p_accept_duration_risk and risk_reason = '')
    or (not p_accept_duration_risk and risk_reason <> '') then
    raise exception '音画超过帧容差时必须由 Owner 明确接受并填写原因' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
  if not found or current_episode.stage <> 'storyboard_approved' then
    raise exception 'Owner shot workbench access is required' using errcode = '42501';
  end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval
    on approval.review_package_id = package.id
   and approval.stage = 'storyboard_approved'
   and approval.decision = 'approved'
  where package.id = p_review_package_id
    and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null
  for update of package;
  if not found then
    raise exception 'The approved storyboard review package is required' using errcode = '22023';
  end if;

  if p_studio_project ->> 'relative_path' !~ format('^episodes/%s/studio-frozen/[0-9a-f-]{36}/index[.]html$', p_episode_id::text)
    or p_studio_project ->> 'sha256' !~ '^[0-9a-f]{64}$'
    or (p_studio_project ->> 'file_size')::numeric < 1
    or (p_studio_project ->> 'file_size')::numeric <> trunc((p_studio_project ->> 'file_size')::numeric) then
    raise exception 'Invalid frozen Studio project' using errcode = '22023';
  end if;
  studio_revision := substring(p_studio_project ->> 'relative_path' from '/studio-frozen/([^/]+)/index[.]html$');

  storyboard := selected_package.context_snapshot #> '{worker_result,storyboard}';
  if coalesce(jsonb_typeof(storyboard -> 'shots'), '') <> 'array' then
    raise exception 'The approved storyboard must contain shots' using errcode = '22023';
  end if;
  if jsonb_array_length(storyboard -> 'shots') = 0 then
    raise exception 'The approved storyboard must contain shots' using errcode = '22023';
  end if;
  duration_settings := public.shot_duration_settings(p_episode_id);
  select policy into blueprint_policy
  from public.account_blueprint_versions
  where id = current_episode.blueprint_version_id
    and account_id = current_episode.account_id;
  select coalesce(version.rules, '{}'::jsonb) into series_rules
  from public.series_versions version
  where version.id = current_episode.series_version_id
    and version.account_id = current_episode.account_id;
  runtime_constraints := public.worker_runtime_constraints(
    jsonb_build_object('provider', 'hyperframes', 'media', jsonb_build_object('adapter', 'hyperframes'))
  );

  for selected_shot in select value from jsonb_array_elements(storyboard -> 'shots') loop
    select candidate.* into draft
    from public.shot_preparation_drafts candidate
    where candidate.episode_id = p_episode_id
      and candidate.review_package_id = p_review_package_id
      and candidate.shot_id = selected_shot ->> 'id'
    for update;
    if not found then
      raise exception 'Every shot needs a saved workbench draft' using errcode = '22023';
    end if;
    if draft.input_fingerprint is distinct from md5(selected_shot::text)
      or draft.selected_material_revision_id is null
      or coalesce(btrim(draft.subtitle_text), '') = ''
      or draft.video_duration_seconds is null
      or draft.video_duration_seconds <= 0
      or coalesce(jsonb_typeof(draft.clip_segments), '') <> 'array' then
      raise exception 'Every shot needs a current source, valid clip segments, duration, and subtitle' using errcode = '22023';
    end if;
    if jsonb_array_length(draft.clip_segments) = 0 then
      raise exception 'Every shot needs a current source, valid clip segments, duration, and subtitle' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(draft.clip_segments) segment
      where jsonb_typeof(segment) <> 'object'
        or jsonb_typeof(segment -> 'start_seconds') <> 'number'
        or jsonb_typeof(segment -> 'end_seconds') <> 'number'
        or (segment ->> 'start_seconds')::numeric < 0
        or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
    ) then
      raise exception 'Every shot needs valid clip segment boundaries' using errcode = '22023';
    end if;

    select revision.* into material
    from public.production_material_revisions revision
    join public.material_revision_approvals approval
      on approval.material_revision_id = revision.id
    where revision.id = draft.selected_material_revision_id
      and revision.episode_id = p_episode_id
      and revision.material_type = 'video';
    if not found then
      raise exception 'Every shot needs an approved current video material revision' using errcode = '22023';
    end if;

    duration_decision := public.shot_duration_decision(
      draft.audio_mode,
      case when draft.audio_mode = 'tts' then draft.tts_actual_duration_seconds
           when draft.audio_mode = 'source' then coalesce(draft.source_audio_duration_seconds, draft.video_duration_seconds)
           else null end,
      draft.video_duration_seconds,
      (selected_shot ->> 'durationSeconds')::numeric,
      (duration_settings ->> 'frame_rate')::numeric,
      (duration_settings ->> 'allowed_frames')::integer,
      draft.video_duration_seconds
    );
    if duration_decision ->> 'status' = 'needs_attention' then
      risk_count := risk_count + 1;
    end if;

    if draft.audio_mode = 'tts' then
      if coalesce(btrim(draft.tts_text), '') = ''
        or draft.tts_text_confirmation_fingerprint is distinct from md5(btrim(draft.tts_text)) then
        raise exception 'Every TTS shot needs saved and confirmed narration text' using errcode = '22023';
      end if;
      select track.* into narration_track
      from public.audio_tracks track
      join public.tasks task on task.id = track.source_task_id
      where track.id = draft.current_audio_track_id
        and track.episode_id = p_episode_id
        and track.source_review_package_id = p_review_package_id
        and track.cue_id = draft.shot_id
        and track.track_kind = 'narration'
        and track.sha256 is not null
        and track.file_size > 0
        and track.duration_seconds > 0
        and task.id = coalesce(draft.current_tts_task_id, track.source_task_id)
        and task.task_type = 'generate_narration'
        and task.status = 'completed'
        and task.invalidated_at is null
        and task.input_snapshot #>> '{media,narration,text}' = draft.tts_text
        and task.input_snapshot ->> 'configuration_hash' = public.shot_tts_configuration_hash(p_episode_id, draft.id);
      if not found then
        raise exception 'Every TTS shot needs its current successful narration and configuration fingerprint' using errcode = '22023';
      end if;
    elsif draft.audio_mode not in ('source', 'none') then
      raise exception 'Unsupported shot audio mode' using errcode = '22023';
    end if;
  end loop;

  if risk_count > 0 and not p_accept_duration_risk then
    raise exception '音画超过帧容差，必须由 Owner 明确接受并填写原因' using errcode = '22023';
  end if;
  if risk_count = 0 and p_accept_duration_risk then
    raise exception '当前没有音画超过帧容差的风险，不需要接受原因' using errcode = '22023';
  end if;

  update public.shot_preparation_drafts draft
  set frozen_at = now(),
      frozen_by = auth.uid(),
      confirmation_status = 'confirmed',
      confirmation_reason = 'Owner explicitly generated the review video from this snapshot.',
      confirmed_at = now(),
      confirmed_by = auth.uid(),
      video_status = 'ready',
      audio_status = 'ready',
      warning_decision = case when risk_count > 0 then 'accepted' else 'not_required' end,
      warning_reason = case when risk_count > 0 then risk_reason else null end,
      warning_accepted_at = case when risk_count > 0 then now() else null end,
      warning_accepted_by = case when risk_count > 0 then auth.uid() else null end,
      updated_at = now()
  where draft.episode_id = p_episode_id
    and draft.review_package_id = p_review_package_id;

  update public.review_packages
  set invalidated_at = now(), invalidated_reason = 'Superseded by a newer explicit review video generation.'
  where episode_id = p_episode_id
    and stage = 'production_ready'
    and invalidated_at is null;

  select package.* into created_package
  from public.create_shot_preparation_review_package(p_episode_id, p_review_package_id) package
  limit 1;
  if not found then
    raise exception 'Unable to create the immutable shot review snapshot' using errcode = '22023';
  end if;

  update public.review_packages
  set context_snapshot = context_snapshot || jsonb_build_object(
    'blueprint_version_id', current_episode.blueprint_version_id,
    'blueprint_policy', coalesce(blueprint_policy, '{}'::jsonb),
    'series_version_id', current_episode.series_version_id,
    'series_rules', series_rules,
    'duration_settings', duration_settings,
    'effective_runtime_constraints', runtime_constraints,
    'studio_project', jsonb_build_object('revision', studio_revision, 'relative_path', p_studio_project ->> 'relative_path', 'sha256', p_studio_project ->> 'sha256', 'file_size', (p_studio_project ->> 'file_size')::bigint),
    'generation', jsonb_build_object('kind', 'explicit_review_video', 'risk_accepted', p_accept_duration_risk, 'risk_reason', nullif(risk_reason, ''))
  )
  where id = created_package.id;

  composition_config := default_composition || coalesce(series_rules -> 'hyperframes_composition', '{}'::jsonb) || jsonb_build_object(
    'frame_rate', (duration_settings ->> 'frame_rate')::numeric,
    'allowed_frames', (duration_settings ->> 'allowed_frames')::integer,
    'reason', 'Owner 明确提交的 Studio 工作版本。',
    'studio_project', p_studio_project,
    'studio_project_revision', studio_revision
  );
  insert into public.review_render_composition_revisions (episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, created_by, composition_config)
  values (p_episode_id, created_package.id, 1, composition_config ->> 'caption_style', composition_config ->> 'pacing', composition_config ->> 'crop', composition_config ->> 'transition', composition_config ->> 'layout', composition_config ->> 'reason', auth.uid(), composition_config);

  update public.episodes
  set stage = 'production_ready', updated_at = now()
  where id = p_episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (p_episode_id, 'storyboard_approved', 'production_ready', 'Owner 明确生成审核视频，冻结整单镜头快照。', auth.uid());

  select task.* into created_task
  from public.orchestrate_review_render_tasks(p_episode_id) task
  limit 1;
  if not found then
    raise exception 'Unable to create the review render task from the frozen snapshot' using errcode = '22023';
  end if;

  update public.tasks
  set input_snapshot = input_snapshot || jsonb_build_object(
    'blueprint_version_id', current_episode.blueprint_version_id,
    'blueprint_policy', coalesce(blueprint_policy, '{}'::jsonb),
    'series_version_id', current_episode.series_version_id,
    'series_baseline', jsonb_build_object('version_id', current_episode.series_version_id, 'rules', series_rules),
    'duration_settings', duration_settings,
    'studio_project', jsonb_build_object('revision', studio_revision, 'relative_path', p_studio_project ->> 'relative_path', 'sha256', p_studio_project ->> 'sha256', 'file_size', (p_studio_project ->> 'file_size')::bigint),
    'effective_runtime_constraints', runtime_constraints,
    'generation', jsonb_build_object('kind', 'explicit_review_video', 'risk_accepted', p_accept_duration_risk, 'risk_reason', nullif(risk_reason, ''))
  )
  where id = created_task.id;

  update public.episodes
  set stage = 'render_ready', updated_at = now()
  where id = p_episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (p_episode_id, 'production_ready', 'render_ready', '审核视频任务已创建，Worker 只消费冻结整单快照。', auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_review_video_requested', jsonb_build_object(
    'review_package_id', created_package.id,
    'task_id', created_task.id,
    'blueprint_version_id', current_episode.blueprint_version_id,
    'blueprint_policy', coalesce(blueprint_policy, '{}'::jsonb),
    'series_version_id', current_episode.series_version_id,
    'duration_settings', duration_settings,
    'risk_count', risk_count,
    'risk_accepted', p_accept_duration_risk,
    'risk_reason', nullif(risk_reason, '')
  ), auth.uid());
  return next created_task;
end;
$$;

revoke all on function public.generate_shot_review_video(uuid, uuid, jsonb, boolean, text) from public, anon;
grant execute on function public.generate_shot_review_video(uuid, uuid, jsonb, boolean, text) to authenticated;
revoke all on function public.freeze_shot_preparation_batch(uuid, uuid) from authenticated;

do $$
declare definition text;
begin
  select pg_get_functiondef('public.register_completed_review_render()'::regprocedure) into definition;
  if position('''review_qc_report''' in definition) = 0
    or position('''qc_report''' in definition) = 0
    or position('qc_artifact.id is null' in definition) = 0
    or position('''composition_revision_id''' in definition) = 0
    or position('''composition_adjustments''' in definition) = 0
    or position('''frozen_input_artifacts'',new.input_snapshot -> ''input_artifacts''' in definition) = 0 then
    raise exception 'Latest review render completion function is missing QC evidence fields';
  end if;
  definition := replace(
    definition,
    '''frozen_input_artifacts'',new.input_snapshot -> ''input_artifacts''',
    '''studio_project'',new.input_snapshot #> ''{review_render,adjustments,studio_project}'',' || chr(10) || '    ''studio_project_revision'',new.input_snapshot #>> ''{review_render,adjustments,studio_project_revision}'',' || chr(10) || '    ''frozen_input_artifacts'',new.input_snapshot -> ''input_artifacts'''
  );
  execute definition;
end $$;
