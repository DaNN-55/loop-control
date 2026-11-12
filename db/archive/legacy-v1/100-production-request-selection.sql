-- Expand per-request selection while retaining the legacy image request read path.
CREATE OR REPLACE FUNCTION local_identity.queue_workspace_images(p_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v local_identity.workspace_visual_candidates;w local_identity.production_workspaces;cfg jsonb;auth local_identity.script_productions;tid uuid;frozen jsonb;aid uuid;account_budget public.generation_account_budgets;BEGIN
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned image request required' USING ERRCODE='42501';END IF;
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=v.workspace_id FOR UPDATE;
 IF v.task_id IS NOT NULL THEN RETURN v.task_id;END IF;
 SELECT b.policy->'static_visual' INTO cfg FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=v.episode_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed';
 SELECT * INTO auth FROM local_identity.script_productions WHERE episode_id=v.episode_id AND script_revision_id=w.script_revision_id AND enabled AND authorized_at IS NOT NULL;
 IF v.request_snapshot->>'selectionVersion'='1' THEN
 cfg:=v.request_snapshot->'execution';
 IF cfg->>'credential_ref' IS DISTINCT FROM v.request_snapshot#>>'{selection,connectionVersionId}' OR NOT EXISTS(SELECT 1 FROM public.external_connection_versions cv JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=local_identity.owner_id() AND cn.current_version_id=cv.id JOIN local_identity.connection_bindings cb ON cb.version_id=cv.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=cv.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE cv.id::text=cfg->>'credential_ref' AND cv.provider='openai' AND cv.adapter='openai_images' AND cv.revoked_at IS NULL AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence p WHERE p.version_id=cv.id AND p.owner_id=cn.created_by AND p.mode='live' AND p.outcome='verified')) THEN RAISE EXCEPTION 'Validated owned image connection required';END IF;
 END IF;
 IF cfg IS NULL OR cfg IS DISTINCT FROM v.request_snapshot->'execution' OR cfg->>'execution_path'<>'external' OR cfg#>>'{executor,provider}'<>'openai' OR cfg#>>'{executor,adapter}'<>'openai_images' OR cfg#>>'{executor,model}'<>'gpt-image-2' OR auth.authorization_hash IS DISTINCT FROM v.request_snapshot->>'authorizationHash' OR auth.authorization_hash IS NULL THEN RAISE EXCEPTION 'Current authorized image configuration required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN public.review_packages p ON p.id=w.storyboard_package_id WHERE e.id=v.episode_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND p.invalidated_at IS NULL) THEN RAISE EXCEPTION 'Current workspace required';END IF;
 SELECT account_id INTO aid FROM public.episodes WHERE id=v.episode_id;
 SELECT * INTO account_budget FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF account_budget.account_id IS NULL THEN RAISE EXCEPTION 'Approve a generation budget first';END IF;
 IF (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+(SELECT coalesce(sum(t.budget_limit_cents),0) FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id WHERE e.account_id=aid AND t.task_type='generate_static_visual' AND t.status IN ('ready','running') AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id))+(v.request_snapshot->>'reservationCents')::integer>account_budget.total_limit_cents THEN RAISE EXCEPTION '图片生成预算不足' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates x JOIN public.tasks t ON t.id=x.task_id LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id LEFT JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id WHERE x.workspace_id=v.workspace_id AND x.target_item_id=v.target_item_id AND x.request_snapshot->>'kind'='image' AND (t.status IN ('ready','running') OR (r.request_state='submitting' AND t.status<>'completed' AND coalesce(s.outcome,'started')<>'rejected'))) THEN RAISE EXCEPTION 'Previous image submission pending or unknown' USING ERRCODE='55000';END IF;
 frozen:=jsonb_build_object('capability','static_visual_generation','production_selection',v.request_snapshot->'selection','production_context',v.request_snapshot->'context','workspace_target',v.request_snapshot->'target','cost_basis',v.request_snapshot->'costBasis','configuration_hash',v.input_fingerprint,'workspace_image_request_id',v.id,'credential_ref',cfg->>'credential_ref','executor',cfg->'executor','allowed_tools',jsonb_build_array('read','write'),'input_artifacts',coalesce(v.request_snapshot->'references','[]'::jsonb),'budget',jsonb_build_object('limit_cents',(v.request_snapshot->>'reservationCents')::integer,'max_attempts',1),'media',jsonb_build_object('adapter','openai_images','static_visual',jsonb_build_object('prompt',coalesce(v.request_snapshot->>'actualPrompt',v.request_snapshot->>'prompt'),'settings',v.request_snapshot->'imageSettings','references',coalesce(v.request_snapshot->'references','[]'::jsonb))),'output',jsonb_build_object('required_artifact_types',jsonb_build_array('static_visual'),'content_type','image/png','relative_path',format('episodes/%s/workspace-images/%s/image.png',v.episode_id,v.id),'review_stage','production_ready'));
 UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=v.episode_id;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(v.episode_id,'generate_static_visual','ready',frozen,(v.request_snapshot->>'reservationCents')::integer,1,'openai','gpt-image-2','workspace-image-v1') RETURNING id INTO tid;
 UPDATE local_identity.workspace_visual_candidates SET task_id=tid WHERE id=v.id;RETURN tid;
END $$;

-- A queued exact version remains executable after UI/defaults or connection rotation.
CREATE OR REPLACE FUNCTION local_identity.input_media_connection(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_version_id uuid) RETURNS TABLE(version_id uuid,provider text,adapter text,endpoint text,secret_ref uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tasks task WHERE task.id=p_task_id AND task.task_type='generate_static_visual' AND task.provider='openai') THEN
 RETURN QUERY SELECT * FROM local_identity.input_media_connection_before_images(p_task_id,p_attempt,p_lease_token,p_version_id);RETURN;END IF;
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 RETURN QUERY SELECT v.id,v.provider,v.adapter,v.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.media_enabled
 JOIN public.external_connection_versions v ON v.id=p_version_id AND v.provider='openai' AND v.adapter='openai_images' AND v.revoked_at IS NULL
 JOIN public.external_connections c ON c.id=v.connection_id AND c.created_by=i.owner_id
 JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=v.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.input_snapshot->>'credential_ref'=v.id::text AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen image connection unavailable';END IF;
END $$;
