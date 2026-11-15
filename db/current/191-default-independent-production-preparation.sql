-- ADR-0068 / B1: a current workspace owns an independent preparation; old packages are optional evidence.
ALTER TABLE local_identity.production_workspaces ALTER COLUMN preparation_revision_id SET NOT NULL;
ALTER TABLE local_identity.production_workspaces ADD CONSTRAINT production_workspace_script_preparation
 FOREIGN KEY(episode_id,script_revision_id,preparation_revision_id) REFERENCES local_identity.production_preparation_revisions(episode_id,script_revision_id,id);
ALTER TABLE local_identity.production_workspaces ALTER COLUMN storyboard_package_id DROP NOT NULL;
ALTER TABLE local_identity.production_workspace_versions ALTER COLUMN storyboard_package_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION local_identity.workspace_delivery_current(p_workspace uuid, p_export uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=w.episode_id AND p.script_revision_id=w.script_revision_id JOIN local_identity.workspace_exports x ON x.workspace_id=w.id
 WHERE w.id=p_workspace AND x.id=p_export AND x.status='ready' AND x.confirmed_at IS NOT NULL AND x.project_content_version=w.revision AND x.content_sha256=w.content_sha256 AND e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id) AND e.archived_at IS NULL
 AND x.id=(SELECT id FROM local_identity.workspace_exports WHERE workspace_id=w.id ORDER BY created_at DESC,id DESC LIMIT 1)
 AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_export_issues i WHERE i.workspace_id=w.id AND (i.resolved_at IS NULL OR i.created_at>x.confirmed_at)))
$function$
;
CREATE OR REPLACE FUNCTION local_identity.stop_workspace_queued_tasks(p_workspace uuid, p_kind text, p_shot text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces; stopped integer;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned current workspace required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=w.episode_id AND p.script_revision_id=w.script_revision_id
  WHERE e.id=w.episode_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_historical_episode(e.id)
  AND e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id)) THEN RAISE EXCEPTION 'Current writable workspace required' USING ERRCODE='55000';END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('narration','bgm','sfx','shot') OR
  (p_kind IN ('narration','shot') AND (p_shot IS NULL OR length(p_shot)=0)) OR
  (p_kind IN ('bgm','sfx') AND p_shot IS NOT NULL) THEN RAISE EXCEPTION 'Invalid stopped content scope' USING ERRCODE='22023';END IF;
 IF p_kind='shot' AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot) THEN RAISE EXCEPTION 'Shot is still in the current workspace' USING ERRCODE='22023';END IF;
 WITH scoped AS (
  SELECT r.task_id FROM local_identity.workspace_narration_requests r WHERE r.workspace_id=w.id AND r.shot_id=p_shot AND p_kind IN ('narration','shot')
  UNION SELECT r.task_id FROM local_identity.workspace_audio_requests r JOIN local_identity.workspace_audio_preparations p ON p.id=r.preparation_id
   WHERE r.workspace_id=w.id AND (p_kind IN ('bgm','sfx') AND p.kind=p_kind OR p_kind='shot' AND p.shot_id=p_shot)
  UNION SELECT v.task_id FROM local_identity.workspace_visual_candidates v WHERE v.workspace_id=w.id AND p_kind='shot' AND v.shot_id=p_shot
 )
 UPDATE public.tasks t SET status='superseded',invalidated_at=clock_timestamp(),invalidated_reason='当前用途已关闭或删除，不再自动执行。'
 WHERE t.id IN (SELECT task_id FROM scoped) AND t.episode_id=w.episode_id AND t.status='ready' AND t.invalidated_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions s WHERE s.task_id=t.id AND s.outcome IN ('started','received'))
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_visual_submissions s WHERE s.task_id=t.id AND s.outcome IN ('started','received'))
  AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id)
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_publication_holds(w.episode_id) h WHERE h.task_id=t.id)
  AND NOT (coalesce(t.last_result#>'{preflight,checks}','[]'::jsonb) @> '[{"check":"provider_result_unknown"}]'::jsonb);
 GET DIAGNOSTICS stopped=ROW_COUNT;
 IF stopped>0 THEN INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id)
  SELECT e.account_id,e.id,'workspace_queued_content_stopped',jsonb_build_object('workspace_id',w.id,'kind',p_kind,'shot_id',p_shot,'stopped_count',stopped),local_identity.owner_id() FROM public.episodes e WHERE e.id=w.episode_id;END IF;
 RETURN stopped;
END $function$
;

-- The controller has compared original/new script bodies and verified both preparation files.
-- This command confirms only that explicit formatting decision, retaining native bytes and old evidence.
CREATE FUNCTION local_identity.resume_production_formatting_revision(p_workspace uuid,p_revision bigint,p_script uuid,p_project_sha text,p_preparation uuid,p_file jsonb,p_manifest jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces;e public.episodes;parent local_identity.production_preparation_revisions;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned workspace required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id FOR UPDATE;
 IF e.archived_at IS NOT NULL OR local_identity.is_historical_episode(e.id) OR e.stage<>'waiting_input'
  OR e.main_script_revision_id IS DISTINCT FROM p_script OR w.script_revision_id=p_script OR w.revision<>p_revision OR w.project_sha256<>p_project_sha THEN
  RAISE EXCEPTION 'Current pending script and workspace required' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=e.id AND status IN ('ready','running')) THEN RAISE EXCEPTION 'Finish current tasks before resuming editing' USING ERRCODE='55000';END IF;
 SELECT * INTO parent FROM local_identity.production_preparation_revisions WHERE id=w.preparation_revision_id AND episode_id=e.id AND script_revision_id=w.script_revision_id;
 IF parent.id IS NULL OR parent.source_format<>'production-preparation/v1' OR parent.manifest IS DISTINCT FROM p_manifest OR w.storyboard_package_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id=p_script AND episode_id=e.id AND is_main_script AND material_type='script') THEN
  RAISE EXCEPTION 'Verified original production preparation required' USING ERRCODE='40001';END IF;
 IF p_preparation IS NULL OR EXISTS(SELECT 1 FROM local_identity.production_preparation_revisions WHERE id=p_preparation) THEN RAISE EXCEPTION 'Fresh preparation identity required' USING ERRCODE='40001';END IF;
 INSERT INTO public.material_revision_approvals(material_revision_id,approved_by)
  SELECT p_script,local_identity.owner_id() WHERE NOT EXISTS(SELECT 1 FROM public.material_revision_approvals WHERE material_revision_id=p_script);
 UPDATE public.episodes SET stage='script_approved',updated_at=clock_timestamp() WHERE id=e.id;
 PERFORM local_identity.register_production_preparation(e.id,p_script,p_preparation,p_file,p_manifest);
 UPDATE local_identity.production_preparation_revisions SET parent_preparation_revision_id=parent.id WHERE id=p_preparation;
 INSERT INTO local_identity.production_shot_versions(preparation_revision_id,episode_id,shot_id,position,origin,baseline_text,snapshot)
  SELECT p_preparation,e.id,v.shot_id,v.position,v.origin,v.baseline_text,v.snapshot FROM local_identity.production_shot_versions v WHERE v.preparation_revision_id=parent.id
  ON CONFLICT(preparation_revision_id,shot_id) DO UPDATE SET position=excluded.position,origin=excluded.origin,baseline_text=excluded.baseline_text,snapshot=excluded.snapshot;
 UPDATE local_identity.production_workspaces SET script_revision_id=p_script,preparation_revision_id=p_preparation,revision=revision+1,updated_at=clock_timestamp() WHERE id=w.id;
 UPDATE local_identity.script_productions SET enabled=false,authorized_at=NULL,last_status='排版修订已确认，沿用原工程；在线制作未授权',updated_at=clock_timestamp() WHERE episode_id=e.id;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id)
  VALUES(e.account_id,e.id,'production_formatting_revision_confirmed',jsonb_build_object('workspace_id',w.id,'parent_preparation_revision_id',parent.id,'preparation_revision_id',p_preparation,'previous_script_revision_id',w.script_revision_id,'script_revision_id',p_script,'project_sha256',w.project_sha256),local_identity.owner_id());
