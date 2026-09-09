do $$
declare
  definition text;
  old_guard constant text := '    and draft.input_fingerprint = md5(required.value::text) and draft.subtitle_text <> ''''';
  new_guard constant text := '    and draft.input_fingerprint = md5(required.value::text) and (not draft.subtitles_enabled or coalesce(btrim(draft.subtitle_text), '''') <> '''')';
begin
  select pg_get_functiondef('public.has_current_shot_preparation_snapshot(uuid, uuid)'::regprocedure)
  into definition;

  if position(new_guard in definition) > 0 and position(old_guard in definition) = 0 then
    return;
  end if;
  if position(old_guard in definition) = 0 or position(new_guard in definition) > 0 then
    raise exception 'shot preparation snapshot subtitle guard has unknown or partial state';
  end if;

  definition := replace(definition, old_guard, new_guard);
  if position(new_guard in definition) = 0 or position(old_guard in definition) > 0 then
    raise exception 'shot preparation snapshot subtitle guard patch produced an invalid state';
  end if;
  execute definition;
end;
$$;
