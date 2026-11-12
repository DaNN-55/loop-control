-- Native input scope shares the host capacity but never mutates imported scheduler history.
CREATE SEQUENCE local_identity.input_dispatch_turn;
SELECT setval('local_identity.input_dispatch_turn',greatest(1,(SELECT turn+1 FROM public.worker_scheduler_settings WHERE singleton)),false);
REVOKE ALL ON SEQUENCE local_identity.input_dispatch_turn FROM PUBLIC;
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
    select nextval('local_identity.input_dispatch_turn') into next_turn;
    insert into public.worker_episode_turns(episode_id,last_turn) values(candidate.episode_id,next_turn)
      on conflict on constraint worker_episode_turns_pkey do update set last_turn=excluded.last_turn;
    return;
  end loop;
end;
$function$;
