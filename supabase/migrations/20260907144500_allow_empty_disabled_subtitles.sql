do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean,text,text,numeric)'::regprocedure) into definition;
  if definition is null then raise exception 'save_shot_preparation_draft is required'; end if;
  patched := replace(definition,
    'or coalesce(btrim(p_subtitle_text), '''') = '''' or p_subtitles_enabled is null',
    'or (p_subtitles_enabled and coalesce(btrim(p_subtitle_text), '''') = '''') or p_subtitles_enabled is null');
  if patched = definition then raise exception 'Shot subtitle validation clause was not found'; end if;
  execute patched;
end;
$$;
