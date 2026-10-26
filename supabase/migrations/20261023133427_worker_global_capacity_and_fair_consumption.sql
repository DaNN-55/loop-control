-- T07: capacity is a database fact; service processes cannot raise it by
-- passing a larger per-invocation worker count. No Owner/browser write grants.
create table if not exists public.worker_scheduler_settings (
  singleton boolean primary key default true check(singleton),
  capacity integer not null default 2 check(capacity between 1 and 64),
  turn bigint not null default 0
);
alter table public.worker_scheduler_settings enable row level security;
revoke all on public.worker_scheduler_settings from public,anon,authenticated,service_role;
grant select,update on public.worker_scheduler_settings to service_role;
insert into public.worker_scheduler_settings(singleton) values(true) on conflict do nothing;

create table if not exists public.worker_episode_turns (
  episode_id uuid primary key references public.episodes(id) on delete cascade,
  last_turn bigint not null
);
alter table public.worker_episode_turns enable row level security;
revoke all on public.worker_episode_turns from public,anon,authenticated,service_role;
grant select on public.worker_episode_turns to service_role;

-- Trusted deployment ceilings may only lower conservative platform defaults.
create table if not exists public.worker_resource_ceilings (
  resource_key text primary key check(resource_key ~ '^(provider|adapter|connection|host):.+$'),
  capacity integer not null check(capacity between 1 and 64)
);
alter table public.worker_resource_ceilings enable row level security;
revoke all on public.worker_resource_ceilings from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.worker_resource_ceilings to service_role;

-- Resource keys overlap deliberately: changing a connection cannot evade the
-- Provider or Adapter ceiling. Unknown trusted quotas keep the Adapter default.
create or replace function public.worker_resource_limits(p_input jsonb, p_capacity integer)
returns jsonb language plpgsql stable set search_path='' as $$
declare runtime jsonb:=public.worker_runtime_constraints(p_input,p_capacity);
 provider text:=coalesce(nullif(p_input#>>'{executor,provider}',''),p_input->>'provider','unknown');
 adapter text:=coalesce(nullif(p_input#>>'{executor,adapter}',''),p_input#>>'{media,adapter}','default');
 credential text:=nullif(p_input->>'credential_ref',''); limits jsonb;
begin
 limits:=jsonb_build_array(
  jsonb_build_object('key','provider:'||provider,'limit',least(coalesce((runtime#>>'{source,provider_or_connection_limit}')::integer,(runtime#>>'{source,adapter_safety_limit}')::integer),p_capacity)),
  jsonb_build_object('key','adapter:'||provider||':'||adapter,'limit',(runtime->>'effective_concurrency')::integer),
  jsonb_build_object('key','connection:'||coalesce(credential,provider||':'||adapter||':shared'),'limit',(runtime->>'effective_concurrency')::integer)
 );
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
revoke all on function public.worker_resource_limits(jsonb,integer) from public,anon,authenticated;

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
    where task.status = 'ready' and task.invalidated_at is null and task.available_at <= clock_timestamp()
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

-- Requeued work keeps its delay across dispatcher/Worker restarts. Delay grows
-- from 1s to at most 30s; the existing attempt budget still bounds retries.
alter table public.tasks add column if not exists available_at timestamptz not null default '-infinity';
create or replace function public.worker_retry_backoff()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='running' and new.status='ready' then
  new.available_at:=clock_timestamp()+make_interval(secs=>least(30,power(2,least(greatest(new.attempt-1,0),5)))::integer);
 end if;
 return new;
end $$;
revoke all on function public.worker_retry_backoff() from public,anon,authenticated;
drop trigger if exists worker_retry_backoff on public.tasks;
create trigger worker_retry_backoff before update of status on public.tasks for each row execute function public.worker_retry_backoff();

notify pgrst,'reload schema';

create index if not exists worker_active_episode_idx on public.tasks(episode_id) where status='running';
create index if not exists worker_ready_available_idx on public.tasks(available_at,created_at,id) where status='ready' and invalidated_at is null;

-- A private scheduler read, not an Owner command. Use the DB clock for retry
-- waits: host/VM wall-clock skew must not turn a durable retry into lost work.
create or replace function public.worker_retry_delay_ms()
returns integer language sql volatile set search_path='' as $$
 select case when min(available_at) is null then 0 else
   least(30000,greatest(1,ceil(extract(epoch from(min(available_at)-clock_timestamp()))*1000)))::integer end
 from public.tasks
 where status='ready' and invalidated_at is null and attempt<max_attempts
   and provider in ('codex','google_tts','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','cloudflare','whisperx')
   and available_at>clock_timestamp() and available_at<'infinity'::timestamptz;
$$;
revoke all on function public.worker_retry_delay_ms() from public,anon,authenticated;
grant execute on function public.worker_retry_delay_ms() to service_role;
notify pgrst,'reload schema';

-- Deployment changes use the same lock as claims, before taking table rows.
-- A new lower ceiling applies to subsequent reservations; existing executions
-- keep their leases and are not preempted by a configuration edit.
create or replace function public.serialize_worker_capacity_configuration()
returns trigger language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('loop-worker-global-capacity',0));
 return null;
end $$;
revoke all on function public.serialize_worker_capacity_configuration() from public,anon,authenticated;
drop trigger if exists serialize_worker_capacity on public.worker_scheduler_settings;
create trigger serialize_worker_capacity before insert or update or delete on public.worker_scheduler_settings for each statement execute function public.serialize_worker_capacity_configuration();
drop trigger if exists serialize_worker_resources on public.worker_resource_ceilings;
create trigger serialize_worker_resources before insert or update or delete on public.worker_resource_ceilings for each statement execute function public.serialize_worker_capacity_configuration();
