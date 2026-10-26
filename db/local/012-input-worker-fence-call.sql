-- Qualify the local variable against the task id column; keep all fence checks.
CREATE OR REPLACE FUNCTION local_identity.input_worker_call(p_name text,p_args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected_task_id uuid:=(p_args->>'p_task_id')::uuid; BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.tasks t JOIN local_identity.input_episodes e ON e.episode_id=t.episode_id WHERE t.id=selected_task_id AND e.enabled AND t.task_type='prepare_visual_brief') THEN RAISE EXCEPTION 'Managed input Worker task required' USING ERRCODE='42501'; END IF;
 IF p_name='refresh_worker_task_lease' THEN PERFORM public.refresh_worker_task_lease(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid);
 ELSIF p_name='report_worker_progress' THEN PERFORM public.report_worker_progress(selected_task_id,(p_args->>'p_attempt')::integer,(p_args->>'p_lease_token')::uuid,p_args->'p_progress');
 ELSIF p_name='report_worker_result' THEN PERFORM public.report_worker_result(selected_task_id,(p_args->>'p_attempt')::integer,p_args->'p_result',(p_args->>'p_lease_token')::uuid);
 ELSE RAISE EXCEPTION 'Unsupported Worker command' USING ERRCODE='22023'; END IF; RETURN 'null'::jsonb; END $$;
