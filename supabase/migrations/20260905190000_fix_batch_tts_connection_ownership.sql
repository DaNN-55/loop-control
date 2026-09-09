do $$
declare
  definition text;
  ownership_state text;
  variable_conflict_state text;
  patched text;
  old_block text := $old$
        join public.external_connections connection on connection.id = version.connection_id
        where version.id::text = credential_ref
          and connection.account_id = current_episode.account_id
          and connection.current_version_id = version.id$old$;
  new_block text := $new$
        join public.external_connections connection on connection.id = version.connection_id
        join public.account_memberships connection_owner
          on connection_owner.account_id = current_episode.account_id
         and connection_owner.user_id = connection.created_by
         and connection_owner.role = 'owner'
        where version.id::text = credential_ref
          and connection.current_version_id = version.id$new$;
  old_variable_block text := E'AS $function$\ndeclare';
  new_variable_block text := E'AS $function$\n#variable_conflict use_variable\ndeclare';
begin
  select pg_get_functiondef('public.generate_confirmed_shot_tts_batch(uuid,uuid)'::regprocedure) into definition;
  if definition is null then raise exception 'generate_confirmed_shot_tts_batch is required'; end if;

  if position(new_block in definition) > 0 then
    ownership_state := 'new';
  elsif position(old_block in definition) > 0 then
    ownership_state := 'old';
  else
    raise exception 'generate_confirmed_shot_tts_batch connection ownership clauses were neither the old nor new form';
  end if;

  if position(new_variable_block in definition) > 0 then
    variable_conflict_state := 'new';
  elsif position(old_variable_block in definition) > 0 then
    variable_conflict_state := 'old';
  else
    raise exception 'generate_confirmed_shot_tts_batch variable conflict declaration was neither the old nor new form';
  end if;

  if ownership_state = 'new' and variable_conflict_state = 'new' then return; end if;
  patched := definition;
  if ownership_state = 'old' then patched := replace(patched, old_block, new_block); end if;
  if variable_conflict_state = 'old' then patched := replace(patched, old_variable_block, new_variable_block); end if;
  if patched = definition then raise exception 'generate_confirmed_shot_tts_batch patches were not applied'; end if;
  execute patched;
end;
$$;
