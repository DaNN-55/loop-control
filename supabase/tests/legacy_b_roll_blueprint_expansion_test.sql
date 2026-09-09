begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

insert into auth.users (id, email)
values ('52000000-0000-4000-8000-000000000001', 'issue-52-migration@test.invalid');

insert into public.accounts (id, slug, name, timezone)
values ('52000000-0000-4000-8000-000000000002', 'issue-52-migration', 'Issue 52 migration', 'Asia/Shanghai');

insert into public.account_memberships (account_id, user_id, role)
values ('52000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001', 'owner');

insert into public.account_blueprint_versions (id, account_id, version, policy, is_active)
values (
  '52000000-0000-4000-8000-000000000003',
  '52000000-0000-4000-8000-000000000002',
  1,
  '{"positioning":"legacy","b_roll":{"executor":{"provider":"pexels","adapter":"pexels_video","model":"pexels-video-v1","prompt_version":"b-roll-v1"},"allowed_tools":["read","write"],"per_shot_budget_cents":20,"total_budget_cents":100,"max_attempts":3,"max_concurrency":1,"provider_max_concurrency":1}}'::jsonb,
  true
);

update public.accounts
set current_blueprint_version_id = '52000000-0000-4000-8000-000000000003'
where id = '52000000-0000-4000-8000-000000000002';

select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.create_external_connection('pexels', 'pexels_video', 'Issue 52 Pexels', 'issue-52-pexels-secret');
select set_config('request.jwt.claim.role', 'service_role', true);
select public.record_external_connection_verification(
  (select current_version_id from public.external_connections where created_by = '52000000-0000-4000-8000-000000000001'),
  'verified',
  'Issue 52 test connection verified.'
);
select set_config('request.jwt.claim.role', 'authenticated', true);
create temporary table legacy_b_roll_fixture (connection_ref text) on commit drop;
insert into legacy_b_roll_fixture
select current_version_id::text
from public.external_connections
where created_by = '52000000-0000-4000-8000-000000000001';

insert into public.account_blueprint_versions (id, account_id, version, policy, is_active)
select
  '52000000-0000-4000-8000-000000000008',
  account_id,
  2,
  jsonb_set(policy, '{b_roll,credential_ref}', to_jsonb((select connection_ref from legacy_b_roll_fixture)), true),
  true
from public.account_blueprint_versions
where id = '52000000-0000-4000-8000-000000000003';

update public.account_blueprint_versions
set is_active = false
where id = '52000000-0000-4000-8000-000000000003';

update public.accounts
set current_blueprint_version_id = '52000000-0000-4000-8000-000000000008'
where id = '52000000-0000-4000-8000-000000000002';

insert into public.series (id, account_id, name)
values ('52000000-0000-4000-8000-000000000004', '52000000-0000-4000-8000-000000000002', 'Legacy series');

insert into public.series_versions (id, account_id, series_id, version, rules, created_by)
values (
  '52000000-0000-4000-8000-000000000005',
  '52000000-0000-4000-8000-000000000002',
  '52000000-0000-4000-8000-000000000004',
  1,
  '{"format":"legacy","b_roll":{"executor":{"provider":"legacy-series"}}}'::jsonb,
  '52000000-0000-4000-8000-000000000001'
);

insert into public.episodes (id, account_id, blueprint_version_id, series_version_id, title, stage, is_test)
values (
  '52000000-0000-4000-8000-000000000006',
  '52000000-0000-4000-8000-000000000002',
  '52000000-0000-4000-8000-000000000003',
  '52000000-0000-4000-8000-000000000005',
  'Existing episode',
  'waiting_input',
  true
);