END $$;
REVOKE ALL ON FUNCTION local_identity.resume_production_formatting_revision(uuid,bigint,uuid,text,uuid,jsonb,jsonb) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.resume_production_formatting_revision(uuid,bigint,uuid,text,uuid,jsonb,jsonb) TO loop_app;

-- A current task proves the preparation frozen at submission. Legacy requests keep their original decoder.
CREATE FUNCTION local_identity.workspace_task_preparation_current(p_task uuid,p_workspace uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.tasks t JOIN local_identity.production_workspaces w ON w.episode_id=t.episode_id
 JOIN public.episodes e ON e.id=w.episode_id JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=e.id AND p.script_revision_id=w.script_revision_id
 WHERE t.id=p_task AND w.id=p_workspace AND t.invalidated_at IS NULL AND e.main_script_revision_id=w.script_revision_id
  AND e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_recycled_episode(e.id) AND NOT local_identity.is_historical_episode(e.id)
  AND local_identity.preparation_source_current(p.id)
  AND CASE WHEN t.input_snapshot ? 'production_preparation' THEN
   t.input_snapshot#>>'{production_preparation,version}'='production-preparation-ref/v1'
   AND t.input_snapshot#>>'{production_preparation,workspace_id}'=w.id::text
   AND t.input_snapshot#>>'{production_preparation,preparation_revision_id}'=p.id::text
   AND t.input_snapshot#>>'{production_preparation,script_revision_id}'=w.script_revision_id::text
   AND (NOT(t.input_snapshot->'production_preparation' ? 'shot_id') OR EXISTS(SELECT 1 FROM local_identity.production_shot_versions shot WHERE shot.preparation_revision_id=p.id AND shot.episode_id=e.id AND shot.shot_id=t.input_snapshot#>>'{production_preparation,shot_id}'))
   AND (EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates v
    WHERE v.task_id=t.id AND v.workspace_id=w.id AND v.episode_id=e.id AND v.shot_id IS NOT NULL
     AND v.shot_id=t.input_snapshot#>>'{production_preparation,shot_id}'
     AND v.id::text=coalesce(t.input_snapshot->>'workspace_image_request_id',t.input_snapshot->>'workspace_visual_request_id')
     AND (v.request_snapshot->>'kind'='image' AND t.task_type='generate_static_visual' OR v.request_snapshot->>'kind'='video' AND t.task_type IN ('generate_shot_video','generate_a_roll','generate_b_roll')))
    OR EXISTS(SELECT 1 FROM local_identity.workspace_audio_requests r JOIN local_identity.workspace_audio_preparations a ON a.id=r.preparation_id
     WHERE r.task_id=t.id AND r.workspace_id=w.id AND r.episode_id=e.id AND a.workspace_id=w.id AND a.episode_id=e.id
      AND t.task_type IN ('extract_embedded_audio','generate_soundtrack')
      AND a.shot_id IS NOT DISTINCT FROM t.input_snapshot#>>'{production_preparation,shot_id}' AND (a.kind<>'source' OR a.shot_id IS NOT NULL)))
  ELSE p.source_format='storyboard/v1' AND p.source_reference_id=w.storyboard_package_id
   AND (t.input_snapshot->>'storyboard_review_package_id'=p.source_reference_id::text OR t.task_type='generate_static_visual'
    AND EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates v WHERE v.workspace_id=w.id AND v.episode_id=e.id AND v.task_id=t.id AND v.id::text=t.input_snapshot->>'workspace_image_request_id'))
  END)
$$;
REVOKE ALL ON FUNCTION local_identity.workspace_task_preparation_current(uuid,uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;

CREATE OR REPLACE FUNCTION local_identity.queue_workspace_images(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v local_identity.workspace_visual_candidates;w local_identity.production_workspaces;cfg jsonb;auth local_identity.script_productions;tid uuid;frozen jsonb;aid uuid;BEGIN
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned image request required' USING ERRCODE='42501';END IF;
 w:=local_identity.lock_current_production_workspace(v.workspace_id);
 IF v.task_id IS NOT NULL THEN RETURN v.task_id;END IF;
 SELECT b.policy->'static_visual' INTO cfg FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=v.episode_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed';
 SELECT * INTO auth FROM local_identity.workspace_production_authorizations WHERE episode_id=v.episode_id AND script_revision_id=w.script_revision_id AND enabled AND authorized_at IS NOT NULL AND authorization_hash=local_identity.current_workspace_call_hash(w.id);
 IF v.request_snapshot->>'selectionVersion'='1' THEN
 cfg:=v.request_snapshot->'execution';
 IF cfg->>'credential_ref' IS DISTINCT FROM v.request_snapshot#>>'{selection,connectionVersionId}' OR NOT EXISTS(SELECT 1 FROM public.external_connection_versions cv JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=local_identity.owner_id() AND cn.current_version_id=cv.id JOIN local_identity.connection_bindings cb ON cb.version_id=cv.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=cv.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE cv.id::text=cfg->>'credential_ref' AND cv.provider='openai' AND cv.adapter='openai_images' AND cv.revoked_at IS NULL AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence p WHERE p.version_id=cv.id AND p.owner_id=cn.created_by AND p.mode='live' AND p.outcome='verified')) THEN RAISE EXCEPTION 'Validated owned image connection required';END IF;
 END IF;
 IF cfg IS NULL OR cfg IS DISTINCT FROM v.request_snapshot->'execution' OR cfg->>'execution_path'<>'external' OR cfg#>>'{executor,provider}'<>'openai' OR cfg#>>'{executor,adapter}'<>'openai_images' OR coalesce(cfg#>>'{executor,model}','') NOT IN ('gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08','gpt-image-2.6-sunburst','gpt-image-2.6-flare') OR auth.authorization_hash IS DISTINCT FROM v.request_snapshot->>'authorizationHash' OR auth.authorization_hash IS NULL THEN RAISE EXCEPTION 'Current authorized image configuration required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=e.id AND p.script_revision_id=w.script_revision_id WHERE e.id=v.episode_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND local_identity.preparation_source_current(p.id)) THEN RAISE EXCEPTION 'Current workspace required';END IF;
 IF w.episode_id IS DISTINCT FROM v.episode_id OR v.request_snapshot#>>'{target,workspaceId}' IS DISTINCT FROM w.id::text OR v.request_snapshot#>>'{target,preparationRevisionId}' IS DISTINCT FROM w.preparation_revision_id::text OR v.request_snapshot#>>'{target,scriptRevisionId}' IS DISTINCT FROM w.script_revision_id::text OR v.request_snapshot#>>'{target,shotId}' IS DISTINCT FROM v.shot_id THEN RAISE EXCEPTION 'Current preparation-bound image target required' USING ERRCODE='40001';END IF;
 SELECT account_id INTO aid FROM public.episodes WHERE id=v.episode_id;

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
          AND (coalesce(outcome,'started')='started' OR(outcome='received' AND NOT EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts f WHERE f.task_id=prior.id))) AND NOT held AS may_retry
   FROM prior WHERE status IN ('ready','running') OR held
    OR (request_state='submitting' AND status<>'completed' AND coalesce(outcome,'started')<>'rejected' AND NOT retried AND NOT local_identity.provider_request_not_sent(id))
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
 
 frozen:=jsonb_build_object('capability','static_visual_generation','production_preparation',jsonb_build_object('version','production-preparation-ref/v1','workspace_id',w.id,'preparation_revision_id',w.preparation_revision_id,'script_revision_id',w.script_revision_id,'shot_id',v.shot_id),'production_selection',v.request_snapshot->'selection','production_context',v.request_snapshot->'context','workspace_target',v.request_snapshot->'target','cost_basis',v.request_snapshot->'costBasis','configuration_hash',v.input_fingerprint,'workspace_image_request_id',v.id,'credential_ref',cfg->>'credential_ref','executor',cfg->'executor','allowed_tools',jsonb_build_array('read','write'),'input_artifacts',coalesce(v.request_snapshot->'references','[]'::jsonb),'budget',jsonb_build_object('limit_cents',(v.request_snapshot->>'reservationCents')::integer,'max_attempts',1),'media',jsonb_build_object('adapter','openai_images','static_visual',jsonb_build_object('prompt',coalesce(v.request_snapshot->>'actualPrompt',v.request_snapshot->>'prompt'),'settings',v.request_snapshot->'imageSettings','references',coalesce(v.request_snapshot->'references','[]'::jsonb))),'output',jsonb_build_object('required_artifact_types',jsonb_build_array('static_visual'),'content_type','image/png','relative_path',format('episodes/%s/workspace-images/%s/image.png',v.episode_id,v.id),'review_stage','production_ready'));
 UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=v.episode_id;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(v.episode_id,'generate_static_visual','ready',frozen,(v.request_snapshot->>'reservationCents')::integer,1,'openai',cfg#>>'{executor,model}','workspace-image-v1') RETURNING id INTO tid;
 UPDATE local_identity.workspace_visual_candidates SET task_id=tid WHERE id=v.id;RETURN tid;
END $function$
;
CREATE OR REPLACE FUNCTION local_identity.provider_dispatch_context_current(p_task uuid, p_kind text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      AND CASE WHEN r.request_snapshot->>'selectionVersion'='1'
       THEN w.project_sha256=r.request_snapshot#>>'{target,projectSha256}'
       ELSE EXISTS(SELECT 1 FROM local_identity.workspace_narrations n WHERE n.workspace_id=w.id AND n.shot_id=r.shot_id AND n.mode='tts' AND n.task_id=t.id AND n.input_fingerprint=r.input_fingerprint AND n.confirmed_fingerprint=r.input_fingerprint) END)
   ELSE p_kind='image' AND t.task_type='generate_static_visual' AND t.provider='openai'
    AND local_identity.workspace_task_preparation_current(t.id,w.id) AND EXISTS(
    SELECT 1 FROM local_identity.workspace_visual_candidates v
    JOIN local_identity.workspace_production_authorizations a ON a.episode_id=v.episode_id
    WHERE v.task_id=t.id AND v.workspace_id=w.id AND a.enabled AND a.authorized_at IS NOT NULL
     AND a.script_revision_id=w.script_revision_id AND a.authorization_hash=v.request_snapshot->>'authorizationHash'
     AND (v.request_snapshot#>>'{target,projectSha256}' IS NULL OR w.project_sha256=v.request_snapshot#>>'{target,projectSha256}')
     AND (NOT(t.input_snapshot ? 'production_preparation') OR v.request_snapshot#>>'{target,workspaceId}'=w.id::text AND v.request_snapshot#>>'{target,preparationRevisionId}'=w.preparation_revision_id::text AND v.request_snapshot#>>'{target,shotId}'=v.shot_id AND v.request_snapshot#>>'{target,scriptRevisionId}'=w.script_revision_id::text)) END
 )
$function$
;
CREATE OR REPLACE FUNCTION local_identity.reserve_workspace_images(p_task uuid, p_attempt integer, p_lease uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE t public.tasks;v local_identity.workspace_visual_candidates;aid uuid;BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required';END IF;
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO t FROM public.tasks WHERE id=p_task AND task_type='generate_static_visual' AND provider='openai' AND status='running' FOR UPDATE;
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE task_id=t.id;
 IF t.id IS NULL OR v.id IS NULL OR NOT local_identity.provider_dispatch_context_current(t.id,'image') THEN RAISE EXCEPTION 'Current image request required';END IF;
 SELECT account_id INTO aid FROM public.episodes WHERE id=t.episode_id;
 IF EXISTS(SELECT 1 FROM public.paid_generation_reservations WHERE task_id=t.id) THEN RAISE EXCEPTION 'Previous image submission outcome unknown; do not resubmit';END IF;
 INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents) VALUES(t.id,aid,'image',t.budget_limit_cents);
 INSERT INTO local_identity.workspace_visual_submissions(task_id,outcome) VALUES(t.id,'started');
END $function$
;

CREATE OR REPLACE FUNCTION local_identity.queue_workspace_audio(p_preparation uuid, p_retry boolean DEFAULT false, p_source jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE prep local_identity.workspace_audio_preparations; workspace local_identity.production_workspaces; previous public.tasks; created public.tasks; policy jsonb; config jsonb; executor jsonb; auth local_identity.script_productions; frozen jsonb; nonce text:=gen_random_uuid()::text; budget integer:=0; attempts integer:=2; BEGIN
 SELECT * INTO prep FROM local_identity.workspace_audio_preparations WHERE id=p_preparation FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(prep.episode_id) THEN RAISE EXCEPTION 'Owned preparation required' USING ERRCODE='42501'; END IF;
 workspace:=local_identity.lock_current_production_workspace(prep.workspace_id);
 PERFORM 1 FROM public.episodes e WHERE e.id=prep.episode_id AND e.main_script_revision_id=workspace.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed';
 IF NOT FOUND OR prep.material_revision_id IS NOT NULL THEN RAISE EXCEPTION 'Current generated preparation required' USING ERRCODE='22023'; END IF;
 IF prep.task_id IS NOT NULL THEN
  SELECT * INTO previous FROM public.tasks WHERE id=prep.task_id;
  IF previous.status IN ('ready','running','completed') OR NOT p_retry THEN RETURN previous.id; END IF;
  p_source:=previous.input_snapshot->'workspace_source';
 END IF;
 IF previous.id IS NOT NULL AND NOT local_identity.workspace_task_preparation_current(previous.id,workspace.id) THEN RAISE EXCEPTION 'Original audio preparation no longer current' USING ERRCODE='40001';END IF;
 IF previous.id IS NOT NULL THEN
  frozen:=previous.input_snapshot;budget:=previous.budget_limit_cents;attempts:=previous.max_attempts;executor:=frozen->'executor';
  SELECT * INTO auth FROM local_identity.workspace_production_authorizations WHERE episode_id=prep.episode_id AND script_revision_id=workspace.script_revision_id AND enabled AND authorized_at IS NOT NULL AND authorization_hash=local_identity.current_workspace_call_hash(workspace.id);
  IF prep.kind<>'source' AND auth.authorization_hash IS NULL THEN RAISE EXCEPTION 'Current production authorization required' USING ERRCODE='42501';END IF;
 ELSIF prep.kind='source' THEN
  IF p_source IS NULL OR p_source->>'sha256' IS DISTINCT FROM prep.source_sha256 OR coalesce(p_source->>'startSeconds','') !~ '^[0-9]+([.][0-9]+)?$' OR (p_source->>'startSeconds')::numeric>7200 OR (p_source->>'durationSeconds')::numeric IS DISTINCT FROM prep.duration_seconds OR (left(coalesce(p_source->>'relativePath',''),length((SELECT directory_relative_path FROM local_identity.episode_storage_location(prep.episode_id)))+1) IS DISTINCT FROM (SELECT directory_relative_path FROM local_identity.episode_storage_location(prep.episode_id))||'/' AND left(coalesce(p_source->>'relativePath',''),length('episodes/'||prep.episode_id::text)+1) IS DISTINCT FROM 'episodes/'||prep.episode_id::text||'/') THEN RAISE EXCEPTION 'Current native source required' USING ERRCODE='22023'; END IF;
  frozen:=jsonb_build_object('capability','embedded_audio_extraction','workspace_source',p_source,'media',jsonb_build_object('adapter','ffmpeg_extract_audio','embedded_audio',jsonb_build_object('source_relative_path',p_source->>'relativePath','duration_seconds',prep.duration_seconds,'start_seconds',(p_source->>'startSeconds')::numeric)),'input_artifacts',jsonb_build_array(jsonb_build_object('artifactType','source_video','relativePath',p_source->>'relativePath','sha256',p_source->>'sha256','fileSize',(p_source->>'fileSize')::bigint)),'allowed_tools',jsonb_build_array('read','write'));
 ELSE
  config:=prep.request_snapshot->'execution';executor:=config->'executor';
  IF prep.request_snapshot->>'selectionVersion' IS DISTINCT FROM '1' OR prep.request_snapshot#>>'{selection,capability}' IS DISTINCT FROM 'music_sound' OR config->>'credential_ref' IS DISTINCT FROM prep.request_snapshot#>>'{selection,connectionVersionId}' OR NOT EXISTS(SELECT 1 FROM public.external_connection_versions cv JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=local_identity.owner_id() AND cn.current_version_id=cv.id JOIN local_identity.connection_bindings cb ON cb.version_id=cv.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=cv.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE cv.id::text=config->>'credential_ref' AND cv.provider='freesound' AND cv.adapter='freesound_preview' AND cv.revoked_at IS NULL AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=cv.id AND pe.owner_id=cn.created_by AND pe.mode='live' AND pe.outcome='verified')) THEN RAISE EXCEPTION 'Validated owned Freesound selection required' USING ERRCODE='22023';END IF;
  IF config->>'execution_path' IS DISTINCT FROM 'external' OR executor->>'provider' IS DISTINCT FROM 'freesound' OR executor->>'adapter' IS DISTINCT FROM 'freesound_preview' OR executor->>'model' IS DISTINCT FROM 'freesound-preview-v1' THEN RAISE EXCEPTION 'Selected Freesound execution required' USING ERRCODE='22023'; END IF;
  SELECT * INTO auth FROM local_identity.workspace_production_authorizations WHERE episode_id=prep.episode_id AND script_revision_id=workspace.script_revision_id AND enabled AND authorized_at IS NOT NULL AND authorization_hash=local_identity.current_workspace_call_hash(workspace.id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Current production authorization required' USING ERRCODE='42501'; END IF;
  IF coalesce(config->>'budget_cents','') !~ '^[0-9]+$' OR coalesce(config->>'max_attempts','') !~ '^[1-9][0-9]*$' OR jsonb_typeof(config->'allowed_tools') IS DISTINCT FROM 'array' OR jsonb_array_length(config->'allowed_tools')=0 THEN RAISE EXCEPTION 'Frozen soundtrack budget and tools required' USING ERRCODE='22023'; END IF;
  budget:=(config->>'budget_cents')::integer;attempts:=(config->>'max_attempts')::integer;
  frozen:=jsonb_build_object('production_selection',prep.request_snapshot->'selection','production_context',prep.request_snapshot->'context','workspace_target',prep.request_snapshot->'target','cost_basis',prep.request_snapshot->'costBasis','capability','soundtrack_generation','credential_ref',config->>'credential_ref','executor',executor,'media',jsonb_build_object('adapter','freesound_preview','soundtrack',jsonb_build_object('query',prep.query,'target_duration_seconds',prep.duration_seconds,'cue',jsonb_build_object('id',prep.id,'kind',prep.kind,'description',prep.description,'search_query',prep.query,'start_seconds',prep.offset_seconds,'duration_seconds',prep.duration_seconds))),'allowed_tools',config->'allowed_tools','input_artifacts','[]'::jsonb);
 END IF;
 IF previous.id IS NULL THEN
  IF workspace.episode_id IS DISTINCT FROM prep.episode_id OR prep.shot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(workspace.bindings) b WHERE b->>'shotId'=prep.shot_id) THEN RAISE EXCEPTION 'Current audio target required' USING ERRCODE='40001';END IF;
  IF prep.kind<>'source' AND (prep.request_snapshot#>>'{target,workspaceId}' IS DISTINCT FROM workspace.id::text OR prep.request_snapshot#>>'{target,preparationRevisionId}' IS DISTINCT FROM workspace.preparation_revision_id::text OR prep.request_snapshot#>>'{target,scriptRevisionId}' IS DISTINCT FROM workspace.script_revision_id::text) THEN RAISE EXCEPTION 'Current preparation-bound sound input required' USING ERRCODE='40001';END IF;
  frozen:=frozen||jsonb_build_object('production_preparation',jsonb_strip_nulls(jsonb_build_object('version','production-preparation-ref/v1','workspace_id',workspace.id,'preparation_revision_id',workspace.preparation_revision_id,'script_revision_id',workspace.script_revision_id,'shot_id',prep.shot_id)));
 END IF;
 IF prep.kind='sfx' AND prep.request_snapshot ? 'candidateIndex' THEN
    IF jsonb_typeof(prep.request_snapshot->'candidateIndex') IS DISTINCT FROM 'number' OR (prep.request_snapshot->>'candidateIndex')::integer NOT BETWEEN 0 AND 2 THEN RAISE EXCEPTION 'Invalid sound candidate index' USING ERRCODE='22023'; END IF;
    frozen:=jsonb_set(frozen,'{media,soundtrack,candidate_index}',prep.request_snapshot->'candidateIndex');
   END IF;
   frozen:=frozen||jsonb_build_object('configuration_hash',prep.input_fingerprint||'-'||nonce,'workspace_audio',jsonb_build_object('preparation_id',prep.id,'input_fingerprint',prep.input_fingerprint),'budget',jsonb_build_object('limit_cents',budget,'max_attempts',attempts),'audio_track',CASE WHEN previous.id IS NOT NULL THEN frozen->'audio_track' ELSE jsonb_build_object('kind',prep.kind,'cue_id',coalesce(prep.shot_id,prep.id::text),'preparation_revision_id',workspace.preparation_revision_id,'start_seconds',0,'duration_seconds',0.001) END,'output',jsonb_build_object('required_artifact_types',jsonb_build_array(CASE WHEN prep.kind='source' THEN 'shot_source_audio' ELSE 'soundtrack_audio' END),'content_type','audio/mpeg','relative_path',format('%s/workspace-audio/%s/%s.mp3',(SELECT directory_relative_path FROM local_identity.episode_storage_location(prep.episode_id)),prep.id,nonce),'review_stage','production_ready'));
 UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=prep.episode_id;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(prep.episode_id,CASE WHEN prep.kind='source' THEN 'extract_embedded_audio' ELSE 'generate_soundtrack' END,'ready',frozen,budget,attempts,CASE WHEN prep.kind='source' THEN 'ffmpeg' ELSE 'freesound' END,CASE WHEN prep.kind='source' THEN 'ffmpeg' ELSE executor->>'model' END,CASE WHEN prep.kind='source' THEN 'workspace-source-audio-v1' ELSE executor->>'prompt_version' END) RETURNING * INTO created;
 UPDATE local_identity.workspace_audio_preparations SET task_id=created.id WHERE id=prep.id;
 INSERT INTO local_identity.workspace_audio_requests(task_id,preparation_id,workspace_id,episode_id,input_fingerprint,authorization_hash) VALUES(created.id,prep.id,workspace.id,prep.episode_id,prep.input_fingerprint,auth.authorization_hash);
 RETURN created.id;
END $function$
;
CREATE OR REPLACE FUNCTION local_identity.workspace_audio_task_current(p_task uuid, p_attempt integer, p_lease uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE request local_identity.workspace_audio_requests; BEGIN
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO request FROM local_identity.workspace_audio_requests WHERE task_id=p_task;
 IF NOT FOUND THEN RETURN true; END IF;
 IF NOT local_identity.workspace_task_preparation_current(p_task,request.workspace_id) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.workspace_audio_preparations p JOIN local_identity.production_workspaces w ON w.id=p.workspace_id JOIN public.episodes e ON e.id=w.episode_id WHERE p.id=request.preparation_id AND p.task_id=p_task AND p.input_fingerprint=request.input_fingerprint AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed') THEN RETURN false; END IF;
 RETURN request.authorization_hash IS NULL OR EXISTS(SELECT 1 FROM local_identity.workspace_production_authorizations p JOIN public.episodes e ON e.id=p.episode_id WHERE p.episode_id=request.episode_id AND p.enabled AND p.authorized_at IS NOT NULL AND p.authorization_hash=request.authorization_hash AND p.script_revision_id=e.main_script_revision_id);
END $function$
;
CREATE OR REPLACE FUNCTION public.register_completed_audio_track()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_artifact public.artifacts; track_snapshot jsonb; actual_duration numeric; source_material public.production_material_revisions;
begin
  if new.status <> 'completed' or new.task_type not in ('generate_narration', 'extract_embedded_audio', 'generate_soundtrack') then return new; end if;
  track_snapshot := new.input_snapshot -> 'audio_track';
  if jsonb_typeof(track_snapshot) <> 'object' then raise exception 'Completed audio task is missing its frozen audio track snapshot' using errcode = '22023'; end if;
  IF new.input_snapshot ? 'workspace_narration' AND (new.input_snapshot#>>'{workspace_narration,version}' IS DISTINCT FROM 'workspace-narration/v2' OR new.input_snapshot#>>'{workspace_narration,preparation_revision_id}' IS DISTINCT FROM track_snapshot->>'preparation_revision_id' OR NOT EXISTS(SELECT 1 FROM local_identity.production_shot_versions v WHERE v.episode_id=new.episode_id AND v.preparation_revision_id::text=track_snapshot->>'preparation_revision_id' AND v.shot_id=new.input_snapshot#>>'{workspace_narration,shot_id}')) THEN RAISE EXCEPTION 'Frozen narration preparation differs from audio provenance' USING ERRCODE='22023';END IF;
  IF new.input_snapshot ? 'production_preparation' AND (
   new.input_snapshot#>>'{production_preparation,version}' IS DISTINCT FROM 'production-preparation-ref/v1'
   OR new.input_snapshot#>>'{production_preparation,preparation_revision_id}' IS DISTINCT FROM track_snapshot->>'preparation_revision_id'
   OR NOT EXISTS(SELECT 1 FROM local_identity.workspace_audio_requests r JOIN local_identity.workspace_audio_preparations a ON a.id=r.preparation_id
    WHERE r.task_id=new.id AND r.episode_id=new.episode_id AND a.episode_id=new.episode_id
     AND r.workspace_id::text=new.input_snapshot#>>'{production_preparation,workspace_id}' AND a.workspace_id=r.workspace_id
     AND a.shot_id IS NOT DISTINCT FROM new.input_snapshot#>>'{production_preparation,shot_id}' AND (a.kind<>'source' OR a.shot_id IS NOT NULL))
   OR NOT EXISTS(SELECT 1 FROM local_identity.production_preparation_revisions p JOIN local_identity.production_workspaces w ON w.episode_id=p.episode_id
    WHERE p.episode_id=new.episode_id AND p.id::text=track_snapshot->>'preparation_revision_id'
     AND p.script_revision_id::text=new.input_snapshot#>>'{production_preparation,script_revision_id}'
     AND w.id::text=new.input_snapshot#>>'{production_preparation,workspace_id}'
     AND (NOT(new.input_snapshot->'production_preparation' ? 'shot_id') OR EXISTS(SELECT 1 FROM local_identity.production_shot_versions shot WHERE shot.preparation_revision_id=p.id AND shot.episode_id=p.episode_id AND shot.shot_id=new.input_snapshot#>>'{production_preparation,shot_id}' AND shot.shot_id=track_snapshot->>'cue_id')))
  ) THEN RAISE EXCEPTION 'Frozen audio preparation differs from its registered provenance' USING ERRCODE='22023';END IF;
  if coalesce(new.last_result ->> 'audioDurationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$' or (new.last_result ->> 'audioDurationSeconds')::numeric <= 0 then raise exception 'Completed audio task is missing its probed duration' using errcode = '22023'; end if;
  actual_duration := (new.last_result ->> 'audioDurationSeconds')::numeric;
  if track_snapshot ? 'source_material_revision_id' then
    select material.* into source_material from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id where material.id = (track_snapshot ->> 'source_material_revision_id')::uuid and material.episode_id = new.episode_id;
    if not found then raise exception 'Completed audio task source material approval is invalid' using errcode = '22023'; end if;
  end if;
  select * into selected_artifact from public.artifacts artifact where artifact.producer_task_id = new.id and artifact.relative_path = new.input_snapshot #>> '{output,relative_path}';
  if not found then raise exception 'Completed audio task is missing its frozen output artifact' using errcode = '22023'; end if;
  insert into public.audio_tracks (episode_id,source_task_id,source_artifact_id,source_review_package_id,preparation_revision_id,source_material_revision_id,track_kind,cue_id,relative_path,sha256,file_size,start_seconds,duration_seconds)
  values (new.episode_id,new.id,selected_artifact.id,nullif(track_snapshot ->> 'source_review_package_id','')::uuid,nullif(track_snapshot ->> 'preparation_revision_id','')::uuid,source_material.id,track_snapshot ->> 'kind',nullif(track_snapshot ->> 'cue_id',''),selected_artifact.relative_path,selected_artifact.sha256,selected_artifact.file_size,coalesce((track_snapshot ->> 'start_seconds')::numeric,0),actual_duration);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION local_identity.request_workspace_official_visual(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_first_frame_id uuid, p_prompt text, p_duration integer, p_request_id uuid, p_reservation_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.episodes; rp local_identity.production_preparation_revisions; src public.production_material_revisions; s jsonb; cfg jsonb; pol jsonb; ref uuid; tid uuid:=gen_random_uuid(); existing uuid; image jsonb; visual_inputs jsonb; visual_mode text; input_files jsonb; typ text; provider_name text; adapter_name text; model_name text;
begin
 if not local_identity.lock_owned_input_episode(p_episode_id) then raise exception 'Managed Owner Episode required' using errcode='42501'; end if;
 select * into e from public.episodes where id=p_episode_id for update;
 if not found or not exists(select 1 from public.account_memberships where account_id=e.account_id and user_id=local_identity.owner_id() and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 select id into existing from public.tasks where provider in ('volcengine','minimax','kling') and input_snapshot->>'wan_request_id'=p_request_id::text and episode_id=e.id;
 if found then
  if not exists(select 1 from public.tasks where id=existing and (input_snapshot#>>'{production_preparation,version}'='production-preparation-ref/v1' AND input_snapshot#>>'{production_preparation,preparation_revision_id}'=p_review_package_id::text OR input_snapshot->>'storyboard_review_package_id'=p_review_package_id::text) and input_snapshot#>>'{shot,id}'=p_shot_id and input_snapshot#>>'{media,wan_video,first_frame,relativePath}'=(select storage_path from public.production_material_revisions where id=p_first_frame_id and episode_id=e.id) and input_snapshot#>>'{media,wan_video,prompt}'=btrim(p_prompt) and input_snapshot#>>'{media,wan_video,duration_seconds}'=p_duration::text and budget_limit_cents=p_reservation_cents) then raise exception 'Request identity changed'; end if;
  return existing; end if;
 if not exists(select 1 from local_identity.workspace_visual_candidates v join local_identity.production_workspaces w on w.id=v.workspace_id and w.episode_id=v.episode_id join local_identity.workspace_production_authorizations a on a.episode_id=w.episode_id and a.enabled and a.authorized_at is not null and a.script_revision_id=w.script_revision_id and a.authorization_hash=v.request_snapshot->>'authorizationHash' where v.id=p_request_id and v.episode_id=e.id and v.shot_id=p_shot_id and w.preparation_revision_id=p_review_package_id and w.script_revision_id=e.main_script_revision_id and w.revision=(v.request_snapshot->>'expectedRevision')::bigint and e.archived_at is null and e.stage<>'production_completed') then raise exception 'Current authorized workspace visual lineage required'; end if;
 if exists(select 1 from local_identity.workspace_visual_candidates v join local_identity.production_workspaces w on w.id=v.workspace_id where v.id=p_request_id and v.request_snapshot->'target' ? 'preparationRevisionId' and (v.request_snapshot#>>'{target,preparationRevisionId}' is distinct from p_review_package_id::text or v.request_snapshot#>>'{target,workspaceId}' is distinct from w.id::text or v.request_snapshot#>>'{target,scriptRevisionId}' is distinct from w.script_revision_id::text or v.request_snapshot#>>'{target,shotId}' is distinct from p_shot_id)) then raise exception 'Current preparation-bound video target required' using errcode='40001';end if;
 select * into rp from local_identity.production_preparation_revisions where id=p_review_package_id and episode_id=e.id and script_revision_id=e.main_script_revision_id and local_identity.preparation_source_current(id);
 if not found then raise exception 'Current production preparation required' using errcode='40001';end if;
 s:=local_identity.workspace_shot_context(p_episode_id,p_review_package_id,p_shot_id);
 if s is null then raise exception 'Current bound production shot required' using errcode='40001';end if;
 if exists(select 1 from local_identity.workspace_visual_candidates where id=p_request_id and request_snapshot->>'selectionVersion'='1') then s:=s-'shotType';typ:='video';
 else typ:=local_identity.historical_preparation_shot_classification(rp.id,p_shot_id);if typ not in ('a_roll','b_roll') or typ is null then raise exception 'Recorded legacy visual selection required' using errcode='22023';end if;end if;
 select policy into pol from public.account_blueprint_versions where id=e.blueprint_version_id;
 cfg:=case when exists(select 1 from local_identity.workspace_visual_candidates where id=p_request_id and request_snapshot->>'selectionVersion'='1') then (select request_snapshot->'execution' from local_identity.workspace_visual_candidates where id=p_request_id) else pol->typ end; provider_name:=cfg#>>'{executor,provider}'; adapter_name:=cfg#>>'{executor,adapter}'; model_name:=cfg#>>'{executor,model}';
 if cfg->>'execution_path' is distinct from 'external' or not coalesce((provider_name,adapter_name,model_name) in (('volcengine','seedance_video','doubao-seedance-2-0-260128'),('volcengine','seedance_video','doubao-seedance-2-5-260628'),('minimax','minimax_video','MiniMax-H3'),('minimax','minimax_video','MiniMax-H3-Highspeed'),('minimax','minimax_video','MiniMax-H3-Lite'),('kling','kling_video','kling-v3'),('kling','kling_video','kling-v3-omni')),false) then raise exception 'Select an official video provider and model'; end if;
 if p_duration < (case when provider_name='kling' then 3 else 4 end) or p_duration>15 then raise exception 'Duration outside model range'; end if;
 if p_reservation_cents is null or p_reservation_cents not between 1 and 100000 then raise exception 'Explicit video cost reservation required'; end if;
 ref:=(cfg->>'credential_ref')::uuid;
 if not exists(select 1 from public.external_connection_versions v join public.external_connections c on c.id=v.connection_id where v.id=ref and c.created_by=local_identity.owner_id() and c.current_version_id=v.id and v.provider=provider_name and v.adapter=adapter_name and v.revoked_at is null and public.connection_version_is_verified(v.id)) then raise exception 'Current verified official video connection required'; end if;
 if p_request_id is null or p_prompt is null or p_duration is null or p_duration not between 2 and 15 or char_length(btrim(p_prompt)) not between 1 and 1500 then raise exception 'Prompt or duration invalid'; end if;
 select request_snapshot->'visualInputs',request_snapshot->>'videoMode' into visual_inputs,visual_mode from local_identity.workspace_visual_candidates where id=p_request_id and episode_id=e.id;
 if model_name='kling-v3-omni' and visual_inputs is null then
  raise exception 'Omni requires workspace reference inputs' using errcode='22023';
 end if;
 if visual_inputs is not null then
  if not coalesce((
    (provider_name='volcengine' and model_name in ('doubao-seedance-2-0-260128','doubao-seedance-2-5-260628') and visual_mode in ('keyframes','references'))
    or (provider_name='minimax' and model_name in ('MiniMax-H3','MiniMax-H3-Highspeed','MiniMax-H3-Lite') and visual_mode in ('keyframes','references'))
    or (provider_name='kling' and model_name='kling-v3' and visual_mode='keyframes')
    or (provider_name='kling' and model_name='kling-v3-omni' and visual_mode='references' and p_first_frame_id is null)
   ),false) or jsonb_typeof(visual_inputs)<>'array' or jsonb_array_length(visual_inputs) not between 1 and 40 then
   raise exception 'Invalid workspace video inputs' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('artifactType',entry->>'artifactType','relativePath',entry->>'relativePath','sha256',entry->>'sha256','fileSize',entry->'fileSize') order by seq)
   into input_files from jsonb_array_elements(visual_inputs) with ordinality as v(entry,seq);
 end if;
 if visual_inputs is null or p_first_frame_id is not null then
 select * into src from public.production_material_revisions where id=p_first_frame_id and episode_id=e.id and material_type='image' and mime_type in ('image/png','image/jpeg') and file_size between 1 and 10485760;
 if not found then raise exception 'Select an uploaded first-frame image from this Episode'; end if;
 image:=jsonb_build_object('artifactType','wan_first_frame','relativePath',src.storage_path,'sha256',src.sha256,'fileSize',src.file_size);
  end if;
 input_files:=coalesce(input_files,jsonb_build_array(image));
 s:=jsonb_set(s,'{inputBasis}',(select jsonb_agg(jsonb_build_object('relativePath',f->>'relativePath','sha256',f->>'sha256')) from jsonb_array_elements(input_files) f));
 insert into public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,budget_limit_cents,max_attempts,input_snapshot)
 values(tid,e.id,case typ when 'video' then 'generate_shot_video' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end,'ready',provider_name,model_name,'official-video-v1',p_reservation_cents,1,
 jsonb_build_object('workspace_visual',(select request_snapshot->'mainVoice' from local_identity.workspace_visual_candidates where id=p_request_id),'workspace_visual_request_id',p_request_id,'capability',case typ when 'video' then 'shot_video_generation' else typ||'_generation' end,'wan_request_id',p_request_id,'requested_by',local_identity.owner_id(),'production_preparation',jsonb_build_object('version','production-preparation-ref/v1','workspace_id',(select workspace_id from local_identity.workspace_visual_candidates where id=p_request_id),'preparation_revision_id',rp.id,'script_revision_id',rp.script_revision_id,'shot_id',p_shot_id),'configuration_hash',tid::text,'shot',s,'executor',cfg->'executor','credential_ref',ref,
 'allowed_tools',jsonb_build_array('read','write'),'budget',jsonb_build_object('limit_cents',p_reservation_cents,'max_attempts',1),
 'input_artifacts',input_files,
 'media',jsonb_build_object('adapter',adapter_name,'wan_video',jsonb_build_object('first_frame',image,'prompt',btrim(p_prompt),'duration_seconds',p_duration,'image_mime',src.mime_type,'resolution',case when provider_name='minimax' then coalesce((select request_snapshot->>'videoResolution' from local_identity.workspace_visual_candidates where id=p_request_id),'768P') else '720P' end,'audio',provider_name='minimax','candidate_only',provider_name='minimax' and coalesce((select request_snapshot->>'origin'='candidate' from local_identity.workspace_visual_candidates where id=p_request_id),false))||case when visual_inputs is null then '{}'::jsonb else jsonb_build_object('visual_inputs',visual_inputs,'visual_mode',visual_mode,
  'reference_ratio',(select request_snapshot->>'referenceRatio' from local_identity.workspace_visual_candidates where id=p_request_id)) end),
 'output',jsonb_build_object('content_type','video/mp4','required_artifact_types',jsonb_build_array(case typ when 'video' then 'shot_video' when 'a_roll' then 'a_roll_video' else 'b_roll_asset' end),'relative_path',format('episodes/%s/wan/%s.mp4',e.id,tid),'review_stage','production_ready')));
 insert into public.audit_events(account_id,episode_id,event_type,payload,actor_id) values(e.account_id,e.id,'wan_video_requested',jsonb_build_object('task_id',tid,'shot_id',p_shot_id,'duration',p_duration,'estimated_cents',p_reservation_cents),local_identity.owner_id());
 return tid;
end $function$
;

CREATE OR REPLACE FUNCTION local_identity.request_workspace_wan_visual(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_first_frame_id uuid, p_prompt text, p_duration integer, p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.episodes; rp local_identity.production_preparation_revisions; src public.production_material_revisions; s jsonb; cfg jsonb; pol jsonb; ref uuid; tid uuid:=gen_random_uuid(); existing uuid; image jsonb; visual_inputs jsonb; visual_mode text; reference_ratio text; input_files jsonb; typ text;
begin
 if not local_identity.lock_owned_input_episode(p_episode_id) then raise exception 'Managed Owner Episode required' using errcode='42501'; end if;
 select * into e from public.episodes where id=p_episode_id for update;
 if not found or not exists(select 1 from public.account_memberships where account_id=e.account_id and user_id=local_identity.owner_id() and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 select id into existing from public.tasks where provider='bailian' and input_snapshot->>'wan_request_id'=p_request_id::text and episode_id=e.id;
 if found then
  if not exists(select 1 from public.tasks where id=existing and (input_snapshot#>>'{production_preparation,version}'='production-preparation-ref/v1' AND input_snapshot#>>'{production_preparation,preparation_revision_id}'=p_review_package_id::text OR input_snapshot->>'storyboard_review_package_id'=p_review_package_id::text) and input_snapshot#>>'{shot,id}'=p_shot_id and input_snapshot#>>'{media,wan_video,first_frame,relativePath}'=(select storage_path from public.production_material_revisions where id=p_first_frame_id and episode_id=e.id) and input_snapshot#>>'{media,wan_video,prompt}'=btrim(p_prompt) and input_snapshot#>>'{media,wan_video,duration_seconds}'=p_duration::text) then raise exception 'Request identity changed'; end if;
  return existing; end if;
 if not exists(select 1 from local_identity.workspace_visual_candidates v join local_identity.production_workspaces w on w.id=v.workspace_id and w.episode_id=v.episode_id join local_identity.workspace_production_authorizations a on a.episode_id=w.episode_id and a.enabled and a.authorized_at is not null and a.script_revision_id=w.script_revision_id and a.authorization_hash=v.request_snapshot->>'authorizationHash' where v.id=p_request_id and v.episode_id=e.id and v.shot_id=p_shot_id and w.preparation_revision_id=p_review_package_id and w.script_revision_id=e.main_script_revision_id and w.revision=(v.request_snapshot->>'expectedRevision')::bigint and e.archived_at is null and e.stage<>'production_completed') then raise exception 'Current authorized workspace visual lineage required'; end if;
 if exists(select 1 from local_identity.workspace_visual_candidates v join local_identity.production_workspaces w on w.id=v.workspace_id where v.id=p_request_id and v.request_snapshot->'target' ? 'preparationRevisionId' and (v.request_snapshot#>>'{target,preparationRevisionId}' is distinct from p_review_package_id::text or v.request_snapshot#>>'{target,workspaceId}' is distinct from w.id::text or v.request_snapshot#>>'{target,scriptRevisionId}' is distinct from w.script_revision_id::text or v.request_snapshot#>>'{target,shotId}' is distinct from p_shot_id)) then raise exception 'Current preparation-bound video target required' using errcode='40001';end if;
 select * into rp from local_identity.production_preparation_revisions where id=p_review_package_id and episode_id=e.id and script_revision_id=e.main_script_revision_id and local_identity.preparation_source_current(id);
 if not found then raise exception 'Current production preparation required' using errcode='40001';end if;
 s:=local_identity.workspace_shot_context(p_episode_id,p_review_package_id,p_shot_id);
 if s is null then raise exception 'Current bound production shot required' using errcode='40001';end if;
 if exists(select 1 from local_identity.workspace_visual_candidates where id=p_request_id and request_snapshot->>'selectionVersion'='1') then s:=s-'shotType';typ:='video';
 else typ:=local_identity.historical_preparation_shot_classification(rp.id,p_shot_id);if typ not in ('a_roll','b_roll') or typ is null then raise exception 'Recorded legacy visual selection required' using errcode='22023';end if;end if;
 select policy into pol from public.account_blueprint_versions where id=e.blueprint_version_id;
 cfg:=case when exists(select 1 from local_identity.workspace_visual_candidates where id=p_request_id and request_snapshot->>'selectionVersion'='1') then (select request_snapshot->'execution' from local_identity.workspace_visual_candidates where id=p_request_id) else pol->typ end;
 if cfg->>'execution_path' is distinct from 'external' or cfg#>>'{executor,provider}' is distinct from 'bailian' or cfg#>>'{executor,adapter}' is distinct from 'wan_video' or coalesce(cfg#>>'{executor,model}','') NOT IN ('wan2.6-i2v-flash','wan2.6-i2v','wan2.6-r2v','wan2.5-i2v-preview','wan2.2-i2v-flash','wan2.2-i2v-plus','wanx2.1-i2v-plus','wanx2.1-i2v-turbo') then raise exception 'Select a verified Bailian video connection for this shot capability'; end if;
 ref:=(cfg->>'credential_ref')::uuid;
 if not exists(select 1 from public.external_connection_versions v join public.external_connections c on c.id=v.connection_id where v.id=ref and c.created_by=local_identity.owner_id() and c.current_version_id=v.id and v.provider='bailian' and v.adapter='wan_video' and v.revoked_at is null and public.connection_version_is_verified(v.id)) then raise exception 'Current verified Bailian connection required'; end if;
 if p_request_id is null or p_prompt is null or p_duration is null or p_duration not between 2 and 15 or char_length(btrim(p_prompt)) not between 1 and 1500 then raise exception 'Prompt or duration invalid'; end if;
 if cfg#>>'{executor,model}'='wan2.6-r2v' then
  select request_snapshot->'visualInputs',request_snapshot->>'videoMode',request_snapshot->>'referenceRatio' into visual_inputs,visual_mode,reference_ratio
   from local_identity.workspace_visual_candidates where id=p_request_id and episode_id=e.id and request_snapshot->>'selectionVersion'='1';
  if visual_mode is distinct from 'references' or jsonb_typeof(visual_inputs) is distinct from 'array'
   or jsonb_array_length(visual_inputs) not between 1 and 5 or p_first_frame_id is not null or p_duration not between 2 and 10
   or not coalesce(reference_ratio in ('16:9','9:16','1:1'),false) then
   raise exception 'Invalid Wan workspace reference inputs' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('artifactType',entry->>'artifactType','relativePath',entry->>'relativePath','sha256',entry->>'sha256','fileSize',entry->'fileSize') order by seq)
   into input_files from jsonb_array_elements(visual_inputs) with ordinality as v(entry,seq);
 else
 select * into src from public.production_material_revisions where id=p_first_frame_id and episode_id=e.id and material_type='image' and mime_type in ('image/png','image/jpeg','image/webp','image/bmp') and file_size between 1 and 20971520;
 if not found then raise exception 'Select an uploaded first-frame image from this Episode'; end if;
 image:=jsonb_build_object('artifactType','wan_first_frame','relativePath',src.storage_path,'sha256',src.sha256,'fileSize',src.file_size);
  input_files:=jsonb_build_array(image);
 end if;
 s:=jsonb_set(s,'{inputBasis}',(select jsonb_agg(jsonb_build_object('relativePath',f->>'relativePath','sha256',f->>'sha256')) from jsonb_array_elements(input_files) f));
 insert into public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,budget_limit_cents,max_attempts,input_snapshot)
 values(tid,e.id,case typ when 'video' then 'generate_shot_video' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end,'ready','bailian',cfg#>>'{executor,model}','wan-video-v1',coalesce((SELECT (request_snapshot->>'reservationCents')::integer FROM local_identity.workspace_visual_candidates WHERE id=p_request_id AND request_snapshot->>'selectionVersion'='1'),p_duration*15),1,
 jsonb_build_object('workspace_visual',(select request_snapshot->'mainVoice' from local_identity.workspace_visual_candidates where id=p_request_id),'workspace_visual_request_id',p_request_id,'capability',case typ when 'video' then 'shot_video_generation' else typ||'_generation' end,'wan_request_id',p_request_id,'requested_by',local_identity.owner_id(),'production_preparation',jsonb_build_object('version','production-preparation-ref/v1','workspace_id',(select workspace_id from local_identity.workspace_visual_candidates where id=p_request_id),'preparation_revision_id',rp.id,'script_revision_id',rp.script_revision_id,'shot_id',p_shot_id),'configuration_hash',tid::text,'shot',s,'executor',cfg->'executor','credential_ref',ref,
 'allowed_tools',jsonb_build_array('read','write'),'budget',jsonb_build_object('limit_cents',coalesce((SELECT (request_snapshot->>'reservationCents')::integer FROM local_identity.workspace_visual_candidates WHERE id=p_request_id AND request_snapshot->>'selectionVersion'='1'),p_duration*15),'max_attempts',1),
 'input_artifacts',input_files,
 'media',jsonb_build_object('adapter','wan_video','wan_video',jsonb_build_object('first_frame',image,'prompt',btrim(p_prompt),'duration_seconds',p_duration,'image_mime',src.mime_type,'resolution','720P','audio',false)||
  case when visual_inputs is null then '{}'::jsonb else jsonb_build_object('visual_inputs',visual_inputs,'visual_mode',visual_mode,'reference_ratio',reference_ratio) end),
 'output',jsonb_build_object('content_type','video/mp4','required_artifact_types',jsonb_build_array(case typ when 'video' then 'shot_video' when 'a_roll' then 'a_roll_video' else 'b_roll_asset' end),'relative_path',format('episodes/%s/wan/%s.mp4',e.id,tid),'review_stage','production_ready')));
 insert into public.audit_events(account_id,episode_id,event_type,payload,actor_id) values(e.account_id,e.id,'wan_video_requested',jsonb_build_object('task_id',tid,'shot_id',p_shot_id,'duration',p_duration,'reserved_cents',coalesce((SELECT (request_snapshot->>'reservationCents')::integer FROM local_identity.workspace_visual_candidates WHERE id=p_request_id AND request_snapshot->>'selectionVersion'='1'),p_duration*15)),local_identity.owner_id());
 return tid;
end $function$
;
CREATE OR REPLACE FUNCTION local_identity.queue_workspace_visual_before_settings(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v local_identity.workspace_visual_candidates; w local_identity.production_workspaces; tid uuid; BEGIN
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned visual request required' USING ERRCODE='42501'; END IF;
 w:=local_identity.lock_current_production_workspace(v.workspace_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(v.workspace_id::text||v.target_item_id,0));
 IF v.task_id IS NOT NULL THEN RETURN v.task_id; END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates other JOIN public.tasks t ON t.id=other.task_id LEFT JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id WHERE other.workspace_id=v.workspace_id AND other.target_item_id=v.target_item_id AND t.task_type IN ('generate_shot_video','search_shot_video','preview_shot_video','generate_a_roll', 'generate_b_roll') AND (t.status='running' OR (t.status='ready' AND (t.invalidated_at IS NULL OR EXISTS(SELECT 1 FROM public.paid_generation_reservations prior_reservation WHERE prior_reservation.task_id=t.id) OR EXISTS(SELECT 1 FROM local_identity.native_output_publications prior_publication WHERE prior_publication.task_id=t.id))) OR (s.outcome IN ('started','received') AND t.status<>'completed'))) THEN RAISE EXCEPTION 'Previous visual submission pending or unknown; reconcile or resume its saved Provider ID' USING ERRCODE='55000'; END IF;
 UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=v.episode_id;
 IF v.request_snapshot#>>'{execution,executor,provider}'='bailian' THEN
 tid:=local_identity.request_workspace_wan_visual(v.episode_id,w.preparation_revision_id,v.shot_id,(v.request_snapshot->>'firstFrameId')::uuid,v.request_snapshot->>'prompt',(v.request_snapshot->>'providerDurationSeconds')::integer,v.id);
 ELSE
 tid:=local_identity.request_workspace_official_visual(v.episode_id,w.preparation_revision_id,v.shot_id,(v.request_snapshot->>'firstFrameId')::uuid,v.request_snapshot->>'prompt',(v.request_snapshot->>'providerDurationSeconds')::integer,v.id,(v.request_snapshot->>'reservationCents')::integer);
 END IF;
 UPDATE local_identity.workspace_visual_candidates SET task_id=tid WHERE id=v.id AND task_id IS NULL;RETURN tid;
END $function$
;
CREATE OR REPLACE FUNCTION local_identity.reserve_workspace_visual_generation(p_task uuid, p_attempt integer, p_lease uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v local_identity.workspace_visual_candidates; w local_identity.production_workspaces; reservation jsonb; BEGIN
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE task_id=p_task;
 IF NOT FOUND THEN RETURN local_identity.reserve_wan_generation(p_task,p_attempt,p_lease); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v.workspace_id::text||v.target_item_id,0));
 -- A saved Provider task is polled using its frozen request even after an edit.
 IF NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations WHERE task_id=p_task AND provider_task_id IS NOT NULL) THEN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=v.workspace_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=e.id AND p.script_revision_id=w.script_revision_id JOIN local_identity.workspace_production_authorizations a ON a.episode_id=e.id WHERE e.id=v.episode_id AND e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id) AND local_identity.workspace_task_preparation_current(p_task,w.id) AND e.archived_at IS NULL AND e.stage<>'production_completed' AND a.enabled AND a.authorized_at IS NOT NULL AND a.authorization_hash=v.request_snapshot->>'authorizationHash' AND a.script_revision_id=w.script_revision_id) THEN RAISE EXCEPTION 'Visual input or production authorization changed'; END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates other JOIN public.tasks t ON t.id=other.task_id JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id WHERE other.workspace_id=v.workspace_id AND other.target_item_id=v.target_item_id AND t.task_type IN ('generate_shot_video','search_shot_video','preview_shot_video','generate_a_roll', 'generate_b_roll') AND other.id<>v.id AND s.outcome IN ('started','received') AND t.status<>'completed') THEN RAISE EXCEPTION 'Previous visual submission outcome unknown'; END IF;
 END IF;
 reservation:=local_identity.reserve_wan_generation(p_task,p_attempt,p_lease);
 IF coalesce((reservation->>'new')::boolean,false) THEN INSERT INTO local_identity.workspace_visual_submissions(task_id,outcome) VALUES(p_task,'started') ON CONFLICT DO NOTHING; END IF;
 RETURN reservation;
END $function$
;

-- Retained legacy adapter installs the verified child tuple atomically under the new same-script FK.
CREATE OR REPLACE FUNCTION local_identity.resume_workspace_formatting_revision(p_workspace uuid, p_revision bigint, p_script uuid, p_project_sha text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces;e public.episodes;old public.review_packages;next_package uuid:=extensions.gen_random_uuid();next_revision integer;BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned workspace required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id FOR UPDATE;
 IF e.archived_at IS NOT NULL OR local_identity.is_historical_episode(e.id) OR e.stage<>'waiting_input' OR e.main_script_revision_id IS DISTINCT FROM p_script OR w.script_revision_id=p_script OR w.revision<>p_revision OR w.project_sha256<>p_project_sha THEN RAISE EXCEPTION 'Current pending script and workspace required' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=e.id AND status IN ('ready','running')) THEN RAISE EXCEPTION 'Finish current tasks before resuming editing';END IF;
 SELECT * INTO old FROM public.review_packages WHERE id=w.storyboard_package_id AND episode_id=e.id AND stage='storyboard_review';
 IF NOT FOUND OR w.preparation_revision_id IS DISTINCT FROM old.id OR NOT EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id=p_script AND episode_id=e.id AND is_main_script) THEN RAISE EXCEPTION 'Verified source preparation required';END IF;
 SELECT coalesce(max(revision_number),0)+1 INTO next_revision FROM public.review_packages WHERE episode_id=e.id AND stage='storyboard_review';
 INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,context_snapshot) VALUES(next_package,e.id,'storyboard_review',next_revision,old.artifact_id,old.context_snapshot||jsonb_build_object('workspace_preparation',jsonb_build_object('scriptRevisionId',p_script,'script_revision_id',p_script,'origin','legacy-board','sourceReviewPackageId',old.id,'formattingOnly',true),'continued_project',jsonb_build_object('workspaceId',w.id,'sha256',w.project_sha256,'previousScriptRevisionId',w.script_revision_id)));
 INSERT INTO local_identity.workspace_preparations(package_id,episode_id,script_revision_id,origin,confirmed_by) VALUES(next_package,e.id,p_script,'legacy-board',local_identity.owner_id());
 PERFORM local_identity.import_preparation_source(e.id,p_script,next_package);
 UPDATE local_identity.production_workspaces SET script_revision_id=p_script,storyboard_package_id=next_package,preparation_revision_id=next_package,revision=revision+1,updated_at=clock_timestamp() WHERE id=w.id;
 UPDATE public.episodes SET stage='storyboard_review',updated_at=clock_timestamp() WHERE id=e.id;
 UPDATE local_identity.script_productions SET enabled=false,authorized_at=NULL,last_status='排版修订已确认，沿用原工程；在线制作未授权',updated_at=clock_timestamp() WHERE episode_id=e.id;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,e.id,'workspace_formatting_revision_confirmed',jsonb_build_object('workspace_id',w.id,'source_package_id',old.id,'package_id',next_package,'previous_script_revision_id',w.script_revision_id,'script_revision_id',p_script,'project_sha256',w.project_sha256,'reason','确认脚本排版修订，沿用现有工程继续编辑'),local_identity.owner_id());
END $function$
;
