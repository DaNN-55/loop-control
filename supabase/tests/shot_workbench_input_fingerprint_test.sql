begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

insert into auth.users (id, email)
values ('83000000-0000-4000-8000-000000000001', 'issue-79-fingerprint@test.invalid');
insert into public.accounts (id, slug, name, timezone)
values ('83000000-0000-4000-8000-000000000002', 'issue-79-fingerprint', 'Issue 79 fingerprint', 'Asia/Shanghai');
insert into public.account_memberships (account_id, user_id, role)
values ('83000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', 'owner');
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.account_blueprint_versions (id, account_id, version, policy, is_active)
values ('83000000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000002', 1, '{}'::jsonb, true);
insert into public.episodes (id, account_id, blueprint_version_id, title, stage, is_test)
values ('83000000-0000-4000-8000-000000000004', '83000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000003', 'Issue 79 fingerprint episode', 'storyboard_approved', true);

insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
values ('83000000-0000-4000-8000-000000000005', '83000000-0000-4000-8000-000000000004', 'draft_storyboard', 'completed', '{}'::jsonb, 0, 1, 'codex', 'test', 'test');
insert into public.task_runs (id, task_id, attempt, task_package, result, status)
values ('83000000-0000-4000-8000-000000000006', '83000000-0000-4000-8000-000000000005', 0, '{}'::jsonb, '{}'::jsonb, 'completed');
insert into public.artifacts (id, episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id)
values ('83000000-0000-4000-8000-000000000007', '83000000-0000-4000-8000-000000000004', 'storyboard', 'episodes/83000000-0000-4000-8000-000000000004/storyboard.json', repeat('a', 64), 10, '83000000-0000-4000-8000-000000000005');
insert into public.review_packages (id, episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot)
values (
  '83000000-0000-4000-8000-000000000008',
  '83000000-0000-4000-8000-000000000004',
  '83000000-0000-4000-8000-000000000005',
  '83000000-0000-4000-8000-000000000006',
  '83000000-0000-4000-8000-000000000007',
  'storyboard_review',
  1,
  jsonb_build_object('worker_result', jsonb_build_object('storyboard', jsonb_build_object('shots', jsonb_build_array(
    jsonb_build_object('id', 'shot-001', 'scriptSegment', '指纹测试', 'durationSeconds', 3, 'shotType', 'a_roll')
  ))))
);
insert into public.approvals (episode_id, stage, decision, reason, actor_id, review_package_id)
values ('83000000-0000-4000-8000-000000000004', 'storyboard_approved', 'approved', 'Owner approved the storyboard.', '83000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000008');

insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
values ('83000000-0000-4000-8000-000000000009', '83000000-0000-4000-8000-000000000004', 'draft_storyboard', 'completed', '{}'::jsonb, 0, 1, 'codex', 'test', 'test');
insert into public.task_runs (id, task_id, attempt, task_package, result, status)
values ('83000000-0000-4000-8000-000000000010', '83000000-0000-4000-8000-000000000009', 0, '{}'::jsonb, '{}'::jsonb, 'completed');
insert into public.artifacts (id, episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id)
values ('83000000-0000-4000-8000-000000000011', '83000000-0000-4000-8000-000000000004', 'storyboard', 'episodes/83000000-0000-4000-8000-000000000004/storyboard-2.json', repeat('b', 64), 10, '83000000-0000-4000-8000-000000000009');
insert into public.review_packages (id, episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot)
values (
  '83000000-0000-4000-8000-000000000012',
  '83000000-0000-4000-8000-000000000004',
  '83000000-0000-4000-8000-000000000009',
  '83000000-0000-4000-8000-000000000010',
  '83000000-0000-4000-8000-000000000011',
  'storyboard_review',
  2,
  jsonb_build_object('worker_result', jsonb_build_object('storyboard', jsonb_build_object('shots', jsonb_build_array(
    jsonb_build_object('id', 'shot-002', 'scriptSegment', '其他包', 'durationSeconds', 3, 'shotType', 'a_roll')
  ))))
);

update public.shot_preparation_drafts
set input_fingerprint = null
where review_package_id = '83000000-0000-4000-8000-000000000008' and shot_id = 'shot-001';
insert into public.shot_preparation_drafts (episode_id, review_package_id, shot_id, subtitle_text, input_fingerprint)
values ('83000000-0000-4000-8000-000000000004', '83000000-0000-4000-8000-000000000012', 'shot-001', '其他镜头', null);

update public.shot_preparation_drafts draft
set input_fingerprint = md5(shot.value::text)
from public.review_packages package,
  lateral jsonb_array_elements(coalesce(package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
where draft.review_package_id = package.id
  and draft.episode_id = package.episode_id
  and draft.shot_id = shot.value ->> 'id'
  and draft.input_fingerprint is null;

select is(
  (select input_fingerprint from public.shot_preparation_drafts where review_package_id = '83000000-0000-4000-8000-000000000008' and shot_id = 'shot-001'),
  md5((select context_snapshot #> '{worker_result,storyboard,shots,0}' from public.review_packages where id = '83000000-0000-4000-8000-000000000008')::text),
  'the legacy draft is backfilled from its own package shot'
);
select is(
  (select input_fingerprint from public.shot_preparation_drafts where review_package_id = '83000000-0000-4000-8000-000000000012' and shot_id = 'shot-001'),
  null,
  'a different package and shot do not receive the backfill'
);

insert into public.production_material_revisions (id, episode_id, revision_number, material_type, material_purpose, source_kind, source_path, storage_path, mime_type, sha256, file_size, is_main_script, created_by)
values ('83000000-0000-4000-8000-000000000013', '83000000-0000-4000-8000-000000000004', 1, 'video', 'a_roll', 'file', '/tmp/source.mov', 'episodes/83000000-0000-4000-8000-000000000004/materials/source.mov', 'video/quicktime', repeat('c', 64), 100, false, '83000000-0000-4000-8000-000000000001');
insert into public.material_revision_approvals (material_revision_id, approved_by)
values ('83000000-0000-4000-8000-000000000013', '83000000-0000-4000-8000-000000000001');

select public.save_shot_workbench_draft(
  '83000000-0000-4000-8000-000000000004',
  '83000000-0000-4000-8000-000000000008',
  'shot-001',
  '83000000-0000-4000-8000-000000000013',
  '[{"start_seconds": 0, "end_seconds": 3}]'::jsonb,
  'none',
  '指纹测试',
  true,
  null,
  null,
  null
);
select is(
  (select input_fingerprint from public.shot_preparation_drafts where review_package_id = '83000000-0000-4000-8000-000000000008' and shot_id = 'shot-001'),
  md5((select context_snapshot #> '{worker_result,storyboard,shots,0}' from public.review_packages where id = '83000000-0000-4000-8000-000000000008')::text),
  'future workbench saves keep the current package fingerprint'
);
select is(
  (select selected_material_revision_id from public.shot_preparation_drafts where review_package_id = '83000000-0000-4000-8000-000000000008' and shot_id = 'shot-001'),
  '83000000-0000-4000-8000-000000000013'::uuid,
  'future workbench saves still persist the selected material'
);
select ok(
  position('input_fingerprint = md5(selected_shot::text)' in pg_get_functiondef('public.save_shot_workbench_draft(uuid,uuid,text,uuid,jsonb,text,text,boolean,text,text,numeric)'::regprocedure)) > 0,
  'the deployed workbench function contains the fingerprint assignment'
);

select * from finish();
rollback;
