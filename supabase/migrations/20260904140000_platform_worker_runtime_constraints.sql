-- Worker runtime limits are platform facts. Legacy blueprint fields remain readable,
-- but they are not used to raise the limits of a new task.
create or replace function public.worker_required_tools(p_capability text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array('read', 'write');
$$;

create or replace function public.worker_runtime_constraints(p_input_snapshot jsonb, p_worker_capacity integer default 1)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
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
    when 'google_tts' then 2
    when 'volcengine_tts' then 2
    when 'freesound_preview' then 1
    when 'openai_images' then 1
    when 'workers_ai_images' then 1
    when 'hyperframes_card_video' then 1
    else 1
  end;
  provider_limit := case
    when provider = 'pexels' and adapter = 'pexels_video' then 3
    when provider = 'google_tts' and adapter = 'google_tts' then 2
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

create or replace function public.normalize_worker_task_runtime_constraints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider in ('codex', 'google_tts', 'volcengine_tts', 'pexels', 'ffmpeg', 'freesound', 'hyperframes', 'openai', 'cloudflare')
    and jsonb_typeof(new.input_snapshot) = 'object' then
    new.input_snapshot := new.input_snapshot || jsonb_build_object(
      'runtime_constraints', public.worker_runtime_constraints(new.input_snapshot),
      'allowed_tools', public.worker_required_tools(new.input_snapshot ->> 'capability')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists aa_normalize_worker_task_runtime_constraints on public.tasks;
create trigger aa_normalize_worker_task_runtime_constraints
before insert on public.tasks
for each row execute function public.normalize_worker_task_runtime_constraints();

drop trigger if exists guard_b_roll_task_claim_before_running on public.tasks;

-- Keep the existing lease recovery and task-run freezing path; only widen its
-- provider list so all registered Worker providers use the constrained wrapper.
do $migration$
declare
  definition text;
  updated text;
begin
  select pg_get_functiondef('public.claim_next_worker_task(uuid)'::regprocedure) into definition;
  updated := replace(
    definition,
    $$task.provider in ('codex','google_tts','volcengine_tts','pexels','ffmpeg','freesound','hyperframes')$$,
    $$task.provider in ('codex','google_tts','volcengine_tts','pexels','ffmpeg','freesound','hyperframes','openai','cloudflare')$$
  );
  if updated = definition then
    raise exception 'Worker claim definition did not match the expected provider list';
  end if;
  execute updated;
end;
$migration$;

alter function public.claim_next_worker_task(uuid) rename to claim_next_worker_task_legacy;

create or replace function public.claim_next_worker_task(p_task_id uuid default null, p_worker_capacity integer default 1)
returns table (task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.tasks;
  runtime jsonb;
  group_key text;
  running_count integer;
begin
  if p_worker_capacity <= 0 then
    raise exception 'Worker capacity must be a positive integer' using errcode = '22023';
  end if;

  for candidate in
    select task.*
    from public.tasks task
    where task.status = 'ready'
      and task.provider in ('codex','google_tts','volcengine_tts','pexels','ffmpeg','freesound','hyperframes','openai','cloudflare')
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
$$;

revoke all on function public.worker_required_tools(text) from public, anon, authenticated;
revoke all on function public.worker_runtime_constraints(jsonb, integer) from public, anon, authenticated;
revoke all on function public.normalize_worker_task_runtime_constraints() from public, anon, authenticated;
revoke all on function public.claim_next_worker_task_legacy(uuid) from public, anon, authenticated, service_role;
revoke all on function public.claim_next_worker_task(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_next_worker_task(uuid, integer) to service_role;

-- Actual cost is recorded after execution. It is not a pre-call fee gate and
-- the old unlimited sentinel is no longer written by the public result RPC.
do $migration$
declare
  definition text;
  updated text;
begin
  select pg_get_functiondef('public.report_worker_result_base(uuid,integer,jsonb)'::regprocedure) into definition;
  updated := replace(
    definition,
    $$  if actual_cost > selected_task.budget_limit_cents then
    raise exception 'Worker result cost exceeds task budget' using errcode = '22023';
  end if;
$$,
    ''
  );
  if updated = definition then
    raise exception 'Worker result budget guard did not match the expected version';
  end if;
  execute updated;
end;
$migration$;

create or replace function public.report_worker_result(p_task_id uuid, p_attempt integer, p_result jsonb)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.report_worker_result_base(p_task_id, p_attempt, p_result);
end;
$$;

revoke all on function public.report_worker_result(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.report_worker_result(uuid, integer, jsonb) to service_role;
