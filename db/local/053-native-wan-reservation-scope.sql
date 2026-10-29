-- Keep 052 immutable. The reservation's row variable t must not shadow its
-- managed-task guard alias under PL/pgSQL's strict ambiguity checks.
DO $$ DECLARE original text; changed text; BEGIN
 original:=pg_get_functiondef('local_identity.reserve_wan_generation(uuid,integer,uuid)'::regprocedure);
 changed:=replace(original,'select 1 from public.tasks t where t.id=p_task_id and t.provider=''bailian'' and local_identity.input_task_allowed(t.episode_id,t.task_type)','select 1 from public.tasks managed where managed.id=p_task_id and managed.provider=''bailian'' and local_identity.input_task_allowed(managed.episode_id,managed.task_type)');
 IF changed=original THEN RAISE EXCEPTION 'Wan reservation scope changed'; END IF;
 EXECUTE changed;
END $$;
