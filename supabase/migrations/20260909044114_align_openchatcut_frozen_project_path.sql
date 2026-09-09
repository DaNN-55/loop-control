do $$
declare
  definition text;
  patched text;
  old_validation constant text := 'if p_studio_project ->> ''relative_path'' !~ format(''^episodes/%s/studio-frozen/[0-9a-f-]{36}/index[.]html$'', p_episode_id::text)';
  new_validation constant text := 'if p_studio_project ->> ''relative_path'' !~ format(''^episodes/%s/(studio-frozen/[0-9a-f-]{36}/index[.]html|openchatcut-frozen/[0-9a-f-]{36}/project[.]json)$'', p_episode_id::text)';
  old_revision constant text := 'studio_revision := substring(p_studio_project ->> ''relative_path'' from ''/studio-frozen/([^/]+)/index[.]html$'');';
  new_revision constant text := 'studio_revision := coalesce(substring(p_studio_project ->> ''relative_path'' from ''/openchatcut-frozen/([^/]+)/project[.]json$''), substring(p_studio_project ->> ''relative_path'' from ''/studio-frozen/([^/]+)/index[.]html$''));';
begin
  select pg_get_functiondef('public.generate_shot_review_video(uuid, uuid, jsonb, boolean, text)'::regprocedure)
    into definition;
  if position(new_validation in definition) > 0 and position(new_revision in definition) > 0
    and position(old_validation in definition) = 0 and position(old_revision in definition) = 0 then
    return;
  end if;
  if position(old_validation in definition) = 0 or position(old_revision in definition) = 0
    or position(new_validation in definition) > 0 or position(new_revision in definition) > 0 then
    raise exception 'generate_shot_review_video OpenChatCut path patch has unknown or partial state';
  end if;
  patched := replace(definition, old_validation, new_validation);
  patched := replace(patched, old_revision, new_revision);
  if position(new_validation in patched) = 0 or position(new_revision in patched) = 0
    or position(old_validation in patched) > 0 or position(old_revision in patched) > 0 then
    raise exception 'generate_shot_review_video OpenChatCut path patch produced an invalid state';
  end if;
  execute patched;
end;
$$;

do $$
declare
  definition text;
  patched text;
  old_validation constant text := 'canonical_composition #>> ''{studio_project,relative_path}'' !~ format(''^episodes/%s/studio-frozen/[0-9a-f-]{36}/index[.]html$'', selected_episode.id::text)';
  new_validation constant text := 'canonical_composition #>> ''{studio_project,relative_path}'' !~ format(''^episodes/%s/(studio-frozen/[0-9a-f-]{36}/index[.]html|openchatcut-frozen/[0-9a-f-]{36}/project[.]json)$'', selected_episode.id::text)';
begin
  select pg_get_functiondef('public.request_review_render_revision(uuid, jsonb, text)'::regprocedure)
    into definition;
  if position(new_validation in definition) > 0 and position(old_validation in definition) = 0 then
    return;
  end if;
  if position(old_validation in definition) = 0 or position(new_validation in definition) > 0 then
    raise exception 'request_review_render_revision OpenChatCut path patch has unknown or partial state';
  end if;
  patched := replace(definition, old_validation, new_validation);
  if position(new_validation in patched) = 0 or position(old_validation in patched) > 0 then
    raise exception 'request_review_render_revision OpenChatCut path patch produced an invalid state';
  end if;
  execute patched;
end;
$$;
