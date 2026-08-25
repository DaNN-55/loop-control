revoke all on function public.orchestrate_b_roll_tasks_legacy(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_b_roll_tasks_legacy(uuid) to service_role;
