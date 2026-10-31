-- Pexels search and selected preview use the existing persistent media queue.
-- Neither operation registers/adopts a material; only Owner's explicit import does.
CREATE TABLE local_identity.workspace_pexels_requests(
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,target_item_id text NOT NULL,target_snapshot jsonb NOT NULL,
 request_snapshot jsonb NOT NULL,task_id uuid UNIQUE REFERENCES public.tasks(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX workspace_pexels_search_target ON local_identity.workspace_pexels_requests(workspace_id,target_item_id,created_at DESC,id DESC) WHERE request_snapshot->>'operation'='search';
CREATE INDEX workspace_pexels_preview_source ON local_identity.workspace_pexels_requests(workspace_id,(request_snapshot#>>'{source,searchId}'),target_item_id,(request_snapshot#>>'{source,id}'),created_at DESC,id DESC) WHERE request_snapshot->>'operation'='preview';
ALTER TABLE local_identity.workspace_pexels_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_pexels_owner ON local_identity.workspace_pexels_requests TO loop_app
 USING(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_pexels_requests.workspace_id AND w.episode_id=workspace_pexels_requests.episode_id))
 WITH CHECK(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_pexels_requests.workspace_id AND w.episode_id=workspace_pexels_requests.episode_id));
REVOKE ALL ON local_identity.workspace_pexels_requests FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT,INSERT ON local_identity.workspace_pexels_requests TO loop_app;
CREATE FUNCTION local_identity.queue_workspace_pexels(p_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r local_identity.workspace_pexels_requests;w local_identity.production_workspaces;cfg jsonb;snap jsonb;tid uuid;op text;BEGIN
 SELECT * INTO r FROM local_identity.workspace_pexels_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(r.episode_id) THEN RAISE EXCEPTION 'Owned Pexels request required' USING ERRCODE='42501';END IF;
 IF r.task_id IS NOT NULL THEN RETURN r.task_id;END IF;
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=r.workspace_id FOR UPDATE;
 snap:=r.request_snapshot;cfg:=snap->'execution';op:=snap->>'operation';
 IF op NOT IN ('search','preview') OR snap#>>'{selection,capability}'<>'video' OR cfg#>>'{executor,provider}'<>'pexels' OR cfg#>>'{executor,adapter}'<>'pexels_video' OR snap#>>'{selection,model}' IS NOT NULL OR cfg->>'credential_ref' IS DISTINCT FROM snap#>>'{selection,connectionVersionId}' OR NOT EXISTS(SELECT 1 FROM public.episodes e WHERE e.id=r.episode_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND w.revision=(snap->>'expectedRevision')::bigint) THEN RAISE EXCEPTION 'Current Pexels selection and workspace required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.external_connection_versions cv JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=local_identity.owner_id() JOIN local_identity.connection_bindings cb ON cb.version_id=cv.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=cv.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE cv.id::text=cfg->>'credential_ref' AND cv.provider='pexels' AND cv.adapter='pexels_video' AND cv.revoked_at IS NULL AND (op='preview' OR cn.current_version_id=cv.id) AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence p WHERE p.version_id=cv.id AND p.owner_id=cn.created_by AND p.mode='live' AND p.outcome='verified')) THEN RAISE EXCEPTION 'Validated owned Pexels connection required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.workspace_id::text||r.target_item_id||':pexels:'||op,0));
 IF EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests x JOIN public.tasks t ON t.id=x.task_id WHERE x.workspace_id=r.workspace_id AND x.target_item_id=r.target_item_id AND x.request_snapshot->>'operation'=op AND t.status IN ('ready','running')) THEN RAISE EXCEPTION 'Pexels request already running' USING ERRCODE='55000';END IF;
 UPDATE local_identity.input_episodes SET enabled=true,media_enabled=true WHERE episode_id=r.episode_id;
 INSERT INTO public.tasks(episode_id,task_type,status,budget_limit_cents,max_attempts,provider,model,prompt_version,input_snapshot) VALUES(r.episode_id,'generate_b_roll','ready',0,1,'pexels','pexels-video-v1','workspace-pexels-v1',jsonb_build_object(
 'capability','b_roll_generation','workspace_pexels_request_id',r.id,'configuration_hash',snap->>'fingerprint','credential_ref',cfg->>'credential_ref','executor',cfg->'executor','production_selection',snap->'selection','production_context',snap->'context','workspace_target',snap->'target','cost_basis',jsonb_build_object('kind','free-search','reservedCents',0),'allowed_tools',jsonb_build_array('read','write'),'input_artifacts',snap->'inputs','budget',jsonb_build_object('limit_cents',0,'max_attempts',1),
 'media',jsonb_build_object('adapter','pexels_video','b_roll',jsonb_build_object('query',snap->>'query','target_duration_seconds',snap->'targetDurationSeconds','request',jsonb_build_object('operation',op,'parameters',snap->'parameters','source',snap->'source'))),
 'output',jsonb_build_object('required_artifact_types',jsonb_build_array(CASE op WHEN 'search' THEN 'pexels_search_results' ELSE 'pexels_video_preview' END),'content_type',CASE op WHEN 'search' THEN 'application/json' ELSE 'video/mp4' END,'relative_path',format('episodes/%s/pexels/%s',r.episode_id,CASE op WHEN 'search' THEN 'results.json' ELSE 'preview.mp4' END),'review_stage','production_ready'))) RETURNING id INTO tid;
 UPDATE local_identity.workspace_pexels_requests SET task_id=tid WHERE id=r.id;RETURN tid;
END $$;
REVOKE ALL ON FUNCTION local_identity.queue_workspace_pexels(uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.queue_workspace_pexels(uuid) TO loop_owner;
