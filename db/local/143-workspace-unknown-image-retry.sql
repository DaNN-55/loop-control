-- A confirmed retry creates a new task and links to the original without
-- changing the original submission outcome or its reservation.
DO $retry$
DECLARE original text; old_guard text; new_guard text;
BEGIN
 original:=pg_get_functiondef('local_identity.queue_workspace_images(uuid)'::regprocedure);
 old_guard:=$old$ IF EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates x JOIN public.tasks t ON t.id=x.task_id LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id LEFT JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id WHERE x.workspace_id=v.workspace_id AND x.target_item_id=v.target_item_id AND x.request_snapshot->>'kind'='image' AND (t.status IN ('ready','running') OR (r.request_state='submitting' AND t.status<>'completed' AND coalesce(s.outcome,'started')<>'rejected'))) THEN RAISE EXCEPTION 'Previous image submission pending or unknown' USING ERRCODE='55000';END IF;$old$;
 new_guard:=$new$
 IF EXISTS(
  WITH prior AS (
   SELECT t.id,t.status,r.request_state,r.provider_task_id,s.outcome,
    EXISTS(SELECT 1 FROM local_identity.native_output_publications h WHERE h.task_id=t.id) held,
    EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates retry
           WHERE retry.workspace_id=x.workspace_id AND retry.target_item_id=x.target_item_id
             AND retry.task_id IS NOT NULL AND retry.request_snapshot->>'retryOfTaskId'=t.id::text) retried
   FROM local_identity.workspace_visual_candidates x JOIN public.tasks t ON t.id=x.task_id
   LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id
   LEFT JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id
   WHERE x.workspace_id=v.workspace_id AND x.target_item_id=v.target_item_id AND x.request_snapshot->>'kind'='image'
  ), unresolved AS (
   SELECT *,status IN ('failed','blocked') AND provider_task_id IS NULL
          AND coalesce(outcome,'started')='started' AND NOT held AS may_retry
   FROM prior WHERE status IN ('ready','running') OR held
    OR (request_state='submitting' AND status<>'completed' AND coalesce(outcome,'started')<>'rejected' AND NOT retried)
  ), confirmed_retry AS (
   SELECT u.id FROM unresolved u JOIN local_identity.workspace_call_confirmations c
     ON c.authorization_hash=local_identity.current_workspace_call_hash(v.workspace_id)
   WHERE u.may_retry AND u.id::text=v.request_snapshot->>'retryOfTaskId'
     AND c.command='requestWorkspaceImageCandidates'
     AND c.payload->>'retryOfTaskId'=u.id::text AND c.payload->>'targetItemId'=v.target_item_id
  )
  SELECT 1 FROM unresolved u WHERE NOT EXISTS(SELECT 1 FROM confirmed_retry r WHERE r.id=u.id)
  UNION ALL
  SELECT 1 WHERE v.request_snapshot ? 'retryOfTaskId' AND NOT EXISTS(SELECT 1 FROM confirmed_retry)
 ) THEN RAISE EXCEPTION 'Previous image submission pending or unknown' USING ERRCODE='55000';END IF;
 $new$;
 IF strpos(original,old_guard)=0 THEN RAISE EXCEPTION 'Image retry guard changed';END IF;
 EXECUTE replace(original,old_guard,new_guard);
END $retry$;
