-- ADR-0048 / item 1: reject retired planning writes; retain historical data.
CREATE OR REPLACE FUNCTION local_identity.queue_workspace_planning(p_episode uuid, p_script uuid, p_retry uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy planning is retired; use the current production workspace' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION local_identity.replan_workspace_planning(p_episode uuid, p_script uuid, p_previous uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy planning is retired; use the current production workspace' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION local_identity.save_planning_selection(p_episode uuid, p_selection jsonb, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy planning is retired; use the current production workspace' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_storyboard_tasks()
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN

 RAISE EXCEPTION 'Legacy planning is retired; use the current production workspace' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_storyboard_tasks_for_episode(p_episode_id uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN

 RAISE EXCEPTION 'Legacy planning is retired; use the current production workspace' USING ERRCODE='0A000';
END;
$function$;

DROP TRIGGER initialize_planning_selection ON public.episodes;
DROP TRIGGER freeze_shared_planning_harness_before_insert ON public.tasks;
DROP TRIGGER zy_freeze_native_planning_attempt_limit ON public.tasks;
DROP FUNCTION local_identity.initialize_planning_selection();
DROP FUNCTION local_identity.legacy_planning_prefill(p_policy jsonb);
DROP FUNCTION local_identity.freeze_native_planning_attempt_limit();
DROP FUNCTION public.freeze_shared_planning_harness();
