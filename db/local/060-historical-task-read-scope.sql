CREATE FUNCTION local_identity.is_historical_task(p_id uuid)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM local_identity.historical_tasks WHERE task_id=p_id)$$;
REVOKE ALL ON FUNCTION local_identity.is_historical_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.is_historical_task(uuid) TO loop_owner;
