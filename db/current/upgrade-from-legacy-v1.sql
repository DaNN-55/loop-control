-- ADR-0047: schema-only forward transition; all business rows and historical ledger entries are retained.

CREATE OR REPLACE FUNCTION local_identity.claim_input_task_pre_lease(p_task_id uuid DEFAULT NULL::uuid, p_worker_capacity integer DEFAULT 1)
 RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  candidate public.tasks;
  runtime jsonb;
  running_count integer;
  resource jsonb; next_turn bigint;
begin
  if p_worker_capacity is null or p_worker_capacity <= 0 then
    raise exception 'Worker capacity must be a positive integer' using errcode = '22023';
  end if;

  -- One durable host limit, shared by every HTTP/CLI process. Caller capacity
  -- may lower this invocation's limit but cannot raise the configured ceiling.
  perform pg_advisory_xact_lock(hashtextextended('loop-worker-global-capacity',0));
  perform local_identity.recover_input_tasks();
  select least(p_worker_capacity, capacity) into p_worker_capacity
    from public.worker_scheduler_settings where singleton for update;
  if not found then raise exception 'Worker scheduler capacity is not configured' using errcode='55000'; end if;
  if (select count(*) from public.tasks where local_identity.current_worker_task(tasks) and status='running'
      and claimed_at > clock_timestamp()-interval '30 minutes') >= p_worker_capacity then return; end if;

  for candidate in
    select task.*
    from public.tasks task left join public.worker_episode_turns turns on turns.episode_id=task.episode_id
    where local_identity.current_worker_task(task) and local_identity.input_task_allowed(task.episode_id,task.task_type) and task.status = 'ready' AND NOT EXISTS(SELECT 1 FROM local_identity.historical_tasks h WHERE h.task_id=task.id) and task.invalidated_at is null and task.available_at <= clock_timestamp()
      and task.provider in ('codex','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','whisperx','bailian','volcengine','minimax','kling')
      and task.attempt < task.max_attempts
      and (p_task_id is null or task.id = p_task_id)
    order by (select count(*) from public.tasks busy where local_identity.current_worker_task(busy) and busy.episode_id=task.episode_id and busy.status='running' and busy.claimed_at>clock_timestamp()-interval '30 minutes'), coalesce(turns.last_turn,0), task.created_at, task.id
    for update of task skip locked
  loop
    runtime := public.worker_runtime_constraints(candidate.input_snapshot, p_worker_capacity);
    runtime := runtime || jsonb_build_object('resource_limits',public.worker_resource_limits(candidate.input_snapshot,p_worker_capacity),
      'effective_concurrency',least((runtime->>'effective_concurrency')::integer,
        (select min((r->>'limit')::integer) from jsonb_array_elements(public.worker_resource_limits(candidate.input_snapshot,p_worker_capacity)) r)));
    -- All claimants take global -> recovery -> sorted resource locks. No lock
    -- is held across execution. Skip a saturated resource and try other Episodes.
    running_count:=0;
    for resource in select value from jsonb_array_elements(public.worker_resource_limits(candidate.input_snapshot,p_worker_capacity)) order by value->>'key'
    loop
      perform pg_advisory_xact_lock(hashtextextended(resource->>'key',0));
      select count(*) into running_count from public.tasks task
      where local_identity.current_worker_task(task) and task.status='running' and task.claimed_at>clock_timestamp()-interval '30 minutes'
        and exists(select 1 from jsonb_array_elements(public.worker_resource_limits(task.input_snapshot,p_worker_capacity)) r where r->>'key'=resource->>'key');
      if running_count >= (resource->>'limit')::integer then exit; end if;
    end loop;
    if running_count >= (resource->>'limit')::integer then continue; end if;

    update public.tasks task
    set input_snapshot = candidate.input_snapshot || jsonb_build_object(
      'runtime_constraints', runtime,
      'allowed_tools', public.worker_required_tools(candidate.input_snapshot ->> 'capability')
    )
    where task.id = candidate.id;
    return query select * from public.claim_next_worker_task_legacy(candidate.id);
    select nextval('local_identity.input_dispatch_turn') into next_turn;
    insert into public.worker_episode_turns(episode_id,last_turn) values(candidate.episode_id,next_turn)
      on conflict on constraint worker_episode_turns_pkey do update set last_turn=excluded.last_turn;
    return;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION local_identity.generate_input_shot_tts(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_retry boolean DEFAULT false)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  native_retry_id uuid;
  current_episode public.episodes;
  selected_package public.review_packages;
  draft public.shot_preparation_drafts;
  blueprint_policy jsonb;
  narration_config jsonb;
  executor jsonb;
  voice jsonb;
  existing_task public.tasks;
  created_task public.tasks;
  provider text;
  adapter text;
  model text;
  prompt_version text;
  credential_ref text;
  config_hash text;
  budget_limit integer;
  max_attempts integer;
  task_snapshot jsonb;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = local_identity.owner_id() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate shot narration' using errcode = '42501'; end if;
  IF NOT EXISTS(SELECT 1 FROM local_identity.input_episodes i WHERE i.episode_id=p_episode_id AND i.owner_id=local_identity.owner_id() AND i.enabled AND i.storyboard_enabled) THEN RAISE EXCEPTION 'Native managed storyboard required' USING ERRCODE='42501'; END IF;
  if local_identity.workspace_shot_context(p_episode_id,p_review_package_id,p_shot_id) IS NULL and current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then raise exception 'Shot narration can only be generated in the shot workbench' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join lateral (select 1 where local_identity.workspace_shot_context(p_episode_id,p_review_package_id,p_shot_id) IS NOT NULL OR EXISTS(select 1 from public.approvals approval where approval.review_package_id=package.id and approval.stage='storyboard_approved' and approval.decision='approved')) approval on true
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select * into draft from public.shot_preparation_drafts
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id)
  for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.audio_mode <> 'tts' then raise exception 'Only TTS shots can generate narration' using errcode = '22023'; end if;
  if coalesce(btrim(coalesce(draft.tts_text, draft.subtitle_text)), '') = '' or coalesce(btrim(draft.tts_voice), '') = '' or draft.tts_speaking_rate is null or draft.tts_speaking_rate <= 0 then
    raise exception 'TTS 草稿必须包含口播内容、声音和有效语速' using errcode = '22023';
  end if;

  select blueprint.policy into blueprint_policy from public.account_blueprint_versions blueprint where blueprint.id = current_episode.blueprint_version_id;
  narration_config := blueprint_policy -> 'narration';
  executor := narration_config -> 'executor';
  provider := executor ->> 'provider';
  adapter := executor ->> 'adapter';
  model := coalesce(nullif(btrim(executor ->> 'model'), ''), 'standard');
  prompt_version := coalesce(nullif(btrim(executor ->> 'prompt_version'), ''), 'narration-v1');
  credential_ref := nullif(btrim(narration_config ->> 'credential_ref'), '');
  if (provider, adapter) not in (('volcengine_tts', 'volcengine_tts')) then
    raise exception '蓝图没有可执行的 TTS Adapter' using errcode = '22023';
  end if;
  if credential_ref is null or credential_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (
    select 1 from public.external_connection_versions version
    join public.external_connections connection on connection.id = version.connection_id
    where version.id = credential_ref::uuid and connection.created_by = local_identity.owner_id()
      and connection.current_version_id = version.id and version.provider = provider and version.adapter = adapter
      and version.revoked_at is null and public.connection_version_is_verified(version.id)
  ) then
    raise exception 'TTS 外部连接版本未验证或与当前蓝图不兼容' using errcode = '22023';
  end if;
  voice := jsonb_build_object(
    'language_code', coalesce(nullif(btrim(draft.tts_language_code), ''), nullif(btrim(narration_config #>> '{voice,language_code}'), ''), 'zh-CN'),
    'name', draft.tts_voice,
    'speaking_rate', draft.tts_speaking_rate
  );
  config_hash := md5(jsonb_build_object('text', coalesce(draft.tts_text, draft.subtitle_text), 'voice', voice, 'provider', provider, 'adapter', adapter, 'model', model, 'prompt_version', prompt_version, 'connection_version_id', credential_ref)::text);

  select task.* into existing_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = 'generate_narration'
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
    and task.input_snapshot ->> 'configuration_hash' = config_hash
  order by task.created_at desc for update limit 1;
  if found and existing_task.status in ('ready', 'running') then return existing_task; end if;
  if found and existing_task.status = 'completed' and public.restore_completed_shot_tts_track(draft.id, existing_task.id) then return existing_task; end if;
  if found and existing_task.status = 'failed' and not p_retry then return existing_task; end if;

  IF FOUND AND existing_task.status='failed' AND p_retry THEN native_retry_id:=gen_random_uuid(); END IF;
  budget_limit := case when (narration_config ->> 'budget_cents') ~ '^[0-9]+$' then (narration_config ->> 'budget_cents')::integer else 0 end;
  max_attempts := case when (narration_config ->> 'max_attempts') ~ '^[1-9][0-9]*$' then (narration_config ->> 'max_attempts')::integer else 1 end;
  task_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'native_tts_retry_id',native_retry_id,'capability', 'narration_generation', 'storyboard_review_package_id', p_review_package_id,
    'configuration_hash', config_hash, 'credential_ref', credential_ref,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', p_episode_id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
    'executor', jsonb_build_object('provider', provider, 'adapter', adapter, 'model', model, 'prompt_version', prompt_version),
    'media', jsonb_build_object('adapter', adapter, 'narration', jsonb_build_object('text', coalesce(draft.tts_text, draft.subtitle_text), 'voice', voice)), 'acoustic_alignment', jsonb_build_object('confirmed_text', draft.subtitle_text, 'text_fingerprint', encode(extensions.digest(convert_to(draft.subtitle_text, 'UTF8'), 'sha256'), 'hex')),
    'audio_track', jsonb_build_object('kind', 'narration', 'cue_id', draft.shot_id, 'source_review_package_id', p_review_package_id, 'start_seconds', 0, 'duration_seconds', 0.001),
    'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', max_attempts),
    'allowed_tools', coalesce(narration_config -> 'allowed_tools', jsonb_build_array('read', 'write')),
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array('narration_audio'), 'content_type', 'audio/mpeg', 'relative_path', format('episodes/%s/audio/shot-narration-%s-%s.mp3', p_episode_id, draft.shot_id, config_hash||CASE WHEN native_retry_id IS NULL THEN '' ELSE '-retry-'||native_retry_id::text END), 'review_stage', 'production_ready'),
    'input_artifacts', jsonb_build_array()
  ));
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, 'generate_narration', 'ready'::public.task_status, task_snapshot, budget_limit, max_attempts, provider, model, prompt_version)
  returning * into created_task;
  update public.shot_preparation_drafts
  set current_audio_track_id = null, current_tts_task_id = null, tts_actual_duration_seconds = null, audio_status = 'running', pending_tts_task_id = created_task.id, tts_error = null, updated_at = now()
  where id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_tts_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'configuration_hash', config_hash, 'retry', p_retry), local_identity.owner_id());
  return created_task;
