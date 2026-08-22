begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

\ir ../migrations/20260822130625_freeze_script_harness.sql

insert into auth.users (id, email)
values ('53000000-0000-4000-8000-000000000001', 'issue-53-harness@test.invalid');

insert into public.accounts (id, slug, name, timezone)
values ('53000000-0000-4000-8000-000000000002', 'issue-53-harness', 'Issue 53 Harness', 'Asia/Shanghai');

insert into public.account_memberships (account_id, user_id, role)
values ('53000000-0000-4000-8000-000000000002', '53000000-0000-4000-8000-000000000001', 'owner');

insert into public.prompt_versions (id, account_id, capability, version, slug, name, summary, instructions)
values (
  '53000000-0000-4000-8000-000000000003',
  '53000000-0000-4000-8000-000000000002',
  'script_writing',
  2,
  'script-writing-v2',
  'Harness v2',
  'Frozen script harness.',
  'Write one reviewable script and never approve or publish it.'
);

select is(
  (select content_hash from public.prompt_versions where id = '53000000-0000-4000-8000-000000000003'),
  encode(extensions.digest('Write one reviewable script and never approve or publish it.', 'sha256'), 'hex'),
  'a Harness stores a stable hash of its full content'
);

select throws_ok(
  $$update public.prompt_versions set instructions = 'Replacement' where id = '53000000-0000-4000-8000-000000000003'$$,
  'P0001',
  'Prompt Harness content is immutable',
  'Harness content cannot be overwritten'
);

select throws_ok(
  $$insert into public.prompt_versions (account_id, capability, version, slug, name, summary, instructions) values ('53000000-0000-4000-8000-000000000002', 'script_writing', 3, 'script-writing-v3', 'Empty Harness', 'Must fail', '')$$,
  '22023',
  'Prompt Harness content is required',
  'Harness content cannot be empty'
);

insert into public.account_blueprint_versions (id, account_id, version, policy, is_active)
values (
  '53000000-0000-4000-8000-000000000004',
  '53000000-0000-4000-8000-000000000002',
  1,
  jsonb_build_object(
    'positioning', 'Initial positioning',
    'allowed_tools', jsonb_build_array('read', 'write'),
    'budgets', jsonb_build_object('script_writing_cents', 42),
    'executors', jsonb_build_object('script_writing', jsonb_build_object(
      'adapter', 'codex',
      'harness_id', '53000000-0000-4000-8000-000000000003',
      'model', 'gpt-5.6-codex'
    ))
  ),
  true
);

update public.accounts
set current_blueprint_version_id = '53000000-0000-4000-8000-000000000004'
where id = '53000000-0000-4000-8000-000000000002';

insert into public.episodes (id, account_id, blueprint_version_id, title, stage, script_source, is_test)
values (
  '53000000-0000-4000-8000-000000000005',
  '53000000-0000-4000-8000-000000000002',
  '53000000-0000-4000-8000-000000000004',
  'Commissioned episode',
  'waiting_input',
  'provided',
  true
);

select set_config('request.jwt.claim.sub', '53000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.commission_script('53000000-0000-4000-8000-000000000005', 'Follow the account direction.', 'This episode needs a focused prompt.')$$,
  'a delegated commission freezes the selected Codex Harness'
);

select is(
  (select input_snapshot -> 'harness' from public.tasks where episode_id = '53000000-0000-4000-8000-000000000005' and task_type = 'draft_script'),
  jsonb_build_object(
    'id', '53000000-0000-4000-8000-000000000003',
    'version', 2,
    'content', 'Write one reviewable script and never approve or publish it.',
    'content_hash', (select content_hash from public.prompt_versions where id = '53000000-0000-4000-8000-000000000003'),
    'adapter', 'codex',
    'model', 'gpt-5.6-codex',
    'prompt_version', 'script-writing-v2'
  ),
  'the task freezes Harness identity, version, content, and hash'
);

select is(
  (select input_snapshot -> 'executor' from public.tasks where episode_id = '53000000-0000-4000-8000-000000000005' and task_type = 'draft_script'),
  '{"provider":"codex","adapter":"codex","model":"gpt-5.6-codex","prompt_version":"script-writing-v2"}'::jsonb,
  'the task freezes the registered Codex adapter and model'
);

select is(
  (select script_source from public.episodes where id = '53000000-0000-4000-8000-000000000005'),
  'delegated',
  'commissioning atomically records the delegated script source'
);

select is(
  (select input_snapshot #>> '{prompt_context,account_defaults,positioning}' from public.tasks where episode_id = '53000000-0000-4000-8000-000000000005' and task_type = 'draft_script'),
  'Initial positioning',
  'the task freezes its layered Prompt context'
);

update public.account_blueprint_versions
set policy = jsonb_set(jsonb_set(policy, '{executors,script_writing,model}', to_jsonb('gpt-5.6-luna'::text)), '{positioning}', to_jsonb('Later positioning'::text))
where id = '53000000-0000-4000-8000-000000000004';

select is(
  (select input_snapshot #>> '{executor,model}' from public.tasks where episode_id = '53000000-0000-4000-8000-000000000005' and task_type = 'draft_script'),
  'gpt-5.6-codex',
  'later blueprint changes do not affect the existing task'
);

select is(
  (select input_snapshot #>> '{prompt_context,account_defaults,positioning}' from public.tasks where episode_id = '53000000-0000-4000-8000-000000000005' and task_type = 'draft_script'),
  'Initial positioning',
  'later blueprint changes do not replace frozen Prompt context'
);

insert into public.episodes (id, account_id, blueprint_version_id, title, stage, script_source, is_test)
values (
  '53000000-0000-4000-8000-000000000006',
  '53000000-0000-4000-8000-000000000002',
  '53000000-0000-4000-8000-000000000004',
  'Imported episode',
  'waiting_input',
  'provided',
  true
);

select lives_ok(
  $$select public.import_production_material('53000000-0000-4000-8000-000000000006', 'script', 'file', '/tmp/imported.md', 'episodes/53000000-0000-4000-8000-000000000006/materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-imported.md', 'text/markdown', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 9, true, 'main_script')$$,
  'an imported script remains on the external-input path'
);

select is(
  (select count(*) from public.tasks where episode_id = '53000000-0000-4000-8000-000000000006' and task_type = 'draft_script'),
  0::bigint,
  'an imported script does not create a draft-script task'
);

select * from finish();
rollback;
