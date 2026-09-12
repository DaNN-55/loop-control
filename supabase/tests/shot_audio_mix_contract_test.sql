begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

select has_column('public', 'shot_preparation_drafts', 'bgm_ducking_level', 'shot drafts persist the selected BGM ducking level');

select ok(public.is_valid_shot_audio_mix(
  '{"version":"shot-audio-mix/v1","main_voice":{"mode":"tts","track_id":"track-1","gain_db":0,"role":"anchor"},"bgm":{"selection_id":"bgm-1","cue_id":"bgm-cue","material_revision_id":null,"gain_db":-12,"role":"follower","ducking_level":"strong","duck_depth_db":-14},"sfx":{"selection_id":"sfx-1","cue_id":"sfx-cue","material_revision_id":null,"gain_db":-6,"role":"independent","automatic_ducking":false}}'::jsonb
), 'the versioned mix accepts one anchor, follower BGM, and independent SFX');

select ok(not public.is_valid_shot_audio_mix(
  '{"version":"shot-audio-mix/v1","main_voice":{"mode":"tts","track_id":"track-1","gain_db":0,"role":"anchor"},"bgm":null,"sfx":{"selection_id":"sfx-1","cue_id":"sfx-cue","material_revision_id":null,"gain_db":-6,"role":"independent","automatic_ducking":true}}'::jsonb
), 'SFX cannot silently opt into automatic ducking');

insert into auth.users (id, email) values ('82000000-0000-4000-8000-000000000001', 'issue-102@test.invalid');
insert into public.accounts (id, slug, name, timezone) values ('82000000-0000-4000-8000-000000000002', 'issue-102', 'Issue 102', 'Asia/Shanghai');
insert into public.account_memberships (account_id, user_id, role) values ('82000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'owner');
insert into public.account_blueprint_versions (id, account_id, version, policy, is_active) values ('82000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000002', 1, '{}'::jsonb, true);
insert into public.episodes (id, account_id, blueprint_version_id, title, stage, is_test) values ('82000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000003', 'Issue 102 episode', 'storyboard_approved', true);
insert into public.tasks (id, episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version) values ('82000000-0000-4000-8000-000000000005', '82000000-0000-4000-8000-000000000004', 'draft_storyboard', 'completed', '{}'::jsonb, 0, 1, 'codex', 'test', 'test');
insert into public.task_runs (id, task_id, attempt, task_package, result, status) values ('82000000-0000-4000-8000-000000000006', '82000000-0000-4000-8000-000000000005', 0, '{}'::jsonb, '{}'::jsonb, 'completed');
insert into public.artifacts (id, episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id) values ('82000000-0000-4000-8000-000000000007', '82000000-0000-4000-8000-000000000004', 'storyboard', 'episodes/issue-102/storyboard.json', repeat('a', 64), 10, '82000000-0000-4000-8000-000000000005');
insert into public.review_packages (id, episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot) values (
  '82000000-0000-4000-8000-000000000008', '82000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000005', '82000000-0000-4000-8000-000000000006', '82000000-0000-4000-8000-000000000007', 'storyboard_review', 1,
  '{"worker_result":{"storyboard":{"version":"storyboard/v1","shots":[{"id":"shot-1","scriptSegment":"声音测试","durationSeconds":2,"shotType":"a_roll","productionMethod":"test","inputBasis":[],"targetSpec":"9:16"}],"audioCues":[{"id":"bgm-cue","kind":"bgm","description":"BGM","searchQuery":"music","startSeconds":0,"durationSeconds":2},{"id":"sfx-cue","kind":"sfx","description":"SFX","searchQuery":"click","startSeconds":0,"durationSeconds":1}]}}}'::jsonb
);

insert into public.shot_preparation_drafts (episode_id, review_package_id, shot_id, audio_mode, subtitle_text, subtitles_enabled, tts_text, tts_voice, tts_speaking_rate, input_fingerprint, bgm_ducking_level)
values ('82000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000008', 'shot-1', 'tts', '声音测试', true, '声音测试', 'voice-a', 1, repeat('0', 32), 'strong');
insert into public.storyboard_audio_selections (id, episode_id, review_package_id, target_kind, target_id, audio_kind, cue_id, created_by)
values
  ('82000000-0000-4000-8000-000000000009', '82000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000008', 'episode', '82000000-0000-4000-8000-000000000004', 'bgm', 'bgm-cue', '82000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000010', '82000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000008', 'shot', 'shot-1', 'sfx', 'sfx-cue', '82000000-0000-4000-8000-000000000001');

select is((select preparation_contract #>> '{audio_mix,main_voice,mode}' from public.shot_preparation_drafts where shot_id = 'shot-1'), 'tts', 'TTS is frozen as the authoritative main voice mode');
select is((select preparation_contract #>> '{audio_mix,bgm,duck_depth_db}' from public.shot_preparation_drafts where shot_id = 'shot-1'), '-14', 'strong BGM ducking is frozen as an explicit mix parameter');
select is((select preparation_contract #>> '{audio_mix,sfx,automatic_ducking}' from public.shot_preparation_drafts where shot_id = 'shot-1'), 'false', 'selected SFX stays outside automatic ducking');

create temporary table issue_102_fingerprint(value text);
insert into issue_102_fingerprint select preparation_input_fingerprint from public.shot_preparation_drafts where shot_id = 'shot-1';
update public.storyboard_audio_selections set cue_id = null where id = '82000000-0000-4000-8000-000000000010';
select ok((select preparation_input_fingerprint from public.shot_preparation_drafts where shot_id = 'shot-1') <> (select value from issue_102_fingerprint), 'SFX selection changes the complete preparation fingerprint');

update public.shot_preparation_drafts set audio_mode = 'none' where shot_id = 'shot-1';
select is((select preparation_contract #>> '{audio_mix,bgm,ducking_level}' from public.shot_preparation_drafts where shot_id = 'shot-1'), 'off', 'silent mode keeps BGM but disables ineffective ducking');

select ok(
  has_function_privilege('authenticated', 'public.save_shot_audio_mix(uuid,uuid,text,text)', 'execute')
    and not has_function_privilege('anon', 'public.save_shot_audio_mix(uuid,uuid,text,text)', 'execute'),
  'only authenticated clients can call the owner-checked audio mix save RPC'
);

select * from finish();
rollback;
