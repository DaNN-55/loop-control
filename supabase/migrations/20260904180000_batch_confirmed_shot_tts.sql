create function public.generate_confirmed_shot_tts_batch(
  p_episode_id uuid,
  p_review_package_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  storyboard_shot jsonb;
  draft public.shot_preparation_drafts;
  existing_task public.tasks;
  generated_task public.tasks;
  blueprint_policy jsonb;
  narration_config jsonb;
  executor jsonb;
  provider text;
  adapter text;
  credential_ref text;
  config_hash text;
  details jsonb := '[]'::jsonb;
  created_count integer := 0;
  already_exists_count integer := 0;
  already_succeeded_count integer := 0;
  unconfirmed_count integer := 0;
  not_tts_count integer := 0;
  invalid_configuration_count integer := 0;
  other_count integer := 0;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate shot narration' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then
    raise exception 'Shot narration can only be generated in the shot workbench' using errcode = '22023';
  end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id
    and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select blueprint.policy into blueprint_policy
  from public.account_blueprint_versions blueprint
  where blueprint.id = current_episode.blueprint_version_id;
  narration_config := blueprint_policy -> 'narration';
  executor := narration_config -> 'executor';
  provider := executor ->> 'provider';
  adapter := executor ->> 'adapter';
  credential_ref := nullif(btrim(narration_config ->> 'credential_ref'), '');

  for storyboard_shot in
    select shot.value
    from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) with ordinality shot(value, position)
    order by shot.position
  loop
    select * into draft
    from public.shot_preparation_drafts candidate
    where candidate.episode_id = p_episode_id
      and candidate.review_package_id = p_review_package_id
      and candidate.shot_id = storyboard_shot ->> 'id'
    for update;

    if not found then
      other_count := other_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', storyboard_shot ->> 'id', 'status', 'other', 'reason', '未找到已保存的镜头草稿；页面未保存修改不会进入本批。'));
      continue;
    end if;

    if draft.audio_mode <> 'tts' then
      not_tts_count := not_tts_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'not_tts', 'reason', '当前镜头不是 TTS 模式。'));
      continue;
    end if;

    if coalesce(btrim(draft.tts_text), '') = '' or draft.tts_text_confirmation_fingerprint is distinct from md5(btrim(draft.tts_text)) then
      unconfirmed_count := unconfirmed_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'unconfirmed', 'reason', '口播正文尚未保存并确认。'));
      continue;
    end if;

    config_hash := public.shot_tts_configuration_hash(p_episode_id, draft.id);
    if (provider, adapter) not in (('google_tts', 'google_tts'), ('volcengine_tts', 'volcengine_tts'))
      or config_hash is null
      or coalesce(btrim(draft.tts_voice), '') = ''
      or draft.tts_speaking_rate is null
      or draft.tts_speaking_rate <= 0
      or credential_ref is null
      or credential_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not exists (
        select 1
        from public.external_connection_versions version
        join public.external_connections connection on connection.id = version.connection_id
        where version.id::text = credential_ref
          and connection.account_id = current_episode.account_id
          and connection.current_version_id = version.id
          and version.provider = provider
          and version.adapter = adapter
          and version.revoked_at is null
          and public.connection_version_is_verified(version.id)
      ) then
      invalid_configuration_count := invalid_configuration_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'invalid_configuration', 'reason', 'TTS 执行器、声音、语速或已验证连接配置不完整。'));
      continue;
    end if;

    select task.* into existing_task
    from public.tasks task
    where task.episode_id = p_episode_id
      and task.task_type = 'generate_narration'
      and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
      and task.input_snapshot ->> 'configuration_hash' = config_hash
    order by task.created_at desc
    limit 1
    for update;

    if found and existing_task.status in ('ready', 'running', 'completed') then
      if existing_task.status = 'completed' then
        already_succeeded_count := already_succeeded_count + 1;
        details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'already_succeeded', 'task_id', existing_task.id));
      else
        already_exists_count := already_exists_count + 1;
        details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'already_exists', 'task_id', existing_task.id));
      end if;
      continue;
    end if;

    if found and existing_task.status in ('blocked', 'failed') then
      other_count := other_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'other', 'task_id', existing_task.id, 'reason', '已有失败或阻塞任务；请使用单镜头安全重试。'));
      continue;
    end if;

    begin
      generated_task := public.generate_shot_tts(p_episode_id, p_review_package_id, draft.shot_id, false);
      created_count := created_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'created', 'task_id', generated_task.id));
    exception when others then
      other_count := other_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'other', 'reason', sqlerrm));
    end;
  end loop;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    p_episode_id,
    'shot_tts_batch_generation_requested',
    jsonb_build_object(
      'review_package_id', p_review_package_id,
      'created_count', created_count,
      'already_exists_count', already_exists_count,
      'already_succeeded_count', already_succeeded_count,
      'unconfirmed_count', unconfirmed_count,
      'not_tts_count', not_tts_count,
      'invalid_configuration_count', invalid_configuration_count,
      'other_count', other_count
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'version', 'shot-tts-batch/v1',
    'episode_id', p_episode_id,
    'review_package_id', p_review_package_id,
    'total_count', created_count + already_exists_count + already_succeeded_count + unconfirmed_count + not_tts_count + invalid_configuration_count + other_count,
    'created_count', created_count,
    'already_exists_count', already_exists_count,
    'already_succeeded_count', already_succeeded_count,
    'unconfirmed_count', unconfirmed_count,
    'not_tts_count', not_tts_count,
    'invalid_configuration_count', invalid_configuration_count,
    'other_count', other_count,
    'details', details
  );
end;
$$;

revoke all on function public.generate_confirmed_shot_tts_batch(uuid, uuid) from public, anon;
grant execute on function public.generate_confirmed_shot_tts_batch(uuid, uuid) to authenticated;
