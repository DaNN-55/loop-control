begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

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

\ir ../migrations/20260822104421_expand_legacy_b_roll_blueprints.sql

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
  'pexels-default',
  'the expanded blueprint freezes the legacy connection reference'
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
  'pexels-default',
  'the new episode freezes the explicit connection reference'
);

select * from finish();
rollback;
