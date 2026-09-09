do $$
declare
  definition text;
  old_baseline text := '    ''series_baseline'', jsonb_build_object(''version_id'', current_episode.series_version_id, ''version'', series_version_number, ''rules'', series_rules),';
  new_baseline text := '    ''series_baseline'', case when current_episode.series_version_id is null then null else jsonb_build_object(''version_id'', current_episode.series_version_id, ''version'', series_version_number, ''rules'', series_rules) end,';
begin
  select pg_get_functiondef('public.generate_shot_review_video(uuid, uuid, jsonb, boolean, text)'::regprocedure)
    into definition;
  if position(new_baseline in definition) > 0 and position(old_baseline in definition) = 0 then
    return;
  end if;
  if position(old_baseline in definition) = 0 or position(new_baseline in definition) > 0 then
    raise exception 'review render null series baseline patch has unknown or partial state';
  end if;
  definition := replace(definition, old_baseline, new_baseline);
  if position(new_baseline in definition) = 0 or position(old_baseline in definition) > 0 then
    raise exception 'review render null series baseline patch produced an invalid state';
  end if;
  execute definition;
end;
$$;
