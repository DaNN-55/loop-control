-- T16 native-only command/Worker boundary. Imported history is never opted in.
CREATE TABLE local_identity.input_episodes(episode_id uuid PRIMARY KEY REFERENCES public.episodes(id),owner_id uuid NOT NULL REFERENCES local_identity.owners(id),enabled boolean NOT NULL DEFAULT false);
ALTER TABLE local_identity.input_episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY owned_input_episode ON local_identity.input_episodes TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id() AND EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
REVOKE ALL ON local_identity.input_episodes FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON local_identity.input_episodes TO loop_app;
GRANT USAGE ON SCHEMA public,local_identity TO loop_worker;
GRANT SELECT ON public.production_material_revisions,public.artifacts,public.review_packages TO loop_owner;
GRANT EXECUTE ON FUNCTION public.create_episode(uuid,uuid,uuid,text,boolean),public.import_production_material(uuid,text,text,text,text,text,text,bigint,boolean,text),public.start_episode_production(uuid),public.record_episode_worker_preflight(uuid,uuid),public.transition_episode(uuid,public.episode_stage,text) TO loop_owner;

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
    where exists(select 1 from local_identity.input_episodes e where e.episode_id=tasks.episode_id and e.enabled) and task_type='prepare_visual_brief' and status='running' and (claimed_at is null or claimed_at <= clock_timestamp()-interval '30 minutes')
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
    where exists(select 1 from local_identity.input_episodes managed where managed.episode_id=task.episode_id and managed.enabled) and task.task_type='prepare_visual_brief' and task.status = 'ready' and task.invalidated_at is null and task.available_at <= clock_timestamp()
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
    update public.worker_scheduler_settings set turn=turn+1 where singleton returning turn into next_turn;
    insert into public.worker_episode_turns(episode_id,last_turn) values(candidate.episode_id,next_turn)
      on conflict on constraint worker_episode_turns_pkey do update set last_turn=excluded.last_turn;
    return;
  end loop;
end;
$function$;
CREATE OR REPLACE FUNCTION local_identity.claim_input_task(p_task_id uuid DEFAULT NULL::uuid, p_worker_capacity integer DEFAULT 1)
 RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare claimed record; token uuid;
begin
  if local_identity.actor_role() is distinct from 'service_role' then raise exception 'Worker service role is required' using errcode='42501'; end if;
  -- The private claimant invokes independent recovery before selecting ready rows.
  for claimed in select * from local_identity.claim_input_task_pre_lease(p_task_id,p_worker_capacity) loop
    token := gen_random_uuid();
    update public.tasks set lease_token=token where id=claimed.task_id;
    update public.task_runs set lease_token=token,task_package=task_package || jsonb_build_object('lease_token',token)
      where task_runs.task_id=claimed.task_id and task_runs.attempt=claimed.attempt;
    return query select claimed.task_id,claimed.task_type,claimed.attempt,claimed.budget_limit_cents,claimed.max_attempts,claimed.provider,claimed.model,claimed.prompt_version,claimed.episode_id,claimed.account_id,claimed.blueprint_version_id,claimed.title,claimed.allowed_asset_root,claimed.input_snapshot,token;
  end loop;
end $function$;

CREATE FUNCTION local_identity.plan_input_tasks(p_episode_id uuid DEFAULT NULL) RETURNS SETOF public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE id uuid; BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501'; END IF;
 FOR id IN SELECT m.episode_id FROM local_identity.input_episodes m JOIN public.episodes e ON e.id=m.episode_id WHERE m.enabled AND e.stage='script_approved' AND (p_episode_id IS NULL OR e.id=p_episode_id) ORDER BY e.created_at,e.id LOOP
 RETURN QUERY SELECT * FROM public.orchestrate_provided_script_tasks_for_episode(id);
 END LOOP; END $$;
CREATE FUNCTION local_identity.input_worker_call(p_name text,p_args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE id uuid:=(p_args->>'p_task_id')::uuid; BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.tasks t JOIN local_identity.input_episodes e ON e.episode_id=t.episode_id WHERE t.id=id AND e.enabled AND t.task_type='prepare_visual_brief') THEN RAISE EXCEPTION 'Managed input Worker task required' USING ERRCODE='42501'; END IF;
 IF p_name='refresh_worker_task_lease' THEN PERFORM public.refresh_worker_task_lease(id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid);
 ELSIF p_name='report_worker_progress' THEN PERFORM public.report_worker_progress(id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid,p_args->'p_progress');
 ELSIF p_name='report_worker_result' THEN PERFORM public.report_worker_result(id,(p_args->>'p_attempt')::integer,p_args->'p_result',(p_args->>'p_lease_token')::uuid);
 ELSE RAISE EXCEPTION 'Unsupported Worker command' USING ERRCODE='22023'; END IF; RETURN 'null'::jsonb; END $$;
REVOKE ALL ON FUNCTION local_identity.recover_input_tasks(),local_identity.claim_input_task_pre_lease(uuid,integer),local_identity.claim_input_task(uuid,integer),local_identity.plan_input_tasks(uuid),local_identity.input_worker_call(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.claim_input_task(uuid,integer),local_identity.plan_input_tasks(uuid),local_identity.input_worker_call(text,jsonb) TO loop_worker;