end;
$function$
;

CREATE OR REPLACE FUNCTION local_identity.input_media_connection_before_images(p_task_id uuid, p_attempt integer, p_lease_token uuid, p_version_id uuid)
 RETURNS TABLE(version_id uuid, provider text, adapter text, endpoint text, secret_ref uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 RETURN QUERY SELECT v.id,v.provider,v.adapter,v.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled
 JOIN public.external_connection_versions v ON v.id=p_version_id
 JOIN public.external_connections c ON c.id=v.connection_id AND c.created_by=i.owner_id AND c.current_version_id=v.id
 JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=v.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND v.revoked_at IS NULL AND (
  (i.media_enabled AND t.task_type IN ('generate_shot_video','search_shot_video','preview_shot_video','generate_a_roll','generate_b_roll','generate_soundtrack') AND t.provider IN ('pexels','freesound','bailian','volcengine','minimax','kling') AND t.input_snapshot->>'credential_ref'=v.id::text AND v.provider=t.provider AND v.adapter=t.input_snapshot#>>'{media,adapter}') OR
  (t.task_type='prepare_visual_brief' AND v.provider IN ('openai') AND t.input_snapshot#>>'{visual_assets,image_generation,credential_ref}'=v.id::text AND v.provider=t.input_snapshot#>>'{visual_assets,image_generation,provider}' AND v.adapter=t.input_snapshot#>>'{visual_assets,image_generation,adapter}')
 ) AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen media connection unavailable' USING ERRCODE='42501'; END IF;
END $function$
;

CREATE OR REPLACE FUNCTION local_identity.input_task_connection(p_task_id uuid, p_attempt integer, p_lease_token uuid)
 RETURNS TABLE(version_id uuid, provider text, adapter text, endpoint text, secret_ref uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 RETURN QUERY SELECT v.id,v.provider,v.adapter,v.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.narration_enabled
 JOIN public.external_connection_versions v ON v.id=(t.input_snapshot->>'credential_ref')::uuid
 JOIN public.external_connections c ON c.id=v.connection_id AND c.created_by=i.owner_id AND (c.current_version_id=v.id OR t.input_snapshot->>'selectionVersion'='1')
 JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=v.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.task_type='generate_narration' AND t.provider IN ('volcengine_tts') AND v.provider=t.provider AND v.adapter=t.input_snapshot#>>'{media,adapter}' AND v.revoked_at IS NULL
 AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen narration connection unavailable' USING ERRCODE='42501'; END IF;
END $function$
;

CREATE OR REPLACE FUNCTION local_identity.reserve_wan_generation(p_task_id uuid, p_attempt integer, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.tasks; aid uuid; r public.paid_generation_reservations; amount integer; k text;
begin
 if local_identity.actor_role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501'; end if;
 perform public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
 if not exists(select 1 from public.tasks managed where managed.id=p_task_id and managed.provider IN ('bailian','volcengine','minimax','kling') and local_identity.input_task_allowed(managed.episode_id,managed.task_type)) then raise exception 'Managed Wan task required' using errcode='42501'; end if;
 select * into t from public.tasks where id=p_task_id and status='running' and attempt=p_attempt+1 for update;
 if not found then raise exception 'Current running task attempt required'; end if;
 select account_id into aid from public.episodes where id=t.episode_id;
 select * into r from public.paid_generation_reservations where task_id=t.id;
 if found then return to_jsonb(r)||jsonb_build_object('new',false); end if;
 if t.provider IN ('bailian','volcengine','minimax','kling') then
  k:='video'; amount:=CASE WHEN t.provider='bailian' AND t.input_snapshot#>>'{production_selection,provider}' IS DISTINCT FROM 'bailian' THEN (t.input_snapshot#>>'{media,wan_video,duration_seconds}')::integer*15 ELSE t.budget_limit_cents END;
  if amount is null or amount<1 or amount>100000 then raise exception 'Invalid frozen video duration'; end if;
 elsif t.provider in ('volcengine_tts') and t.task_type='generate_narration' then
  k:='narration'; amount:=greatest(1,char_length(t.input_snapshot#>>'{media,narration,text}'));
  -- Conservatively reserve 0.01 CNY per character, above the approved public
  -- standard-voice rate. This is a reservation, not a claim about actual billing.
 else raise exception 'Unsupported paid task'; end if;
 insert into public.paid_generation_reservations(task_id,account_id,kind,reserved_cents) values(t.id,aid,k,amount) returning * into r;
 return to_jsonb(r)||jsonb_build_object('new',true);
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_next_worker_task_legacy(p_task_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_task public.tasks;
begin
  select * into selected_task from public.tasks task where local_identity.current_worker_task(task) and task.status = 'ready' AND NOT EXISTS(SELECT 1 FROM local_identity.historical_tasks h WHERE h.task_id=task.id) and task.provider in ('codex','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','whisperx','bailian','volcengine','minimax','kling') and task.attempt < task.max_attempts and (p_task_id is null or task.id = p_task_id) order by task.created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.tasks task set status = 'running', claimed_at = now(), attempt = task.attempt + 1 where task.id = selected_task.id;
  insert into public.task_runs (task_id,attempt,task_package)
  select selected_task.id, selected_task.attempt, jsonb_build_object('version','worker-task/v1','task_id',selected_task.id,'task_type',selected_task.task_type,'attempt',selected_task.attempt,'budget_limit_cents',selected_task.budget_limit_cents,'max_attempts',selected_task.max_attempts,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'episode_id',episode.id,'account_id',account.id,'blueprint_version_id',episode.blueprint_version_id,'allowed_asset_root',coalesce(local_identity.episode_asset_root(episode.id),''),'input_snapshot',selected_task.input_snapshot || jsonb_build_object('prompt_context', coalesce(selected_task.input_snapshot -> 'prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot))))
  from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
  return query select selected_task.id,selected_task.task_type,selected_task.attempt,selected_task.budget_limit_cents,selected_task.max_attempts,selected_task.provider,selected_task.model,selected_task.prompt_version,episode.id,account.id,episode.blueprint_version_id,episode.title,coalesce(local_identity.episode_asset_root(episode.id),''),selected_task.input_snapshot || jsonb_build_object('prompt_context', coalesce(selected_task.input_snapshot -> 'prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot))) from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_next_worker_task_pre_lease(p_task_id uuid DEFAULT NULL::uuid, p_worker_capacity integer DEFAULT 1)
 RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  candidate public.tasks;
  runtime jsonb;
  running_count integer;
  resource jsonb; next_turn bigint;
begin
  if p_worker_capacity is null or p_worker_capacity <= 0 then
    raise exception 'Worker capacity must be a positive integer' using errcode = '22023';
  end if;

  -- One durable host limit, shared by every HTTP/CLI process. Caller capacity
  -- may lower this invocation's limit but cannot raise the configured ceiling.
  perform pg_advisory_xact_lock(hashtextextended('loop-worker-global-capacity',0));
  perform public.recover_expired_worker_tasks();
  select least(p_worker_capacity, capacity) into p_worker_capacity
    from public.worker_scheduler_settings where singleton for update;
  if not found then raise exception 'Worker scheduler capacity is not configured' using errcode='55000'; end if;
  if (select count(*) from public.tasks where status='running'
      and claimed_at > clock_timestamp()-interval '30 minutes') >= p_worker_capacity then return; end if;

  for candidate in
    select task.*
    from public.tasks task left join public.worker_episode_turns turns on turns.episode_id=task.episode_id
    where task.status = 'ready' AND NOT EXISTS(SELECT 1 FROM local_identity.historical_tasks h WHERE h.task_id=task.id) and task.invalidated_at is null and task.available_at <= clock_timestamp()
      and task.provider in ('codex','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','whisperx','bailian','volcengine','minimax','kling')
      and task.attempt < task.max_attempts
      and (p_task_id is null or task.id = p_task_id)
    order by (select count(*) from public.tasks busy where busy.episode_id=task.episode_id and busy.status='running' and busy.claimed_at>clock_timestamp()-interval '30 minutes'), coalesce(turns.last_turn,0), task.created_at, task.id
    for update of task skip locked
  loop
    runtime := public.worker_runtime_constraints(candidate.input_snapshot, p_worker_capacity);
    runtime := runtime || jsonb_build_object('resource_limits',public.worker_resource_limits(candidate.input_snapshot,p_worker_capacity),
      'effective_concurrency',least((runtime->>'effective_concurrency')::integer,
        (select min((r->>'limit')::integer) from jsonb_array_elements(public.worker_resource_limits(candidate.input_snapshot,p_worker_capacity)) r)));
    -- All claimants take global -> recovery -> sorted resource locks. No lock
    -- is held across execution. Skip a saturated resource and try other Episodes.
    running_count:=0;
    for resource in select value from jsonb_array_elements(public.worker_resource_limits(candidate.input_snapshot,p_worker_capacity)) order by value->>'key'
    loop
      perform pg_advisory_xact_lock(hashtextextended(resource->>'key',0));
      select count(*) into running_count from public.tasks task
      where task.status='running' and task.claimed_at>clock_timestamp()-interval '30 minutes'
        and exists(select 1 from jsonb_array_elements(public.worker_resource_limits(task.input_snapshot,p_worker_capacity)) r where r->>'key'=resource->>'key');
      if running_count >= (resource->>'limit')::integer then exit; end if;
    end loop;
    if running_count >= (resource->>'limit')::integer then continue; end if;

    update public.tasks task
    set input_snapshot = candidate.input_snapshot || jsonb_build_object(
      'runtime_constraints', runtime,
      'allowed_tools', public.worker_required_tools(candidate.input_snapshot ->> 'capability')
    )
    where task.id = candidate.id;
    return query select * from public.claim_next_worker_task_legacy(candidate.id);
    update public.worker_scheduler_settings set turn=turn+1 where singleton returning turn into next_turn;
    insert into public.worker_episode_turns(episode_id,last_turn) values(candidate.episode_id,next_turn)
      on conflict on constraint worker_episode_turns_pkey do update set last_turn=excluded.last_turn;
    return;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_confirmed_shot_tts_batch(p_episode_id uuid, p_review_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
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
  where episode.id = p_episode_id and membership.user_id = local_identity.owner_id() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate shot narration' using errcode = '42501'; end if;
  if current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then
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
    if (provider, adapter) not in (('volcengine_tts', 'volcengine_tts'))
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
        join public.account_memberships connection_owner
          on connection_owner.account_id = current_episode.account_id
         and connection_owner.user_id = connection.created_by
         and connection_owner.role = 'owner'
        where version.id::text = credential_ref
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
    local_identity.owner_id()
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
$function$
;

CREATE OR REPLACE FUNCTION public.generate_shot_tts(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_retry boolean DEFAULT false)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  draft public.shot_preparation_drafts;
  blueprint_policy jsonb;
  narration_config jsonb;
  executor jsonb;
  voice jsonb;
  existing_task public.tasks;
  created_task public.tasks;
  provider text;
  adapter text;
  model text;
  prompt_version text;
  credential_ref text;
  config_hash text;
  budget_limit integer;
  max_attempts integer;
  task_snapshot jsonb;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = local_identity.owner_id() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate shot narration' using errcode = '42501'; end if;
  if current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then raise exception 'Shot narration can only be generated in the shot workbench' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select * into draft from public.shot_preparation_drafts
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id)
  for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.audio_mode <> 'tts' then raise exception 'Only TTS shots can generate narration' using errcode = '22023'; end if;
  if coalesce(btrim(coalesce(draft.tts_text, draft.subtitle_text)), '') = '' or coalesce(btrim(draft.tts_voice), '') = '' or draft.tts_speaking_rate is null or draft.tts_speaking_rate <= 0 then
    raise exception 'TTS 草稿必须包含口播内容、声音和有效语速' using errcode = '22023';
  end if;

  select blueprint.policy into blueprint_policy from public.account_blueprint_versions blueprint where blueprint.id = current_episode.blueprint_version_id;
  narration_config := blueprint_policy -> 'narration';
  executor := narration_config -> 'executor';
  provider := executor ->> 'provider';
  adapter := executor ->> 'adapter';
  model := coalesce(nullif(btrim(executor ->> 'model'), ''), 'standard');
  prompt_version := coalesce(nullif(btrim(executor ->> 'prompt_version'), ''), 'narration-v1');
  credential_ref := nullif(btrim(narration_config ->> 'credential_ref'), '');
  if (provider, adapter) not in (('volcengine_tts', 'volcengine_tts')) then
    raise exception '蓝图没有可执行的 TTS Adapter' using errcode = '22023';
  end if;
  if credential_ref is null or credential_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (
    select 1 from public.external_connection_versions version
    join public.external_connections connection on connection.id = version.connection_id
    where version.id = credential_ref::uuid and connection.created_by = local_identity.owner_id()
      and connection.current_version_id = version.id and version.provider = provider and version.adapter = adapter
      and version.revoked_at is null and public.connection_version_is_verified(version.id)
  ) then
    raise exception 'TTS 外部连接版本未验证或与当前蓝图不兼容' using errcode = '22023';
  end if;
  voice := jsonb_build_object(
    'language_code', coalesce(nullif(btrim(draft.tts_language_code), ''), nullif(btrim(narration_config #>> '{voice,language_code}'), ''), 'zh-CN'),
    'name', draft.tts_voice,
    'speaking_rate', draft.tts_speaking_rate
  );
  config_hash := md5(jsonb_build_object('text', coalesce(draft.tts_text, draft.subtitle_text), 'voice', voice, 'provider', provider, 'adapter', adapter, 'model', model, 'prompt_version', prompt_version, 'connection_version_id', credential_ref)::text);

  select task.* into existing_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = 'generate_narration'
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
    and task.input_snapshot ->> 'configuration_hash' = config_hash
  order by task.created_at desc for update limit 1;
  if found and existing_task.status in ('ready', 'running') then return existing_task; end if;
  if found and existing_task.status = 'completed' and public.restore_completed_shot_tts_track(draft.id, existing_task.id) then return existing_task; end if;
  if found and existing_task.status = 'failed' and not p_retry then return existing_task; end if;

  budget_limit := case when (narration_config ->> 'budget_cents') ~ '^[0-9]+$' then (narration_config ->> 'budget_cents')::integer else 0 end;
  max_attempts := case when (narration_config ->> 'max_attempts') ~ '^[1-9][0-9]*$' then (narration_config ->> 'max_attempts')::integer else 1 end;
  task_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'capability', 'narration_generation', 'storyboard_review_package_id', p_review_package_id,
    'configuration_hash', config_hash, 'credential_ref', credential_ref,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', p_episode_id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
    'executor', jsonb_build_object('provider', provider, 'adapter', adapter, 'model', model, 'prompt_version', prompt_version),
    'media', jsonb_build_object('adapter', adapter, 'narration', jsonb_build_object('text', coalesce(draft.tts_text, draft.subtitle_text), 'voice', voice)), 'acoustic_alignment', jsonb_build_object('confirmed_text', draft.subtitle_text, 'text_fingerprint', encode(extensions.digest(convert_to(draft.subtitle_text, 'UTF8'), 'sha256'), 'hex')),
    'audio_track', jsonb_build_object('kind', 'narration', 'cue_id', draft.shot_id, 'source_review_package_id', p_review_package_id, 'start_seconds', 0, 'duration_seconds', 0.001),
    'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', max_attempts),
    'allowed_tools', coalesce(narration_config -> 'allowed_tools', jsonb_build_array('read', 'write')),
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array('narration_audio'), 'content_type', 'audio/mpeg', 'relative_path', format('episodes/%s/audio/shot-narration-%s-%s.mp3', p_episode_id, draft.shot_id, config_hash), 'review_stage', 'production_ready'),
    'input_artifacts', jsonb_build_array()
  ));
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, 'generate_narration', 'ready'::public.task_status, task_snapshot, budget_limit, max_attempts, provider, model, prompt_version)
  returning * into created_task;
  update public.shot_preparation_drafts
  set current_audio_track_id = null, current_tts_task_id = null, tts_actual_duration_seconds = null, audio_status = 'running', pending_tts_task_id = created_task.id, tts_error = null, updated_at = now()
  where id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_tts_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'configuration_hash', config_hash, 'retry', p_retry), local_identity.owner_id());
  return created_task;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_worker_task_runtime_constraints()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.provider in ('codex', 'volcengine_tts', 'pexels', 'ffmpeg', 'freesound', 'openchatcut', 'openai', 'whisperx')
    and jsonb_typeof(new.input_snapshot) = 'object' then
    new.input_snapshot := new.input_snapshot || jsonb_build_object(
      'runtime_constraints', public.worker_runtime_constraints(new.input_snapshot),
      'allowed_tools', public.worker_required_tools(new.input_snapshot ->> 'capability')
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.orchestrate_narration_tasks_all()
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RAISE EXCEPTION 'Historical automatic narration entrypoint is retired; use explicit production selection' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_narration_tasks_without_connection_ref(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      elsif jsonb_typeof(executor) <> 'object' or not ((executor ->> 'provider' = 'volcengine_tts' and executor ->> 'adapter' = 'volcengine_tts')) or coalesce(btrim(executor ->> 'model'), '') = '' or coalesce(btrim(executor ->> 'prompt_version'), '') = '' then blocker_code := 'narration_executor_invalid'; blocker_detail := '旁白配置必须精确声明已登记的 TTS 适配器、模型与提示版本。';
      elsif jsonb_typeof(selected_config -> 'allowed_tools') <> 'array' or jsonb_array_length(selected_config -> 'allowed_tools') = 0 then blocker_code := 'narration_allowed_tools_invalid'; blocker_detail := '旁白配置必须声明非空的允许工具清单。';
      elsif jsonb_typeof(selected_config -> 'budget_cents') <> 'number' or selected_config ->> 'budget_cents' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'budget_cents') > 10 or (length(selected_config ->> 'budget_cents') = 10 and selected_config ->> 'budget_cents' > '2147483647') then blocker_code := 'narration_budget_invalid'; blocker_detail := '旁白配置必须提供有效预算。';
      elsif jsonb_typeof(selected_config -> 'max_attempts') <> 'number' or selected_config ->> 'max_attempts' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'max_attempts') > 10 or (length(selected_config ->> 'max_attempts') = 10 and selected_config ->> 'max_attempts' > '2147483647') then blocker_code := 'narration_scheduling_invalid'; blocker_detail := '旁白配置必须提供有效最大尝试次数。';
      elsif jsonb_typeof(selected_config -> 'voice') <> 'object' or coalesce(btrim(selected_config #>> '{voice,language_code}'), '') = '' or coalesce(btrim(selected_config #>> '{voice,name}'), '') = '' or jsonb_typeof(selected_config #> '{voice,speaking_rate}') <> 'number' or (selected_config #>> '{voice,speaking_rate}')::numeric <= 0 then blocker_code := 'narration_voice_invalid'; blocker_detail := '旁白配置必须冻结有效语言、声音与语速。'; end if;
      budget_limit := case when blocker_code is null then (selected_config ->> 'budget_cents')::integer else 0 end; max_attempts := case when blocker_code is null then (selected_config ->> 'max_attempts')::integer else 1 end;
      insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version,last_result,completed_at)
      values (candidate.id,'generate_narration',case when blocker_code is null then 'ready'::public.task_status else 'blocked'::public.task_status end,
        jsonb_strip_nulls(jsonb_build_object('capability','narration_generation','storyboard_review_package_id',candidate.storyboard_review_package_id,'configuration_hash',configuration_hash,'executor',executor,'media',jsonb_build_object('adapter',executor ->> 'adapter','narration',jsonb_build_object('text',btrim(shot ->> 'scriptSegment'),'voice',selected_config -> 'voice')),'audio_track',jsonb_build_object('kind','narration','cue_id',shot ->> 'id','source_review_package_id',candidate.storyboard_review_package_id,'start_seconds',start_seconds,'duration_seconds',shot_duration),'budget',jsonb_build_object('limit_cents',budget_limit,'max_attempts',max_attempts),'allowed_tools',selected_config -> 'allowed_tools','output',jsonb_build_object('required_artifact_types',jsonb_build_array('narration_audio'),'content_type','audio/mpeg','relative_path',format('episodes/%s/audio/narration-%s-%s.mp3',candidate.id,candidate.storyboard_review_package_id,shot ->> 'id'),'review_stage','production_ready'),'input_artifacts',candidate.storyboard_context -> 'input_artifacts')),
        budget_limit,max_attempts,coalesce(executor ->> 'provider','unconfigured'),coalesce(executor ->> 'model','unconfigured'),coalesce(executor ->> 'prompt_version','unconfigured'),case when blocker_code is null then null else jsonb_build_object('version','worker-result/v1','taskId','','status','blocked','artifacts',jsonb_build_array(),'validation',jsonb_build_object('passed',false,'checks',jsonb_build_array()),'actualCostCents',0,'blockers',jsonb_build_array(jsonb_build_object('code',blocker_code,'detail',blocker_detail)),'retry',jsonb_build_object('shouldRetry',false,'reason',blocker_detail),'nextStep','修正冻结的旁白配置后，使用新的配置创建任务。') end,case when blocker_code is null then null else now() end) returning * into created_task;
      if blocker_code is not null then update public.tasks set last_result = jsonb_set(last_result, '{taskId}', to_jsonb(created_task.id::text)) where id = created_task.id returning * into created_task; insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) values (candidate.account_id,candidate.id,'narration_task_blocked',jsonb_build_object('task_id',created_task.id,'cue_id',shot ->> 'id','code',blocker_code,'detail',blocker_detail),null); end if;
      return next created_task; start_seconds := start_seconds + shot_duration;
    end loop;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_blueprint_external_connections()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k text; ref text; expected_provider text; expected_adapter text;
begin
 IF TG_OP='INSERT' AND NEW.is_snapshot AND EXISTS(SELECT 1 FROM public.account_blueprint_versions b WHERE b.account_id=NEW.account_id AND b.policy=NEW.policy) THEN RETURN NEW; END IF;
 -- Exact retirement-only edit: no other policy fields or references can change.
 if TG_OP='UPDATE' and new.policy<>old.policy and new.policy=local_identity.without_retired_provider_capabilities(old.policy) then return new; end if;
 -- Archive an exact copy of this Owner current policy; this grants no execution.
 if new.is_snapshot and not new.is_active and new.archived_at is not null and exists(
  select 1 from public.accounts a join public.account_blueprint_versions b on b.id=a.current_blueprint_version_id
  join public.account_memberships m on m.account_id=a.id and m.user_id=local_identity.owner_id() and m.role='owner'
  where a.id=new.account_id and b.policy=new.policy
 ) then return new; end if;
 foreach k in array array['a_roll','b_roll','soundtrack','narration','static_visual'] loop
  ref:=nullif(btrim(new.policy #>> array[k,'credential_ref']),'');
  if ref is null then continue; end if;
  expected_provider:=new.policy #>> array[k,'executor','provider']; expected_adapter:=new.policy #>> array[k,'executor','adapter'];
  if not coalesce(case k
   when 'a_roll' then (expected_provider,expected_adapter) in (('bailian','wan_video'),('volcengine','seedance_video'),('minimax','minimax_video'),('kling','kling_video'))
   when 'b_roll' then (expected_provider,expected_adapter) in (('bailian','wan_video'),('pexels','pexels_video'),('volcengine','seedance_video'),('minimax','minimax_video'),('kling','kling_video'))
   when 'soundtrack' then (expected_provider,expected_adapter)=('freesound','freesound_preview')
   when 'narration' then (expected_provider,expected_adapter) in (('volcengine_tts','volcengine_tts'))
   when 'static_visual' then (expected_provider,expected_adapter) in (('openai','openai_images')) end,false)
  then raise exception '% uses an incompatible connection Adapter',k using errcode='22023'; end if;
  if ref !~ '^[0-9a-f-]{36}$' or not exists (
   select 1 from public.external_connection_versions v join public.external_connections c on c.id=v.connection_id
   join public.account_memberships m on m.account_id=new.account_id and m.user_id=c.created_by and m.role='owner'
   where v.id=ref::uuid and c.created_by=local_identity.owner_id() and c.current_version_id=v.id and v.revoked_at is null
   and v.provider=expected_provider and v.adapter=expected_adapter and public.connection_version_is_verified(v.id)
  ) then raise exception '% requires this Owner current verified connection',k using errcode='22023'; end if;
 end loop;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.worker_retry_delay_ms()
 RETURNS integer
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select case when min(available_at) is null then 0 else
   least(30000,greatest(1,ceil(extract(epoch from(min(available_at)-clock_timestamp()))*1000)))::integer end
 from public.tasks
 where status='ready' and invalidated_at is null and attempt<max_attempts
   and provider in ('codex','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','whisperx')
   and available_at>clock_timestamp() and available_at<'infinity'::timestamptz;
$function$
;

CREATE OR REPLACE FUNCTION public.worker_runtime_constraints(p_input_snapshot jsonb, p_worker_capacity integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  provider text := coalesce(nullif(btrim(p_input_snapshot #>> '{executor,provider}'), ''), nullif(btrim(p_input_snapshot ->> 'provider'), ''), 'unknown');
  adapter text := coalesce(nullif(btrim(p_input_snapshot #>> '{executor,adapter}'), ''), nullif(btrim(p_input_snapshot #>> '{media,adapter}'), ''), 'default');
  provider_limit integer;
  adapter_limit integer;
  worker_limit integer := case when p_worker_capacity > 0 then p_worker_capacity else 1 end;
  credential_key text := coalesce(nullif(btrim(p_input_snapshot ->> 'credential_ref'), ''), 'shared');
  group_key text;
begin
  adapter_limit := case adapter
    when 'pexels_video' then 3
    when 'volcengine_tts' then 2
    when 'freesound_preview' then 1
    when 'openai_images' then 1
    when 'openchatcut_card_video' then 1
    else 1
  end;
  provider_limit := case
    when provider = 'pexels' and adapter = 'pexels_video' then 3
    when provider = 'volcengine_tts' and adapter = 'volcengine_tts' then 2
    else null
  end;
  group_key := format('%s:%s:%s', provider, adapter, credential_key);
  return jsonb_build_object(
    'version', 'worker-runtime/v1',
    'concurrency_group', group_key,
    'effective_concurrency', least(coalesce(provider_limit, adapter_limit), adapter_limit, worker_limit),
    'source', jsonb_build_object(
      'provider_or_connection_limit', provider_limit,
      'adapter_safety_limit', adapter_limit,
      'worker_capacity', worker_limit
    )
  );
end;
$function$
;

ALTER TABLE public.external_connections DROP CONSTRAINT external_connections_provider_adapter_check;
ALTER TABLE public.external_connections ADD CONSTRAINT external_connections_provider_adapter_check CHECK ((((provider = 'pexels'::text) AND (adapter = 'pexels_video'::text)) OR ((provider = 'freesound'::text) AND (adapter = 'freesound_preview'::text)) OR ((provider = 'openai'::text) AND (adapter = 'openai_images'::text)) OR ((provider = 'volcengine_tts'::text) AND (adapter = 'volcengine_tts'::text)) OR ((provider = 'bailian'::text) AND (adapter = 'wan_video'::text)) OR ((provider = 'volcengine'::text) AND (adapter = 'seedance_video'::text)) OR ((provider = 'minimax'::text) AND (adapter = 'minimax_video'::text)) OR ((provider = 'kling'::text) AND (adapter = 'kling_video'::text)))) NOT VALID;
-- Existing unsupported historical rows are preserved; new writes must satisfy the current contract.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.external_connections WHERE (provider,adapter) NOT IN (('pexels','pexels_video'),('freesound','freesound_preview'),('openai','openai_images'),('volcengine_tts','volcengine_tts'),('bailian','wan_video'),('volcengine','seedance_video'),('minimax','minimax_video'),('kling','kling_video'))) THEN
 ALTER TABLE public.external_connections VALIDATE CONSTRAINT external_connections_provider_adapter_check;
 END IF;
END $$;

-- Normalize the effective path guard when upgrading a historical SQL bootstrap.
ALTER TABLE local_identity.episode_asset_locations DROP CONSTRAINT episode_directory_relative_path;
ALTER TABLE local_identity.episode_asset_locations ADD CONSTRAINT episode_directory_relative_path CHECK (((directory_relative_path IS NULL) OR ((length(directory_relative_path) >= 1) AND (length(directory_relative_path) <= 2048) AND (directory_relative_path !~ '(^/|\\|(^|/)\.{1,2}(/|$)|//|/$)'::text))));
