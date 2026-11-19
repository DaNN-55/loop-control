-- Owner-approved retirement: remove the issue data and every active dependency.
CREATE OR REPLACE FUNCTION local_identity.workspace_delivery_current(p_workspace uuid,p_export uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM local_identity.production_workspaces w
 JOIN public.episodes e ON e.id=w.episode_id
 JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=w.episode_id AND p.script_revision_id=w.script_revision_id
 JOIN local_identity.workspace_exports x ON x.workspace_id=w.id
 WHERE w.id=p_workspace AND x.id=p_export AND x.status='ready' AND x.confirmed_at IS NOT NULL
 AND x.project_content_version=w.revision AND x.content_sha256=w.content_sha256
 AND e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id) AND e.archived_at IS NULL
 AND x.id=(SELECT id FROM local_identity.workspace_exports WHERE workspace_id=w.id ORDER BY created_at DESC,id DESC LIMIT 1))
$$;
DO $$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.delete_episode(uuid,uuid)'::regprocedure);
 definition:=regexp_replace(definition,'DELETE FROM local_identity[.]workspace_export_issues[^;]*;','','g');
 IF position('workspace_export_issues' IN definition)>0 THEN RAISE EXCEPTION 'Retired issue deletion dependency remains'; END IF;
 EXECUTE definition;
END $$;
DROP TABLE local_identity.workspace_export_issues;
