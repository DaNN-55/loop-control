-- Legacy executors registered "received" before validating/persisting files.
-- A stopped legacy request with NO new-protocol fact or publication hold may
-- only get an explicit, newly confirmed replacement. Its old receipt is kept.
DO $migration$
DECLARE original text;changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.queue_workspace_images(uuid)'::regprocedure);
 changed:=replace(original,$old$coalesce(outcome,'started')='started' AND NOT held AS may_retry$old$,
  $new$(coalesce(outcome,'started')='started' OR(outcome='received' AND NOT EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts f WHERE f.task_id=prior.id))) AND NOT held AS may_retry$new$);
 IF changed=original THEN RAISE EXCEPTION 'Image legacy retry guard changed';END IF;
 EXECUTE changed;
 original:=pg_get_functiondef('local_identity.queue_selected_workspace_narration(uuid,text,jsonb,boolean)'::regprocedure);
 changed:=replace(original,$old$u.outcome='started' AND NOT u.held$old$,
  $new$(u.outcome='started' OR(u.outcome='received' AND NOT EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts f WHERE f.task_id=u.id))) AND NOT u.held$new$);
 IF changed=original THEN RAISE EXCEPTION 'Speech legacy retry guard changed';END IF;
 EXECUTE changed;
END $migration$;
