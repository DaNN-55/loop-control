begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

select has_function('public', 'confirm_shot_sync_preview', array['uuid', 'uuid', 'text', 'text', 'text'], 'confirmation accepts structured deviation resolution while keeping the compatible signature');

select ok(position('is_valid_shot_composition' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0, 'layout validity is an authoritative confirmation gate');
select ok(position('is_valid_shot_caption_contract' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0, 'caption content and safe-area validity are authoritative confirmation gates');
select ok(position('acoustic_alignment ->> ''status'' <> ''completed''' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0, 'caption confirmation requires completed acoustic or manual alignment');
select ok(position('aligned.cue ->> ''startMs''' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0 and position('caption.cue ->> ''start_ms''' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0, 'alignment and persisted caption cue field names are compared semantically');
select ok(position('current_preview_input_fingerprint is distinct from draft.preparation_input_fingerprint' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0, 'the preview fingerprint must match the current preparation contract');
select ok(position('preview_task.provider <> ''openchatcut''' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0, 'the confirmed project must come from OpenChatCut');
select ok(position('shot_preview_qc_report' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0, 'proxy, project, runtime, and QC artifacts are all required');
select ok(position('openchatcut_project' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0 and position('openchatcut_render' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0 and position('openchatcut_qc' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0, 'all OpenChatCut compatibility checks must pass');
select ok(position('where target.id = draft.id' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0, 'confirmation mutates only the selected shot draft');
select ok(has_function_privilege('authenticated', 'public.confirm_shot_sync_preview(uuid,uuid,text,text,text)', 'execute') and not has_function_privilege('anon', 'public.confirm_shot_sync_preview(uuid,uuid,text,text,text)', 'execute'), 'only authenticated callers can use the acceptance gate');
select ok(position('btrim(p_confirmation_reason)' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) = 0, 'structured deviation scope does not require a free-text reason');

insert into auth.users (id, email) values ('84000000-0000-4000-8000-000000000001', 'issue-104@test.invalid');
insert into public.accounts (id, slug, name, timezone) values ('84000000-0000-4000-8000-000000000002', 'issue-104', 'Issue 104', 'Asia/Shanghai');
insert into public.account_memberships (account_id, user_id, role) values ('84000000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000001', 'owner');
insert into public.account_blueprint_versions (id, account_id, version, policy, is_active) values ('84000000-0000-4000-8000-000000000003', '84000000-0000-4000-8000-000000000002', 1, '{}'::jsonb, true);
insert into public.episodes (id, account_id, blueprint_version_id, title, stage, is_test) values ('84000000-0000-4000-8000-000000000004', '84000000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000003', 'Issue 104 episode', 'storyboard_approved', true);
insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version) values ('84000000-0000-4000-8000-000000000005', '84000000-0000-4000-8000-000000000004', 'draft_storyboard', 'completed', '{}'::jsonb, 0, 1, 'codex', 'test', 'test');
insert into public.task_runs (id, task_id, attempt, task_package, result, status) values ('84000000-0000-4000-8000-000000000006', '84000000-0000-4000-8000-000000000005', 0, '{}'::jsonb, '{}'::jsonb, 'completed');
insert into public.artifacts (id, episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id) values ('84000000-0000-4000-8000-000000000007', '84000000-0000-4000-8000-000000000004', 'storyboard', 'episodes/issue-104/storyboard.json', repeat('a', 64), 10, '84000000-0000-4000-8000-000000000005');
insert into public.review_packages (id, episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot) values (
  '84000000-0000-4000-8000-000000000008', '84000000-0000-4000-8000-000000000004', '84000000-0000-4000-8000-000000000005', '84000000-0000-4000-8000-000000000006', '84000000-0000-4000-8000-000000000007', 'storyboard_review', 1,
  '{"worker_result":{"storyboard":{"version":"storyboard/v1","shots":[{"id":"shot-1","scriptSegment":"第一镜","durationSeconds":3.8,"shotType":"a_roll","productionMethod":"manual","inputBasis":[],"targetSpec":"9:16"},{"id":"shot-2","scriptSegment":"第二镜","durationSeconds":2,"shotType":"b_roll","productionMethod":"manual","inputBasis":[],"targetSpec":"9:16"}],"audioCues":[]}}}'::jsonb
);
insert into public.approvals (episode_id, stage, decision, reason, actor_id, review_package_id) values ('84000000-0000-4000-8000-000000000004', 'storyboard_approved', 'approved', 'approved requirements', '84000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000008');
insert into public.production_material_revisions (id, episode_id, revision_number, material_type, material_purpose, source_kind, source_path, storage_path, mime_type, sha256, file_size, is_main_script, created_by) values ('84000000-0000-4000-8000-000000000009', '84000000-0000-4000-8000-000000000004', 1, 'video', 'a_roll', 'file', 'shot-1.mp4', 'episodes/issue-104/materials/shot-1.mp4', 'video/mp4', repeat('b', 64), 3000, false, '84000000-0000-4000-8000-000000000001');
insert into public.material_revision_approvals (material_revision_id, approved_by) values ('84000000-0000-4000-8000-000000000009', '84000000-0000-4000-8000-000000000001');
delete from public.shot_preparation_drafts where episode_id = '84000000-0000-4000-8000-000000000004';

insert into public.shot_preparation_drafts (id, episode_id, review_package_id, shot_id, input_fingerprint, selected_material_revision_id, clip_segments, composition, audio_mode, audio_status, subtitle_text, subtitles_enabled, caption_contract, acoustic_alignment, transition_mode, video_duration_seconds, source_video_duration_seconds, video_status, confirmation_status)
values (
  '84000000-0000-4000-8000-000000000010', '84000000-0000-4000-8000-000000000004', '84000000-0000-4000-8000-000000000008', 'shot-1',
  md5((select shot.value::text from public.review_packages package cross join lateral jsonb_array_elements(package.context_snapshot #> '{worker_result,storyboard,shots}') shot(value) where package.id = '84000000-0000-4000-8000-000000000008' and shot.value ->> 'id' = 'shot-1')),
  '84000000-0000-4000-8000-000000000009', '[{"start_seconds":0,"end_seconds":3.8},{"start_seconds":10,"end_seconds":13.8}]'::jsonb,
  '{"version":"shot-composition/v1","layout":"2up-horizontal","slots":[{"id":"left","clipSegmentIndex":0,"fit":"cover","focalPoint":{"x":0.5,"y":0.5}},{"id":"right","clipSegmentIndex":1,"fit":"cover","focalPoint":{"x":0.5,"y":0.5}}]}'::jsonb,
  'none', 'ready', '字幕', true,
  '{"version":"shot-captions/v1","enabled":true,"content_mode":"independent","text":"字幕","cues":[{"id":"cue-1","text":"字幕","start_ms":0,"end_ms":1000}],"spatial":{"version":"shot-caption-space/v1","anchor":"bottom-center","safe_area":"title-safe","max_lines":2,"max_characters_per_line":16}}'::jsonb,
  jsonb_build_object(
    'version', 'acoustic-alignment/v1', 'status', 'completed', 'method', 'manual', 'granularity', 'phrase',
    'inputVersion', repeat('1', 64), 'textFingerprint', repeat('2', 64), 'wordCount', 1,
    'cues', '[{"id":"cue-1","text":"字幕","startMs":0,"endMs":1000}]'::jsonb,
    'reviewIssues', '[]'::jsonb, 'attempts', '[]'::jsonb
  ),
  'cut', 3.8, 13.8, 'ready', 'pending'
);
update public.shot_preparation_drafts draft set preparation_contract = public.build_shot_preparation_contract(draft) where id = '84000000-0000-4000-8000-000000000010';
update public.shot_preparation_drafts set preparation_input_fingerprint = preparation_contract ->> 'input_fingerprint' where id = '84000000-0000-4000-8000-000000000010';

insert into public.shot_preparation_drafts (id, episode_id, review_package_id, shot_id, audio_mode, audio_status, subtitle_text, subtitles_enabled, video_status, confirmation_status)
values ('84000000-0000-4000-8000-000000000011', '84000000-0000-4000-8000-000000000004', '84000000-0000-4000-8000-000000000008', 'shot-2', 'none', 'ready', '', false, 'ready', 'confirmed');

insert into public.tasks (id, episode_id, task_type, status, input_snapshot, last_result, budget_limit_cents, max_attempts, provider, model, prompt_version)
values ('84000000-0000-4000-8000-000000000012', '84000000-0000-4000-8000-000000000004', 'generate_shot_sync_preview', 'completed', jsonb_build_object('preview_input_fingerprint', (select preparation_input_fingerprint from public.shot_preparation_drafts where id = '84000000-0000-4000-8000-000000000010')), '{"validation":{"passed":true,"checks":[{"name":"openchatcut_project","passed":true},{"name":"openchatcut_render","passed":true},{"name":"openchatcut_qc","passed":true}]}}'::jsonb, 0, 1, 'openchatcut', 'openchatcut@0.2.14', 'shot-sync-preview-v1');
insert into public.artifacts (id, episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id) values
  ('84000000-0000-4000-8000-000000000013', '84000000-0000-4000-8000-000000000004', 'shot_preview_proxy', 'episodes/issue-104/proxy.mp4', repeat('c', 64), 100, '84000000-0000-4000-8000-000000000012'),
  ('84000000-0000-4000-8000-000000000014', '84000000-0000-4000-8000-000000000004', 'shot_editable_project', 'episodes/issue-104/project.json', repeat('d', 64), 100, '84000000-0000-4000-8000-000000000012'),
  ('84000000-0000-4000-8000-000000000015', '84000000-0000-4000-8000-000000000004', 'shot_preview_runtime', 'episodes/issue-104/runtime.json', repeat('e', 64), 100, '84000000-0000-4000-8000-000000000012'),
  ('84000000-0000-4000-8000-000000000016', '84000000-0000-4000-8000-000000000004', 'shot_preview_qc_report', 'episodes/issue-104/qc.json', repeat('f', 64), 100, '84000000-0000-4000-8000-000000000012');
update public.shot_preparation_drafts set preview_status = 'ready', current_preview_artifact_id = '84000000-0000-4000-8000-000000000013', current_preview_project_artifact_id = '84000000-0000-4000-8000-000000000014', current_preview_task_id = '84000000-0000-4000-8000-000000000012', current_preview_input_fingerprint = preparation_input_fingerprint where id = '84000000-0000-4000-8000-000000000010';

select set_config('request.jwt.claim.sub', '84000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((public.confirm_shot_sync_preview('84000000-0000-4000-8000-000000000004', '84000000-0000-4000-8000-000000000008', 'shot-1', '', 'none')).confirmation_status, 'confirmed', 'all real gates confirm exactly the selected shot');
select is((select confirmation_status from public.shot_preparation_drafts where id = '84000000-0000-4000-8000-000000000011'), 'confirmed', 'confirming one shot does not rewrite another shot');
update public.shot_preparation_drafts set transition_mode = 'fade' where id = '84000000-0000-4000-8000-000000000010';
select is((select confirmation_status from public.shot_preparation_drafts where id = '84000000-0000-4000-8000-000000000010'), 'pending', 'editing a confirmed shot revokes only that shot confirmation');
select is((select confirmation_status from public.shot_preparation_drafts where id = '84000000-0000-4000-8000-000000000011'), 'confirmed', 'editing one confirmed shot preserves every other confirmation');

select * from finish();
rollback;
