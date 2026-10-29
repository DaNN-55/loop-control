-- Exact-export delivery uses the existing durable queue and lease/result protocol.
CREATE TABLE local_identity.workspace_deliveries (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),
 episode_id uuid NOT NULL REFERENCES public.episodes(id),export_id uuid NOT NULL REFERENCES local_identity.workspace_exports(id),
 task_id uuid NOT NULL UNIQUE REFERENCES public.tasks(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.workspace_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_delivery_owner ON local_identity.workspace_deliveries TO loop_app USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
GRANT SELECT ON local_identity.workspace_deliveries TO loop_app;
ALTER FUNCTION local_identity.input_task_allowed(uuid,text) RENAME TO input_task_allowed_before_workspace_delivery;
CREATE FUNCTION local_identity.input_task_allowed(p_episode_id uuid,p_task_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT local_identity.input_task_allowed_before_workspace_delivery(p_episode_id,p_task_type) OR (p_task_type='prepare_publish_package' AND EXISTS(SELECT 1 FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id WHERE e.id=p_episode_id AND e.archived_at IS NULL AND e.stage<>'production_completed'))
$$;
REVOKE ALL ON FUNCTION local_identity.input_task_allowed(uuid,text) FROM PUBLIC;
CREATE FUNCTION local_identity.workspace_delivery_current(p_workspace uuid,p_export uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id JOIN public.review_packages p ON p.id=w.storyboard_package_id JOIN local_identity.workspace_exports x ON x.workspace_id=w.id
 WHERE w.id=p_workspace AND x.id=p_export AND x.status='ready' AND x.confirmed_at IS NOT NULL AND x.project_content_version=w.revision AND x.content_sha256=w.content_sha256 AND e.main_script_revision_id=w.script_revision_id AND p.invalidated_at IS NULL AND e.archived_at IS NULL
 AND x.id=(SELECT id FROM local_identity.workspace_exports WHERE workspace_id=w.id ORDER BY created_at DESC,id DESC LIMIT 1)
 AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_export_issues i WHERE i.workspace_id=w.id AND (i.resolved_at IS NULL OR i.created_at>x.confirmed_at)))
$$;
CREATE FUNCTION local_identity.queue_workspace_delivery(p_id uuid,p_workspace uuid,p_export uuid,p_snapshot jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces;x local_identity.workspace_exports;t public.tasks;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) OR NOT local_identity.workspace_delivery_current(w.id,p_export) THEN RAISE EXCEPTION 'Current confirmed workspace export required' USING ERRCODE='22023'; END IF;
 SELECT * INTO x FROM local_identity.workspace_exports WHERE id=p_export;
 IF p_snapshot->>'capability'<>'workspace_delivery' OR p_snapshot#>>'{workspace_delivery,identity,exportId}'<>x.id::text OR p_snapshot#>>'{workspace_delivery,identity,workspaceId}'<>w.id::text OR p_snapshot#>>'{workspace_delivery,identity,contentSha256}'<>x.content_sha256 OR p_snapshot#>'{workspace_delivery,identity,video}' IS DISTINCT FROM x.artifact||'{"artifactType":"final_render"}'::jsonb OR p_snapshot#>'{workspace_delivery,identity,project}' IS DISTINCT FROM x.project||'{"artifactType":"editable_project"}'::jsonb OR (p_snapshot#>>'{workspace_delivery,identity,projectContentVersion}')::bigint<>x.project_content_version THEN RAISE EXCEPTION 'Delivery does not match exact export' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_deliveries d JOIN public.tasks busy ON busy.id=d.task_id WHERE d.workspace_id=w.id AND busy.status IN ('ready','running')) THEN RAISE EXCEPTION 'Delivery already queued' USING ERRCODE='22023'; END IF;
 INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,provider,model,prompt_version,max_attempts) VALUES(p_id,w.episode_id,'prepare_publish_package','ready',p_snapshot,'ffmpeg','workspace-delivery/v2','workspace-delivery/v2',1) RETURNING * INTO t;
 INSERT INTO local_identity.workspace_deliveries(id,workspace_id,episode_id,export_id,task_id) VALUES(p_id,w.id,w.episode_id,x.id,t.id);
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) SELECT account_id,id,'workspace_delivery_queued',jsonb_build_object('task_id',t.id,'export_id',x.id,'sha256',x.artifact->>'sha256'),local_identity.owner_id() FROM public.episodes WHERE id=w.episode_id;
 RETURN t.id;
