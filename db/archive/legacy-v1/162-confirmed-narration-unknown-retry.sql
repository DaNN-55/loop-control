-- Explicit, newly confirmed speech generation keeps the original unknown request.
-- No mutation of historical submissions, reservations or publication holds.
DO $migration$
DECLARE original text;old_guard text;new_guard text;
BEGIN
 original:=pg_get_functiondef('local_identity.queue_selected_workspace_narration(uuid,text,jsonb,boolean)'::regprocedure);
 old_guard:=$old$ IF EXISTS(SELECT 1 FROM public.tasks task JOIN local_identity.workspace_narration_requests r ON r.task_id=task.id LEFT JOIN local_identity.workspace_narration_submissions s ON s.task_id=task.id WHERE r.workspace_id=w.id AND r.shot_id=p_shot AND (task.status IN ('ready','running') OR (s.outcome IN ('started','received') AND task.status<>'completed'))) THEN RAISE EXCEPTION 'Previous speech submission pending or unknown' USING ERRCODE='55000';END IF;$old$;
 new_guard:=$new$
 IF EXISTS(
  WITH prior AS(
   SELECT task.id,task.status,s.outcome,
    EXISTS(SELECT 1 FROM local_identity.native_output_publications h WHERE h.task_id=task.id) held,
    EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests child WHERE child.workspace_id=w.id AND child.shot_id=p_shot AND child.request_snapshot->>'retryOfTaskId'=task.id::text) retried
   FROM local_identity.workspace_narration_requests r JOIN public.tasks task ON task.id=r.task_id
   LEFT JOIN local_identity.workspace_narration_submissions s ON s.task_id=task.id
   WHERE r.workspace_id=w.id AND r.shot_id=p_shot
  ), unresolved AS(
   SELECT * FROM prior WHERE status IN ('ready','running') OR held OR(outcome IN ('started','received') AND status<>'completed' AND NOT retried AND NOT local_identity.provider_request_not_sent(id))
  ), approved AS(
   SELECT u.id FROM unresolved u JOIN local_identity.workspace_call_confirmations c ON c.authorization_hash=local_identity.current_workspace_call_hash(w.id)
   WHERE u.status IN ('failed','blocked') AND u.outcome='started' AND NOT u.held AND NOT u.retried
    AND u.id::text=p_snapshot->>'retryOfTaskId' AND c.command='generateWorkspaceNarration'
    AND c.payload->>'retryOfTaskId'=u.id::text AND c.payload->>'clipId'=n.clip_id::text
  )
  SELECT 1 FROM unresolved u WHERE NOT EXISTS(SELECT 1 FROM approved x WHERE x.id=u.id)
  UNION ALL SELECT 1 WHERE p_snapshot ? 'retryOfTaskId' AND NOT EXISTS(SELECT 1 FROM approved)
 ) THEN RAISE EXCEPTION 'Previous speech submission pending or unknown' USING ERRCODE='55000';END IF;
 $new$;
 IF strpos(original,old_guard)=0 THEN RAISE EXCEPTION 'Speech retry guard changed';END IF;
 EXECUTE replace(original,old_guard,new_guard);
 original:=pg_get_functiondef('local_identity.reserve_workspace_narration_submission(uuid,integer,uuid)'::regprocedure);
 old_guard:=$old$AND x.task_id<>p_task_id AND s.outcome IN ('started','received') AND other_task.status<>'completed'$old$;
 new_guard:=$new$AND x.task_id<>p_task_id AND s.outcome IN ('started','received') AND other_task.status<>'completed'
  AND NOT local_identity.provider_request_not_sent(x.task_id)
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests child
   WHERE child.workspace_id=x.workspace_id AND child.shot_id=x.shot_id AND child.request_snapshot->>'retryOfTaskId'=x.task_id::text)$new$;
 IF strpos(original,old_guard)=0 THEN RAISE EXCEPTION 'Speech dispatch guard changed';END IF;
 EXECUTE replace(original,old_guard,new_guard);
 original:=pg_get_functiondef('local_identity.queue_workspace_images(uuid)'::regprocedure);
 old_guard:=$old$(request_state='submitting' AND status<>'completed' AND coalesce(outcome,'started')<>'rejected' AND NOT retried)$old$;
 new_guard:=$new$(request_state='submitting' AND status<>'completed' AND coalesce(outcome,'started')<>'rejected' AND NOT retried AND NOT local_identity.provider_request_not_sent(id))$new$;
 IF strpos(original,old_guard)=0 THEN RAISE EXCEPTION 'Image dispatch retry guard changed';END IF;
 EXECUTE replace(original,old_guard,new_guard);
END $migration$;
CREATE UNIQUE INDEX workspace_speech_single_replacement ON local_identity.workspace_narration_requests(workspace_id,shot_id,(request_snapshot->>'retryOfTaskId')) WHERE request_snapshot ? 'retryOfTaskId';
