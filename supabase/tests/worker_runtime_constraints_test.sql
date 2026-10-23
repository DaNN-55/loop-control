begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);
select set_config('request.jwt.claim.role','service_role',true);

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

create temporary table claimed_leases as select * from public.claim_next_worker_task('81000000-0000-4000-8001-000000000001',8);
select is(
  (select count(*) from claimed_leases),
  1::bigint,
  'the first task in the trusted concurrency group is claimed'
);
insert into claimed_leases select * from public.claim_next_worker_task('81000000-0000-4000-8001-000000000002',8);
select is(
  (select count(*) from claimed_leases where task_id='81000000-0000-4000-8001-000000000002'),
  1::bigint,
  'the second task in the trusted concurrency group is claimed'
);
insert into claimed_leases select * from public.claim_next_worker_task('81000000-0000-4000-8001-000000000003',8);
select is(
  (select count(*) from claimed_leases where task_id='81000000-0000-4000-8001-000000000003'),
  1::bigint,
  'the third task in the trusted concurrency group is claimed'
);
select is(
  (select count(*) from public.claim_next_worker_task('81000000-0000-4000-8001-000000000004',8)),
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
  (select input_snapshot #>> '{runtime_constraints,source,provider_or_connection_limit}' from public.tasks where episode_id='81000000-0000-4000-8000-000000000003' and status = 'running' limit 1) <> '5',
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
  (select bool_and(t.lease_token is not null and t.lease_token=r.lease_token) from public.tasks t join public.task_runs r on r.task_id=t.id and r.attempt=t.attempt-1 where t.episode_id='81000000-0000-4000-8000-000000000003' and t.status='running'),
  'each active task and run share the token returned by atomic claim'
);
select ok(not has_function_privilege('service_role','public.report_worker_result_base(uuid,integer,jsonb)','EXECUTE'),'the Worker cannot bypass fenced result reporting');

update public.tasks
set claimed_at = clock_timestamp()-interval '5 minutes'
where id = '81000000-0000-4000-8001-000000000001';
select is(
  public.refresh_worker_task_lease('81000000-0000-4000-8001-000000000001', 0,(select lease_token from claimed_leases where task_id='81000000-0000-4000-8001-000000000001')),
  true,
  'a matching running task lease is refreshed'
);
select ok(
  (select claimed_at from public.tasks where id = '81000000-0000-4000-8001-000000000001') > clock_timestamp()-interval '1 minute',
  'a matching running task receives a newer claimed_at'
);

update public.tasks
set status = 'blocked', claimed_at = timestamptz '2000-01-01 00:00:00+00'
where id = '81000000-0000-4000-8001-000000000004';
select throws_ok($$select public.refresh_worker_task_lease('81000000-0000-4000-8001-000000000004',0,null::uuid)$$,'42501','Worker lease is expired or belongs to another attempt','a non-running task lease is not refreshed');
select is(
  (select claimed_at from public.tasks where id = '81000000-0000-4000-8001-000000000004'),
  timestamptz '2000-01-01 00:00:00+00',
  'a non-running task keeps its claimed_at'
);

update public.tasks
set claimed_at = timestamptz '2000-01-01 00:00:00+00'
where id = '81000000-0000-4000-8001-000000000001';
select throws_ok(format('select public.refresh_worker_task_lease(%L,1,%L::uuid)','81000000-0000-4000-8001-000000000001',(select lease_token from claimed_leases where task_id='81000000-0000-4000-8001-000000000001')),'42501','Worker lease is expired or belongs to another attempt','a mismatched task attempt lease is not refreshed');
select is(
  (select claimed_at from public.tasks where id = '81000000-0000-4000-8001-000000000001'),
  timestamptz '2000-01-01 00:00:00+00',
  'a mismatched task attempt keeps its claimed_at'
);

select ok(
  not has_function_privilege('anon', 'public.refresh_worker_task_lease(uuid,integer,uuid)', 'EXECUTE'),
  'anonymous callers cannot refresh Worker leases'
);
select ok(
  not has_function_privilege('authenticated', 'public.refresh_worker_task_lease(uuid,integer,uuid)', 'EXECUTE'),
  'signed-in callers cannot refresh Worker leases'
);
select ok(
  has_function_privilege('service_role', 'public.refresh_worker_task_lease(uuid,integer,uuid)', 'EXECUTE'),
  'the Worker service role can refresh Worker leases'
);

select throws_ok($$select public.refresh_worker_task_lease('81000000-0000-4000-8001-000000000001',0)$$,'42501','Lease token is required; upgrade Worker','the unfenced legacy heartbeat is rejected');
select throws_ok(format('select public.refresh_worker_task_lease(%L,0,%L::uuid)','81000000-0000-4000-8001-000000000001',(select lease_token from claimed_leases where task_id='81000000-0000-4000-8001-000000000001')),'42501','Worker lease is expired or belongs to another attempt','even a matching token cannot revive an expired lease');
select * from finish();
rollback;
