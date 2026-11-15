-- Freeze Pexels inputs against the current independent preparation. Historical rows and frozen requests remain unchanged.

CREATE OR REPLACE FUNCTION local_identity.queue_workspace_pexels(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r local_identity.workspace_pexels_requests;w local_identity.production_workspaces;cfg jsonb;snap jsonb;tid uuid;op text;BEGIN
 SELECT * INTO r FROM local_identity.workspace_pexels_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(r.episode_id) THEN RAISE EXCEPTION 'Owned Pexels request required' USING ERRCODE='42501';END IF;
 IF r.task_id IS NOT NULL THEN RETURN r.task_id;END IF;
 w:=local_identity.lock_current_production_workspace(r.workspace_id);
 IF w.episode_id IS DISTINCT FROM r.episode_id OR NOT local_identity.preparation_source_current(w.preparation_revision_id) THEN RAISE EXCEPTION 'Current production preparation required';END IF;
 snap:=r.request_snapshot;cfg:=snap->'execution';op:=snap->>'operation';
 IF snap#>>'{target,workspaceId}' IS DISTINCT FROM w.id::text OR snap#>>'{target,preparationRevisionId}' IS DISTINCT FROM w.preparation_revision_id::text
  OR snap#>>'{target,scriptRevisionId}' IS DISTINCT FROM w.script_revision_id::text OR snap#>>'{target,targetItemId}' IS DISTINCT FROM r.target_item_id
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b JOIN local_identity.production_shot_versions s ON s.preparation_revision_id=w.preparation_revision_id AND s.episode_id=w.episode_id AND s.shot_id=b->>'shotId' WHERE b->>'itemId'=r.target_item_id AND s.shot_id=snap#>>'{target,shotId}') THEN RAISE EXCEPTION 'Frozen Pexels preparation target mismatch';END IF;
 IF op NOT IN ('search','preview') OR snap#>>'{selection,capability}'<>'video' OR cfg#>>'{executor,provider}'<>'pexels' OR cfg#>>'{executor,adapter}'<>'pexels_video' OR snap#>>'{selection,model}' IS NOT NULL OR cfg->>'credential_ref' IS DISTINCT FROM snap#>>'{selection,connectionVersionId}' OR NOT EXISTS(SELECT 1 FROM public.episodes e WHERE e.id=r.episode_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND w.revision=(snap->>'expectedRevision')::bigint) THEN RAISE EXCEPTION 'Current Pexels selection and workspace required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.external_connection_versions cv JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=local_identity.owner_id() JOIN local_identity.connection_bindings cb ON cb.version_id=cv.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=cv.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE cv.id::text=cfg->>'credential_ref' AND cv.provider='pexels' AND cv.adapter='pexels_video' AND cv.revoked_at IS NULL AND (op='preview' OR cn.current_version_id=cv.id) AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence p WHERE p.version_id=cv.id AND p.owner_id=cn.created_by AND p.mode='live' AND p.outcome='verified')) THEN RAISE EXCEPTION 'Validated owned Pexels connection required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.workspace_id::text||r.target_item_id||':pexels:'||op,0));
 IF EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests x JOIN public.tasks t ON t.id=x.task_id WHERE x.workspace_id=r.workspace_id AND x.target_item_id=r.target_item_id AND x.request_snapshot->>'operation'=op AND t.status IN ('ready','running')) THEN RAISE EXCEPTION 'Pexels request already running' USING ERRCODE='55000';END IF;
 UPDATE local_identity.input_episodes SET enabled=true,media_enabled=true WHERE episode_id=r.episode_id;
 INSERT INTO public.tasks(episode_id,task_type,status,budget_limit_cents,max_attempts,provider,model,prompt_version,input_snapshot) VALUES(r.episode_id,CASE op WHEN 'search' THEN 'search_shot_video' ELSE 'preview_shot_video' END,'ready',0,1,'pexels','pexels-video-v1','workspace-pexels-v1',jsonb_build_object(
 'capability',CASE op WHEN 'search' THEN 'shot_video_search' ELSE 'shot_video_preview' END,'production_preparation',jsonb_build_object('version','production-preparation-ref/v1','workspace_id',w.id,'preparation_revision_id',w.preparation_revision_id,'script_revision_id',w.script_revision_id,'shot_id',snap#>>'{target,shotId}'),'workspace_pexels_request_id',r.id,'configuration_hash',snap->>'fingerprint','credential_ref',cfg->>'credential_ref','executor',cfg->'executor','production_selection',snap->'selection','production_context',snap->'context','workspace_target',snap->'target','cost_basis',jsonb_build_object('kind','free-search','reservedCents',0),'allowed_tools',jsonb_build_array('read','write'),'input_artifacts',snap->'inputs','budget',jsonb_build_object('limit_cents',0,'max_attempts',1),
 'media',jsonb_build_object('adapter','pexels_video','video',jsonb_build_object('query',snap->>'query','target_duration_seconds',snap->'targetDurationSeconds','request',jsonb_build_object('operation',op,'parameters',snap->'parameters','source',snap->'source'))),
 'output',jsonb_build_object('required_artifact_types',jsonb_build_array(CASE op WHEN 'search' THEN 'pexels_search_results' ELSE 'pexels_video_preview' END),'content_type',CASE op WHEN 'search' THEN 'application/json' ELSE 'video/mp4' END,'relative_path',format('episodes/%s/pexels/%s',r.episode_id,CASE op WHEN 'search' THEN 'results.json' ELSE 'preview.mp4' END),'review_stage','production_ready'))) RETURNING id INTO tid;
 UPDATE local_identity.workspace_pexels_requests SET task_id=tid WHERE id=r.id;RETURN tid;
END $function$
;

CREATE OR REPLACE FUNCTION local_identity.workspace_task_preparation_current(p_task uuid, p_workspace uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      AND a.shot_id IS NOT DISTINCT FROM t.input_snapshot#>>'{production_preparation,shot_id}' AND (a.kind<>'source' OR a.shot_id IS NOT NULL))
    OR EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests r WHERE r.task_id=t.id AND r.workspace_id=w.id AND r.episode_id=e.id
     AND t.provider='pexels' AND t.task_type IN ('search_shot_video','preview_shot_video') AND r.id::text=t.input_snapshot->>'workspace_pexels_request_id' AND t.prompt_version='workspace-pexels-v1' AND t.model='pexels-video-v1'
     AND t.input_snapshot->'workspace_target'=r.request_snapshot->'target'
     AND coalesce(t.input_snapshot#>>'{media,video,request,operation}',t.input_snapshot#>>'{media,b_roll,request,operation}')=r.request_snapshot->>'operation'
     AND CASE WHEN t.task_type='generate_b_roll' THEN r.request_snapshot->>'operation' IN ('search','preview') ELSE t.task_type=CASE r.request_snapshot->>'operation' WHEN 'search' THEN 'search_shot_video' WHEN 'preview' THEN 'preview_shot_video' END END
     AND r.request_snapshot#>>'{target,workspaceId}'=w.id::text AND r.request_snapshot#>>'{target,preparationRevisionId}'=p.id::text
     AND r.request_snapshot#>>'{target,scriptRevisionId}'=w.script_revision_id::text AND r.request_snapshot#>>'{target,shotId}'=t.input_snapshot#>>'{production_preparation,shot_id}'
     AND r.target_item_id=r.request_snapshot#>>'{target,targetItemId}'
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'itemId'=r.target_item_id AND b->>'shotId'=r.request_snapshot#>>'{target,shotId}')))
  ELSE p.source_format='storyboard/v1' AND p.source_reference_id=w.storyboard_package_id
   AND (t.provider IS DISTINCT FROM 'pexels' AND (t.input_snapshot->>'storyboard_review_package_id'=p.source_reference_id::text OR t.task_type='generate_static_visual'
    AND EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates v WHERE v.workspace_id=w.id AND v.episode_id=e.id AND v.task_id=t.id AND v.id::text=t.input_snapshot->>'workspace_image_request_id'))
    OR t.provider='pexels' AND t.task_type IN ('search_shot_video','preview_shot_video','generate_b_roll')
    AND EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests r WHERE r.task_id=t.id AND r.workspace_id=w.id AND r.episode_id=e.id
     AND NOT(r.request_snapshot->'target' ? 'preparationRevisionId') AND NOT(r.request_snapshot->'target' ? 'workspaceId')
     AND r.id::text=t.input_snapshot->>'workspace_pexels_request_id' AND t.prompt_version='workspace-pexels-v1' AND t.model='pexels-video-v1'
     AND t.input_snapshot->'workspace_target'=r.request_snapshot->'target'
     AND coalesce(t.input_snapshot#>>'{media,video,request,operation}',t.input_snapshot#>>'{media,b_roll,request,operation}')=r.request_snapshot->>'operation'
     AND CASE WHEN t.task_type='generate_b_roll' THEN r.request_snapshot->>'operation' IN ('search','preview') ELSE t.task_type=CASE r.request_snapshot->>'operation' WHEN 'search' THEN 'search_shot_video' WHEN 'preview' THEN 'preview_shot_video' END END AND r.request_snapshot#>>'{target,scriptRevisionId}'=w.script_revision_id::text
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'itemId'=r.target_item_id AND b->>'shotId'=r.request_snapshot#>>'{target,shotId}')))
  END)
$function$
;

CREATE OR REPLACE FUNCTION local_identity.input_media_connection(p_task_id uuid, p_attempt integer, p_lease_token uuid, p_version_id uuid)
 RETURNS TABLE(version_id uuid, provider text, adapter text, endpoint text, secret_ref uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests r WHERE r.task_id=p_task_id) THEN
  IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
  PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
  IF NOT EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests r WHERE r.task_id=p_task_id AND local_identity.workspace_task_preparation_current(p_task_id,r.workspace_id)) THEN RAISE EXCEPTION 'Pexels production preparation is stale' USING ERRCODE='55000';END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND t.task_type='generate_soundtrack' AND EXISTS(SELECT 1 FROM local_identity.workspace_audio_requests r WHERE r.task_id=t.id)) THEN RETURN QUERY SELECT * FROM local_identity.input_media_connection_before_audio_selection(p_task_id,p_attempt,p_lease_token,p_version_id);RETURN;END IF;
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 RETURN QUERY SELECT cv.id,cv.provider,cv.adapter,cv.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.media_enabled
 JOIN public.external_connection_versions cv ON cv.id=p_version_id AND cv.provider=t.provider AND cv.adapter=t.input_snapshot#>>'{executor,adapter}' AND cv.revoked_at IS NULL
 JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=i.owner_id
 JOIN local_identity.connection_bindings b ON b.version_id=cv.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=cv.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.input_snapshot->>'credential_ref'=cv.id::text AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=cv.id AND pe.owner_id=i.owner_id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen audio connection unavailable';END IF;
END $function$
;
