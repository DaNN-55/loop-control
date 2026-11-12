-- An invalidated, never-sent queued request is history, not an in-flight call.
-- Retain every running request and every reservation/submission/publication fence.
DO $invalidated_video$
DECLARE original text; changed text;
 marker constant text := 't.status IN (''ready'',''running'') OR (s.outcome';
 replacement constant text := 't.status=''running'' OR (t.status=''ready'' AND (t.invalidated_at IS NULL OR EXISTS(SELECT 1 FROM public.paid_generation_reservations prior_reservation WHERE prior_reservation.task_id=t.id) OR EXISTS(SELECT 1 FROM local_identity.native_output_publications prior_publication WHERE prior_publication.task_id=t.id))) OR (s.outcome';
BEGIN
 original:=pg_get_functiondef('local_identity.queue_workspace_visual_before_settings(uuid)'::regprocedure);
 IF strpos(original,marker)=0 THEN RAISE EXCEPTION 'Workspace video pending guard changed';END IF;
 changed:=replace(original,marker,replacement);
 EXECUTE changed;
END $invalidated_video$;
