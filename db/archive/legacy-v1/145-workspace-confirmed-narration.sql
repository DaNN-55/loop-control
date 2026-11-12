-- The configured Worker may send speech without a separate network permit
-- only if the existing submission fence reserves a consumed per-call approval.
CREATE FUNCTION local_identity.reserve_workspace_narration_route(p_task_id uuid,p_attempt integer,p_lease_token uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE confirmed boolean;
BEGIN
 IF NOT local_identity.reserve_workspace_narration_submission(p_task_id,p_attempt,p_lease_token) THEN
  RETURN NULL;
 END IF;
 SELECT EXISTS(
  SELECT 1 FROM local_identity.workspace_narration_requests r
  JOIN local_identity.workspace_call_confirmations c
    ON c.workspace_id=r.workspace_id AND c.episode_id=r.episode_id AND c.authorization_hash=r.authorization_hash
  WHERE r.task_id=p_task_id AND r.request_snapshot->>'selectionVersion'='1'
    AND c.command='generateWorkspaceNarration' AND c.consumed_at IS NOT NULL
 ) INTO confirmed;
 RETURN CASE WHEN confirmed THEN 'confirmed' ELSE 'legacy' END;
END $$;
REVOKE ALL ON FUNCTION local_identity.reserve_workspace_narration_route(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.reserve_workspace_narration_route(uuid,integer,uuid) TO loop_worker;
