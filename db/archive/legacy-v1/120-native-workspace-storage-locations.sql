-- Literal registered-prefix guards. Frozen creative references are never rewritten.
-- Legacy references are accepted only when the exact immutable artifact already
-- belongs to this episode; this is not a relocation/lineage fallback.
CREATE FUNCTION local_identity.owned_studio_frozen_reference(p_episode uuid,p_reference jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((
  SELECT (left(p_reference->>'relative_path',length(l.directory_relative_path)+1)=l.directory_relative_path||'/'
    AND substring(p_reference->>'relative_path' from length(l.directory_relative_path)+2) ~ '^(studio-frozen/[0-9a-f-]{36}/index[.]html|openchatcut-frozen/[0-9a-f-]{36}/project[.]json)$')
   OR (p_reference->>'relative_path' ~ ('^episodes/'||p_episode::text||'/(studio-frozen/[0-9a-f-]{36}/index[.]html|openchatcut-frozen/[0-9a-f-]{36}/project[.]json)$')
    AND EXISTS(SELECT 1 FROM public.artifacts a WHERE a.episode_id=p_episode AND a.relative_path=p_reference->>'relative_path' AND a.sha256=p_reference->>'sha256' AND a.file_size=(p_reference->>'file_size')::bigint))
  FROM local_identity.episode_storage_location(p_episode) l
 ),false)
$$;
REVOKE ALL ON FUNCTION local_identity.owned_studio_frozen_reference(uuid,jsonb) FROM PUBLIC;
-- Calls run in the existing definer functions after their Owner/task checks.

DO $adapt$
DECLARE d text; changed text; prefix text:='(SELECT directory_relative_path FROM local_identity.episode_storage_location(p_episode_id))';
BEGIN
 d:=pg_get_functiondef('local_identity.scope_input_studio_task(uuid,text,jsonb)'::regprocedure);
 changed:=replace(d,$old$p_frozen->>'relative_path' !~ format('^episodes/%s/openchatcut-frozen/[0-9a-f-]{36}/project[.]json$',t.episode_id)$old$,
  $new$(NOT local_identity.owned_studio_frozen_reference(t.episode_id,p_frozen) OR p_frozen->>'relative_path' !~ '/openchatcut-frozen/[0-9a-f-]{36}/project[.]json$')$new$);
 IF changed=d THEN RAISE EXCEPTION 'Studio scope frozen guard contract changed';END IF;
 d:=changed;changed:=replace(d,$old$format('episodes/%s/review-render/%s',t.episode_id,t.id)$old$,
  $new$format('%s/review-render/%s',(SELECT directory_relative_path FROM local_identity.episode_storage_location(t.episode_id)),t.id)$new$);
 IF changed=d THEN RAISE EXCEPTION 'Studio scope output contract changed';END IF;EXECUTE changed;

 d:=pg_get_functiondef('public.generate_shot_review_video(uuid,uuid,jsonb,boolean,text)'::regprocedure);
 changed:=replace(d,$old$p_studio_project ->> 'relative_path' !~ format('^episodes/%s/(studio-frozen/[0-9a-f-]{36}/index[.]html|openchatcut-frozen/[0-9a-f-]{36}/project[.]json)$', p_episode_id::text)$old$,
  'NOT local_identity.owned_studio_frozen_reference(p_episode_id,p_studio_project)');
 IF changed=d THEN RAISE EXCEPTION 'Shot review frozen guard contract changed';END IF;EXECUTE changed;

 d:=pg_get_functiondef('public.request_review_render_revision(uuid,jsonb,text)'::regprocedure);
 changed:=replace(d,$old$canonical_composition #>> '{studio_project,relative_path}' !~ format('^episodes/%s/(studio-frozen/[0-9a-f-]{36}/index[.]html|openchatcut-frozen/[0-9a-f-]{36}/project[.]json)$', selected_episode.id::text)$old$,
  $new$NOT local_identity.owned_studio_frozen_reference(selected_episode.id,canonical_composition->'studio_project')$new$);
 IF changed=d THEN RAISE EXCEPTION 'Review revision frozen guard contract changed';END IF;EXECUTE changed;

 d:=pg_get_functiondef('public.record_publish_input(uuid,text,text,text,bigint)'::regprocedure);
 changed:=replace(d,$old$p_relative_path !~ ('^episodes/' || p_episode_id::text || '/publish-input/cover-v1\.(jpg|png|webp)$')$old$,
  '(left(p_relative_path,length('||prefix||')+1) IS DISTINCT FROM '||prefix||'||''/'' OR substring(p_relative_path from length('||prefix||')+2) !~ ''^publish-input/cover-v1[.](jpg|png|webp)$'')');
 IF changed=d THEN RAISE EXCEPTION 'Publish cover path contract changed';END IF;
 d:=changed;changed:=replace(d,$old$'episodes/' || p_episode_id::text || '/publish-input/metadata-v1.json'$old$,prefix||'||''/publish-input/metadata-v1.json''');
 IF changed=d THEN RAISE EXCEPTION 'Publish metadata path contract changed';END IF;EXECUTE changed;

 d:=pg_get_functiondef('public.record_publish_package(uuid,text,text,bigint)'::regprocedure);
 changed:=replace(d,$old$'episodes/' || p_episode_id::text || '/publish-package/manifest.json'$old$,prefix||'||''/publish-package/manifest.json''');
 IF changed=d THEN RAISE EXCEPTION 'Publish manifest path contract changed';END IF;EXECUTE changed;

 d:=pg_get_functiondef('local_identity.queue_owned_final_render(uuid)'::regprocedure);
 changed:=replace(d,$old$format('episodes/%s/final-render/%s',p_episode_id,t.id)$old$,'format(''%s/final-render/%s'','||prefix||',t.id)');
 IF changed=d THEN RAISE EXCEPTION 'Final render output contract changed';END IF;EXECUTE changed;
END $adapt$;
