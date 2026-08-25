alter table public.episodes
  add column if not exists audio_source_mode text not null default 'tts'
  check (audio_source_mode in ('source', 'tts'));

create function public.set_episode_audio_source_mode(p_episode_id uuid, p_audio_source_mode text)
returns public.episodes
language plpgsql security definer set search_path = ''
as $$
declare current_episode public.episodes; updated_episode public.episodes;
begin
  if p_audio_source_mode not in ('source', 'tts') then raise exception 'Audio source mode must be source or tts' using errcode = '22023'; end if;
  select episode.* into current_episode from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to update audio source mode' using errcode = '42501'; end if;
  if current_episode.stage <> 'waiting_input' then raise exception 'Audio source mode can only be changed before production starts' using errcode = '22023'; end if;
  update public.episodes set audio_source_mode = p_audio_source_mode, updated_at = now() where id = p_episode_id returning * into updated_episode;
  if current_episode.audio_source_mode is distinct from updated_episode.audio_source_mode then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, current_episode.id, 'episode_audio_source_mode_updated', jsonb_build_object('previous_mode', current_episode.audio_source_mode, 'audio_source_mode', updated_episode.audio_source_mode), auth.uid());
  end if;
  return updated_episode;
end;
$$;

revoke all on function public.set_episode_audio_source_mode(uuid, text) from public, anon;
grant execute on function public.set_episode_audio_source_mode(uuid, text) to authenticated;

