-- Costs remain recorded on task runs, but no task result is rejected for exceeding
-- a user-configured production budget.
create or replace function public.report_worker_result(p_task_id uuid, p_attempt integer, p_result jsonb)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks
  set budget_limit_cents = 2147483647
  where id = p_task_id
    and status = 'running';

  return public.report_worker_result_base(p_task_id, p_attempt, p_result);
end;
$$;

revoke all on function public.report_worker_result(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.report_worker_result(uuid, integer, jsonb) to service_role;
