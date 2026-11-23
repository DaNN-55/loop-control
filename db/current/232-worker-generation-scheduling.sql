-- Opt in by configuring generation routes. Existing installations keep their
-- current scheduling until the local operator configures the supported routes.
ALTER TABLE public.worker_resource_ceilings DROP CONSTRAINT worker_resource_ceilings_resource_key_check,
 ADD CONSTRAINT worker_resource_ceilings_resource_key_check
 CHECK (resource_key ~ '^(provider|adapter|connection|host|generation|quota):.+$');

CREATE TABLE public.worker_generation_routes (
 provider text NOT NULL CHECK (btrim(provider)=provider AND provider<>''),
 adapter text NOT NULL CHECK (btrim(adapter)=adapter AND adapter<>''),
 kind text NOT NULL CHECK (kind IN ('image','video','speech')),
 capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 2),
 quota_key text REFERENCES public.worker_resource_ceilings(resource_key)
  CHECK (quota_key LIKE 'quota:%'),
 PRIMARY KEY(provider,adapter)
);
REVOKE ALL ON public.worker_generation_routes FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
CREATE TRIGGER serialize_worker_generation_routes BEFORE INSERT OR DELETE OR UPDATE
 ON public.worker_generation_routes FOR EACH STATEMENT EXECUTE FUNCTION public.serialize_worker_capacity_configuration();

CREATE OR REPLACE FUNCTION public.worker_runtime_constraints(p_input_snapshot jsonb, p_worker_capacity integer DEFAULT 1) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
<<resolved_task>>
declare
  provider text := coalesce(nullif(btrim(p_input_snapshot #>> '{executor,provider}'), ''), nullif(btrim(p_input_snapshot ->> 'provider'), ''), 'unknown');
  adapter text := coalesce(nullif(btrim(p_input_snapshot #>> '{executor,adapter}'), ''), nullif(btrim(p_input_snapshot #>> '{media,adapter}'), ''), 'default');
  configured_limit integer;
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
  SELECT r.capacity INTO configured_limit FROM public.worker_generation_routes r
   WHERE (r.provider,r.adapter)=(resolved_task.provider,resolved_task.adapter);
  adapter_limit:=coalesce(configured_limit,adapter_limit);
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
$$;

CREATE OR REPLACE FUNCTION public.worker_resource_limits(p_input jsonb, p_capacity integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
<<resolved_task>>
declare runtime jsonb:=public.worker_runtime_constraints(p_input,p_capacity);
 provider text:=coalesce(nullif(btrim(p_input#>>'{executor,provider}'),''),nullif(btrim(p_input->>'provider'),''),'unknown');
 adapter text:=coalesce(nullif(btrim(p_input#>>'{executor,adapter}'),''),nullif(btrim(p_input#>>'{media,adapter}'),''),'default');
 credential text:=nullif(btrim(p_input->>'credential_ref'),'');
 route public.worker_generation_routes; limits jsonb;
begin
 limits:=jsonb_build_array(
  jsonb_build_object('key','provider:'||provider,'limit',least(coalesce((runtime#>>'{source,provider_or_connection_limit}')::integer,(runtime#>>'{source,adapter_safety_limit}')::integer),p_capacity)),
  jsonb_build_object('key','adapter:'||provider||':'||adapter,'limit',(runtime->>'effective_concurrency')::integer),
  jsonb_build_object('key','connection:'||coalesce(credential,provider||':'||adapter||':shared'),'limit',(runtime->>'effective_concurrency')::integer)
 );
 SELECT * INTO route FROM public.worker_generation_routes r
 WHERE (r.provider,r.adapter)=(resolved_task.provider,resolved_task.adapter);
 IF FOUND THEN
  limits:=limits||jsonb_build_array(jsonb_build_object('key','generation:'||route.kind,'limit',
    least(p_capacity,CASE WHEN route.kind='speech' THEN 1 ELSE 2 END)));
  IF route.quota_key IS NOT NULL THEN
   limits:=limits||jsonb_build_array(jsonb_build_object('key',route.quota_key,'limit',p_capacity));
  END IF;
 END IF;
 if provider in ('ffmpeg','openchatcut','whisperx') then
  limits:=limits||jsonb_build_array(jsonb_build_object('key','host:cpu','limit',1));
 end if;
 if provider in ('ffmpeg','openchatcut') then
  limits:=limits||jsonb_build_array(jsonb_build_object('key','host:render','limit',1));
 end if;
 if provider in ('pexels','freesound') then
  limits:=limits||jsonb_build_array(jsonb_build_object('key','host:download','limit',least(3,p_capacity)));
 end if;
 select jsonb_agg(jsonb_build_object('key',r.value->>'key','limit',
   least((r.value->>'limit')::integer,coalesce(c.capacity,(r.value->>'limit')::integer))) order by r.value->>'key')
 into limits from jsonb_array_elements(limits) r
 left join public.worker_resource_ceilings c on c.resource_key=r.value->>'key';
 return limits;
end $$;


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
    order by CASE WHEN p_input_only AND task.task_type='generate_narration' AND EXISTS (
      SELECT 1 FROM public.worker_generation_routes r WHERE r.kind='speech' AND r.provider=task.provider
       AND r.adapter=coalesce(nullif(task.input_snapshot#>>'{executor,adapter}',''),task.input_snapshot#>>'{media,adapter}')
    ) THEN 0 ELSE 1 END,
    (select count(*) from public.tasks busy where true and busy.episode_id=task.episode_id and busy.status='running' and busy.claimed_at>clock_timestamp()-interval '30 minutes'), coalesce(turns.last_turn,0), task.created_at, task.id
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
