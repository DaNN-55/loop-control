-- Exhausted single-attempt jobs are recorded as blocked by report_worker_result.
-- They can safely resume GET/download only when a supplier ID is already saved.
do $$
declare definition text; changed text;
begin
 definition:=pg_get_functiondef('public.resume_wan_video_task(uuid)'::regprocedure);
 changed:=replace(definition,'t.status<>''failed''','t.status not in (''failed'',''blocked'')');
 if changed=definition then raise exception 'Wan resume status guard changed upstream'; end if;
 execute changed;
end $$;
