do $$
declare
  definition text;
  patched_definition text;
begin
  select pg_get_functiondef('public.generate_shot_tts(uuid,uuid,text,boolean)'::regprocedure) into definition;
  if definition is null then raise exception 'generate_shot_tts is required'; end if;
  if position('#variable_conflict use_variable' in definition) > 0 then return; end if;

  patched_definition := replace(
    definition,
    E'AS $function$\ndeclare',
    E'AS $function$\n#variable_conflict use_variable\ndeclare'
  );
  if patched_definition = definition then raise exception 'generate_shot_tts declaration block was not found'; end if;

  execute patched_definition;
end;
$$;
