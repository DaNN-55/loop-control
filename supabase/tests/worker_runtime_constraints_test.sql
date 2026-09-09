begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

insert into public.accounts (id, slug, name, timezone)
values ('81000000-0000-4000-8000-000000000001', 'issue-81-runtime', 'Issue 81 runtime', 'Asia/Shanghai');

insert into public.account_blueprint_versions (id, account_id, version, policy, is_active)
values (
  '81000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000001',
  1,
  jsonb_build_object(
    'b_roll', jsonb_build_object(
      'executor', jsonb_build_object('provider', 'pexels', 'adapter', 'pexels_video', 'model', 'pexels-video-v1', 'prompt_version', 'b-roll-v1'),
      'scheduling', jsonb_build_object('max_concurrency', 5, 'provider_max_concurrency', 3)
    )
  ),
  true
);

update public.accounts
set current_blueprint_version_id = '81000000-0000-4000-8000-000000000002'
where id = '81000000-0000-4000-8000-000000000001';

insert into public.episodes (id, account_id, blueprint_version_id, title, is_test)
values ('81000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'Issue 81 concurrency', true);

insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
select
  ('81000000-0000-4000-8001-00000000000' || task_number)::uuid,
  '81000000-0000-4000-8000-000000000003',
  'generate_b_roll',
  'ready',
  jsonb_build_object(
    'capability', 'b_roll_generation',
    'executor', jsonb_build_object('provider', 'pexels', 'adapter', 'pexels_video', 'model', 'pexels-video-v1', 'prompt_version', 'b-roll-v1'),
    'credential_ref', 'legacy-connection-3',
    'scheduling', jsonb_build_object('max_concurrency', 5, 'provider_max_concurrency', 3),
    'allowed_tools', jsonb_build_array('read', 'write'),
    'shot', jsonb_build_object('id', format('shot-%s', task_number))
  ),
  0,
  1,
  'pexels',
  'pexels-video-v1',
  'b-roll-v1'
from generate_series(1, 4) as task_number;

select is(
  (select count(*) from public.claim_next_worker_task(null, 8)),
  1::bigint,
  'the first task in the trusted concurrency group is claimed'
);
select is(
  (select count(*) from public.claim_next_worker_task(null, 8)),
  1::bigint,
  'the second task in the trusted concurrency group is claimed'
);
select is(
  (select count(*) from public.claim_next_worker_task(null, 8)),
  1::bigint,
  'the third task in the trusted concurrency group is claimed'
);
select is(
  (select count(*) from public.claim_next_worker_task(null, 8)),
  0::bigint,
  'the fourth task is held when the effective limit is three'
);
select is(
  (select count(*) from public.tasks where episode_id = '81000000-0000-4000-8000-000000000003' and status = 'running'),
  3::bigint,
  'the server runs at most three corresponding tasks'
);
select is(
  (select count(*) from public.tasks where episode_id = '81000000-0000-4000-8000-000000000003' and status = 'running' and input_snapshot #>> '{runtime_constraints,effective_concurrency}' = '3'),
  3::bigint,
  'each claimed task stores the effective concurrency'
);
select is(
  (select count(*) from public.tasks where episode_id = '81000000-0000-4000-8000-000000000003' and input_snapshot #>> '{runtime_constraints,source,provider_or_connection_limit}' = '3' and input_snapshot #>> '{runtime_constraints,source,adapter_safety_limit}' = '3' and input_snapshot #>> '{runtime_constraints,source,worker_capacity}' = '8'),
  3::bigint,
  'each claimed task stores provider, Adapter, and Worker limit sources'
);
select is(
  (select count(*) from public.tasks where episode_id = '81000000-0000-4000-8000-000000000003' and input_snapshot #>> '{runtime_constraints,concurrency_group}' = 'pexels:pexels_video:legacy-connection-3'),
  4::bigint,
  'all four tasks share the same trusted concurrency group'
);
select is(
  (select count(*) from public.tasks where episode_id = '81000000-0000-4000-8000-000000000003' and input_snapshot #>> '{scheduling,max_concurrency}' = '5' and input_snapshot #>> '{scheduling,provider_max_concurrency}' = '3'),
  4::bigint,
  'legacy scheduling facts remain unchanged'
);
select ok(
  (select input_snapshot #>> '{runtime_constraints,source,provider_or_connection_limit}' from public.tasks where status = 'running' limit 1) <> '5',
  'legacy capability limit five cannot raise the platform limit'
);

select is(
  (public.worker_runtime_constraints(jsonb_build_object('executor', jsonb_build_object('provider', 'pexels', 'adapter', 'pexels_video')), 8) ->> 'effective_concurrency')::integer,
  3,
  'a trusted Pexels limit wins over a larger Worker capacity'
);

select is(
  (public.worker_runtime_constraints(jsonb_build_object('executor', jsonb_build_object('provider', 'pexels', 'adapter', 'pexels_video')), 2) ->> 'effective_concurrency')::integer,
  2,
  'Worker capacity is part of the effective concurrency minimum'
);

select is(
  (public.worker_runtime_constraints(jsonb_build_object('executor', jsonb_build_object('provider', 'unknown', 'adapter', 'unknown')), 8) ->> 'effective_concurrency')::integer,
  1,
  'unknown providers use the conservative Adapter default'
);

select is(
  public.worker_required_tools('b_roll_generation'),
  '["read", "write"]'::jsonb,
  'Worker file abilities are platform-declared'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.claim_next_worker_task(uuid,integer)'::regprocedure)) > 0,
  'claiming serializes each runtime concurrency group'
);

select ok(
  position('budget_limit_cents = 2147483647' in pg_get_functiondef('public.report_worker_result(uuid,integer,jsonb)'::regprocedure)) = 0,
  'result reporting does not write an unlimited budget sentinel'
);

update public.tasks
set claimed_at = timestamptz '2000-01-01 00:00:00+00'
where id = '81000000-0000-4000-8001-000000000001';
select is(
  public.refresh_worker_task_lease('81000000-0000-4000-8001-000000000001', 0),
  true,
  'a matching running task lease is refreshed'
);
select ok(
  (select claimed_at from public.tasks where id = '81000000-0000-4000-8001-000000000001') > timestamptz '2000-01-01 00:00:00+00',
  'a matching running task receives a newer claimed_at'
);

update public.tasks
set status = 'blocked', claimed_at = timestamptz '2000-01-01 00:00:00+00'
where id = '81000000-0000-4000-8001-000000000004';
select is(
  public.refresh_worker_task_lease('81000000-0000-4000-8001-000000000004', 0),
  false,
  'a non-running task lease is not refreshed'
);
select is(
  (select claimed_at from public.tasks where id = '81000000-0000-4000-8001-000000000004'),
  timestamptz '2000-01-01 00:00:00+00',
  'a non-running task keeps its claimed_at'
);

update public.tasks
set claimed_at = timestamptz '2000-01-01 00:00:00+00'
where id = '81000000-0000-4000-8001-000000000001';
select is(
  public.refresh_worker_task_lease('81000000-0000-4000-8001-000000000001', 1),
  false,
  'a mismatched task attempt lease is not refreshed'
);
select is(
  (select claimed_at from public.tasks where id = '81000000-0000-4000-8001-000000000001'),
  timestamptz '2000-01-01 00:00:00+00',
  'a mismatched task attempt keeps its claimed_at'
);

select ok(
  not has_function_privilege('anon', 'public.refresh_worker_task_lease(uuid,integer)', 'EXECUTE'),
  'anonymous callers cannot refresh Worker leases'
);
select ok(
  not has_function_privilege('authenticated', 'public.refresh_worker_task_lease(uuid,integer)', 'EXECUTE'),
  'signed-in callers cannot refresh Worker leases'
);
select ok(
  has_function_privilege('service_role', 'public.refresh_worker_task_lease(uuid,integer)', 'EXECUTE'),
  'the Worker service role can refresh Worker leases'
);

select * from finish();
rollback;
