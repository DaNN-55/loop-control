create function public._required_confirmation_reason_replace(p_definition text, p_old text, p_new text, p_context text)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if position(p_old in p_definition) = 0 then
    raise exception '% confirmation-reason patch target was not found', p_context;
  end if;
  return replace(p_definition, p_old, p_new);
end;
$$;

do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure);
  definition := public._required_confirmation_reason_replace(
    definition,
    E'if has_deviation and (p_deviation_resolution = \'none\' or coalesce(btrim(p_confirmation_reason), \'\') = \'\') then\n    raise exception \'A non-structural deviation needs an Episode exception or confirmation reason\' using errcode = \'22023\';\n  end if;',
    E'if has_deviation and p_deviation_resolution = \'none\' then\n    raise exception \'A non-structural deviation needs an Episode exception or shot-only acceptance\' using errcode = \'22023\';\n  end if;',
    'deviation gate'
  );
  definition := public._required_confirmation_reason_replace(
    definition,
    E'confirmation_reason = coalesce(nullif(btrim(p_confirmation_reason), \'\'), \'Owner confirmed every current shot acceptance gate.\'),',
    E'confirmation_reason = case when has_deviation and p_deviation_resolution = \'episode_exception\' then \'Owner recorded this duration deviation as an Episode exception.\' when has_deviation then \'Owner accepted this duration deviation for the current shot.\' else \'Owner confirmed every current shot acceptance gate.\' end,',
    'confirmation audit summary'
  );
  definition := public._required_confirmation_reason_replace(
    definition,
    E'warning_reason = case when has_deviation then btrim(p_confirmation_reason) else null end,',
    E'warning_reason = case when has_deviation and p_deviation_resolution = \'episode_exception\' then \'Episode exception\' when has_deviation then \'Current shot accepted\' else null end,',
    'warning audit summary'
  );
  definition := public._required_confirmation_reason_replace(
    definition,
    E'\'reason\', btrim(p_confirmation_reason),',
    E'\'reason\', case when p_deviation_resolution = \'episode_exception\' then \'Episode exception\' else \'Current shot accepted\' end,',
    'deviation audit payload'
  );
  execute definition;
end;
$$;

comment on function public.confirm_shot_sync_preview(uuid, uuid, text, text, text) is
  'Confirms a verified shot preview. Duration deviations require a structured scope choice; free-text justification is intentionally optional.';

drop function public._required_confirmation_reason_replace(text, text, text, text);
