begin;
select plan(13);

select ok(public.is_valid_shot_caption_contract(
  '{"version":"shot-captions/v1","enabled":true,"content_mode":"follow_tts","text":"最终口播","cues":[],"spatial":{"version":"shot-caption-space/v1","anchor":"bottom-center","safe_area":"title-safe","max_lines":2,"max_characters_per_line":16}}'::jsonb
), 'follow-TTS caption contract accepts spatial constraints');

select ok(public.is_valid_shot_caption_contract(
  '{"version":"shot-captions/v1","enabled":true,"content_mode":"independent","text":"  Owner 原文\n不自动改写  ","cues":[],"spatial":{"version":"shot-caption-space/v1","anchor":"top-left","safe_area":"action-safe","max_lines":1,"max_characters_per_line":12}}'::jsonb
), 'independent caption contract preserves Owner text and alternate safe area');

select ok(public.is_valid_shot_caption_contract(
  '{"version":"shot-captions/v1","enabled":true,"content_mode":"independent","text":"第一段第二段","cues":[{"id":"one","text":"第一段","start_ms":0,"end_ms":900},{"id":"two","text":"第二段","start_ms":1000,"end_ms":1900}],"spatial":{"version":"shot-caption-space/v1","anchor":"middle-center","safe_area":"title-safe","max_lines":2,"max_characters_per_line":8}}'::jsonb
), 'manual caption cues remain a valid editable timing source');

select ok(public.is_valid_shot_caption_contract(
  '{"version":"shot-captions/v1","enabled":false,"content_mode":"independent","text":"","cues":[],"spatial":{"version":"shot-caption-space/v1","anchor":"bottom-center","safe_area":"title-safe","max_lines":2,"max_characters_per_line":16}}'::jsonb
), 'disabled captions may carry an empty body');

select ok(not public.is_valid_shot_caption_contract(
  '{"version":"shot-captions/v1","enabled":true,"content_mode":"rewritten","text":"正文","cues":[],"spatial":{"version":"shot-caption-space/v1","anchor":"bottom-center","safe_area":"title-safe","max_lines":2,"max_characters_per_line":16}}'::jsonb
), 'unknown content modes are rejected');

select ok(not public.is_valid_shot_caption_contract(
  '{"version":"shot-captions/v1","enabled":true,"content_mode":"independent","text":"正文","cues":[],"spatial":{"version":"shot-caption-space/v1","anchor":"pixel-100-200","safe_area":"title-safe","max_lines":2,"max_characters_per_line":16}}'::jsonb
), 'pixel coordinates cannot replace a visual anchor');

select has_column('public', 'shot_preparation_drafts', 'caption_contract', 'shot drafts persist the versioned caption contract');
select has_column('public', 'shot_preparation_drafts', 'preparation_contract', 'shot drafts persist the versioned shot preparation contract');
select has_column('public', 'shot_preparation_drafts', 'preparation_input_fingerprint', 'shot drafts persist the complete input fingerprint');

with base as (
  select jsonb_populate_record(null::public.shot_preparation_drafts, jsonb_build_object(
    'input_fingerprint', repeat('0', 32), 'selected_material_revision_id', '00000000-0000-4000-8000-000000000001',
    'clip_segments', '[{"start_seconds":0,"end_seconds":2}]'::jsonb,
    'composition', '{"version":"shot-composition/v1","layout":"full","slots":[{"id":"full","clipSegmentIndex":0,"fit":"cover","focalPoint":{"x":0.5,"y":0.5}}]}'::jsonb,
    'audio_mode', 'tts', 'tts_text', '最终口播', 'tts_voice', 'voice-a', 'tts_speaking_rate', 1.2,
    'caption_contract', '{"version":"shot-captions/v1","enabled":true,"content_mode":"follow_tts","text":"最终口播","cues":[],"spatial":{"version":"shot-caption-space/v1","anchor":"bottom-center","safe_area":"title-safe","max_lines":2,"max_characters_per_line":16}}'::jsonb
  )) as draft
), changed_text as (
  select jsonb_populate_record(null::public.shot_preparation_drafts, to_jsonb(draft) || jsonb_build_object('caption_contract', jsonb_set((draft).caption_contract, '{text}', '"Owner 独立字幕"'::jsonb))) as draft from base
), changed_space as (
  select jsonb_populate_record(null::public.shot_preparation_drafts, to_jsonb(draft) || jsonb_build_object('caption_contract', jsonb_set((draft).caption_contract, '{spatial,anchor}', '"top-center"'::jsonb))) as draft from base
)
select ok(
  (select public.build_shot_preparation_contract(draft) ->> 'input_fingerprint' from base)
    <> (select public.build_shot_preparation_contract(draft) ->> 'input_fingerprint' from changed_text)
  and (select public.build_shot_preparation_contract(draft) ->> 'input_fingerprint' from base)
    <> (select public.build_shot_preparation_contract(draft) ->> 'input_fingerprint' from changed_space),
  'caption body and spatial constraints both change the shot preparation fingerprint'
);

select ok(
  position('subtitle_text = (p_caption_contract ->> ''text''::text)' in pg_get_functiondef('public.save_shot_caption_contract(uuid,uuid,text,jsonb)'::regprocedure)) > 0
    or position('subtitle_text = p_caption_contract ->> ''text''' in pg_get_functiondef('public.save_shot_caption_contract(uuid,uuid,text,jsonb)'::regprocedure)) > 0,
  'caption save writes the exact JSON string without trimming or rewriting it'
);

select ok(
  position('''preparation_contract'', draft.preparation_contract' in pg_get_functiondef('public.create_shot_preparation_review_package(uuid,uuid)'::regprocedure)) > 0
    and position('draft.preparation_input_fingerprint' in pg_get_functiondef('public.create_shot_preparation_review_package(uuid,uuid)'::regprocedure)) > 0,
  'confirmed shot snapshots freeze the versioned preparation contract and complete fingerprint'
);

select ok(
  has_function_privilege('authenticated', 'public.save_shot_caption_contract(uuid,uuid,text,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.save_shot_caption_contract(uuid,uuid,text,jsonb)', 'execute'),
  'only authenticated clients can call the owner-checked caption save RPC'
);

select * from finish();
rollback;
