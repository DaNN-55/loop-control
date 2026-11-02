-- A task whose files may already have been published must never be re-executed
-- by generic failure handling or lease expiry. No new task state or queue.
CREATE TABLE local_identity.native_output_publications (
 task_id uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
 attempt integer NOT NULL CHECK(attempt>=0),
 lease_token uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.native_output_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON local_identity.native_output_publications FROM PUBLIC,loop_app,loop_worker;

CREATE FUNCTION local_identity.begin_native_output_publication(p_task_id uuid,p_attempt integer,p_lease_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
 IF NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND local_identity.input_task_allowed(t.episode_id,t.task_type)) THEN RAISE EXCEPTION 'Native task required' USING ERRCODE='42501'; END IF;
 INSERT INTO local_identity.native_output_publications(task_id,attempt,lease_token) VALUES(p_task_id,p_attempt,p_lease_token) ON CONFLICT(task_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM local_identity.native_output_publications WHERE task_id=p_task_id AND attempt=p_attempt AND lease_token=p_lease_token) THEN RAISE EXCEPTION 'Pending publication belongs to another attempt' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION local_identity.finish_native_output_publication(p_task_id uuid,p_attempt integer,p_lease_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tasks;
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.tasks WHERE id=p_task_id FOR UPDATE;
 IF NOT FOUND OR t.attempt<>p_attempt+1 OR NOT EXISTS(SELECT 1 FROM public.task_runs r WHERE r.task_id=p_task_id AND r.attempt=p_attempt AND r.lease_token=p_lease_token) THEN RAISE EXCEPTION 'Current native attempt required' USING ERRCODE='42501'; END IF;
 IF t.status='running' THEN PERFORM public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
 ELSIF t.status<>'completed' THEN RAISE EXCEPTION 'Publication outcome requires reconciliation' USING ERRCODE='42501'; END IF;
 DELETE FROM local_identity.native_output_publications WHERE task_id=p_task_id AND attempt=p_attempt AND lease_token=p_lease_token;
END $$;

-- Explicit receipt recovery may renew only the same held attempt. The caller
-- still validates the frozen directory, inputs, receipt and both file versions.
CREATE FUNCTION local_identity.resume_native_output_publication(p_task_id uuid,p_attempt integer,p_lease_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tasks;
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.tasks WHERE id=p_task_id FOR UPDATE;
 IF t.status='completed' THEN RETURN; END IF;
 IF NOT FOUND OR t.status<>'running' OR t.invalidated_at IS NOT NULL OR t.attempt<>p_attempt+1 OR t.lease_token IS DISTINCT FROM p_lease_token
 OR NOT local_identity.input_task_allowed(t.episode_id,t.task_type)
 OR NOT EXISTS(SELECT 1 FROM local_identity.native_output_publications h WHERE h.task_id=p_task_id AND h.attempt=p_attempt AND h.lease_token=p_lease_token)
 OR NOT EXISTS(SELECT 1 FROM public.task_runs r WHERE r.task_id=p_task_id AND r.attempt=p_attempt AND r.lease_token=p_lease_token AND r.status='running')
 THEN RAISE EXCEPTION 'Held native attempt required' USING ERRCODE='42501'; END IF;
 UPDATE public.tasks SET claimed_at=clock_timestamp() WHERE id=p_task_id;
END $$;

CREATE FUNCTION local_identity.pending_native_output_publications() RETURNS TABLE(task_id uuid,episode_id uuid,attempt integer,lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT h.task_id,t.episode_id,h.attempt,h.lease_token FROM local_identity.native_output_publications h JOIN public.tasks t ON t.id=h.task_id
 WHERE t.status='running' AND t.attempt=h.attempt+1 AND t.lease_token=h.lease_token ORDER BY h.created_at,h.task_id;
END $$;

CREATE FUNCTION local_identity.native_output_recovery_attempt(p_task_id uuid,p_attempt integer) RETURNS TABLE(episode_id uuid,lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT t.episode_id,r.lease_token FROM public.tasks t JOIN public.task_runs r ON r.task_id=t.id AND r.attempt=p_attempt
 WHERE t.id=p_task_id AND t.attempt=p_attempt+1 AND t.invalidated_at IS NULL AND r.lease_token IS NOT NULL
 AND EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=t.episode_id)
 AND (t.status='completed' AND r.status='completed' OR t.status='running' AND r.status='running' AND EXISTS(SELECT 1 FROM local_identity.native_output_publications h WHERE h.task_id=t.id AND h.attempt=p_attempt AND h.lease_token=r.lease_token));
END $$;

CREATE FUNCTION local_identity.prevent_pending_publication_retry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- This trigger runs under the task row lock, including when a failure report
 -- started before the publication fence committed and waited for that lock.
 IF NEW.status IN ('ready','failed','blocked') AND NEW.status IS DISTINCT FROM OLD.status AND EXISTS(SELECT 1 FROM local_identity.native_output_publications WHERE task_id=NEW.id) THEN
  RAISE EXCEPTION 'Native output publication requires explicit reconciliation before retry' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prevent_pending_publication_retry BEFORE UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION local_identity.prevent_pending_publication_retry();

ALTER FUNCTION local_identity.input_worker_call(text,jsonb) RENAME TO input_worker_call_before_publication_fence;
REVOKE ALL ON FUNCTION local_identity.input_worker_call_before_publication_fence(text,jsonb) FROM PUBLIC,loop_app,loop_worker;
CREATE FUNCTION local_identity.input_worker_call(p_name text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501'; END IF;
 IF p_name='report_worker_result' AND p_args#>>'{p_result,status}' IS DISTINCT FROM 'completed'
 AND EXISTS(SELECT 1 FROM local_identity.native_output_publications WHERE task_id=(p_args->>'p_task_id')::uuid) THEN
  RAISE EXCEPTION 'Native output publication outcome is pending' USING ERRCODE='55000';
 END IF;
 RETURN local_identity.input_worker_call_before_publication_fence(p_name,p_args);
END $$;

DO $$DECLARE original text; changed text; BEGIN
 original:=pg_get_functiondef('local_identity.recover_input_tasks()'::regprocedure);
 changed:=replace(original,'and status=''running'' and','and status=''running'' and not exists(select 1 from local_identity.native_output_publications h where h.task_id=tasks.id) and');
 IF changed=original THEN RAISE EXCEPTION 'Expected native lease recovery predicate'; END IF;
 EXECUTE changed;
END $$;

REVOKE ALL ON FUNCTION local_identity.begin_native_output_publication(uuid,integer,uuid),local_identity.finish_native_output_publication(uuid,integer,uuid),local_identity.resume_native_output_publication(uuid,integer,uuid),local_identity.pending_native_output_publications(),local_identity.prevent_pending_publication_retry(),local_identity.input_worker_call(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.begin_native_output_publication(uuid,integer,uuid),local_identity.finish_native_output_publication(uuid,integer,uuid),local_identity.resume_native_output_publication(uuid,integer,uuid),local_identity.pending_native_output_publications(),local_identity.input_worker_call(text,jsonb) TO loop_worker;
REVOKE ALL ON FUNCTION local_identity.native_output_recovery_attempt(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.native_output_recovery_attempt(uuid,integer) TO loop_worker;
