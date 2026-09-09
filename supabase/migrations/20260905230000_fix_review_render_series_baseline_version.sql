do $$
declare
  definition text;
  old_declaration text := '  series_rules jsonb;' || chr(10) || '  risk_count integer := 0;';
  new_declaration text := '  series_rules jsonb;' || chr(10) || '  series_version_number integer;' || chr(10) || '  risk_count integer := 0;';
  old_select text := '  select coalesce(version.rules, ''{}''::jsonb) into series_rules' || chr(10) || '  from public.series_versions version' || chr(10) || '  where version.id = current_episode.series_version_id' || chr(10) || '    and version.account_id = current_episode.account_id;';
  new_select text := '  select version.version, coalesce(version.rules, ''{}''::jsonb) into series_version_number, series_rules' || chr(10) || '  from public.series_versions version' || chr(10) || '  where version.id = current_episode.series_version_id' || chr(10) || '    and version.account_id = current_episode.account_id;';
  old_baseline text := '    ''series_baseline'', jsonb_build_object(''version_id'', current_episode.series_version_id, ''rules'', series_rules),';
  new_baseline text := '    ''series_baseline'', jsonb_build_object(''version_id'', current_episode.series_version_id, ''version'', series_version_number, ''rules'', series_rules),';
  has_old_declaration boolean;
  has_new_declaration boolean;
  has_old_select boolean;
  has_new_select boolean;
  has_old_baseline boolean;
  has_new_baseline boolean;
begin
  select pg_get_functiondef('public.generate_shot_review_video(uuid, uuid, jsonb, boolean, text)'::regprocedure)
    into definition;

  has_old_declaration := position(old_declaration in definition) > 0;
  has_new_declaration := position(new_declaration in definition) > 0;
  has_old_select := position(old_select in definition) > 0;
  has_new_select := position(new_select in definition) > 0;
  has_old_baseline := position(old_baseline in definition) > 0;
  has_new_baseline := position(new_baseline in definition) > 0;

  if has_new_declaration and has_new_select and has_new_baseline
    and not has_old_declaration and not has_old_select and not has_old_baseline then
    return;
  end if;
  if not has_old_declaration or has_new_declaration
    or not has_old_select or has_new_select
    or not has_old_baseline or has_new_baseline then
    raise exception 'review render series baseline version patch has unknown or partial state';
  end if;

  definition := replace(definition, old_declaration, new_declaration);
  definition := replace(definition, old_select, new_select);
  definition := replace(definition, old_baseline, new_baseline);

  if position(new_declaration in definition) = 0
    or position(new_select in definition) = 0
    or position(new_baseline in definition) = 0
    or position(old_select in definition) > 0
    or position(old_baseline in definition) > 0 then
    raise exception 'review render series baseline version patch produced an invalid state';
  end if;

  execute definition;
end;
$$;