select is(
  (select policy from public.account_blueprint_versions where id = '52000000-0000-4000-8000-000000000003'),
  '{"positioning":"legacy","b_roll":{"executor":{"provider":"pexels","adapter":"pexels_video","model":"pexels-video-v1","prompt_version":"b-roll-v1"},"allowed_tools":["read","write"],"per_shot_budget_cents":20,"total_budget_cents":100,"max_attempts":3,"max_concurrency":1,"provider_max_concurrency":1}}'::jsonb,
  'the referenced legacy blueprint policy remains unchanged'
);
select is(
  (select rules from public.series_versions where id = '52000000-0000-4000-8000-000000000005'),
  '{"format":"legacy","b_roll":{"executor":{"provider":"legacy-series"}}}'::jsonb,
  'the referenced series baseline remains unchanged'
);
select is(
  (select blueprint_version_id from public.episodes where id = '52000000-0000-4000-8000-000000000006'),
  '52000000-0000-4000-8000-000000000003'::uuid,
  'the existing episode keeps its blueprint reference'
);
select isnt(
  (select current_blueprint_version_id from public.accounts where id = '52000000-0000-4000-8000-000000000002'),
  '52000000-0000-4000-8000-000000000003'::uuid,
  'the account switches to an expanded blueprint version'
);
select is(
  (select policy #>> '{b_roll,credential_ref}' from public.account_blueprint_versions where id = (select current_blueprint_version_id from public.accounts where id = '52000000-0000-4000-8000-000000000002')),
  (select connection_ref from legacy_b_roll_fixture),
  'the expanded blueprint freezes the Owner-verified connection reference'
);
select is(
  (select version from public.account_blueprint_versions where id = (select current_blueprint_version_id from public.accounts where id = '52000000-0000-4000-8000-000000000002')),
  2,
  'the expanded blueprint is a new version'
);

select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $episode$select public.create_episode(
    '52000000-0000-4000-8000-000000000002',
    (select current_blueprint_version_id from public.accounts where id = '52000000-0000-4000-8000-000000000002'),
    '52000000-0000-4000-8000-000000000005',
    'New episode',
    true
  )$episode$,
  'a new episode can use the expanded legacy blueprint'
);
select is(
  (select blueprint.policy #>> '{b_roll,credential_ref}'
   from public.episodes episode
   join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
   where episode.title = 'New episode'),
  (select connection_ref from legacy_b_roll_fixture),
  'the new episode freezes the explicit Owner-verified connection reference'
);

update public.episodes
set stage = 'storyboard_approved'
where title = 'New episode';

insert into public.review_packages (id, episode_id, stage, revision_number, context_snapshot)
values (
  '52000000-0000-4000-8000-000000000007',
  (select id from public.episodes where title = 'New episode'),
  'storyboard_review',
  1,
  '{"worker_result":{"storyboard":{"shots":[{"id":"shot-1","shotType":"b_roll","productionMethod":"city","scriptSegment":"night","durationSeconds":3,"inputBasis":[]}]}},"input_artifacts":[]}'::jsonb
);
insert into public.approvals (episode_id, stage, decision, reason, actor_id, review_package_id)
values (
  (select id from public.episodes where title = 'New episode'),
  'storyboard_approved',
  'approved',
  'Use the expanded blueprint configuration.',
  '52000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000007'
);

select is(
  (select provider from public.orchestrate_b_roll_tasks_configured((select id from public.episodes where title = 'New episode'))),
  'pexels',
  'a legacy series B-roll rule cannot replace the frozen blueprint adapter'
);
select is(
  (select input_snapshot #>> '{credential_ref}' from public.tasks where episode_id = (select id from public.episodes where title = 'New episode') and task_type = 'generate_b_roll'),
  (select connection_ref from legacy_b_roll_fixture),
  'the B-roll task freezes the expanded blueprint connection reference'
);
update public.tasks
set input_snapshot = jsonb_set(input_snapshot, '{configuration_hash}', to_jsonb('legacy-series-config'::text))
where episode_id = (select id from public.episodes where title = 'New episode')
  and task_type = 'generate_b_roll';
select is(
  (select count(*) from public.orchestrate_b_roll_tasks_configured((select id from public.episodes where title = 'New episode'))),
  0::bigint,
  'a task frozen with the legacy series configuration is not recreated'
);
select is(
  (select count(*) from public.tasks where episode_id = (select id from public.episodes where title = 'New episode') and task_type = 'generate_b_roll'),
  1::bigint,
  'the existing B-roll task remains the only task for its approved shot'
);
select ok(
  not has_function_privilege('anon', 'public.orchestrate_b_roll_tasks_legacy(uuid)', 'EXECUTE'),
  'anonymous callers cannot invoke internal B-roll orchestration'
);
select ok(
  not has_function_privilege('authenticated', 'public.orchestrate_b_roll_tasks_legacy(uuid)', 'EXECUTE'),
  'signed-in callers cannot invoke internal B-roll orchestration'
);
select ok(
  has_function_privilege('service_role', 'public.orchestrate_b_roll_tasks_legacy(uuid)', 'EXECUTE'),
  'the Worker service role can invoke internal B-roll orchestration'
);

select * from finish();
rollback;