END $$;
ALTER FUNCTION local_identity.input_worker_call(text,jsonb) RENAME TO input_worker_call_before_workspace_delivery;
CREATE FUNCTION local_identity.input_worker_call(p_name text,p_args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tasks;d local_identity.workspace_deliveries;candidate_artifact jsonb;pack jsonb;oldstage public.episode_stage;
BEGIN
 SELECT * INTO d FROM local_identity.workspace_deliveries WHERE task_id=(p_args->>'p_task_id')::uuid;
 IF NOT FOUND THEN RETURN local_identity.input_worker_call_before_workspace_delivery(p_name,p_args); END IF;
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501'; END IF;
 -- Match Owner lock order: episode, workspace, task. Completion cannot race editing.
 PERFORM id FROM public.episodes WHERE id=d.episode_id FOR UPDATE;
 PERFORM id FROM local_identity.production_workspaces WHERE id=d.workspace_id FOR UPDATE;
 SELECT * INTO t FROM public.tasks WHERE id=d.task_id FOR UPDATE;
 IF p_name='refresh_worker_task_lease' THEN PERFORM public.refresh_worker_task_lease(t.id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid);
 ELSIF p_name='report_worker_progress' THEN PERFORM public.report_worker_progress(t.id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid,p_args->'p_progress');
 ELSIF p_name='report_worker_result' THEN
  IF p_args#>>'{p_result,status}'='completed' THEN
   IF NOT local_identity.workspace_delivery_current(d.workspace_id,d.export_id) THEN RAISE EXCEPTION 'Confirmed export changed before delivery completion' USING ERRCODE='22023'; END IF;
   IF p_args#>'{p_result,deliveryIdentity}' IS DISTINCT FROM t.input_snapshot#>'{workspace_delivery,identity}' THEN RAISE EXCEPTION 'Result identity mismatch' USING ERRCODE='22023'; END IF;
   SELECT value INTO pack FROM jsonb_array_elements(p_args#>'{p_result,artifacts}') entry(value) WHERE value->>'artifactType'='publish_package';
   IF pack->>'relativePath' IS DISTINCT FROM t.input_snapshot#>>'{output,relative_path}' OR jsonb_array_length(p_args#>'{p_result,artifacts}')<>4 THEN RAISE EXCEPTION 'Delivery manifest mismatch' USING ERRCODE='22023'; END IF;
   FOR candidate_artifact IN SELECT value FROM jsonb_array_elements(t.input_snapshot#>'{workspace_delivery,artifacts}') entry(value) WHERE value->>'artifactType' IN ('cover','metadata','final_qc_report') LOOP
    IF NOT (p_args#>'{p_result,artifacts}') @> jsonb_build_array(candidate_artifact) THEN RAISE EXCEPTION 'Delivery inputs mismatch' USING ERRCODE='22023'; END IF;
   END LOOP;
  END IF;
  PERFORM public.report_worker_result(t.id,(p_args->>'p_attempt')::integer,p_args->'p_result',(p_args->>'p_lease_token')::uuid);
  IF p_args#>>'{p_result,status}'='completed' THEN
   SELECT stage INTO oldstage FROM public.episodes WHERE id=d.episode_id FOR UPDATE;
   UPDATE public.episodes SET stage='production_completed',updated_at=clock_timestamp() WHERE id=d.episode_id;
   INSERT INTO public.state_transitions(episode_id,from_stage,to_stage,reason) VALUES(d.episode_id,oldstage,'production_completed','Exact workspace delivery package verified.');
   INSERT INTO public.audit_events(account_id,episode_id,event_type,payload) SELECT account_id,id,'publish_package_verified',jsonb_build_object('task_id',t.id,'export_id',d.export_id,'sha256',pack->>'sha256','to_stage','production_completed','protocol','publish-package/v2') FROM public.episodes WHERE id=d.episode_id;
  END IF;
 ELSE RAISE EXCEPTION 'Unsupported Worker command' USING ERRCODE='22023'; END IF;
 RETURN 'null'::jsonb;
END $$;
REVOKE ALL ON FUNCTION local_identity.workspace_delivery_current(uuid,uuid),local_identity.queue_workspace_delivery(uuid,uuid,uuid,jsonb),local_identity.input_worker_call(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.queue_workspace_delivery(uuid,uuid,uuid,jsonb) TO loop_app;
GRANT EXECUTE ON FUNCTION local_identity.input_worker_call(text,jsonb) TO loop_worker;
