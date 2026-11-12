-- T17: explicit per-Episode opt-in; preserve all T16/imported task scope.
ALTER TABLE local_identity.input_episodes ADD COLUMN storyboard_enabled boolean NOT NULL DEFAULT false;
CREATE FUNCTION local_identity.input_task_allowed(p_episode_id uuid,p_task_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=p_episode_id AND e.enabled AND (p_task_type='prepare_visual_brief' OR (e.storyboard_enabled AND p_task_type IN ('draft_storyboard','draft_storyboard_revision')))) $$;
REVOKE ALL ON FUNCTION local_identity.input_task_allowed(uuid,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION local_identity.recover_input_tasks()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare stale public.tasks; expired_result jsonb; recovered integer := 0;
begin
  if local_identity.actor_role() is distinct from 'service_role' then
    raise exception 'Worker service role is required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('loop-worker-lease-recovery',0));
  for stale in select * from public.tasks
    where local_identity.input_task_allowed(tasks.episode_id,task_type) and status='running' and (claimed_at is null or claimed_at <= clock_timestamp()-interval '30 minutes')
    order by id for update skip locked
  loop
    expired_result := jsonb_build_object('version','worker-result/v1','taskId',stale.id,'status','failed','artifacts','[]'::jsonb,
      'validation',jsonb_build_object('passed',false,'checks',jsonb_build_array(jsonb_build_object('name','worker_lease','passed',false,'detail','Worker lease expired before it reported a result.'))),
      'actualCostCents',0,'blockers','[]'::jsonb,'retry',jsonb_build_object('shouldRetry',stale.attempt < stale.max_attempts,'reason','Worker lease expired.'),'nextStep','Retry after the Worker is available.');
    update public.task_runs set status='failed',result=expired_result,completed_at=clock_timestamp()
      where task_id=stale.id and attempt=stale.attempt-1 and status='running';
    update public.tasks set status=case when stale.attempt < stale.max_attempts then 'ready'::public.task_status else 'failed'::public.task_status end,
      claimed_at=null,lease_token=null,completed_at=case when stale.attempt < stale.max_attempts then null else clock_timestamp() end,last_result=expired_result where id=stale.id;
    insert into public.audit_events(account_id,episode_id,event_type,payload)
      select account_id,id,'worker_lease_expired',jsonb_build_object('task_id',stale.id,'attempt',stale.attempt-1) from public.episodes where id=stale.episode_id;
    recovered := recovered+1;
  end loop;
  return recovered;
end $function$;
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
  if (select count(*) from public.tasks where status='running'
      and claimed_at > clock_timestamp()-interval '30 minutes') >= p_worker_capacity then return; end if;

  for candidate in
    select task.*
    from public.tasks task left join public.worker_episode_turns turns on turns.episode_id=task.episode_id
    where local_identity.input_task_allowed(task.episode_id,task.task_type) and task.status = 'ready' and task.invalidated_at is null and task.available_at <= clock_timestamp()
      and task.provider in ('codex','google_tts','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','cloudflare','whisperx')
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
    select nextval('local_identity.input_dispatch_turn') into next_turn;
    insert into public.worker_episode_turns(episode_id,last_turn) values(candidate.episode_id,next_turn)
      on conflict on constraint worker_episode_turns_pkey do update set last_turn=excluded.last_turn;
    return;
  end loop;
end;
$function$;
CREATE OR REPLACE FUNCTION local_identity.input_worker_call(p_name text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE selected_task_id uuid:=(p_args->>'p_task_id')::uuid; BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=selected_task_id AND local_identity.input_task_allowed(t.episode_id,t.task_type)) THEN RAISE EXCEPTION 'Managed input Worker task required' USING ERRCODE='42501'; END IF;
 IF p_name='refresh_worker_task_lease' THEN PERFORM public.refresh_worker_task_lease(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid);
 ELSIF p_name='report_worker_progress' THEN PERFORM public.report_worker_progress(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid,p_args->'p_progress');
 ELSIF p_name='report_worker_result' THEN PERFORM public.report_worker_result(selected_task_id,(p_args->>'p_attempt')::integer,p_args->'p_result',(p_args->>'p_lease_token')::uuid);
 ELSE RAISE EXCEPTION 'Unsupported Worker command' USING ERRCODE='22023'; END IF; RETURN 'null'::jsonb; END $function$;
CREATE OR REPLACE FUNCTION local_identity.plan_input_tasks(p_episode_id uuid DEFAULT NULL) RETURNS SETOF public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; created public.tasks; BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 FOR candidate IN SELECT e.id,e.stage,i.storyboard_enabled FROM public.episodes e JOIN local_identity.input_episodes i ON i.episode_id=e.id AND i.enabled WHERE (p_episode_id IS NULL OR e.id=p_episode_id) AND (e.stage='script_approved' OR (i.storyboard_enabled AND e.stage='visual_approved')) LOOP
  IF candidate.stage='script_approved' THEN
   FOR created IN SELECT * FROM public.orchestrate_provided_script_tasks_for_episode(candidate.id) LOOP RETURN NEXT created; END LOOP;
  ELSE
   FOR created IN SELECT * FROM public.orchestrate_storyboard_tasks_for_episode(candidate.id) LOOP RETURN NEXT created; END LOOP;
  END IF;
 END LOOP; END $$;
GRANT EXECUTE ON FUNCTION public.create_storyboard_annotation(uuid,text,text),public.request_shot_structure_revision(uuid,uuid,jsonb,text) TO loop_owner;
