-- Per-shot narration is generated directly from the saved draft. The existing
-- content, voice, rate, ownership, stage, and reviewed-storyboard checks remain.
do $$
declare
  definition text;
  patched_definition text;
  confirmation_guard constant text := '  if draft.tts_text_confirmation_fingerprint is distinct from md5(btrim(coalesce(draft.tts_text, draft.subtitle_text))) then raise exception ''口播内容必须先保存并确认'' using errcode = ''22023''; end if;
';
begin
  select pg_get_functiondef('public.generate_shot_tts(uuid,uuid,text,boolean)'::regprocedure)
  into definition;

  if definition is null then
    raise exception 'generate_shot_tts is required';
  end if;

  if position(confirmation_guard in definition) = 0 then
    raise exception 'generate_shot_tts confirmation guard was not found';
  end if;

  patched_definition := replace(definition, confirmation_guard, '');
  execute patched_definition;
end $$;
