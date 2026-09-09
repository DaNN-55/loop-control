begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

insert into auth.users (id, email)
values ('82000000-0000-4000-8000-000000000001', 'issue-79-clip@test.invalid');
insert into public.accounts (id, slug, name, timezone)
values ('82000000-0000-4000-8000-000000000002', 'issue-79-clip', 'Issue 79 clip', 'Asia/Shanghai');
insert into public.account_memberships (account_id, user_id, role)
values ('82000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'owner');

select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.account_blueprint_versions (id, account_id, version, policy, is_active)
values (
  '82000000-0000-4000-8000-000000000003',
  '82000000-0000-4000-8000-000000000002',
  1,
  '{}'::jsonb,
  true
);
update public.accounts
set current_blueprint_version_id = '82000000-0000-4000-8000-000000000003'
where id = '82000000-0000-4000-8000-000000000002';

insert into public.episodes (id, account_id, blueprint_version_id, title, stage, is_test)
values ('82000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000003', 'Issue 79 clip episode', 'storyboard_approved', true);

insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
values (
  '82000000-0000-4000-8000-000000000005',
  '82000000-0000-4000-8000-000000000004',
  'draft_storyboard',
  'completed',
  '{}'::jsonb,
  0,
  1,
  'codex',
  'test',
  'test'
);
insert into public.task_runs (id, task_id, attempt, task_package, result, status)
values ('82000000-0000-4000-8000-000000000006', '82000000-0000-4000-8000-000000000005', 0, '{}'::jsonb, '{}'::jsonb, 'completed');
insert into public.artifacts (id, episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id)
values ('82000000-0000-4000-8000-000000000007', '82000000-0000-4000-8000-000000000004', 'storyboard', 'episodes/82000000-0000-4000-8000-000000000004/storyboard.json', repeat('a', 64), 10, '82000000-0000-4000-8000-000000000005');
insert into public.review_packages (id, episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot)
values (
  '82000000-0000-4000-8000-000000000008',
  '82000000-0000-4000-8000-000000000004',
  '82000000-0000-4000-8000-000000000005',
  '82000000-0000-4000-8000-000000000006',
  '82000000-0000-4000-8000-000000000007',
  'storyboard_review',
  1,
  jsonb_build_object('worker_result', jsonb_build_object('storyboard', jsonb_build_object('shots', jsonb_build_array(
    jsonb_build_object('id', 'shot-001', 'scriptSegment', '准备片段测试', 'durationSeconds', 3, 'shotType', 'a_roll', 'productionMethod', 'manual', 'inputBasis', jsonb_build_array())
  ))))
);
insert into public.approvals (episode_id, stage, decision, reason, actor_id, review_package_id)
values ('82000000-0000-4000-8000-000000000004', 'storyboard_approved', 'approved', 'Owner approved the storyboard.', '82000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000008');

insert into public.production_material_revisions (id, episode_id, revision_number, material_type, material_purpose, source_kind, source_path, storage_path, mime_type, sha256, file_size, is_main_script, created_by)
values ('82000000-0000-4000-8000-000000000009', '82000000-0000-4000-8000-000000000004', 1, 'video', 'a_roll', 'file', '/tmp/source.mov', 'episodes/82000000-0000-4000-8000-000000000004/materials/source.mov', 'video/quicktime', repeat('b', 64), 100, false, '82000000-0000-4000-8000-000000000001');
insert into public.material_revision_approvals (material_revision_id, approved_by)
values ('82000000-0000-4000-8000-000000000009', '82000000-0000-4000-8000-000000000001');

update public.shot_preparation_drafts
set audio_mode = 'none', selected_material_revision_id = '82000000-0000-4000-8000-000000000009', clip_segments = '[{"start_seconds": 0, "end_seconds": 3}]'::jsonb, video_duration_seconds = 3
where episode_id = '82000000-0000-4000-8000-000000000004' and review_package_id = '82000000-0000-4000-8000-000000000008' and shot_id = 'shot-001';

insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, actual_cost_cents, completed_at, last_result)
values (
  '82000000-0000-4000-8000-000000000010',
  '82000000-0000-4000-8000-000000000004',
  'generate_a_roll',
  'completed',
  jsonb_build_object('capability', 'a_roll_manual_upload', 'storyboard_review_package_id', '82000000-0000-4000-8000-000000000008', 'shot', jsonb_build_object('id', 'shot-001', 'shotType', 'a_roll', 'durationSeconds', 3)),
  0,
  1,
  'manual_upload',
  'owner-provided-video',
  'manual-a-roll-v1',
  0,
  now(),
  '{"status":"completed"}'::jsonb
);

insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, actual_cost_cents, completed_at, last_result)
values (
  '82000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000004',
  'generate_a_roll',
  'completed',
  jsonb_build_object('capability', 'a_roll_manual_upload', 'storyboard_review_package_id', '82000000-0000-4000-8000-000000000008', 'pre_render_revision', 'revision-2', 'shot', jsonb_build_object('id', 'shot-001', 'shotType', 'a_roll', 'durationSeconds', 3)),
  0,
  1,
  'manual_upload',
  'owner-provided-video',
  'manual-a-roll-v1',
  0,
  now(),
  '{"status":"completed"}'::jsonb
);

select is((select input_snapshot #>> '{shot_preparation,draft_id}' from public.tasks where id = '82000000-0000-4000-8000-000000000010'), null, 'the completed manual task has no draft id');
select is((select count(*) from public.tasks where episode_id = '82000000-0000-4000-8000-000000000004' and task_type = 'generate_a_roll' and coalesce(input_snapshot ->> 'pre_render_revision', '') = '' and status <> 'superseded'), 1::bigint, 'the completed manual task initially occupies the current A-roll key');
select is((select count(*) from public.tasks where episode_id = '82000000-0000-4000-8000-000000000004' and task_type = 'generate_a_roll' and input_snapshot ->> 'pre_render_revision' = 'revision-2' and status <> 'superseded'), 1::bigint, 'a different pre-render revision remains independently addressable');

select ok(position('and task.input_snapshot #>> ''{shot_preparation,draft_id}'' = draft.id::text' in pg_get_functiondef('public.generate_shot_clip(uuid,uuid,text,boolean)'::regprocedure)) > 0, 'idempotency lookup still keys by the current draft id');
select ok(position('and task.input_snapshot ->> ''configuration_hash'' = config_hash' in pg_get_functiondef('public.generate_shot_clip(uuid,uuid,text,boolean)'::regprocedure)) > 0, 'idempotency lookup still keys by configuration hash');

select public.generate_shot_clip('82000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000008', 'shot-001', false);

select is((select status from public.tasks where id = '82000000-0000-4000-8000-000000000010'), 'superseded', 'the completed manual task is superseded by the replacement');
select is((select count(*) from public.tasks where episode_id = '82000000-0000-4000-8000-000000000004' and task_type = 'generate_a_roll' and coalesce(input_snapshot ->> 'pre_render_revision', '') = '' and status <> 'superseded'), 1::bigint, 'the replacement leaves one active A-roll task for the current revision');
select is((select status from public.tasks where episode_id = '82000000-0000-4000-8000-000000000004' and task_type = 'generate_a_roll' and coalesce(input_snapshot ->> 'pre_render_revision', '') = '' and status <> 'superseded'), 'ready', 'the replacement task is ready for the Worker');
select is((select input_snapshot ->> 'storyboard_review_package_id' from public.tasks where episode_id = '82000000-0000-4000-8000-000000000004' and task_type = 'generate_a_roll' and coalesce(input_snapshot ->> 'pre_render_revision', '') = '' and status <> 'superseded'), '82000000-0000-4000-8000-000000000008', 'the replacement keeps the storyboard package key');
select is((select input_snapshot #>> '{shot,id}' from public.tasks where episode_id = '82000000-0000-4000-8000-000000000004' and task_type = 'generate_a_roll' and coalesce(input_snapshot ->> 'pre_render_revision', '') = '' and status <> 'superseded'), 'shot-001', 'the replacement keeps the shot key');
select is((select video_status from public.shot_preparation_drafts where episode_id = '82000000-0000-4000-8000-000000000004' and shot_id = 'shot-001'), 'running', 'the draft waits for the replacement clip');
select is((select status from public.tasks where id = '82000000-0000-4000-8000-000000000011'), 'completed', 'a different pre-render revision is not superseded');

select * from finish();
rollback;
