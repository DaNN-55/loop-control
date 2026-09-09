begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

insert into auth.users (id, email)
values ('77000000-0000-4000-8000-000000000001', 'issue-77-owner@test.invalid');

insert into public.accounts (id, slug, name, timezone)
values ('77000000-0000-4000-8000-000000000002', 'issue-77-structure', 'Issue 77 structure', 'Asia/Shanghai');

insert into public.account_memberships (account_id, user_id, role)
values ('77000000-0000-4000-8000-000000000002', '77000000-0000-4000-8000-000000000001', 'owner');

insert into public.account_blueprint_versions (id, account_id, version, policy, is_active)
values (
  '77000000-0000-4000-8000-000000000003',
  '77000000-0000-4000-8000-000000000002',
  1,
  '{}'::jsonb,
  true
);

update public.accounts
set current_blueprint_version_id = '77000000-0000-4000-8000-000000000003'
where id = '77000000-0000-4000-8000-000000000002';

insert into public.episodes (id, account_id, blueprint_version_id, title, stage)
values (
  '77000000-0000-4000-8000-000000000004',
  '77000000-0000-4000-8000-000000000002',
  '77000000-0000-4000-8000-000000000003',
  'Issue 77 structure revision',
  'storyboard_approved'
);

insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
values (
  '77000000-0000-4000-8000-000000000005',
  '77000000-0000-4000-8000-000000000004',
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
values (
  '77000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000005',
  0,
  '{}'::jsonb,
  '{}'::jsonb,
  'completed'
);

insert into public.artifacts (id, episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id)
values (
  '77000000-0000-4000-8000-000000000007',
  '77000000-0000-4000-8000-000000000004',
  'storyboard',
  'episodes/77000000-0000-4000-8000-000000000004/storyboard.json',
  repeat('a', 64),
  10,
  '77000000-0000-4000-8000-000000000005'
);

insert into public.review_packages (id, episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot)
values (
  '77000000-0000-4000-8000-000000000008',
  '77000000-0000-4000-8000-000000000004',
  '77000000-0000-4000-8000-000000000005',
  '77000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000007',
  'storyboard_review',
  1,
  jsonb_build_object(
    'worker_result', jsonb_build_object(
      'storyboard', jsonb_build_object(
        'version', 'storyboard/v1',
        'audioCues', jsonb_build_array(),
        'shots', jsonb_build_array(
          jsonb_build_object('id', 's1', 'scriptSegment', '第一镜头', 'durationSeconds', 4, 'shotType', 'a_roll', 'productionMethod', 'manual', 'inputBasis', jsonb_build_array(jsonb_build_object('relativePath', 'script.md', 'sha256', repeat('a', 64))), 'targetSpec', '固定'),
          jsonb_build_object('id', 's2', 'scriptSegment', '第二镜头', 'durationSeconds', 4, 'shotType', 'b_roll', 'productionMethod', 'manual', 'inputBasis', jsonb_build_array(jsonb_build_object('relativePath', 'script.md', 'sha256', repeat('a', 64))), 'targetSpec', '固定')
        )
      )
    )
  )
);

select set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000001', true);

insert into public.approvals (episode_id, stage, decision, reason, actor_id, review_package_id)
values ('77000000-0000-4000-8000-000000000004', 'storyboard_approved', 'approved', 'Owner approved the storyboard.', '77000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000008');

select is(
  public.canonical_storyboard_structure_revision_operation(jsonb_build_object(
    'kind', 'add_after', 'afterShotId', 's1',
    'shot', jsonb_build_object('id', 'client-a', 'scriptSegment', '新增', 'durationSeconds', 2, 'inputBasis', jsonb_build_array(jsonb_build_object('relativePath', 'client-a.md', 'sha256', repeat('b', 64))))
  )),
  public.canonical_storyboard_structure_revision_operation(jsonb_build_object(
    'kind', 'add_after', 'afterShotId', 's1',
    'shot', jsonb_build_object('id', 'client-b', 'scriptSegment', '新增', 'durationSeconds', 2, 'inputBasis', jsonb_build_array(jsonb_build_object('relativePath', 'client-b.md', 'sha256', repeat('c', 64))))
  )),
  'client-generated IDs and input basis do not change the idempotency key'
);

select id from public.request_shot_structure_revision(
  '77000000-0000-4000-8000-000000000004',
  '77000000-0000-4000-8000-000000000008',
  jsonb_build_object('kind', 'add_after', 'afterShotId', 's1', 'shot', jsonb_build_object('id', 'client-a', 'scriptSegment', '新增', 'durationSeconds', 2, 'inputBasis', jsonb_build_array(jsonb_build_object('relativePath', 'client-a.md', 'sha256', repeat('b', 64))))),
  'Owner needs one additional opening shot.'
) \gset first_revision_

select id from public.request_shot_structure_revision(
  '77000000-0000-4000-8000-000000000004',
  '77000000-0000-4000-8000-000000000008',
  jsonb_build_object('kind', 'add_after', 'afterShotId', 's1', 'shot', jsonb_build_object('id', 'client-b', 'scriptSegment', '新增', 'durationSeconds', 2, 'inputBasis', jsonb_build_array(jsonb_build_object('relativePath', 'client-b.md', 'sha256', repeat('c', 64))))),
  'Owner needs one additional opening shot.'
) \gset second_revision_

select is(:'first_revision_id'::uuid, :'second_revision_id'::uuid, 'the same semantic request returns the same task');
select is((select count(*) from public.tasks where episode_id = '77000000-0000-4000-8000-000000000004' and task_type = 'draft_storyboard_revision'), 1::bigint, 'idempotency creates one revision task');
select ok((select input_snapshot #>> '{storyboard_revision,operation,shot,id}' from public.tasks where id = :'first_revision_id'::uuid) <> 'client-a', 'the server owns generated shot IDs');
select ok((select input_snapshot #>> '{storyboard_revision,operation,shot,id}' from public.tasks where id = :'first_revision_id'::uuid) = (select input_snapshot #>> '{storyboard_revision,operation,shot,id}' from public.tasks where id = :'second_revision_id'::uuid), 'generated shot IDs remain stable across retries');
select throws_ok(
  $$select public.request_shot_structure_revision('77000000-0000-4000-8000-000000000004', '77000000-0000-4000-8000-000000000008', '{"kind":"delete","shotId":"s2"}'::jsonb, 'a competing structure change')$$,
  '22023',
  'A storyboard structure revision is already running',
  'a different structure operation cannot run beside the active revision'
);
update public.tasks set status = 'failed' where id = :'first_revision_id'::uuid;

insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
values
  ('77000000-0000-4000-8000-000000000013', '77000000-0000-4000-8000-000000000004', 'generate_a_roll', 'completed', '{}'::jsonb, 0, 1, 'manual_upload', 'manual', 'test'),
  ('77000000-0000-4000-8000-000000000014', '77000000-0000-4000-8000-000000000004', 'generate_narration', 'completed', '{}'::jsonb, 0, 1, 'test', 'test', 'test');
insert into public.artifacts (id, episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id)
values
  ('77000000-0000-4000-8000-000000000015', '77000000-0000-4000-8000-000000000004', 'prepared_shot_video', 'episodes/77000000-0000-4000-8000-000000000004/video-s1.mp4', repeat('d', 64), 10, '77000000-0000-4000-8000-000000000013'),
  ('77000000-0000-4000-8000-000000000016', '77000000-0000-4000-8000-000000000004', 'shot_narration', 'episodes/77000000-0000-4000-8000-000000000004/audio-s1.mp3', repeat('e', 64), 10, '77000000-0000-4000-8000-000000000014');
insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds)
values ('77000000-0000-4000-8000-000000000004', '77000000-0000-4000-8000-000000000014', '77000000-0000-4000-8000-000000000016', '77000000-0000-4000-8000-000000000008', 'narration', 's1', 'episodes/77000000-0000-4000-8000-000000000004/audio-s1.mp3', repeat('e', 64), 10, 0, 4);
update public.shot_preparation_drafts
set current_video_artifact_id = '77000000-0000-4000-8000-000000000015', current_video_task_id = '77000000-0000-4000-8000-000000000013', video_status = 'ready', current_audio_track_id = (select id from public.audio_tracks where source_task_id = '77000000-0000-4000-8000-000000000014'), current_tts_task_id = '77000000-0000-4000-8000-000000000014', audio_status = 'ready', confirmation_status = 'confirmed'
where episode_id = '77000000-0000-4000-8000-000000000004' and review_package_id = '77000000-0000-4000-8000-000000000008' and shot_id = 's1';

insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
values ('77000000-0000-4000-8000-000000000009', '77000000-0000-4000-8000-000000000004', 'draft_storyboard', 'completed', '{}'::jsonb, 0, 1, 'codex', 'test', 'test');
insert into public.task_runs (id, task_id, attempt, task_package, result, status)
values ('77000000-0000-4000-8000-000000000010', '77000000-0000-4000-8000-000000000009', 0, '{}'::jsonb, '{}'::jsonb, 'completed');
insert into public.artifacts (id, episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id)
values ('77000000-0000-4000-8000-000000000011', '77000000-0000-4000-8000-000000000004', 'storyboard', 'episodes/77000000-0000-4000-8000-000000000004/storyboard-2.json', repeat('b', 64), 10, '77000000-0000-4000-8000-000000000009');
insert into public.review_packages (id, episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot)
select '77000000-0000-4000-8000-000000000012', episode_id, '77000000-0000-4000-8000-000000000009', '77000000-0000-4000-8000-000000000010', '77000000-0000-4000-8000-000000000011', stage, 2, context_snapshot from public.review_packages where id = '77000000-0000-4000-8000-000000000008';
insert into public.approvals (episode_id, stage, decision, reason, actor_id, review_package_id)
values ('77000000-0000-4000-8000-000000000004', 'storyboard_approved', 'approved', 'Owner approved the revised storyboard.', '77000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000012');

select is((select current_video_task_id from public.shot_preparation_drafts where review_package_id = '77000000-0000-4000-8000-000000000012' and shot_id = 's1'), '77000000-0000-4000-8000-000000000013'::uuid, 'an unchanged shot reuses a valid completed video task');
select is((select count(*) from public.audio_tracks where source_review_package_id = '77000000-0000-4000-8000-000000000012' and source_task_id = '77000000-0000-4000-8000-000000000014' and cue_id = 's1'), 1::bigint, 'an unchanged shot copies a valid completed audio history into the new package');

select throws_ok(
  $$select public.request_shot_structure_revision('77000000-0000-4000-8000-000000000004', '77000000-0000-4000-8000-000000000008', '{"kind":"delete","shotId":"s2"}'::jsonb, 'stale package')$$,
  '22023',
  'The storyboard review package is stale',
  'an older active storyboard package cannot receive a revision'
);

select id from public.request_shot_structure_revision(
  '77000000-0000-4000-8000-000000000004',
  '77000000-0000-4000-8000-000000000012',
  '{"kind":"change_duration","shotId":"s1","durationSeconds":5}'::jsonb,
  'Owner needs a longer opening shot.'
) \gset completed_revision_
select input_snapshot #>> '{output,relative_path}' as output_path from public.tasks where id = :'completed_revision_id'::uuid \gset completed_revision_

insert into public.task_runs (task_id, attempt, task_package, result, status)
values (
  :'completed_revision_id'::uuid,
  0,
  '{}'::jsonb,
  jsonb_build_object(
    'storyboard', jsonb_build_object('version', 'storyboard/v1', 'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'scriptSegment', '第一镜头', 'durationSeconds', 5, 'shotType', 'a_roll', 'productionMethod', 'manual', 'inputBasis', jsonb_build_array(jsonb_build_object('relativePath', 'script.md', 'sha256', repeat('a', 64))), 'targetSpec', '固定'))),
    'artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'storyboard', 'relativePath', :'completed_revision_output_path'::text, 'sha256', repeat('c', 64), 'fileSize', 10))
  ),
  'completed'
);
insert into public.artifacts (episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id)
values ('77000000-0000-4000-8000-000000000004', 'storyboard', :'completed_revision_output_path'::text, repeat('c', 64), 10, :'completed_revision_id'::uuid);
update public.tasks set attempt = 1, status = 'completed' where id = :'completed_revision_id'::uuid;

select is((select stage from public.episodes where id = '77000000-0000-4000-8000-000000000004'), 'storyboard_approved'::public.episode_stage, 'a completed deterministic revision remains in the shot workbench');
select is((select count(*) from public.review_packages where episode_id = '77000000-0000-4000-8000-000000000004' and revision_number = 3), 1::bigint, 'a completed revision creates a new review package');
select is((select count(*) from public.review_packages where id = '77000000-0000-4000-8000-000000000008'), 1::bigint, 'the original review package remains historical');
select is((select count(*) from public.approvals approval join public.review_packages package on package.id = approval.review_package_id where package.episode_id = '77000000-0000-4000-8000-000000000004' and package.revision_number = 3 and approval.stage = 'storyboard_approved' and approval.decision = 'approved'), 1::bigint, 'the completed deterministic revision is automatically approved');
select is((select count(*) from public.audit_events event where event.episode_id = '77000000-0000-4000-8000-000000000004' and event.event_type = 'storyboard_structure_revision_applied' and event.payload ->> 'task_id' = :'completed_revision_id'), 1::bigint, 'the completed deterministic revision records its in-workbench application');
select is((select confirmation_status from public.shot_preparation_drafts draft join public.review_packages package on package.id = draft.review_package_id where package.episode_id = '77000000-0000-4000-8000-000000000004' and package.revision_number = 3 and draft.shot_id = 's1'), 'pending', 'a duration change retains its draft but requires a new confirmation');
select is((select current_video_task_id from public.shot_preparation_drafts draft join public.review_packages package on package.id = draft.review_package_id where package.episode_id = '77000000-0000-4000-8000-000000000004' and package.revision_number = 3 and draft.shot_id = 's1'), '77000000-0000-4000-8000-000000000013'::uuid, 'a duration change retains its prepared video while its decision is reconfirmed');

select * from finish();
rollback;
