-- The confirmed image prompt and references are frozen per target. Adopting
-- another candidate or editing audio must not cancel a queued batch image.
CREATE OR REPLACE FUNCTION local_identity.provider_dispatch_context_current(p_task uuid, p_kind text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id
  JOIN local_identity.production_workspaces w ON w.episode_id=e.id
  JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=e.id AND p.script_revision_id=w.script_revision_id
  WHERE t.id=p_task AND t.invalidated_at IS NULL AND e.archived_at IS NULL
   AND e.stage<>'production_completed' AND NOT local_identity.is_recycled_episode(e.id)
   AND e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id)
   AND CASE WHEN p_kind='speech' THEN
    t.task_type='generate_narration' AND EXISTS(
     SELECT 1 FROM local_identity.workspace_narration_requests r
     JOIN local_identity.workspace_production_authorizations a ON a.episode_id=r.episode_id
     WHERE r.task_id=t.id AND r.workspace_id=w.id AND a.enabled AND a.authorized_at IS NOT NULL
      AND a.script_revision_id=w.script_revision_id AND a.authorization_hash=r.authorization_hash
      AND CASE WHEN t.input_snapshot ? 'workspace_narration' THEN
       t.input_snapshot#>>'{workspace_narration,version}'='workspace-narration/v2'
       AND t.input_snapshot#>>'{workspace_narration,workspace_id}'=w.id::text
       AND t.input_snapshot#>>'{workspace_narration,shot_id}'=r.shot_id
       AND t.input_snapshot#>>'{workspace_narration,preparation_revision_id}'=p.id::text
       AND r.request_snapshot#>>'{target,preparationRevisionId}'=p.id::text
       AND r.request_snapshot#>>'{target,workspaceId}'=w.id::text
       AND r.request_snapshot#>>'{target,shotId}'=r.shot_id
       AND r.request_snapshot#>>'{target,scriptRevisionId}'=w.script_revision_id::text
      ELSE p.source_format='storyboard/v1'
       AND t.input_snapshot->>'storyboard_review_package_id'=p.source_reference_id::text
      END
      AND CASE WHEN r.request_snapshot ? 'batchId'
       THEN EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=r.shot_id)
       WHEN r.request_snapshot->>'selectionVersion'='1'
       THEN w.project_sha256=r.request_snapshot#>>'{target,projectSha256}'
       ELSE EXISTS(SELECT 1 FROM local_identity.workspace_narrations n WHERE n.workspace_id=w.id AND n.shot_id=r.shot_id AND n.mode='tts' AND n.task_id=t.id AND n.input_fingerprint=r.input_fingerprint AND n.confirmed_fingerprint=r.input_fingerprint) END)
   ELSE p_kind='image' AND t.task_type='generate_static_visual' AND t.provider='openai'
    AND local_identity.workspace_task_preparation_current(t.id,w.id) AND EXISTS(
    SELECT 1 FROM local_identity.workspace_visual_candidates v
    JOIN local_identity.workspace_production_authorizations a ON a.episode_id=v.episode_id
    WHERE v.task_id=t.id AND v.workspace_id=w.id AND a.enabled AND a.authorized_at IS NOT NULL
     AND a.script_revision_id=w.script_revision_id AND a.authorization_hash=v.request_snapshot->>'authorizationHash'
     AND CASE WHEN v.request_snapshot ? 'batchId' THEN
      EXISTS (SELECT 1 FROM jsonb_array_elements(w.bindings) binding
       WHERE binding->>'shotId'=v.shot_id AND binding->>'itemId'=v.target_item_id AND binding->>'id'=v.clip_id::text)
     ELSE v.request_snapshot#>>'{target,projectSha256}' IS NULL OR w.project_sha256=v.request_snapshot#>>'{target,projectSha256}' END
     AND (NOT(t.input_snapshot ? 'production_preparation') OR v.request_snapshot#>>'{target,workspaceId}'=w.id::text AND v.request_snapshot#>>'{target,preparationRevisionId}'=w.preparation_revision_id::text AND v.request_snapshot#>>'{target,shotId}'=v.shot_id AND v.request_snapshot#>>'{target,scriptRevisionId}'=w.script_revision_id::text)) END
 )
$$;
