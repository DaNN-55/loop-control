-- ADR-0048: retire old narration execution without deleting historical records or audio.
CREATE OR REPLACE FUNCTION local_identity.generate_input_shot_tts(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_retry boolean DEFAULT false)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy narration generation is retired; use an explicit workspace production selection' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_shot_tts(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_retry boolean DEFAULT false)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy narration generation is retired; use an explicit workspace production selection' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_confirmed_shot_tts_batch(p_episode_id uuid, p_review_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Legacy narration generation is retired; use an explicit workspace production selection' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_narration_tasks(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RAISE EXCEPTION 'Legacy narration generation is retired; use an explicit workspace production selection' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_narration_tasks_all()
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RAISE EXCEPTION 'Legacy narration generation is retired; use an explicit workspace production selection' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_narration_tasks_configured(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RAISE EXCEPTION 'Legacy narration generation is retired; use an explicit workspace production selection' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_narration_tasks_without_connection_ref(p_episode_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RAISE EXCEPTION 'Legacy narration generation is retired; use an explicit workspace production selection' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION local_identity.reserve_workspace_narration_submission_legacy(p_task_id uuid, p_attempt integer, p_lease_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 RAISE EXCEPTION 'Legacy narration generation is retired; use an explicit workspace production selection' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION local_identity.current_worker_task(p_task public.tasks)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce((p_task).provider,'') <> 'codex'
 AND (p_task).task_type NOT IN ('draft_script','prepare_visual_brief','draft_storyboard','draft_storyboard_revision')
 AND coalesce((p_task).input_snapshot->>'capability','') NOT IN ('script_writing','visual_planning','storyboard_planning')
 AND coalesce((p_task).input_snapshot->>'provider','') <> 'codex'
 AND coalesce((p_task).input_snapshot#>>'{executor,provider}','') <> 'codex'
 AND ((p_task).task_type <> 'generate_narration' OR (coalesce((p_task).prompt_version,'')='production-request-v1' AND coalesce((p_task).input_snapshot->>'selectionVersion','')='1'))
$function$;
