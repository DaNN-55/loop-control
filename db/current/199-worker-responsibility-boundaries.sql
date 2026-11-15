-- ADR-0066 E2: preserve checks while giving each transaction one responsible implementation.
-- All historical data, frozen identifiers, migration bytes and ledgers remain unchanged.

CREATE OR REPLACE FUNCTION local_identity.claim_scheduled_worker_task(p_task_id uuid,p_worker_capacity integer,p_input_only boolean)
 RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  candidate public.tasks;
  runtime jsonb;
  running_count integer;
  resource jsonb; next_turn bigint; selected_task public.tasks; token uuid;
begin
  IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role is required' USING ERRCODE='42501'; END IF;
  if p_worker_capacity is null or p_worker_capacity <= 0 then
    raise exception 'Worker capacity must be a positive integer' using errcode = '22023';
  end if;

  -- One durable host limit, shared by every HTTP/CLI process. Caller capacity
  -- may lower this invocation's limit but cannot raise the configured ceiling.
  perform pg_advisory_xact_lock(hashtextextended('loop-worker-global-capacity',0));
  IF p_input_only THEN perform local_identity.recover_input_tasks(); ELSE perform public.recover_expired_worker_tasks(); END IF;
  select least(p_worker_capacity, capacity) into p_worker_capacity
    from public.worker_scheduler_settings where singleton for update;
  if not found then raise exception 'Worker scheduler capacity is not configured' using errcode='55000'; end if;
  if (select count(*) from public.tasks where (NOT p_input_only OR local_identity.current_worker_task(tasks)) and status='running'
      and claimed_at > clock_timestamp()-interval '30 minutes') >= p_worker_capacity then return; end if;

  for candidate in
    select task.*
    from public.tasks task left join public.worker_episode_turns turns on turns.episode_id=task.episode_id
    where (NOT p_input_only OR (local_identity.current_worker_task(task) and local_identity.input_task_allowed(task.episode_id,task.task_type))) and task.status = 'ready' AND NOT EXISTS(SELECT 1 FROM local_identity.historical_tasks h WHERE h.task_id=task.id) and task.invalidated_at is null and task.available_at <= clock_timestamp()
      and task.provider in ('codex','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','whisperx','bailian','volcengine','minimax','kling')
      and task.attempt < task.max_attempts
      and (p_task_id is null or task.id = p_task_id)
    order by (select count(*) from public.tasks busy where (NOT p_input_only OR local_identity.current_worker_task(busy)) and busy.episode_id=task.episode_id and busy.status='running' and busy.claimed_at>clock_timestamp()-interval '30 minutes'), coalesce(turns.last_turn,0), task.created_at, task.id
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
      where (NOT p_input_only OR local_identity.current_worker_task(task)) and task.status='running' and task.claimed_at>clock_timestamp()-interval '30 minutes'
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
    <<start_attempt>>
    BEGIN

  select * into selected_task from public.tasks task where local_identity.current_worker_task(task) and task.status = 'ready' AND NOT EXISTS(SELECT 1 FROM local_identity.historical_tasks h WHERE h.task_id=task.id) and task.provider in ('codex','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','whisperx','bailian','volcengine','minimax','kling') and task.attempt < task.max_attempts and task.id = candidate.id order by task.created_at for update skip locked limit 1;
  if not found then EXIT start_attempt; end if;
  update public.tasks task set status = 'running', claimed_at = now(), attempt = task.attempt + 1 where task.id = selected_task.id;
  insert into public.task_runs (task_id,attempt,task_package)
  select selected_task.id, selected_task.attempt, jsonb_build_object('version','worker-task/v1','task_id',selected_task.id,'task_type',selected_task.task_type,'attempt',selected_task.attempt,'budget_limit_cents',selected_task.budget_limit_cents,'max_attempts',selected_task.max_attempts,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'episode_id',episode.id,'account_id',account.id,'blueprint_version_id',episode.blueprint_version_id,'allowed_asset_root',coalesce(local_identity.episode_asset_root(episode.id),''),'input_snapshot',selected_task.input_snapshot || jsonb_build_object('prompt_context', coalesce(selected_task.input_snapshot -> 'prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot))))
  from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
  token := gen_random_uuid();
  update public.tasks set lease_token=token where id=selected_task.id;
  update public.task_runs set lease_token=token,task_package=task_package||jsonb_build_object('lease_token',token)
   where task_runs.task_id=selected_task.id and task_runs.attempt=selected_task.attempt;
  return query select selected_task.id,selected_task.task_type,selected_task.attempt,selected_task.budget_limit_cents,selected_task.max_attempts,selected_task.provider,selected_task.model,selected_task.prompt_version,episode.id,account.id,episode.blueprint_version_id,episode.title,coalesce(local_identity.episode_asset_root(episode.id),''),selected_task.input_snapshot || jsonb_build_object('prompt_context', coalesce(selected_task.input_snapshot -> 'prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot))),token from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
    END start_attempt;
    IF p_input_only THEN select nextval('local_identity.input_dispatch_turn') into next_turn; ELSE update public.worker_scheduler_settings set turn=turn+1 where singleton returning turn into next_turn; END IF;
    insert into public.worker_episode_turns(episode_id,last_turn) values(candidate.episode_id,next_turn)
      on conflict on constraint worker_episode_turns_pkey do update set last_turn=excluded.last_turn;
    return;
  end loop;
end;
$function$;

REVOKE ALL ON FUNCTION local_identity.claim_scheduled_worker_task(uuid,integer,boolean) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;

CREATE OR REPLACE FUNCTION local_identity.claim_managed_worker_task(p_task_id uuid DEFAULT NULL::uuid,p_worker_capacity integer DEFAULT 1)
 RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role is required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM local_identity.claim_scheduled_worker_task(p_task_id,p_worker_capacity,true);
END;
$function$;

REVOKE ALL ON FUNCTION local_identity.claim_managed_worker_task(uuid,integer) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.claim_managed_worker_task(uuid,integer) TO loop_worker;

CREATE OR REPLACE FUNCTION public.claim_next_worker_task(p_task_id uuid DEFAULT NULL::uuid,p_worker_capacity integer DEFAULT 1)
 RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role is required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM local_identity.claim_scheduled_worker_task(p_task_id,p_worker_capacity,false);
END;
$function$;

DROP FUNCTION local_identity.claim_input_task(uuid,integer);

DROP FUNCTION local_identity.claim_input_task_pre_lease(uuid,integer);

DROP FUNCTION public.claim_next_worker_task_pre_lease(uuid,integer);

DROP FUNCTION public.claim_next_worker_task_legacy(uuid);

CREATE OR REPLACE FUNCTION local_identity.input_task_allowed(p_episode_id uuid,p_task_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
SELECT (((EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=p_episode_id AND e.enabled AND (p_task_type='draft_storyboard_revision' OR NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.episode_id=p_episode_id AND t.task_type='draft_storyboard_revision' AND t.invalidated_at IS NULL AND t.status IN ('ready','running'))) AND (p_task_type='prepare_visual_brief' OR (e.storyboard_enabled AND p_task_type IN ('draft_storyboard','draft_storyboard_revision')) OR (e.narration_enabled AND p_task_type='generate_narration') OR (e.media_enabled AND p_task_type IN ('generate_shot_video','search_shot_video','preview_shot_video','generate_a_roll','generate_b_roll','generate_soundtrack','extract_embedded_audio')) OR (e.alignment_enabled AND p_task_type='align_shot_captions') OR (e.preview_enabled AND p_task_type='generate_shot_sync_preview') OR (e.studio_enabled AND p_task_type='generate_review_render') OR (e.delivery_enabled AND p_task_type='generate_final_render')))) OR (p_task_type='prepare_publish_package' AND EXISTS(SELECT 1 FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id WHERE e.id=p_episode_id AND e.archived_at IS NULL AND e.stage<>'production_completed'))) OR (p_task_type='generate_static_visual' AND EXISTS(SELECT 1 FROM local_identity.input_episodes WHERE episode_id=p_episode_id AND enabled AND media_enabled))
) AND NOT local_identity.is_recycled_episode(p_episode_id)
$function$;

DROP FUNCTION local_identity.input_task_allowed_before_images(uuid,text);
DROP FUNCTION local_identity.input_task_allowed_before_workspace_delivery(uuid,text);

CREATE OR REPLACE FUNCTION local_identity.input_media_connection(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_version_id uuid)
 RETURNS TABLE(version_id uuid,provider text,adapter text,endpoint text,secret_ref uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 IF EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests r WHERE r.task_id=p_task_id) THEN
  IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
  PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
  IF NOT EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests r WHERE r.task_id=p_task_id AND local_identity.workspace_task_preparation_current(p_task_id,r.workspace_id)) THEN RAISE EXCEPTION 'Pexels production preparation is stale' USING ERRCODE='55000';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND t.task_type='generate_soundtrack' AND EXISTS(SELECT 1 FROM local_identity.workspace_audio_requests r WHERE r.task_id=t.id)) THEN
 RETURN QUERY SELECT cv.id,cv.provider,cv.adapter,cv.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.media_enabled
 JOIN public.external_connection_versions cv ON cv.id=p_version_id AND cv.provider=t.provider AND cv.adapter=t.input_snapshot#>>'{executor,adapter}' AND cv.revoked_at IS NULL
 JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=i.owner_id
 JOIN local_identity.connection_bindings b ON b.version_id=cv.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=cv.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.input_snapshot->>'credential_ref'=cv.id::text AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=cv.id AND pe.owner_id=i.owner_id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen audio connection unavailable';END IF;
 ELSIF EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND t.input_snapshot#>>'{production_selection,capability}'='video') THEN
 RETURN QUERY SELECT cv.id,cv.provider,cv.adapter,cv.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.media_enabled
 JOIN public.external_connection_versions cv ON cv.id=p_version_id AND cv.provider=t.provider AND cv.adapter=t.input_snapshot#>>'{executor,adapter}' AND cv.revoked_at IS NULL
 JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=i.owner_id
 JOIN local_identity.connection_bindings b ON b.version_id=cv.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=cv.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.input_snapshot->>'credential_ref'=cv.id::text AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=cv.id AND pe.owner_id=i.owner_id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen video connection unavailable';END IF;
 ELSIF EXISTS(SELECT 1 FROM public.tasks task WHERE task.id=p_task_id AND task.task_type='generate_static_visual' AND task.provider='openai') THEN
 RETURN QUERY SELECT v.id,v.provider,v.adapter,v.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.media_enabled
 JOIN public.external_connection_versions v ON v.id=p_version_id AND v.provider='openai' AND v.adapter='openai_images' AND v.revoked_at IS NULL
 JOIN public.external_connections c ON c.id=v.connection_id AND c.created_by=i.owner_id
 JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=v.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.input_snapshot->>'credential_ref'=v.id::text AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen image connection unavailable';END IF;
 ELSE
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
 END IF;
END;

$function$;

DROP FUNCTION local_identity.input_media_connection_before_audio_selection(uuid,integer,uuid,uuid);

DROP FUNCTION local_identity.input_media_connection_before_video_selection(uuid,integer,uuid,uuid);

DROP FUNCTION local_identity.input_media_connection_before_images(uuid,integer,uuid,uuid);

CREATE OR REPLACE FUNCTION local_identity.record_workspace_narration_submission(p_task_id uuid, p_attempt integer, p_lease_token uuid, p_outcome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 IF p_outcome NOT IN ('received','rejected') THEN RAISE EXCEPTION 'Invalid submission result'; END IF;
 UPDATE local_identity.workspace_narration_submissions SET outcome=p_outcome WHERE task_id=p_task_id AND attempt=p_attempt AND outcome='started';
 UPDATE local_identity.workspace_narration_submissions SET outcome=p_outcome
 WHERE task_id=p_task_id AND outcome='started' AND EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts f WHERE f.task_id=p_task_id AND f.attempt=p_attempt AND f.lease_token=p_lease_token AND f.phase='dispatching');
 UPDATE local_identity.provider_dispatch_facts SET phase=p_outcome,updated_at=clock_timestamp() WHERE task_id=p_task_id AND attempt=p_attempt AND lease_token=p_lease_token AND phase='dispatching';
END
$function$;

DROP FUNCTION local_identity.record_workspace_narration_submission_before_dispatch_facts(uuid,integer,uuid,text);

CREATE OR REPLACE FUNCTION local_identity.record_workspace_visual_submission(p_task uuid, p_attempt integer, p_lease uuid, p_outcome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 IF p_outcome NOT IN ('received','rejected') THEN RAISE EXCEPTION 'Invalid submission outcome'; END IF;
 UPDATE local_identity.workspace_visual_submissions SET outcome=p_outcome WHERE task_id=p_task;
 UPDATE local_identity.provider_dispatch_facts SET phase=p_outcome,updated_at=clock_timestamp() WHERE task_id=p_task AND attempt=p_attempt AND lease_token=p_lease AND phase='dispatching';
END
$function$;

DROP FUNCTION local_identity.record_workspace_visual_submission_before_dispatch_facts(uuid,integer,uuid,text);

ALTER FUNCTION local_identity.reserve_workspace_narration_submission_legacy(uuid,integer,uuid) RENAME TO reject_unsupported_narration_submission;

CREATE OR REPLACE FUNCTION local_identity.reserve_workspace_narration_submission(p_task_id uuid, p_attempt integer, p_lease_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r local_identity.workspace_narration_requests;t public.tasks;aid uuid;BEGIN
 SELECT * INTO r FROM local_identity.workspace_narration_requests WHERE task_id=p_task_id;
 IF r.request_snapshot->>'selectionVersion' IS DISTINCT FROM '1' THEN RETURN local_identity.reject_unsupported_narration_submission(p_task_id,p_attempt,p_lease_token);END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 PERFORM pg_advisory_xact_lock(hashtextextended(r.workspace_id::text||r.shot_id,0));
 IF NOT local_identity.provider_dispatch_context_current(p_task_id,'speech') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests x JOIN local_identity.workspace_narration_submissions s ON s.task_id=x.task_id JOIN public.tasks other_task ON other_task.id=x.task_id WHERE x.workspace_id=r.workspace_id AND x.shot_id=r.shot_id AND x.task_id<>p_task_id AND s.outcome IN ('started','received') AND other_task.status<>'completed'
  AND NOT local_identity.provider_request_not_sent(x.task_id)
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests child
   WHERE child.workspace_id=x.workspace_id AND child.shot_id=x.shot_id AND child.request_snapshot->>'retryOfTaskId'=x.task_id::text)) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions WHERE task_id=p_task_id) THEN RETURN false;END IF;
 SELECT * INTO t FROM public.tasks WHERE id=p_task_id;SELECT account_id INTO aid FROM public.episodes WHERE id=t.episode_id;
 INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents) VALUES(t.id,aid,'narration',t.budget_limit_cents); 
 INSERT INTO local_identity.workspace_narration_submissions(task_id,attempt,outcome) VALUES(p_task_id,p_attempt,'started') ON CONFLICT DO NOTHING;RETURN FOUND;
