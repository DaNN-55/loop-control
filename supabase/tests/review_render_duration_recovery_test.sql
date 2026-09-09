begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

insert into auth.users (id, email)
values ('85000000-0000-4000-8000-000000000001', 'issue-79-duration-recovery@test.invalid');
insert into public.accounts (id, slug, name, timezone)
values ('85000000-0000-4000-8000-000000000002', 'issue-79-duration-recovery', 'Issue 79 duration recovery', 'Asia/Shanghai');
insert into public.account_memberships (account_id, user_id, role)
values ('85000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000001', 'owner');
insert into public.account_blueprint_versions (id, account_id, version, policy, is_active)
values ('85000000-0000-4000-8000-000000000003', '85000000-0000-4000-8000-000000000002', 1, '{}'::jsonb, true);
insert into public.series (id, account_id, name)
values ('85000000-0000-4000-8000-000000000004', '85000000-0000-4000-8000-000000000002', 'Issue 79 duration series');
insert into public.series_versions (id, account_id, series_id, version, rules, created_by)
values ('85000000-0000-4000-8000-000000000005', '85000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000004', 7, '{"format":"9:16"}'::jsonb, '85000000-0000-4000-8000-000000000001');
insert into public.episodes (id, account_id, blueprint_version_id, series_version_id, title, stage, is_test)
values ('85000000-0000-4000-8000-000000000006', '85000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000003', '85000000-0000-4000-8000-000000000005', 'Issue 79 duration recovery episode', 'render_ready', true);
insert into public.review_packages (id, episode_id, stage, revision_number, context_snapshot)
values ('85000000-0000-4000-8000-000000000007', '85000000-0000-4000-8000-000000000006', 'production_ready', 1, '{}'::jsonb);
insert into public.review_render_composition_revisions (id, episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, composition_config)
values ('85000000-0000-4000-8000-000000000008', '85000000-0000-4000-8000-000000000006', '85000000-0000-4000-8000-000000000007', 1, 'cinematic', 'standard', 'cover', 'fade', 'lower_third', '原始合成配置。', '{"aspect_ratio":"9:16","width":1080,"height":1920,"captions_enabled":true,"caption_style":"cinematic","pacing":"standard","crop":"cover","transition":"fade","layout":"lower_third","narration_gain_db":0,"bgm_gain_db":-12,"sfx_gain_db":-6}'::jsonb);
insert into public.review_render_composition_revisions (id, episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, composition_config)
values ('85000000-0000-4000-8000-000000000012', '85000000-0000-4000-8000-000000000006', '85000000-0000-4000-8000-000000000007', 2, 'cinematic', 'standard', 'cover', 'fade', 'lower_third', '其他合成配置。', '{"aspect_ratio":"9:16","width":1080,"height":1920,"captions_enabled":true,"caption_style":"cinematic","pacing":"standard","crop":"cover","transition":"fade","layout":"lower_third","narration_gain_db":0,"bgm_gain_db":-12,"sfx_gain_db":-6}'::jsonb);

insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, last_result)
values (
  '85000000-0000-4000-8000-000000000009',
  '85000000-0000-4000-8000-000000000006',
  'generate_review_render',
  'blocked',
  jsonb_build_object(
    'series_baseline', jsonb_build_object('version_id', '85000000-0000-4000-8000-000000000005', 'version', 7, 'rules', '{"format":"9:16"}'::jsonb),
    'review_render', jsonb_build_object('pre_render_review_package_id', '85000000-0000-4000-8000-000000000007', 'composition_revision_id', '85000000-0000-4000-8000-000000000008', 'project_revision', 1, 'project_relative_path', 'episodes/85000000-0000-4000-8000-000000000006/review-render/v1/index.html'),
    'output', jsonb_build_object('relative_path', 'episodes/85000000-0000-4000-8000-000000000006/review-render/v1/review-render.mp4')
  ),
  0, 1, 'hyperframes', 'hyperframes@0.7.109', 'review-render-v4', '{"status":"blocked","blockers":[{"code":"task_package_invalid","detail":"镜头时长判定格式无效。"}]}'::jsonb
);
insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, last_result)
values (
  '85000000-0000-4000-8000-000000000010',
  '85000000-0000-4000-8000-000000000006',
  'generate_review_render',
  'blocked',
  jsonb_build_object(
    'series_baseline', jsonb_build_object('version_id', '85000000-0000-4000-8000-000000000005', 'version', 7, 'rules', '{"format":"9:16"}'::jsonb),
    'review_render', jsonb_build_object('pre_render_review_package_id', '85000000-0000-4000-8000-000000000007', 'composition_revision_id', '85000000-0000-4000-8000-000000000012', 'project_revision', 2, 'project_relative_path', 'episodes/85000000-0000-4000-8000-000000000006/review-render/v2-other/index.html'),
    'output', jsonb_build_object('relative_path', 'episodes/85000000-0000-4000-8000-000000000006/review-render/v2-other/review-render.mp4')
  ),
  0, 1, 'hyperframes', 'hyperframes@0.7.109', 'review-render-v4', '{"status":"blocked","blockers":[{"code":"task_package_invalid","detail":"其他格式错误。"}]}'::jsonb
);

