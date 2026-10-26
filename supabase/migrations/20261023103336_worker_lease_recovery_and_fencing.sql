-- Attempt number remains zero-based in task_runs/Worker, one-based in tasks.
alter table public.tasks add column lease_token uuid;
alter table public.task_runs add column lease_token uuid;

-- Recover before ready selection and group-capacity calculation. B serializes the short
-- recovery/claim critical section; C owns global capacity and fair scheduling.
create or replace function public.recover_expired_worker_tasks()
returns integer language plpgsql security definer set search_path = '' as $$
declare stale public.tasks; expired_result jsonb; recovered integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Worker service role is required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('loop-worker-lease-recovery',0));
  for stale in select * from public.tasks
    where status='running' and (claimed_at is null or claimed_at <= clock_timestamp()-interval '30 minutes')
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
end $$;
revoke all on function public.recover_expired_worker_tasks() from public,anon,authenticated;
grant execute on function public.recover_expired_worker_tasks() to service_role;

CREATE OR REPLACE FUNCTION public.claim_next_worker_task_legacy(p_task_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_task public.tasks;
begin
  select * into selected_task from public.tasks task where task.status = 'ready' and task.provider in ('codex','google_tts','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','cloudflare','whisperx') and task.attempt < task.max_attempts and (p_task_id is null or task.id = p_task_id) order by task.created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.tasks task set status = 'running', claimed_at = now(), attempt = task.attempt + 1 where task.id = selected_task.id;
  insert into public.task_runs (task_id,attempt,task_package)
  select selected_task.id, selected_task.attempt, jsonb_build_object('version','worker-task/v1','task_id',selected_task.id,'task_type',selected_task.task_type,'attempt',selected_task.attempt,'budget_limit_cents',selected_task.budget_limit_cents,'max_attempts',selected_task.max_attempts,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'episode_id',episode.id,'account_id',account.id,'blueprint_version_id',episode.blueprint_version_id,'allowed_asset_root',coalesce(blueprint.policy ->> 'asset_root',''),'input_snapshot',selected_task.input_snapshot || jsonb_build_object('prompt_context', coalesce(selected_task.input_snapshot -> 'prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot))))
  from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
  return query select selected_task.id,selected_task.task_type,selected_task.attempt,selected_task.budget_limit_cents,selected_task.max_attempts,selected_task.provider,selected_task.model,selected_task.prompt_version,episode.id,account.id,episode.blueprint_version_id,episode.title,coalesce(blueprint.policy ->> 'asset_root',''),selected_task.input_snapshot || jsonb_build_object('prompt_context', coalesce(selected_task.input_snapshot -> 'prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot))) from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_next_worker_task_pre_lease(p_task_id uuid DEFAULT NULL::uuid, p_worker_capacity integer DEFAULT 1)
 RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  candidate public.tasks;
  runtime jsonb;
  group_key text;
  running_count integer;
begin
  if p_worker_capacity <= 0 then
    raise exception 'Worker capacity must be a positive integer' using errcode = '22023';
  end if;

  perform public.recover_expired_worker_tasks();

  for candidate in
    select task.*
    from public.tasks task
    where task.status = 'ready'
      and task.provider in ('codex','google_tts','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','cloudflare','whisperx')
      and task.attempt < task.max_attempts
      and (p_task_id is null or task.id = p_task_id)
    order by task.created_at, task.id
    for update skip locked
  loop
    runtime := public.worker_runtime_constraints(candidate.input_snapshot, p_worker_capacity);
    group_key := runtime ->> 'concurrency_group';
    perform pg_advisory_xact_lock(hashtextextended(group_key, 0));
    select count(*) into running_count
    from public.tasks task
    where task.status = 'running'
      and coalesce(task.input_snapshot #>> '{runtime_constraints,concurrency_group}', public.worker_runtime_constraints(task.input_snapshot, p_worker_capacity) ->> 'concurrency_group') = group_key;
    if running_count >= (runtime ->> 'effective_concurrency')::integer then
      continue;
    end if;

    update public.tasks task
    set input_snapshot = candidate.input_snapshot || jsonb_build_object(
      'runtime_constraints', runtime,
      'allowed_tools', public.worker_required_tools(candidate.input_snapshot ->> 'capability')
    )
    where task.id = candidate.id;
    return query select * from public.claim_next_worker_task_legacy(candidate.id);
    return;
  end loop;
end;
$function$;




drop function public.claim_next_worker_task(uuid,integer);
create function public.claim_next_worker_task(p_task_id uuid default null,p_worker_capacity integer default 1)
returns table(task_id uuid,task_type text,attempt integer,budget_limit_cents integer,max_attempts integer,provider text,model text,prompt_version text,episode_id uuid,account_id uuid,blueprint_version_id uuid,title text,allowed_asset_root text,input_snapshot jsonb,lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare claimed record; token uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Worker service role is required' using errcode='42501'; end if;
  -- The private claimant invokes independent recovery before selecting ready rows.
  for claimed in select * from public.claim_next_worker_task_pre_lease(p_task_id,p_worker_capacity) loop
    token := gen_random_uuid();
    update public.tasks set lease_token=token where id=claimed.task_id;
    update public.task_runs set lease_token=token,task_package=task_package || jsonb_build_object('lease_token',token)
      where task_runs.task_id=claimed.task_id and task_runs.attempt=claimed.attempt;
    return query select claimed.task_id,claimed.task_type,claimed.attempt,claimed.budget_limit_cents,claimed.max_attempts,claimed.provider,claimed.model,claimed.prompt_version,claimed.episode_id,claimed.account_id,claimed.blueprint_version_id,claimed.title,claimed.allowed_asset_root,claimed.input_snapshot,token;
  end loop;
end $$;

-- Lock first, then inspect clock_timestamp(): a transaction that waited behind a
-- renew/reclaim must validate the current attempt, token and lease after waiting.
create function public.assert_worker_lease(p_task_id uuid,p_attempt integer,p_lease_token uuid)
returns void language plpgsql security definer set search_path='' as $$
declare selected public.tasks;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Worker service role is required' using errcode='42501'; end if;
  select * into selected from public.tasks where id=p_task_id for update;
  if not found or selected.status <> 'running' or selected.attempt <> p_attempt+1
    or p_lease_token is null or selected.lease_token is distinct from p_lease_token
    or selected.claimed_at is null or selected.claimed_at <= clock_timestamp()-interval '30 minutes'
    or not exists(select 1 from public.task_runs where task_id=p_task_id and attempt=p_attempt and status='running' and lease_token=p_lease_token)
    then raise exception 'Worker lease is expired or belongs to another attempt' using errcode='42501'; end if;
end $$;

create function public.refresh_worker_task_lease(p_task_id uuid,p_attempt integer,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
  update public.tasks set claimed_at=clock_timestamp() where id=p_task_id;
  return true;
end $$;
create or replace function public.refresh_worker_task_lease(p_task_id uuid,p_attempt integer)
returns boolean language plpgsql security definer set search_path='' as $$
begin raise exception 'Lease token is required; upgrade Worker' using errcode='42501'; end $$;

create function public.report_worker_result(p_task_id uuid,p_attempt integer,p_result jsonb,p_lease_token uuid)
returns public.tasks language plpgsql security definer set search_path='' as $$
declare reported public.tasks;
begin
  perform public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
  reported := public.report_worker_result_base(p_task_id,p_attempt,p_result);
  update public.tasks set lease_token=null where id=p_task_id returning * into reported;
  return reported;
end $$;
create or replace function public.report_worker_result(p_task_id uuid,p_attempt integer,p_result jsonb)
returns public.tasks language plpgsql security definer set search_path='' as $$
begin raise exception 'Lease token is required; upgrade Worker' using errcode='42501'; end $$;

create function public.report_worker_progress(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_progress jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
  if p_progress->>'version' is distinct from 'worker-progress/v1' or jsonb_typeof(p_progress->'progress') is distinct from 'object' then
    raise exception 'Worker progress is invalid' using errcode='22023'; end if;
  update public.tasks set last_result=p_progress where id=p_task_id;
  update public.task_runs set result=p_progress where task_id=p_task_id and attempt=p_attempt and lease_token=p_lease_token;
end $$;

-- All unfenced entry points are internal, including the legacy result base.
revoke all on function public.claim_next_worker_task_legacy(uuid),public.claim_next_worker_task_pre_lease(uuid,integer),public.report_worker_result_base(uuid,integer,jsonb),public.assert_worker_lease(uuid,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_next_worker_task(uuid,integer),public.refresh_worker_task_lease(uuid,integer,uuid),public.report_worker_result(uuid,integer,jsonb,uuid),public.report_worker_progress(uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_next_worker_task(uuid,integer),public.refresh_worker_task_lease(uuid,integer,uuid),public.report_worker_result(uuid,integer,jsonb,uuid),public.report_worker_progress(uuid,integer,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
