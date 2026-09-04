do $$
declare
  definition text;
  patched_definition text;
begin
  select pg_get_functiondef('public.generate_shot_tts(uuid,uuid,text,boolean)'::regprocedure) into definition;
  if definition is null then raise exception 'generate_shot_tts is required'; end if;

  patched_definition := replace(
    definition,
    'connection.account_id = current_episode.account_id',
    'connection.created_by = auth.uid()'
  );
  if patched_definition = definition then raise exception 'generate_shot_tts connection ownership guard was not found'; end if;

  execute patched_definition;
end;
$$;
