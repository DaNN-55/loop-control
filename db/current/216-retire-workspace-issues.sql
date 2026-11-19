-- Owner-approved retirement: remove the issue data and every active dependency.
DO $$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('local_identity.workspace_delivery_current(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_export_issues i WHERE i.workspace_id=w.id AND (i.resolved_at IS NULL OR i.created_at>x.confirmed_at))','');
 IF position('workspace_export_issues' IN definition)>0 THEN RAISE EXCEPTION 'Retired issue delivery dependency remains'; END IF;
 EXECUTE definition;
END $$;
DO $$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.delete_episode(uuid,uuid)'::regprocedure);
 definition:=regexp_replace(definition,'DELETE FROM local_identity[.]workspace_export_issues[^;]*;','','g');
 IF position('workspace_export_issues' IN definition)>0 THEN RAISE EXCEPTION 'Retired issue deletion dependency remains'; END IF;
 EXECUTE definition;
END $$;
DROP TABLE local_identity.workspace_export_issues;
