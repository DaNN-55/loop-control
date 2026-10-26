-- Existing Worker claims return a zero-based attempt and increment tasks.attempt
-- before execution. Match the same attempt convention as report_worker_result.
do $$
declare sig text; definition text; changed text;
begin
 foreach sig in array array['public.reserve_paid_generation(uuid,integer)','public.record_wan_submission(uuid,integer,text)','public.register_wan_material(uuid,integer,text,text,bigint)'] loop
  definition:=pg_get_functiondef(sig::regprocedure);
  changed:=replace(definition,'attempt=p_attempt','attempt=p_attempt+1');
  if changed=definition then raise exception 'Wan attempt guard changed upstream: %',sig; end if;
  execute changed;
 end loop;
end $$;
