begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

insert into auth.users (id, email)
values ('79000000-0000-4000-8000-000000000001', 'issue-79-batch@test.invalid');
insert into public.accounts (id, slug, name, timezone)
values ('79000000-0000-4000-8000-000000000002', 'issue-79-batch', 'Issue 79 batch', 'Asia/Shanghai');
insert into public.account_memberships (account_id, user_id, role)
values ('79000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000001', 'owner');

select set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.create_external_connection('google_tts', 'google_tts', 'Issue 79 Google TTS', 'issue-79-secret');
select set_config('request.jwt.claim.role', 'service_role', true);
select public.record_external_connection_verification(
  (select current_version_id from public.external_connections where created_by = '79000000-0000-4000-8000-000000000001'),
  'verified',
  'Issue 79 test connection verified.'
);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.account_blueprint_versions (id, account_id, version, policy, is_active)
values (
  '79000000-0000-4000-8000-000000000003',
  '79000000-0000-4000-8000-000000000002',
  1,
  jsonb_build_object(
    'narration', jsonb_build_object(
      'credential_ref', (select current_version_id from public.external_connections where created_by = '79000000-0000-4000-8000-000000000001'),
      'executor', jsonb_build_object('provider', 'google_tts', 'adapter', 'google_tts', 'model', 'standard', 'prompt_version', 'narration-v1'),
      'voice', jsonb_build_object('language_code', 'zh-CN', 'name', 'test-voice', 'speaking_rate', 1.0)
    )
  ),
  true
);
update public.accounts
set current_blueprint_version_id = '79000000-0000-4000-8000-000000000003'
where id = '79000000-0000-4000-8000-000000000002';

insert into public.episodes (id, account_id, blueprint_version_id, title, stage, is_test)
values (
  '79000000-0000-4000-8000-000000000004',
  '79000000-0000-4000-8000-000000000002',
  '79000000-0000-4000-8000-000000000003',
  'Issue 79 batch episode',
  'storyboard_approved',
  true
);
insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
values (
  '79000000-0000-4000-8000-000000000005',
  '79000000-0000-4000-8000-000000000004',
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
values ('79000000-0000-4000-8000-000000000006', '79000000-0000-4000-8000-000000000005', 0, '{}'::jsonb, '{}'::jsonb, 'completed');
insert into public.artifacts (id, episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id)
values ('79000000-0000-4000-8000-000000000007', '79000000-0000-4000-8000-000000000004', 'storyboard', 'episodes/79000000-0000-4000-8000-000000000004/storyboard.json', repeat('a', 64), 10, '79000000-0000-4000-8000-000000000005');
insert into public.review_packages (id, episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot)
values (
  '79000000-0000-4000-8000-000000000008',
  '79000000-0000-4000-8000-000000000004',
  '79000000-0000-4000-8000-000000000005',
  '79000000-0000-4000-8000-000000000006',
  '79000000-0000-4000-8000-000000000007',
  'storyboard_review',
  1,
  jsonb_build_object(
    'worker_result', jsonb_build_object(
      'storyboard', jsonb_build_object(
        'shots', jsonb_build_array(jsonb_build_object(
          'id', 'shot-001',
          'scriptSegment', '批量测试口播',
          'durationSeconds', 2,
          'shotType', 'a_roll',
          'productionMethod', 'manual',
          'inputBasis', jsonb_build_array()
        ))
      )
    )
  )
);
insert into public.approvals (episode_id, stage, decision, reason, actor_id, review_package_id)
values ('79000000-0000-4000-8000-000000000004', 'storyboard_approved', 'approved', 'Owner approved the storyboard.', '79000000-0000-4000-8000-000000000001', '79000000-0000-4000-8000-000000000008');

update public.shot_preparation_drafts
set tts_text = '批量测试口播', tts_voice = 'test-voice', tts_speaking_rate = 1.0
where episode_id = '79000000-0000-4000-8000-000000000004'
  and review_package_id = '79000000-0000-4000-8000-000000000008'
  and shot_id = 'shot-001';
update public.shot_preparation_drafts
set tts_text_confirmation_fingerprint = md5('批量测试口播'),
    tts_text_confirmed_at = now(),
    tts_text_confirmed_by = '79000000-0000-4000-8000-000000000001'
where episode_id = '79000000-0000-4000-8000-000000000004'
  and review_package_id = '79000000-0000-4000-8000-000000000008'
  and shot_id = 'shot-001';

create temporary table batch_result (result jsonb) on commit drop;
insert into batch_result
select public.generate_confirmed_shot_tts_batch('79000000-0000-4000-8000-000000000004', '79000000-0000-4000-8000-000000000008');

select is((select (result ->> 'created_count')::integer from batch_result), 1, 'batch RPC creates one narration task for the confirmed draft');
select is((select count(*) from public.tasks where episode_id = '79000000-0000-4000-8000-000000000004' and task_type = 'generate_narration'), 1::bigint, 'batch RPC persists the generated narration task');
select is((select provider from public.tasks where episode_id = '79000000-0000-4000-8000-000000000004' and task_type = 'generate_narration'), 'google_tts', 'generated task uses the blueprint TTS provider');
select is((select input_snapshot #>> '{credential_ref}' from public.tasks where episode_id = '79000000-0000-4000-8000-000000000004' and task_type = 'generate_narration'), (select current_version_id::text from public.external_connections where created_by = '79000000-0000-4000-8000-000000000001'), 'generated task freezes the verified connection version');
select is((select audio_status from public.shot_preparation_drafts where episode_id = '79000000-0000-4000-8000-000000000004' and shot_id = 'shot-001'), 'running', 'batch RPC marks the draft as waiting for narration execution');

select * from finish();
rollback;
