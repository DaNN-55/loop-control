begin;
select plan(9);

select has_column('public', 'shot_preparation_drafts', 'acoustic_alignment', 'shot drafts persist acoustic alignment state');

select ok(public.is_valid_acoustic_alignment(
  '{"version":"acoustic-alignment/v1","status":"completed","method":"tts_native","granularity":"word","inputVersion":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","audioSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","textFingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","provider":"fixture","model":"fixture-v1","connectionVersionId":null,"wordCount":1,"cues":[{"id":"one","text":"Owner正文","startMs":20,"endMs":900}],"attempts":[],"detail":"done","generatedAt":"2026-09-11T02:00:00.000Z"}'::jsonb
), 'completed alignment requires real timed cues');

select ok(not public.is_valid_acoustic_alignment(
  '{"version":"acoustic-alignment/v1","status":"completed","method":"tts_native","granularity":"word","inputVersion":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","audioSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","textFingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","provider":"fixture","model":"fixture-v1","connectionVersionId":null,"wordCount":0,"cues":[],"attempts":[],"detail":"fake","generatedAt":"2026-09-11T02:00:00.000Z"}'::jsonb
), 'completed state cannot be fabricated without timed cues');

select ok(
  position('acoustic_alignment' in pg_get_functiondef('public.generate_shot_tts(uuid,uuid,text,boolean)'::regprocedure)) > 0,
  'shot TTS task freezes acoustic alignment text input'
);

select ok(
  position('confirmed_text' in pg_get_functiondef('public.generate_shot_tts(uuid,uuid,text,boolean)'::regprocedure)) > 0
  and position('credential_ref' in pg_get_functiondef('public.generate_shot_tts(uuid,uuid,text,boolean)'::regprocedure)) > 0,
  'alignment remains attached to the frozen TTS connection version'
);

select ok(
  position('old.current_audio_track_id is distinct from new.current_audio_track_id' in lower(pg_get_functiondef('public.expire_shot_acoustic_alignment()'::regprocedure))) > 0,
  'audio version changes expire old alignment'
);

select ok(
  position('old.subtitle_text is distinct from new.subtitle_text' in lower(pg_get_functiondef('public.expire_shot_acoustic_alignment()'::regprocedure))) > 0
  and position('old.tts_voice is distinct from new.tts_voice' in lower(pg_get_functiondef('public.expire_shot_acoustic_alignment()'::regprocedure))) > 0
  and position('old.tts_speaking_rate is distinct from new.tts_speaking_rate' in lower(pg_get_functiondef('public.expire_shot_acoustic_alignment()'::regprocedure))) > 0,
  'body, voice, and speaking rate changes expire old alignment'
);

select ok(
  position('jsonb_set(caption_contract, ''{cues}''' in pg_get_functiondef('public.sync_shot_acoustic_alignment_after_task_update()'::regprocedure)) > 0
  and position('subtitle_text =' in pg_get_functiondef('public.sync_shot_acoustic_alignment_after_task_update()'::regprocedure)) = 0,
  'worker timing updates cues without overwriting Owner subtitle body'
);

select ok(
  not has_function_privilege('authenticated', 'public.sync_shot_acoustic_alignment_after_task_update()', 'execute')
  and has_function_privilege('service_role', 'public.sync_shot_acoustic_alignment_after_task_update()', 'execute'),
  'only the Worker service role can invoke alignment synchronization'
);

select * from finish();
rollback;
