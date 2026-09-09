do $$
declare
  definition text;
  old_guard constant text := '      if coalesce(btrim(draft.tts_text), '''') = ''''
        or draft.tts_text_confirmation_fingerprint is distinct from md5(btrim(draft.tts_text)) then';
  new_guard constant text := '      if coalesce(btrim(draft.tts_text), '''') = '''' then';
begin
  select pg_get_functiondef('public.generate_shot_review_video(uuid, uuid, jsonb, boolean, text)'::regprocedure)
    into definition;
  if position(new_guard in definition) > 0 and position(old_guard in definition) = 0 then
    return;
  end if;
  if position(old_guard in definition) = 0 or position(new_guard in definition) > 0 then
    raise exception 'generate shot review video TTS guard has unknown or partial state';
  end if;
  definition := replace(definition, old_guard, new_guard);
  if position(new_guard in definition) = 0 or position(old_guard in definition) > 0 then
    raise exception 'generate shot review video TTS guard patch produced an invalid state';
  end if;
  execute definition;
end;
$$;