create or replace function public.orchestrate_narration_tasks_without_connection_ref(p_episode_id uuid default null)
returns setof public.tasks
language plpgsql security definer set search_path = ''
as $$
declare candidate record; selected_config jsonb; executor jsonb; configuration_hash text; shot jsonb; shot_duration numeric; start_seconds numeric; budget_limit integer; max_attempts integer; blocker_code text; blocker_detail text; created_task public.tasks;
begin
  for candidate in
    select episode.*, blueprint.policy as blueprint_policy, series_version.rules as series_rules, review_package.id as storyboard_review_package_id, review_package.context_snapshot as storyboard_context
    from public.episodes episode join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join lateral (select package.* from public.review_packages package join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved' where package.episode_id = episode.id and package.stage = 'storyboard_review' order by package.revision_number desc limit 1) review_package on true
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    where episode.stage = 'storyboard_approved' and (p_episode_id is null or episode.id = p_episode_id)
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    selected_config := coalesce(candidate.series_rules -> 'narration', candidate.blueprint_policy -> 'narration'); configuration_hash := md5(coalesce(selected_config::text, 'null')); executor := selected_config -> 'executor'; start_seconds := 0;
    for shot in select value from jsonb_array_elements(coalesce(candidate.storyboard_context #> '{worker_result,storyboard,shots}', '[]'::jsonb))
    loop
      if coalesce(btrim(shot ->> 'id'), '') = '' or coalesce(btrim(shot ->> 'scriptSegment'), '') = '' or coalesce(shot ->> 'durationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$' or (shot ->> 'durationSeconds')::numeric <= 0 then raise exception 'Approved storyboard shot is invalid' using errcode = '22023'; end if;
      shot_duration := (shot ->> 'durationSeconds')::numeric;
      if exists (select 1 from public.tasks task where task.episode_id = candidate.id and task.task_type = 'generate_narration' and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text and task.input_snapshot #>> '{audio_track,cue_id}' = shot ->> 'id' and task.input_snapshot ->> 'configuration_hash' = configuration_hash) then start_seconds := start_seconds + shot_duration; continue; end if;
      blocker_code := null; blocker_detail := null;
      if jsonb_typeof(selected_config) <> 'object' then blocker_code := 'narration_executor_missing'; blocker_detail := '蓝图或系列规则未声明 narration 执行器配置。';
      elsif jsonb_typeof(executor) <> 'object' or executor ->> 'provider' <> 'google_tts' or executor ->> 'adapter' <> 'google_tts' or coalesce(btrim(executor ->> 'model'), '') = '' or coalesce(btrim(executor ->> 'prompt_version'), '') = '' then blocker_code := 'narration_executor_invalid'; blocker_detail := '旁白配置必须精确声明 google_tts 适配器、模型与提示版本。';
      elsif jsonb_typeof(selected_config -> 'allowed_tools') <> 'array' or jsonb_array_length(selected_config -> 'allowed_tools') = 0 then blocker_code := 'narration_allowed_tools_invalid'; blocker_detail := '旁白配置必须声明非空的允许工具清单。';
      elsif jsonb_typeof(selected_config -> 'budget_cents') <> 'number' or selected_config ->> 'budget_cents' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'budget_cents') > 10 or (length(selected_config ->> 'budget_cents') = 10 and selected_config ->> 'budget_cents' > '2147483647') then blocker_code := 'narration_budget_invalid'; blocker_detail := '旁白配置必须提供有效预算。';
      elsif jsonb_typeof(selected_config -> 'max_attempts') <> 'number' or selected_config ->> 'max_attempts' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'max_attempts') > 10 or (length(selected_config ->> 'max_attempts') = 10 and selected_config ->> 'max_attempts' > '2147483647') then blocker_code := 'narration_scheduling_invalid'; blocker_detail := '旁白配置必须提供有效最大尝试次数。';
      elsif jsonb_typeof(selected_config -> 'voice') <> 'object' or coalesce(btrim(selected_config #>> '{voice,language_code}'), '') = '' or coalesce(btrim(selected_config #>> '{voice,name}'), '') = '' or jsonb_typeof(selected_config #> '{voice,speaking_rate}') <> 'number' or (selected_config #>> '{voice,speaking_rate}')::numeric <= 0 then blocker_code := 'narration_voice_invalid'; blocker_detail := '旁白配置必须冻结有效语言、声音与语速。'; end if;
      budget_limit := case when blocker_code is null then (selected_config ->> 'budget_cents')::integer else 0 end; max_attempts := case when blocker_code is null then (selected_config ->> 'max_attempts')::integer else 1 end;
      insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version,last_result,completed_at)
      values (candidate.id,'generate_narration',case when blocker_code is null then 'ready'::public.task_status else 'blocked'::public.task_status end,
        jsonb_strip_nulls(jsonb_build_object('capability','narration_generation','storyboard_review_package_id',candidate.storyboard_review_package_id,'configuration_hash',configuration_hash,'executor',executor,'media',jsonb_build_object('adapter','google_tts','narration',jsonb_build_object('text',btrim(shot ->> 'scriptSegment'),'voice',selected_config -> 'voice')),'audio_track',jsonb_build_object('kind','narration','cue_id',shot ->> 'id','source_review_package_id',candidate.storyboard_review_package_id,'start_seconds',start_seconds,'duration_seconds',shot_duration),'budget',jsonb_build_object('limit_cents',budget_limit,'max_attempts',max_attempts),'allowed_tools',selected_config -> 'allowed_tools','output',jsonb_build_object('required_artifact_types',jsonb_build_array('narration_audio'),'content_type','audio/mpeg','relative_path',format('episodes/%s/audio/narration-%s-%s.mp3',candidate.id,candidate.storyboard_review_package_id,shot ->> 'id'),'review_stage','production_ready'),'input_artifacts',candidate.storyboard_context -> 'input_artifacts')),
        budget_limit,max_attempts,coalesce(executor ->> 'provider','unconfigured'),coalesce(executor ->> 'model','unconfigured'),coalesce(executor ->> 'prompt_version','unconfigured'),case when blocker_code is null then null else jsonb_build_object('version','worker-result/v1','taskId','','status','blocked','artifacts',jsonb_build_array(),'validation',jsonb_build_object('passed',false,'checks',jsonb_build_array()),'actualCostCents',0,'blockers',jsonb_build_array(jsonb_build_object('code',blocker_code,'detail',blocker_detail)),'retry',jsonb_build_object('shouldRetry',false,'reason',blocker_detail),'nextStep','修正冻结的旁白配置后，使用新的配置创建任务。') end,case when blocker_code is null then null else now() end) returning * into created_task;
      if blocker_code is not null then update public.tasks set last_result = jsonb_set(last_result, '{taskId}', to_jsonb(created_task.id::text)) where id = created_task.id returning * into created_task; insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) values (candidate.account_id,candidate.id,'narration_task_blocked',jsonb_build_object('task_id',created_task.id,'cue_id',shot ->> 'id','code',blocker_code,'detail',blocker_detail),null); end if;
      return next created_task; start_seconds := start_seconds + shot_duration;
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
    select episode.id from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where (p_episode_id is null or episode.id = p_episode_id)
      and episode.audio_source_mode = 'tts'
      and (blueprint.policy -> 'narration') is not null
      and jsonb_typeof(blueprint.policy -> 'narration') <> 'null'
  loop
    return query select * from public.orchestrate_narration_tasks_configured(candidate_id);
  end loop;
end;
$$;

create or replace function public.orchestrate_embedded_audio_tasks(p_episode_id uuid default null)
returns setof public.tasks language plpgsql security definer set search_path = ''
as $$
declare candidate record; created_task public.tasks;
begin
  for candidate in
    select material.*, approval.id as approval_id, episode.account_id, episode.blueprint_version_id
    from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    join public.episodes episode on episode.id = material.episode_id
    where material.material_type = 'video'
      and material.storage_path ~* '[.](mp4|mov|webm)$'
      and episode.audio_source_mode = 'source'
      and (p_episode_id is null or material.episode_id = p_episode_id)
    order by material.created_at, material.id for update of material skip locked
  loop
    if exists (select 1 from public.tasks task where task.task_type = 'extract_embedded_audio' and task.input_snapshot ->> 'source_material_revision_id' = candidate.id::text) then continue; end if;
    insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version)
    values (candidate.episode_id,'extract_embedded_audio','ready',jsonb_build_object(
      'capability','embedded_audio_extraction','source_material_revision_id',candidate.id,'source_material_approval_id',candidate.approval_id,'source_video_revision_sha256',candidate.sha256,
      'media',jsonb_build_object('adapter','ffmpeg_extract_audio','embedded_audio',jsonb_build_object('source_relative_path',candidate.storage_path,'duration_seconds',0.001)),
      'audio_track',jsonb_build_object('kind','derived','cue_id',format('material-v%s',candidate.revision_number),'source_material_revision_id',candidate.id,'start_seconds',0,'duration_seconds',0.001),
      'budget',jsonb_build_object('limit_cents',0,'max_attempts',1),'allowed_tools',jsonb_build_array('read','write'),
      'output',jsonb_build_object('required_artifact_types',jsonb_build_array('derived_audio'),'content_type','audio/mpeg','relative_path',format('episodes/%s/audio/derived-material-v%s.mp3',candidate.episode_id,candidate.revision_number),'review_stage','production_ready'),
      'input_artifacts',jsonb_build_array(jsonb_build_object('artifactType','source_video_material','relativePath',candidate.storage_path,'sha256',candidate.sha256,'fileSize',candidate.file_size))),0,1,'ffmpeg','ffmpeg','embedded-audio-v1') returning * into created_task;
    return next created_task;
  end loop;
end;
$$;

revoke all on function public.orchestrate_narration_tasks_without_connection_ref(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_narration_tasks_without_connection_ref(uuid) to service_role;
revoke all on function public.orchestrate_narration_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_narration_tasks(uuid) to service_role;
revoke all on function public.orchestrate_embedded_audio_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_embedded_audio_tasks(uuid) to service_role;
