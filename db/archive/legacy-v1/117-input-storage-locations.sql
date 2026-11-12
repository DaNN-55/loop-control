-- Input writes use the registered actual directory. No default layout change,
-- historical reference rewrite, or alternative storage authority is introduced.
DO $adapt$
DECLARE d text;changed text;trusted_guard text;prefix text:='(SELECT directory_relative_path FROM local_identity.episode_storage_location(p_episode_id))';
BEGIN
 d:=pg_get_functiondef('public.import_production_material(uuid,text,text,text,text,text,text,bigint,boolean,text)'::regprocedure);
 trusted_guard:='(left(p_storage_path,length('||prefix||')+11) IS DISTINCT FROM '||prefix||'||''/materials/'' OR substring(p_storage_path from length('||prefix||')+12) !~ ''^[0-9a-f]{64}-[^/]+$'')';
 changed:=replace(d,'p_storage_path !~ (''^episodes/'' || p_episode_id::text || ''/materials/[0-9a-f]{64}-[^/]+$'')',trusted_guard);
 IF changed=d AND position(trusted_guard IN d)=0 THEN RAISE EXCEPTION 'Input path guard contract changed';END IF;EXECUTE changed;
 d:=pg_get_functiondef('local_identity.register_workspace_preparation(uuid,uuid,uuid,jsonb,jsonb,text)'::regprocedure);
 changed:=replace(d,'p_file->>''relativePath'' NOT LIKE ''episodes/''||p_episode::text||''/preparation/%''',
  '(left(p_file->>''relativePath'',length((SELECT directory_relative_path FROM local_identity.episode_storage_location(p_episode)))+13) IS DISTINCT FROM (SELECT directory_relative_path FROM local_identity.episode_storage_location(p_episode))||''/preparation/'' OR p_file->>''relativePath'' ~ ''(^/|\\|(^|/)\.{1,2}(/|$)|//|/$)'')');
 IF changed=d THEN RAISE EXCEPTION 'Preparation path guard contract changed';END IF;EXECUTE changed;
 d:=pg_get_functiondef('local_identity.queue_workspace_planning(uuid,uuid,uuid)'::regprocedure);
 changed:=replace(d,'format(''episodes/%s/preparation/planner-%s.json'',e.id,extensions.gen_random_uuid())',
  'format(''%s/preparation/planner-%s.json'',(SELECT directory_relative_path FROM local_identity.episode_storage_location(e.id)),extensions.gen_random_uuid())');
 IF changed=d THEN RAISE EXCEPTION 'Planning output path contract changed';END IF;EXECUTE changed;
END $adapt$;

-- Reuse retains the source and approval evidence while execution owns a local copy.
CREATE TABLE local_identity.material_import_origins(
 material_id uuid PRIMARY KEY REFERENCES public.production_material_revisions(id) ON DELETE CASCADE,
 provenance jsonb NOT NULL
);
ALTER TABLE local_identity.material_import_origins ENABLE ROW LEVEL SECURITY;
CREATE POLICY material_origin_owner ON local_identity.material_import_origins TO loop_app USING(EXISTS(SELECT 1 FROM public.production_material_revisions m JOIN public.episodes e ON e.id=m.episode_id JOIN public.account_memberships a ON a.account_id=e.account_id WHERE m.id=material_id AND a.user_id=local_identity.owner_id() AND a.role='owner'));
GRANT SELECT ON local_identity.material_import_origins TO loop_app;
CREATE FUNCTION local_identity.record_material_reuse(p_material uuid,p_source uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.production_material_revisions;source public.production_material_revisions;origin jsonb;
BEGIN
 SELECT * INTO target FROM public.production_material_revisions WHERE id=p_material;
 SELECT * INTO source FROM public.production_material_revisions WHERE id=p_source;
 IF target.id IS NULL OR source.id IS NULL OR NOT local_identity.lock_owned_input_episode(target.episode_id)
 OR target.episode_id=source.episode_id OR NOT local_identity.script_material_is_approved(source.id)
 OR target.sha256<>source.sha256 OR target.file_size<>source.file_size OR target.material_type<>source.material_type
 OR (SELECT account_id FROM public.episodes WHERE id=target.episode_id) IS DISTINCT FROM (SELECT account_id FROM public.episodes WHERE id=source.episode_id)
 THEN RAISE EXCEPTION 'Approved same-account immutable source required' USING ERRCODE='42501';END IF;
 origin:=jsonb_build_object('source',to_jsonb(source),'approvals',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.approved_at,a.id) FROM public.material_revision_approvals a WHERE a.material_revision_id=source.id));
 INSERT INTO local_identity.material_import_origins(material_id,provenance) VALUES(target.id,origin) ON CONFLICT DO NOTHING;
 RETURN (SELECT provenance FROM local_identity.material_import_origins WHERE material_id=target.id);
END $$;
REVOKE ALL ON FUNCTION local_identity.record_material_reuse(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.record_material_reuse(uuid,uuid) TO loop_app;
