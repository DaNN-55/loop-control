-- Retire old task repair and automatic dispatch; preserve signatures, ACLs and historical rows.

CREATE OR REPLACE FUNCTION local_identity.plan_input_tasks(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION local_identity.plan_input_tasks_before_workspace_audio(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_episode_configuration_repair(p_episode_id uuid, p_policy jsonb, p_blocker_code text DEFAULT NULL::text, p_blocker_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_episode_configuration_repair_v2(p_episode_id uuid, p_policy jsonb, p_blocker_code text DEFAULT NULL::text, p_blocker_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_external_connection_repair(p_episode_id uuid, p_connection_version_id uuid, p_blocker_code text DEFAULT NULL::text, p_blocker_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_a_roll_tasks_for_episode(p_episode_id uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_a_roll_tasks_for_episode_without_card_adapter(p_episode_id uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_b_roll_tasks(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_b_roll_tasks_configured(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_b_roll_tasks_legacy(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_b_roll_tasks_with_connection_ref(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_b_roll_tasks_without_connection_ref(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_soundtrack_tasks(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_soundtrack_tasks_without_manual_path(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy task repair and automatic dispatch are retired; use an explicit current workspace request' USING ERRCODE='0A000';
END;
$function$;

-- No enabled legacy record may be rediscovered by an older continuation scanner.
-- The records themselves remain intact for history and restore.
CREATE OR REPLACE FUNCTION local_identity.script_production_scopes()
 RETURNS TABLE(episode_id uuid, owner_id uuid, authorization_hash text)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT NULL::uuid, NULL::uuid, NULL::text WHERE false
$function$;
