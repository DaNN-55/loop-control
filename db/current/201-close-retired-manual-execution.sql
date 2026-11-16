-- Close the retired manual execution surface (ADR-0066).
-- Retain historical rows, frozen files, function bodies used by internal history
-- adapters, committed receipts and output reconciliation; revoke external writes.
-- Current workspaces share task kinds with old orders, so admission uses actual
-- request records and preparation provenance instead of task names alone.

REVOKE ALL ON FUNCTION public.request_official_shot_video(uuid,uuid,text,uuid,text,integer,uuid,integer) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.request_wan_shot_video(uuid,uuid,text,uuid,text,integer,uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.resume_wan_video_task(uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.generate_shot_review_video(uuid,uuid,jsonb,boolean,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.request_review_render_revision(uuid,jsonb,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.register_owned_studio_freeze(uuid,uuid,jsonb) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.queue_owned_studio_render(uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.scope_input_studio_task(uuid,text,jsonb) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.create_qc_review_issue(uuid,text,numeric,text,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.resolve_qc_review_issue(uuid,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.request_qc_member_revision(uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.retry_owned_final_render(uuid,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.queue_owned_final_render(uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.complete_owned_publish(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.generate_shot_clip(uuid,uuid,text,boolean) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_manual_shot_clip(uuid,uuid,text,uuid,text,numeric,numeric) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.generate_shot_source_audio(uuid,uuid,text,boolean) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.request_shot_acoustic_alignment(uuid,uuid,text,boolean) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.generate_shot_sync_preview(uuid,uuid,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.confirm_shot_sync_preview(uuid,uuid,text,text,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_shot_manual_alignment(uuid,uuid,text,jsonb) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.retry_input_media(uuid,uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.scope_input_post_task(uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.register_manual_audio(uuid,uuid,text,uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.register_manual_episode_narration(uuid,uuid,uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_storyboard_audio_selection(uuid,uuid,text,text,text,text,uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_shot_workbench_composition_draft(uuid,uuid,text,uuid,jsonb,jsonb,numeric,text,text,boolean,text,text,numeric) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_shot_workbench_draft(uuid,uuid,text,uuid,jsonb,text,text,boolean,text,text,numeric) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.set_episode_audio_source_mode(uuid,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_episode_tts_settings(uuid,text,text,numeric) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean,text,text,numeric) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_shot_caption_contract(uuid,uuid,text,jsonb) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_shot_tts_override(uuid,uuid,text,text,numeric) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_shot_audio_mix(uuid,uuid,text,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.save_shot_transition_mode(uuid,uuid,text,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.create_audio_track_annotation(uuid,numeric,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.confirm_caption_text(uuid,uuid,text,uuid,text,text,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.retry_failed_final_render(uuid,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.transition_episode(uuid,public.episode_stage,text) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
REVOKE ALL ON FUNCTION public.record_publish_package_verification(uuid,text,bigint) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;

CREATE OR REPLACE FUNCTION local_identity.current_worker_task(p_task public.tasks) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT coalesce((p_task).provider,'')<>'codex'
 AND (p_task).task_type NOT IN ('draft_script','prepare_visual_brief','draft_storyboard','draft_storyboard_revision')
 AND EXISTS(
  SELECT 1 FROM local_identity.production_workspaces w
  JOIN public.episodes e ON e.id=w.episode_id
  JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=e.id AND p.script_revision_id=w.script_revision_id
  WHERE w.episode_id=(p_task).episode_id AND e.main_script_revision_id=w.script_revision_id
   AND e.archived_at IS NULL AND e.stage<>'production_completed'
   AND NOT local_identity.is_recycled_episode(e.id) AND NOT local_identity.is_historical_episode(e.id)
   AND local_identity.preparation_source_current(p.id)
   AND (
    EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates v WHERE v.task_id=(p_task).id AND v.workspace_id=w.id AND v.episode_id=e.id
     AND (p_task).task_type IN ('generate_static_visual','generate_shot_video','generate_a_roll','generate_b_roll')
     AND local_identity.workspace_task_preparation_current((p_task).id,w.id))
    OR EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests r WHERE r.task_id=(p_task).id AND r.workspace_id=w.id AND r.episode_id=e.id
     AND (p_task).provider='pexels' AND (p_task).task_type IN ('search_shot_video','preview_shot_video','generate_b_roll')
     AND local_identity.workspace_task_preparation_current((p_task).id,w.id))
    OR EXISTS(SELECT 1 FROM local_identity.workspace_audio_requests r JOIN local_identity.workspace_audio_preparations a ON a.id=r.preparation_id
     WHERE r.task_id=(p_task).id AND r.workspace_id=w.id AND r.episode_id=e.id AND a.workspace_id=w.id AND a.episode_id=e.id
      AND (p_task).task_type IN ('extract_embedded_audio','generate_soundtrack')
      AND local_identity.workspace_task_preparation_current((p_task).id,w.id))
    OR ((p_task).task_type='generate_narration' AND (p_task).prompt_version='production-request-v1' AND (p_task).input_snapshot->>'selectionVersion'='1'
     AND EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests r WHERE r.task_id=(p_task).id AND r.workspace_id=w.id AND r.episode_id=e.id
      AND CASE WHEN (p_task).input_snapshot ? 'workspace_narration' THEN
       (p_task).input_snapshot#>>'{workspace_narration,version}'='workspace-narration/v2'
       AND (p_task).input_snapshot#>>'{workspace_narration,workspace_id}'=w.id::text
       AND (p_task).input_snapshot#>>'{workspace_narration,preparation_revision_id}'=p.id::text
       AND (p_task).input_snapshot#>>'{workspace_narration,shot_id}'=r.shot_id
      ELSE p.source_format='storyboard/v1' AND (p_task).input_snapshot->>'storyboard_review_package_id'=p.source_reference_id::text END))
    OR ((p_task).task_type='align_shot_captions' AND (p_task).provider='whisperx'
     AND (p_task).input_snapshot#>>'{workspace_caption,workspace_id}'=w.id::text
     AND CASE WHEN (p_task).input_snapshot#>>'{workspace_caption,version}'='workspace-caption/v2' THEN
      (p_task).input_snapshot#>>'{workspace_caption,preparation_revision_id}'=p.id::text
      AND EXISTS(SELECT 1 FROM local_identity.production_shot_versions s WHERE s.preparation_revision_id=p.id AND s.episode_id=e.id AND s.shot_id=(p_task).input_snapshot#>>'{workspace_caption,shot_id}')
     ELSE NOT ((p_task).input_snapshot->'workspace_caption' ? 'version') AND p.source_format='storyboard/v1'
      AND (p_task).input_snapshot#>>'{shot_preparation,review_package_id}'=p.source_reference_id::text END)
    OR ((p_task).task_type='prepare_publish_package' AND (p_task).input_snapshot->>'capability'='workspace_delivery'
     AND EXISTS(SELECT 1 FROM local_identity.workspace_deliveries d WHERE d.task_id=(p_task).id AND d.workspace_id=w.id AND d.episode_id=e.id
      AND (p_task).input_snapshot#>>'{workspace_delivery,identity,workspaceId}'=w.id::text
      AND (p_task).input_snapshot#>>'{workspace_delivery,identity,exportId}'=d.export_id::text
      AND local_identity.workspace_delivery_current(w.id,d.export_id)))
   )
 )
$function$;

-- Recheck the provenance and exact lease before any execution or credential
-- lookup. Existing output reconciliation does not call this execution boundary.
CREATE OR REPLACE FUNCTION local_identity.assert_current_worker_execution(p_task uuid,p_attempt integer,p_lease uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501'; END IF;
 PERFORM public.assert_worker_lease(p_task,p_attempt,p_lease);
 IF NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task AND local_identity.current_worker_task(t)) THEN
  RAISE EXCEPTION 'Retired execution task; use the current production workspace' USING ERRCODE='55000';
 END IF;
END
$function$;
REVOKE ALL ON FUNCTION local_identity.assert_current_worker_execution(uuid,integer,uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.assert_current_worker_execution(uuid,integer,uuid) TO loop_worker;

CREATE OR REPLACE FUNCTION local_identity.claim_scheduled_worker_task(p_task_id uuid, p_worker_capacity integer, p_input_only boolean) RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb, lease_token uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  if (select count(*) from public.tasks where true and status='running'
      and claimed_at > clock_timestamp()-interval '30 minutes') >= p_worker_capacity then return; end if;

  for candidate in
    select task.*
    from public.tasks task left join public.worker_episode_turns turns on turns.episode_id=task.episode_id
    where (local_identity.current_worker_task(task) and local_identity.input_task_allowed(task.episode_id,task.task_type)) and task.status = 'ready' AND NOT EXISTS(SELECT 1 FROM local_identity.historical_tasks h WHERE h.task_id=task.id) and task.invalidated_at is null and task.available_at <= clock_timestamp()
      and task.provider in ('codex','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','whisperx','bailian','volcengine','minimax','kling')
      and task.attempt < task.max_attempts
      and (p_task_id is null or task.id = p_task_id)
    order by (select count(*) from public.tasks busy where true and busy.episode_id=task.episode_id and busy.status='running' and busy.claimed_at>clock_timestamp()-interval '30 minutes'), coalesce(turns.last_turn,0), task.created_at, task.id
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
      where true and task.status='running' and task.claimed_at>clock_timestamp()-interval '30 minutes'
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

  select * into selected_task from public.tasks task where local_identity.current_worker_task(task) and local_identity.input_task_allowed(task.episode_id,task.task_type) and task.status = 'ready' AND NOT EXISTS(SELECT 1 FROM local_identity.historical_tasks h WHERE h.task_id=task.id) and task.provider in ('codex','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','whisperx','bailian','volcengine','minimax','kling') and task.attempt < task.max_attempts and task.id = candidate.id order by task.created_at for update skip locked limit 1;
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
$$;

CREATE OR REPLACE FUNCTION public.claim_next_worker_task(p_task_id uuid DEFAULT NULL::uuid, p_worker_capacity integer DEFAULT 1) RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb, lease_token uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role is required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM local_identity.claim_scheduled_worker_task(p_task_id,p_worker_capacity,true);
END;
$$;

CREATE OR REPLACE FUNCTION local_identity.input_task_connection(p_task_id uuid, p_attempt integer, p_lease_token uuid) RETURNS TABLE(version_id uuid, provider text, adapter text, endpoint text, secret_ref uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM local_identity.assert_current_worker_execution(p_task_id,p_attempt,p_lease_token);
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
END $$;

CREATE OR REPLACE FUNCTION local_identity.input_media_connection(p_task_id uuid, p_attempt integer, p_lease_token uuid, p_version_id uuid) RETURNS TABLE(version_id uuid, provider text, adapter text, endpoint text, secret_ref uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM local_identity.assert_current_worker_execution(p_task_id,p_attempt,p_lease_token);
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

$$;

CREATE OR REPLACE FUNCTION local_identity.reserve_wan_generation(p_task_id uuid, p_attempt integer, p_lease_token uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare t public.tasks; aid uuid; r public.paid_generation_reservations; amount integer; k text;
begin
 PERFORM local_identity.assert_current_worker_execution(p_task_id,p_attempt,p_lease_token);
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
end $$;

