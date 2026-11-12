-- Keep retired planning records untouched by current native claim/recovery.
-- Historical migrations and task snapshots remain unchanged.
CREATE OR REPLACE FUNCTION local_identity.current_worker_task(p_task public.tasks)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce((p_task).provider,'') <> 'codex'
 AND (p_task).task_type NOT IN ('draft_script','prepare_visual_brief','draft_storyboard','draft_storyboard_revision')
 AND coalesce((p_task).input_snapshot->>'capability','') NOT IN ('script_writing','visual_planning','storyboard_planning')
 AND coalesce((p_task).input_snapshot->>'provider','') <> 'codex'
 AND coalesce((p_task).input_snapshot#>>'{executor,provider}','') <> 'codex'
$$;
REVOKE ALL ON FUNCTION local_identity.current_worker_task(public.tasks) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.current_worker_task(public.tasks) TO loop_worker;

DO $$
DECLARE original text; updated text;
BEGIN
 original:=pg_get_functiondef('local_identity.claim_input_task_pre_lease(uuid,integer)'::regprocedure);
 IF strpos(original,'current_worker_task(')=0 THEN
  IF strpos(original,'where local_identity.input_task_allowed(task.episode_id,task.task_type)')=0
   OR strpos(original,'from public.tasks where status=''running''')=0
   OR strpos(original,'where task.status=''running''')=0
   OR strpos(original,'where busy.episode_id=task.episode_id and busy.status=''running''')=0
  THEN RAISE EXCEPTION 'Native claimant changed; inspect retirement fence before applying'; END IF;
  updated:=replace(original,'where local_identity.input_task_allowed(task.episode_id,task.task_type)',
   'where local_identity.current_worker_task(task) and local_identity.input_task_allowed(task.episode_id,task.task_type)');
  updated:=replace(updated,'from public.tasks where status=''running''',
   'from public.tasks where local_identity.current_worker_task(tasks) and status=''running''');
  updated:=replace(updated,'where task.status=''running''',
   'where local_identity.current_worker_task(task) and task.status=''running''');
  updated:=replace(updated,'where busy.episode_id=task.episode_id and busy.status=''running''',
   'where local_identity.current_worker_task(busy) and busy.episode_id=task.episode_id and busy.status=''running''');
  EXECUTE updated;
 END IF;
 original:=pg_get_functiondef('local_identity.recover_input_tasks()'::regprocedure);
 IF strpos(original,'current_worker_task(')=0 THEN
  IF strpos(original,'where local_identity.input_task_allowed(tasks.episode_id,task_type)')=0
  THEN RAISE EXCEPTION 'Native recovery changed; inspect retirement fence before applying'; END IF;
  EXECUTE replace(original,'where local_identity.input_task_allowed(tasks.episode_id,task_type)',
   'where local_identity.current_worker_task(tasks) and local_identity.input_task_allowed(tasks.episode_id,task_type)');
 END IF;
 original:=pg_get_functiondef('public.claim_next_worker_task_legacy(uuid)'::regprocedure);
 IF strpos(original,'current_worker_task(')=0 THEN
  IF strpos(original,'where task.status = ''ready''')=0
  THEN RAISE EXCEPTION 'Legacy claimant changed; inspect retirement fence before applying'; END IF;
  EXECUTE replace(original,'where task.status = ''ready''',
   'where local_identity.current_worker_task(task) and task.status = ''ready''');
 END IF;
END $$;