END $function$
;

CREATE OR REPLACE FUNCTION local_identity.execute_managed_worker_command(p_name text,p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE delivery_task public.tasks;d local_identity.workspace_deliveries;candidate_artifact jsonb;pack jsonb;oldstage public.episode_stage;
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501'; END IF;
 IF p_name='report_worker_result' AND p_args#>>'{p_result,status}' IS DISTINCT FROM 'completed'
 AND EXISTS(SELECT 1 FROM local_identity.native_output_publications WHERE task_id=(p_args->>'p_task_id')::uuid) THEN
  RAISE EXCEPTION 'Native output publication outcome is pending' USING ERRCODE='55000';
 END IF;

 SELECT * INTO d FROM local_identity.workspace_deliveries WHERE task_id=(p_args->>'p_task_id')::uuid;
 IF NOT FOUND THEN
 DECLARE selected_task_id uuid:=(p_args->>'p_task_id')::uuid; frozen jsonb; paths text[]; authority jsonb;
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=selected_task_id AND local_identity.input_task_allowed(t.episode_id,t.task_type)) THEN RAISE EXCEPTION 'Managed input Worker task required' USING ERRCODE='42501'; END IF;
 IF p_name='refresh_worker_task_lease' THEN PERFORM public.refresh_worker_task_lease(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid);
 ELSIF p_name='report_worker_progress' THEN PERFORM public.report_worker_progress(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid,p_args->'p_progress');
 ELSIF p_name='report_worker_result' THEN
  IF p_args#>>'{p_result,status}'='completed' THEN
   PERFORM public.assert_worker_lease(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid);
   SELECT input_snapshot->'output' INTO frozen FROM public.tasks WHERE id=selected_task_id;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_args#>'{p_result,artifacts}') a WHERE a->>'artifactType'=frozen#>>'{required_artifact_types,0}' AND a->>'relativePath'=frozen->>'relative_path') THEN RAISE EXCEPTION 'Completed result requires the frozen primary path' USING ERRCODE='22023'; END IF;
   SELECT array_agg(a->>'relativePath') INTO paths FROM jsonb_array_elements(p_args#>'{p_result,artifacts}') a;
   authority:=local_identity.native_output_authority(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid,paths);
   IF jsonb_array_length(authority->'conflicts')>0 THEN RAISE EXCEPTION 'Output path is indexed by another task' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_args#>>'{p_result,status}'='completed' AND EXISTS(SELECT 1 FROM public.tasks WHERE id=selected_task_id AND provider IN ('bailian','volcengine','minimax','kling')) THEN
 PERFORM local_identity.register_wan_material(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid,p_args#>>'{p_result,artifacts,0,relativePath}',p_args#>>'{p_result,artifacts,0,sha256}',(p_args#>>'{p_result,artifacts,0,fileSize}')::bigint);
 END IF;
 PERFORM public.report_worker_result(selected_task_id,(p_args->>'p_attempt')::integer,p_args->'p_result',(p_args->>'p_lease_token')::uuid);
 ELSE RAISE EXCEPTION 'Unsupported Worker command' USING ERRCODE='22023'; END IF;
 RETURN 'null'::jsonb;
END;
 END IF;
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501'; END IF;
 -- Match Owner lock order: episode, workspace, task. Completion cannot race editing.
 PERFORM id FROM public.episodes WHERE id=d.episode_id FOR UPDATE;
 PERFORM id FROM local_identity.production_workspaces WHERE id=d.workspace_id FOR UPDATE;
 SELECT * INTO delivery_task FROM public.tasks WHERE id=d.task_id FOR UPDATE;
 IF p_name='refresh_worker_task_lease' THEN PERFORM public.refresh_worker_task_lease(delivery_task.id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid);
 ELSIF p_name='report_worker_progress' THEN PERFORM public.report_worker_progress(delivery_task.id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid,p_args->'p_progress');
 ELSIF p_name='report_worker_result' THEN
  IF p_args#>>'{p_result,status}'='completed' THEN
   IF NOT local_identity.workspace_delivery_current(d.workspace_id,d.export_id) THEN RAISE EXCEPTION 'Confirmed export changed before delivery completion' USING ERRCODE='22023'; END IF;
   IF p_args#>'{p_result,deliveryIdentity}' IS DISTINCT FROM delivery_task.input_snapshot#>'{workspace_delivery,identity}' THEN RAISE EXCEPTION 'Result identity mismatch' USING ERRCODE='22023'; END IF;
   SELECT value INTO pack FROM jsonb_array_elements(p_args#>'{p_result,artifacts}') entry(value) WHERE value->>'artifactType'='publish_package';
   IF pack->>'relativePath' IS DISTINCT FROM delivery_task.input_snapshot#>>'{output,relative_path}' OR jsonb_array_length(p_args#>'{p_result,artifacts}')<>4 THEN RAISE EXCEPTION 'Delivery manifest mismatch' USING ERRCODE='22023'; END IF;
   FOR candidate_artifact IN SELECT value FROM jsonb_array_elements(delivery_task.input_snapshot#>'{workspace_delivery,artifacts}') entry(value) WHERE value->>'artifactType' IN ('cover','metadata','final_qc_report') LOOP
    IF NOT (p_args#>'{p_result,artifacts}') @> jsonb_build_array(candidate_artifact) THEN RAISE EXCEPTION 'Delivery inputs mismatch' USING ERRCODE='22023'; END IF;
   END LOOP;
  END IF;
  PERFORM public.report_worker_result(delivery_task.id,(p_args->>'p_attempt')::integer,p_args->'p_result',(p_args->>'p_lease_token')::uuid);
  IF p_args#>>'{p_result,status}'='completed' THEN
   SELECT stage INTO oldstage FROM public.episodes WHERE id=d.episode_id FOR UPDATE;
   UPDATE public.episodes SET stage='production_completed',updated_at=clock_timestamp() WHERE id=d.episode_id;
   INSERT INTO public.state_transitions(episode_id,from_stage,to_stage,reason) VALUES(d.episode_id,oldstage,'production_completed','Exact workspace delivery package verified.');
   INSERT INTO public.audit_events(account_id,episode_id,event_type,payload) SELECT account_id,id,'publish_package_verified',jsonb_build_object('task_id',delivery_task.id,'export_id',d.export_id,'sha256',pack->>'sha256','to_stage','production_completed','protocol','publish-package/v2') FROM public.episodes WHERE id=d.episode_id;
  END IF;
 ELSE RAISE EXCEPTION 'Unsupported Worker command' USING ERRCODE='22023'; END IF;
 RETURN 'null'::jsonb;
END
$function$;

REVOKE ALL ON FUNCTION local_identity.execute_managed_worker_command(text,jsonb) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.execute_managed_worker_command(text,jsonb) TO loop_worker;

DROP FUNCTION local_identity.input_worker_call(text,jsonb);

DROP FUNCTION local_identity.input_worker_call_before_publication_fence(text,jsonb);

DROP FUNCTION local_identity.input_worker_call_before_workspace_delivery(text,jsonb);

CREATE OR REPLACE FUNCTION local_identity.initialize_historical_shot_inputs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
<<seed_drafts>>
declare
  episode_record public.episodes;
  package_record public.review_packages;
  narration_policy jsonb;
  voice jsonb;
  shot jsonb;
  previous public.shot_preparation_drafts;
begin
  if new.stage <> 'storyboard_approved' or new.decision <> 'approved' or new.review_package_id is null then EXIT seed_drafts; end if;
  select episode.* into episode_record from public.episodes episode where episode.id = new.episode_id;
  select package.* into package_record
  from public.review_packages package
  where package.id = new.review_package_id
    and package.episode_id = new.episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null;
  if not found or episode_record.stage <> 'storyboard_approved' then EXIT seed_drafts; end if;

  narration_policy := (select blueprint.policy -> 'narration' from public.account_blueprint_versions blueprint where blueprint.id = episode_record.blueprint_version_id);
  voice := narration_policy -> 'voice';
  for shot in select value from jsonb_array_elements(coalesce(package_record.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    select draft.* into previous
    from public.shot_preparation_drafts draft
    where draft.episode_id = episode_record.id
      and draft.shot_id = shot ->> 'id'
      and draft.input_fingerprint = md5(shot::text)
    order by draft.updated_at desc
    limit 1;
    insert into public.shot_preparation_drafts (episode_id, review_package_id, shot_id, input_fingerprint, audio_mode, video_status, audio_status, confirmation_status, subtitle_text, subtitles_enabled, tts_voice, tts_speaking_rate, current_video_artifact_id, current_video_task_id, current_audio_track_id, current_tts_task_id, selected_material_revision_id, clip_start_seconds, clip_end_seconds, video_duration_seconds, tts_actual_duration_seconds, warning_decision, warning_reason, warning_accepted_at, warning_accepted_by, confirmation_reason, confirmed_at, confirmed_by, skipped_at, skipped_by)
    values (episode_record.id, package_record.id, shot ->> 'id', md5(shot::text), coalesce(previous.audio_mode, 'tts'), case when previous.current_video_artifact_id is not null then 'ready' else 'pending' end, case when coalesce(previous.audio_mode, 'tts') = 'none' or previous.current_audio_track_id is not null then 'ready' else 'pending' end, case when previous.id is not null and previous.confirmation_status in ('confirmed', 'skipped') then previous.confirmation_status else 'pending' end, coalesce(previous.subtitle_text, btrim(shot ->> 'scriptSegment')), coalesce(previous.subtitles_enabled, true), coalesce(previous.tts_voice, nullif(btrim(voice ->> 'name'), '')), coalesce(previous.tts_speaking_rate, case when (voice ->> 'speaking_rate') ~ '^[0-9]+([.][0-9]+)?$' then (voice ->> 'speaking_rate')::numeric else null end), previous.current_video_artifact_id, previous.current_video_task_id, previous.current_audio_track_id, previous.current_tts_task_id, previous.selected_material_revision_id, previous.clip_start_seconds, previous.clip_end_seconds, previous.video_duration_seconds, previous.tts_actual_duration_seconds, coalesce(previous.warning_decision, 'not_required'), previous.warning_reason, previous.warning_accepted_at, previous.warning_accepted_by, previous.confirmation_reason, previous.confirmed_at, previous.confirmed_by, previous.skipped_at, previous.skipped_by)
    on conflict (episode_id, review_package_id, shot_id) do nothing;
  end loop;

  insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds)
  select episode_record.id, old_track.source_task_id, old_track.source_artifact_id, package_record.id, old_track.track_kind, old_track.cue_id, old_track.relative_path, old_track.sha256, old_track.file_size, old_track.start_seconds, old_track.duration_seconds
  from public.shot_preparation_drafts current_draft
  join public.shot_preparation_drafts old_draft on old_draft.episode_id = current_draft.episode_id and old_draft.shot_id = current_draft.shot_id and old_draft.input_fingerprint = current_draft.input_fingerprint and old_draft.review_package_id <> current_draft.review_package_id
  join public.audio_tracks old_track on old_track.id = old_draft.current_audio_track_id
  where current_draft.review_package_id = package_record.id
    and not exists (
      select 1 from public.audio_tracks existing
      where existing.episode_id = episode_record.id
        and existing.source_review_package_id = package_record.id
        and existing.track_kind = old_track.track_kind
        and existing.cue_id = old_track.cue_id
        and existing.source_task_id = old_track.source_task_id
        and existing.source_artifact_id = old_track.source_artifact_id
    );

  update public.shot_preparation_drafts current_draft
  set current_audio_track_id = new_track.id, audio_status = 'ready', updated_at = now()
  from public.shot_preparation_drafts old_draft
  join public.audio_tracks old_track on old_track.id = old_draft.current_audio_track_id
  join public.audio_tracks new_track on new_track.episode_id = episode_record.id and new_track.source_review_package_id = package_record.id and new_track.source_task_id = old_track.source_task_id and new_track.cue_id = old_track.cue_id
  where current_draft.review_package_id = package_record.id
    and old_draft.episode_id = current_draft.episode_id
    and old_draft.shot_id = current_draft.shot_id
    and old_draft.input_fingerprint = current_draft.input_fingerprint
    and old_draft.review_package_id <> current_draft.review_package_id;
  EXIT seed_drafts;
END seed_drafts;
<<reuse_bindings>>
declare
  package_record public.review_packages;
  episode_record public.episodes;
  shot jsonb;
  previous public.shot_preparation_drafts;
  old_track public.audio_tracks;
  reusable_video boolean;
  reusable_audio boolean;
  new_track public.audio_tracks;
  operation_kind text;
  operation_shot_id text;
  preserve_duration_inputs boolean;
  preserve_type_inputs boolean;
begin
  if new.stage <> 'storyboard_approved' or new.decision <> 'approved' or new.review_package_id is null then EXIT reuse_bindings; end if;

  select episode.* into episode_record from public.episodes episode where episode.id = new.episode_id;
  select package.* into package_record
  from public.review_packages package
  where package.id = new.review_package_id
    and package.episode_id = new.episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null;
  if not found or episode_record.stage <> 'storyboard_approved' then EXIT reuse_bindings; end if;

  operation_kind := coalesce(package_record.context_snapshot #>> '{storyboard_revision,operation,kind}', '');
  operation_shot_id := nullif(btrim(package_record.context_snapshot #>> '{storyboard_revision,operation,shotId}'), '');

  for shot in select value from jsonb_array_elements(coalesce(package_record.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    preserve_duration_inputs := operation_kind = 'change_duration' and operation_shot_id = shot ->> 'id';
    preserve_type_inputs := operation_kind = 'change_type' and operation_shot_id = shot ->> 'id';

    select draft.* into previous
    from public.shot_preparation_drafts draft
    where draft.episode_id = episode_record.id
      and draft.shot_id = shot ->> 'id'
      and draft.review_package_id <> package_record.id
      and (
        draft.input_fingerprint = md5(shot::text)
        or preserve_duration_inputs
        or preserve_type_inputs
      )
    order by (draft.input_fingerprint = md5(shot::text)) desc, draft.updated_at desc, draft.id desc
    limit 1;
    if not found then continue; end if;

    reusable_video := not preserve_type_inputs
      and previous.current_video_artifact_id is not null
      and previous.current_video_task_id is not null
      and exists (
        select 1
        from public.artifacts artifact
        join public.tasks task on task.id = previous.current_video_task_id
        where artifact.id = previous.current_video_artifact_id
          and artifact.producer_task_id = task.id
          and artifact.episode_id = episode_record.id
          and task.episode_id = episode_record.id
          and task.status = 'completed'
          and task.invalidated_at is null
      );

    select track.* into old_track
    from public.audio_tracks track
    join public.tasks task on task.id = track.source_task_id
    join public.artifacts artifact on artifact.id = track.source_artifact_id
    where (not preserve_type_inputs or previous.audio_mode = 'tts')
      and track.id = previous.current_audio_track_id
      and track.episode_id = episode_record.id
      and track.cue_id = previous.shot_id
      and task.status = 'completed'
      and task.invalidated_at is null
      and artifact.episode_id = episode_record.id
      and artifact.sha256 = track.sha256
      and artifact.file_size = track.file_size;
    reusable_audio := found;

    if reusable_audio then
      insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds)
      select episode_record.id, old_track.source_task_id, old_track.source_artifact_id, package_record.id, old_track.track_kind, old_track.cue_id, old_track.relative_path, old_track.sha256, old_track.file_size, old_track.start_seconds, old_track.duration_seconds
      where not exists (
        select 1 from public.audio_tracks existing
        where existing.episode_id = episode_record.id
          and existing.source_review_package_id = package_record.id
          and existing.track_kind = old_track.track_kind
          and existing.cue_id = old_track.cue_id
          and existing.source_task_id = old_track.source_task_id
          and existing.source_artifact_id = old_track.source_artifact_id
      );
      select track.* into new_track
      from public.audio_tracks track
      where track.episode_id = episode_record.id
        and track.source_review_package_id = package_record.id
        and track.source_task_id = old_track.source_task_id
        and track.cue_id = old_track.cue_id
      order by track.created_at desc, track.id desc
      limit 1;
    else
      new_track := null;
    end if;

    update public.shot_preparation_drafts draft
    set audio_mode = previous.audio_mode,
        video_status = case when reusable_video then 'ready' else 'pending' end,
        audio_status = case when previous.audio_mode = 'none' or reusable_audio then 'ready' else 'pending' end,
        confirmation_status = case when preserve_duration_inputs or preserve_type_inputs then 'pending' else previous.confirmation_status end,
        subtitle_text = previous.subtitle_text,
        subtitles_enabled = previous.subtitles_enabled,
        tts_voice = previous.tts_voice,
        tts_speaking_rate = previous.tts_speaking_rate,
        tts_text = previous.tts_text,
        tts_language_code = previous.tts_language_code,
        tts_override_voice = previous.tts_override_voice,
        tts_override_speaking_rate = previous.tts_override_speaking_rate,
        tts_text_confirmation_fingerprint = previous.tts_text_confirmation_fingerprint,
        tts_text_confirmed_at = previous.tts_text_confirmed_at,
        tts_text_confirmed_by = previous.tts_text_confirmed_by,
        selected_material_revision_id = case when preserve_type_inputs then null else previous.selected_material_revision_id end,
        clip_start_seconds = case when preserve_type_inputs then null else previous.clip_start_seconds end,
        clip_end_seconds = case when preserve_type_inputs then null else previous.clip_end_seconds end,
        clip_segments = case when preserve_type_inputs then '[]'::jsonb else previous.clip_segments end,
        video_duration_seconds = case when preserve_type_inputs then null else previous.video_duration_seconds end,
        current_video_artifact_id = case when reusable_video then previous.current_video_artifact_id else null end,
        current_video_task_id = case when reusable_video then previous.current_video_task_id else null end,
        current_audio_track_id = case when new_track.id is not null then new_track.id else null end,
        current_tts_task_id = case when previous.audio_mode = 'tts' and new_track.id is not null then new_track.source_task_id else null end,
        pending_video_task_id = null,
        pending_tts_task_id = null,
        pending_source_audio_task_id = null,
        video_error = null,
        tts_actual_duration_seconds = case when reusable_audio then previous.tts_actual_duration_seconds else null end,
        tts_error = case when reusable_audio then previous.tts_error else null end,
        source_audio_duration_seconds = case when reusable_audio then previous.source_audio_duration_seconds else null end,
        source_audio_error = case when reusable_audio then previous.source_audio_error else null end,
        warning_decision = case when preserve_duration_inputs or preserve_type_inputs then 'not_required' else previous.warning_decision end,
        warning_reason = case when preserve_duration_inputs or preserve_type_inputs then null else previous.warning_reason end,
        warning_accepted_at = case when preserve_duration_inputs or preserve_type_inputs then null else previous.warning_accepted_at end,
        warning_accepted_by = case when preserve_duration_inputs or preserve_type_inputs then null else previous.warning_accepted_by end,
        confirmation_reason = case when preserve_duration_inputs or preserve_type_inputs then null else previous.confirmation_reason end,
        confirmed_at = case when preserve_duration_inputs or preserve_type_inputs then null else previous.confirmed_at end,
        confirmed_by = case when preserve_duration_inputs or preserve_type_inputs then null else previous.confirmed_by end,
        skipped_at = case when preserve_duration_inputs or preserve_type_inputs then null else previous.skipped_at end,
        skipped_by = case when preserve_duration_inputs or preserve_type_inputs then null else previous.skipped_by end,
        frozen_at = null,
        frozen_by = null,
        updated_at = now()
    where draft.episode_id = episode_record.id
      and draft.review_package_id = package_record.id
      and draft.shot_id = shot ->> 'id';
  end loop;
  EXIT reuse_bindings;
END reuse_bindings;
RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION local_identity.initialize_historical_shot_inputs() FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;

DROP TRIGGER seed_shot_preparation_drafts_after_storyboard_approval ON public.approvals;
DROP TRIGGER zz_reuse_shot_preparation_history_after_storyboard_approval ON public.approvals;
CREATE TRIGGER initialize_historical_shot_inputs_after_approval AFTER INSERT ON public.approvals FOR EACH ROW EXECUTE FUNCTION local_identity.initialize_historical_shot_inputs();
DROP FUNCTION public.seed_shot_preparation_drafts_after_storyboard_approval();
DROP FUNCTION public.reuse_shot_preparation_history_after_storyboard_approval();

CREATE OR REPLACE FUNCTION local_identity.validate_historical_visual_receipt(p_task public.tasks)
 RETURNS TABLE(current_episode public.episodes,produced_artifact public.artifacts,completed_run public.task_runs)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 required_artifact_type text; primary_artifact_type text;
BEGIN
  select * into current_episode from public.episodes where id = p_task.episode_id for update;
  if current_episode.stage <> 'visual_draft' then
    raise exception 'Visual asset preparation can only complete from visual_draft' using errcode = '22023';
  end if;
  select * into completed_run
  from public.task_runs
  where task_id = p_task.id and attempt = p_task.attempt - 1 and status = 'completed';
  if not found then
    raise exception 'Completed visual asset preparation task run is missing' using errcode = '22023';
  end if;
  if jsonb_typeof(p_task.input_snapshot #> '{output,required_artifact_types}') <> 'array' then
    raise exception 'Visual asset preparation task has invalid required artifact types' using errcode = '22023';
  end if;
  for required_artifact_type in
    select jsonb_array_elements_text(p_task.input_snapshot #> '{output,required_artifact_types}')
  loop
    if coalesce(btrim(required_artifact_type), '') = '' then
      raise exception 'Visual asset preparation task has an empty required artifact type' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.artifacts artifact
      join lateral jsonb_array_elements(completed_run.result -> 'artifacts') result_artifact on true
      where artifact.producer_task_id = p_task.id
        and artifact.artifact_type = required_artifact_type
        and result_artifact ->> 'artifactType' = artifact.artifact_type
        and result_artifact ->> 'relativePath' = artifact.relative_path
        and result_artifact ->> 'sha256' = artifact.sha256
        and (result_artifact ->> 'fileSize')::bigint = artifact.file_size
    ) then
      raise exception 'Visual asset preparation task is missing required % artifact revision', required_artifact_type using errcode = '22023';
    end if;
  end loop;

  primary_artifact_type := case
    when p_task.input_snapshot #> '{output,required_artifact_types}' @> jsonb_build_array('visual_asset_manifest') then 'visual_asset_manifest'
    else 'visual_brief'
  end;
  select * into produced_artifact
  from public.artifacts
  where producer_task_id = p_task.id
    and artifact_type = primary_artifact_type
    and relative_path = p_task.input_snapshot #>> '{output,relative_path}';
  if not found then
    raise exception 'Visual asset preparation task is missing its frozen % artifact revision', primary_artifact_type using errcode = '22023';
  end if;


RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION local_identity.validate_historical_visual_receipt(public.tasks) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;

CREATE OR REPLACE FUNCTION local_identity.project_historical_visual_receipt(p_task public.tasks,current_episode public.episodes,produced_artifact public.artifacts,completed_run public.task_runs)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE next_revision integer; created_package public.review_packages;
BEGIN
  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.review_packages
  where episode_id = p_task.episode_id and stage = 'visual_review';

  insert into public.review_packages (
    episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot
  ) values (
    p_task.episode_id,
    p_task.id,
    completed_run.id,
    produced_artifact.id,
    'visual_review',
    next_revision,
    p_task.input_snapshot || jsonb_build_object(
      'task_package', completed_run.task_package,
      'worker_result', completed_run.result,
      'artifact', jsonb_build_object(
        'id', produced_artifact.id,
        'relative_path', produced_artifact.relative_path,
        'sha256', produced_artifact.sha256,
        'file_size', produced_artifact.file_size
      ),
      'generated_artifacts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', artifact.id,
          'artifact_type', artifact.artifact_type,
          'relative_path', artifact.relative_path,
          'sha256', artifact.sha256,
          'file_size', artifact.file_size
        ) order by artifact.created_at, artifact.id)
        from public.artifacts artifact
        where artifact.producer_task_id = p_task.id
      ), '[]'::jsonb)
    )
  ) returning * into created_package;

  update public.episodes set stage = 'visual_review', updated_at = now() where id = p_task.episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (p_task.episode_id, 'visual_draft', 'visual_review', 'Worker submitted a frozen visual asset review package.', null);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    p_task.episode_id,
    'visual_review_package_created',
    jsonb_build_object(
      'review_package_id', created_package.id,
      'task_id', p_task.id,
      'artifact_id', produced_artifact.id,
      'revision_number', next_revision
    ),
    null
  );
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION local_identity.project_historical_visual_receipt(public.tasks,public.episodes,public.artifacts,public.task_runs) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;

CREATE OR REPLACE FUNCTION local_identity.register_historical_visual_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE evidence record;
BEGIN

 IF EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.episode_id=NEW.episode_id) AND NOT (NEW.input_snapshot ? 'workspace_preparation' OR EXISTS(SELECT 1 FROM local_identity.workspace_deliveries x WHERE x.task_id=NEW.id)) THEN RETURN NEW; END IF;
  if new.task_type <> 'prepare_visual_brief' or new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;


SELECT * INTO evidence FROM local_identity.validate_historical_visual_receipt(NEW);
PERFORM local_identity.project_historical_visual_receipt(NEW,evidence.current_episode,evidence.produced_artifact,evidence.completed_run);
RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION local_identity.register_historical_visual_receipt() FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;

DROP TRIGGER create_visual_review_package_after_task_completion ON public.tasks;
CREATE TRIGGER create_visual_review_package_after_task_completion AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION local_identity.register_historical_visual_receipt();
DROP FUNCTION public.create_visual_review_package();

CREATE OR REPLACE FUNCTION local_identity.validate_historical_storyboard_receipt(p_task public.tasks)
 RETURNS TABLE(current_episode public.episodes,produced_artifact public.artifacts,completed_run public.task_runs)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 storyboard_shot jsonb;
BEGIN
  select * into current_episode from public.episodes where id = p_task.episode_id for update;
  if current_episode.stage <> 'storyboard_draft' then
    raise exception 'Storyboard planning task can only complete from storyboard_draft' using errcode = '22023';
  end if;
  select * into completed_run
  from public.task_runs
  where task_id = p_task.id and attempt = p_task.attempt - 1 and status = 'completed';
  if not found then
    raise exception 'Completed storyboard planning task run is missing' using errcode = '22023';
  end if;
  if jsonb_typeof(completed_run.result -> 'storyboard') <> 'object'
    or completed_run.result #>> '{storyboard,version}' <> 'storyboard/v1' then
    raise exception 'Storyboard planning task has invalid storyboard content' using errcode = '22023';
  end if;
  if jsonb_typeof(completed_run.result #> '{storyboard,shots}') <> 'array'
    or jsonb_array_length(completed_run.result #> '{storyboard,shots}') = 0 then
    raise exception 'Storyboard planning task has no reviewable shots' using errcode = '22023';
  end if;
  if exists (
    select 1
    from (
      select shot ->> 'id' as shot_id
      from jsonb_array_elements(completed_run.result #> '{storyboard,shots}') shot
    ) shot_ids
    group by shot_id
    having count(*) > 1
  ) then
    raise exception 'Storyboard planning task has duplicate shot IDs' using errcode = '22023';
  end if;
  for storyboard_shot in select value from jsonb_array_elements(completed_run.result #> '{storyboard,shots}')
  loop
    if jsonb_typeof(storyboard_shot) <> 'object'
      or coalesce(btrim(storyboard_shot ->> 'id'), '') = ''
      or coalesce(btrim(storyboard_shot ->> 'scriptSegment'), '') = ''
      or coalesce(btrim(storyboard_shot ->> 'productionMethod'), '') = ''
      or coalesce(btrim(storyboard_shot ->> 'targetSpec'), '') = ''
      or jsonb_typeof(storyboard_shot -> 'durationSeconds') <> 'number'
      or (storyboard_shot ->> 'durationSeconds')::numeric <= 0
      or storyboard_shot ->> 'shotType' not in ('a_roll', 'b_roll')
      or jsonb_typeof(storyboard_shot -> 'inputBasis') <> 'array'
      or jsonb_array_length(storyboard_shot -> 'inputBasis') = 0 then
      raise exception 'Storyboard planning task has an invalid shot' using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(storyboard_shot -> 'inputBasis') input_basis
      where jsonb_typeof(input_basis) <> 'object'
        or coalesce(btrim(input_basis ->> 'relativePath'), '') = ''
        or input_basis ->> 'sha256' !~ '^[0-9a-f]{64}$'
        or not exists (
          select 1 from jsonb_array_elements(p_task.input_snapshot -> 'input_artifacts') frozen_input
          where frozen_input ->> 'relativePath' = input_basis ->> 'relativePath'
            and frozen_input ->> 'sha256' = input_basis ->> 'sha256'
        )
    ) then
      raise exception 'Storyboard planning task references a non-frozen input' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from jsonb_array_elements(p_task.input_snapshot -> 'input_artifacts') frozen_input
      join jsonb_array_elements(storyboard_shot -> 'inputBasis') input_basis
        on input_basis ->> 'relativePath' = frozen_input ->> 'relativePath'
       and input_basis ->> 'sha256' = frozen_input ->> 'sha256'
      where frozen_input ->> 'artifactType' = 'main_script'
    ) then
      raise exception 'Storyboard shot must trace to the frozen main script' using errcode = '22023';
    end if;
    if (
      p_task.input_snapshot->'workspace_preparation' is null or exists (
        select 1 from jsonb_array_elements(p_task.input_snapshot->'input_artifacts') frozen_input
        where frozen_input->>'artifactType' <> 'main_script'
      )
    ) and not exists (
      select 1
      from jsonb_array_elements(p_task.input_snapshot -> 'input_artifacts') frozen_input
      join jsonb_array_elements(storyboard_shot -> 'inputBasis') input_basis
        on input_basis ->> 'relativePath' = frozen_input ->> 'relativePath'
       and input_basis ->> 'sha256' = frozen_input ->> 'sha256'
      where frozen_input ->> 'artifactType' <> 'main_script'
    ) then
      raise exception 'Storyboard shot must trace to approved visual inputs' using errcode = '22023';
    end if;
  end loop;

  select * into produced_artifact
  from public.artifacts
  where producer_task_id = p_task.id
    and artifact_type = 'storyboard'
    and relative_path = p_task.input_snapshot #>> '{output,relative_path}';
  if not found then
    raise exception 'Storyboard planning task is missing its frozen storyboard artifact revision' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(completed_run.result -> 'artifacts') result_artifact
    where result_artifact ->> 'artifactType' = produced_artifact.artifact_type
      and result_artifact ->> 'relativePath' = produced_artifact.relative_path
      and result_artifact ->> 'sha256' = produced_artifact.sha256
      and (result_artifact ->> 'fileSize')::bigint = produced_artifact.file_size
  ) then
    raise exception 'Storyboard artifact revision does not match the frozen worker result' using errcode = '22023';
  end if;


RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION local_identity.validate_historical_storyboard_receipt(public.tasks) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;

CREATE OR REPLACE FUNCTION local_identity.project_historical_storyboard_receipt(p_task public.tasks,current_episode public.episodes,produced_artifact public.artifacts,completed_run public.task_runs)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE next_revision integer; created_package public.review_packages;
BEGIN
  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.review_packages
  where episode_id = p_task.episode_id and stage = 'storyboard_review';

  insert into public.review_packages (
    episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot
  ) values (
    p_task.episode_id,
    p_task.id,
    completed_run.id,
    produced_artifact.id,
    'storyboard_review',
    next_revision,
    p_task.input_snapshot || jsonb_build_object(
      'task_package', completed_run.task_package,
      'worker_result', completed_run.result,
      'artifact', jsonb_build_object(
        'id', produced_artifact.id,
        'relative_path', produced_artifact.relative_path,
        'sha256', produced_artifact.sha256,
        'file_size', produced_artifact.file_size
      )
    )
  ) returning * into created_package;

  insert into public.storyboard_review_shots (review_package_id, shot_id)
  select created_package.id, btrim(shot ->> 'id')
  from jsonb_array_elements(completed_run.result #> '{storyboard,shots}') shot;

  update public.episodes set stage = 'storyboard_review', updated_at = now() where id = p_task.episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (p_task.episode_id, 'storyboard_draft', 'storyboard_review', 'Worker submitted a frozen storyboard review package.', null);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    p_task.episode_id,
    'storyboard_review_package_created',
    jsonb_build_object('review_package_id', created_package.id, 'task_id', p_task.id, 'artifact_id', produced_artifact.id, 'revision_number', next_revision),
    null
  );
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION local_identity.project_historical_storyboard_receipt(public.tasks,public.episodes,public.artifacts,public.task_runs) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;

CREATE OR REPLACE FUNCTION local_identity.register_historical_storyboard_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE evidence record;
BEGIN

 IF EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.episode_id=NEW.episode_id) AND NOT (NEW.input_snapshot ? 'workspace_preparation' OR EXISTS(SELECT 1 FROM local_identity.workspace_deliveries x WHERE x.task_id=NEW.id)) THEN RETURN NEW; END IF;
  if new.task_type <> 'draft_storyboard' or new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;


SELECT * INTO evidence FROM local_identity.validate_historical_storyboard_receipt(NEW);
PERFORM local_identity.project_historical_storyboard_receipt(NEW,evidence.current_episode,evidence.produced_artifact,evidence.completed_run);
RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION local_identity.register_historical_storyboard_receipt() FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;

DROP TRIGGER create_storyboard_review_package_after_task_completion ON public.tasks;
CREATE TRIGGER create_storyboard_review_package_after_task_completion AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION local_identity.register_historical_storyboard_receipt();
DROP FUNCTION public.create_storyboard_review_package();