select is((select count(*) from public.tasks where task_type = 'generate_review_render' and status = 'blocked' and (input_snapshot #>> '{series_baseline,version}')::integer > 0 and exists (select 1 from jsonb_array_elements(last_result -> 'blockers') blocker where blocker ->> 'code' = 'task_package_invalid' and blocker ->> 'detail' = '镜头时长判定格式无效。')), 1::bigint, 'one valid-series duration-invalid task is targeted');
select is((select last_result from public.tasks where id = '85000000-0000-4000-8000-000000000009'), '{"status":"blocked","blockers":[{"code":"task_package_invalid","detail":"镜头时长判定格式无效。"}]}'::jsonb, 'the duration-invalid task keeps its original result before recovery');

select public.recover_duration_decision_review_render_tasks();

select is((select status from public.tasks where id = '85000000-0000-4000-8000-000000000009'), 'blocked', 'the duration-invalid task remains blocked');
select is((select last_result from public.tasks where id = '85000000-0000-4000-8000-000000000009'), '{"status":"blocked","blockers":[{"code":"task_package_invalid","detail":"镜头时长判定格式无效。"}]}'::jsonb, 'the duration-invalid task result remains unchanged');
select is((select count(*) from public.tasks where episode_id = '85000000-0000-4000-8000-000000000006' and task_type = 'generate_review_render' and status = 'ready'), 1::bigint, 'one replacement review render task is ready');
select is((select input_snapshot #>> '{series_baseline,version_id}' from public.tasks where input_snapshot ->> 'recovered_from_task_id' = '85000000-0000-4000-8000-000000000009'), '85000000-0000-4000-8000-000000000005', 'the replacement keeps the series version id');
select is((select (input_snapshot #>> '{series_baseline,version}')::integer from public.tasks where input_snapshot ->> 'recovered_from_task_id' = '85000000-0000-4000-8000-000000000009'), 7, 'the replacement keeps the valid series version');
select is((select (input_snapshot #>> '{review_render,project_revision}')::integer from public.tasks where input_snapshot ->> 'recovered_from_task_id' = '85000000-0000-4000-8000-000000000009'), 3, 'the replacement advances the project revision');
select is((select input_snapshot #>> '{output,relative_path}' from public.tasks where input_snapshot ->> 'recovered_from_task_id' = '85000000-0000-4000-8000-000000000009'), 'episodes/85000000-0000-4000-8000-000000000006/review-render/v3/review-render.mp4', 'the replacement uses a new output path');
select is((select revision_number from public.review_render_composition_revisions where id = (select (input_snapshot #>> '{review_render,composition_revision_id}')::uuid from public.tasks where input_snapshot ->> 'recovered_from_task_id' = '85000000-0000-4000-8000-000000000009')), 3, 'the replacement uses a new composition revision');
select is((select count(*) from public.tasks where id = '85000000-0000-4000-8000-000000000010' and status = 'blocked' and input_snapshot ->> 'recovered_from_task_id' is null), 1::bigint, 'a task with the same code but wrong detail is untouched and not recovered');

select public.recover_duration_decision_review_render_tasks();

select is((select count(*) from public.tasks where input_snapshot ->> 'recovered_from_task_id' = '85000000-0000-4000-8000-000000000009'), 1::bigint, 'recovery is idempotent');
select is((select count(*) from public.review_render_composition_revisions where pre_render_review_package_id = '85000000-0000-4000-8000-000000000007'), 3::bigint, 'recovery creates only one new composition revision');

select * from finish();
rollback;
