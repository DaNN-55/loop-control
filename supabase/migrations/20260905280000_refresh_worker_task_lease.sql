create or replace function public.refresh_worker_task_lease(p_task_id uuid, p_attempt integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks
  set claimed_at = now()
  where id = p_task_id
    and status = 'running'
    and attempt = p_attempt + 1;
  return found;
end;
$$;

revoke all on function public.refresh_worker_task_lease(uuid, integer) from public, anon, authenticated;
grant execute on function public.refresh_worker_task_lease(uuid, integer) to service_role;
