-- ADR-0048 / item 5: retire only disconnected legacy bulk-media entrypoints.
CREATE OR REPLACE FUNCTION public.orchestrate_a_roll_tasks_without_manual_path()
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RAISE EXCEPTION 'Legacy automatic media planning is retired; submit an explicit production request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_a_roll_tasks_without_card_adapter()
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RAISE EXCEPTION 'Legacy automatic media planning is retired; submit an explicit production request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_a_roll_tasks()
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RAISE EXCEPTION 'Legacy automatic media planning is retired; submit an explicit production request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_b_roll_tasks_all()
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RAISE EXCEPTION 'Legacy automatic media planning is retired; submit an explicit production request' USING ERRCODE='0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orchestrate_b_roll_tasks_legacy_all()
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 RAISE EXCEPTION 'Legacy automatic media planning is retired; submit an explicit production request' USING ERRCODE='0A000';
END;
$function$;
