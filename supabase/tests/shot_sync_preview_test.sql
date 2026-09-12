begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

select has_column('public', 'shot_preparation_drafts', 'transition_mode', 'shot drafts persist the basic transition choice');
select has_column('public', 'shot_preparation_drafts', 'current_preview_artifact_id', 'shot drafts retain the playable proxy artifact');
select has_column('public', 'shot_preparation_drafts', 'current_preview_project_artifact_id', 'shot drafts retain the editable project artifact');
select has_column('public', 'shot_preparation_drafts', 'current_preview_input_fingerprint', 'proxy and editable project are bound to an input fingerprint');

with base as (
  select jsonb_populate_record(null::public.shot_preparation_drafts, jsonb_build_object(
    'input_fingerprint', repeat('0', 32),
    'selected_material_revision_id', '00000000-0000-4000-8000-000000000001',
    'clip_segments', '[{"start_seconds":0,"end_seconds":2}]'::jsonb,
    'composition', '{"version":"shot-composition/v1","layout":"full","slots":[{"id":"full","clipSegmentIndex":0,"fit":"cover","focalPoint":{"x":0.5,"y":0.5}}]}'::jsonb,
    'transition_mode', 'cut', 'audio_mode', 'none', 'bgm_ducking_level', 'off',
    'caption_contract', '{"version":"shot-captions/v1","enabled":false,"content_mode":"independent","text":"","cues":[],"spatial":{"version":"shot-caption-space/v1","anchor":"bottom-center","safe_area":"title-safe","max_lines":2,"max_characters_per_line":16}}'::jsonb,
    'acoustic_alignment', '{"version":"acoustic-alignment/v1","status":"waiting","method":"none","granularity":"none","inputVersion":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","audioSha256":"","textFingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","provider":"none","model":"none","connectionVersionId":null,"wordCount":0,"cues":[],"attempts":[],"detail":"waiting","generatedAt":"2026-09-11T00:00:00.000Z"}'::jsonb
  )) as draft
), faded as (
  select jsonb_populate_record(null::public.shot_preparation_drafts, to_jsonb(draft) || '{"transition_mode":"fade"}'::jsonb) as draft from base
)
select ok(
  (select public.build_shot_preparation_contract(draft) ->> 'input_fingerprint' from base)
    <> (select public.build_shot_preparation_contract(draft) ->> 'input_fingerprint' from faded),
  'changing the basic transition expires the complete shot input fingerprint'
);

with draft as (
  select jsonb_populate_record(null::public.shot_preparation_drafts, jsonb_build_object(
    'input_fingerprint', repeat('0', 32), 'clip_segments', '[]'::jsonb,
    'composition', '{"version":"shot-composition/v1","layout":"full","slots":[{"id":"full","clipSegmentIndex":0,"fit":"cover","focalPoint":{"x":0.5,"y":0.5}}]}'::jsonb,
    'transition_mode', 'studio', 'audio_mode', 'none', 'bgm_ducking_level', 'off',
    'caption_contract', '{"version":"shot-captions/v1","enabled":false,"content_mode":"independent","text":"","cues":[],"spatial":{"version":"shot-caption-space/v1","anchor":"bottom-center","safe_area":"title-safe","max_lines":2,"max_characters_per_line":16}}'::jsonb
  )) as value
)
select is((select public.build_shot_preparation_contract(value) ->> 'transition_mode' from draft), 'studio', 'Studio transition intent remains explicit in the editable project contract');

select ok(
  position('''shot_preview_proxy'', ''shot_editable_project'', ''shot_preview_runtime'', ''shot_preview_qc_report''' in pg_get_functiondef('public.generate_shot_sync_preview(uuid,uuid,text)'::regprocedure)) > 0,
  'one task requires the proxy, editable project, runtime, and QC evidence together'
);
select ok(
  position('current_preview_input_fingerprint is distinct from draft.preparation_input_fingerprint' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0,
  'confirmation rejects a proxy whose input fingerprint is stale'
);
select ok(
  position('current_preview_artifact_id = null' in pg_get_functiondef('public.sync_shot_preview_after_task_update()'::regprocedure)) = 0
    and position('preview_status = ''failed''' in pg_get_functiondef('public.sync_shot_preview_after_task_update()'::regprocedure)) > 0,
  'a failed regeneration records failure without deleting the previous playable proxy'
);
select ok(
  position('order by ordinality' in pg_get_functiondef('public.save_shot_manual_alignment(uuid,uuid,text,jsonb)'::regprocedure)) > 0,
  'manual timing remains executable for environments without WhisperX inference'
);
select ok(
  has_function_privilege('authenticated', 'public.generate_shot_sync_preview(uuid,uuid,text)', 'execute')
    and has_function_privilege('authenticated', 'public.confirm_shot_sync_preview(uuid,uuid,text,text,text)', 'execute')
    and not has_function_privilege('anon', 'public.generate_shot_sync_preview(uuid,uuid,text)', 'execute'),
  'only authenticated callers can request or confirm a sync preview'
);

select * from finish();
rollback;
