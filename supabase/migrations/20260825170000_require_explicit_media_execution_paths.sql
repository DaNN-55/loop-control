-- Forward-correct the B-roll and soundtrack wrappers from 20260825150000.
-- Missing execution paths must not fall through to an external dispatch.

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef(to_regprocedure('public.orchestrate_b_roll_tasks(uuid)')) into definition;
  if definition is null or position('coalesce(blueprint.policy #>> ''{b_roll,execution_path}'', ''external'')' in definition) = 0 then
    raise exception 'Unable to require an explicit B-roll execution path';
  end if;
  execute replace(definition, 'coalesce(blueprint.policy #>> ''{b_roll,execution_path}'', ''external'')', 'blueprint.policy #>> ''{b_roll,execution_path}'' in (''external'', ''local'')');

  select pg_get_functiondef(to_regprocedure('public.orchestrate_soundtrack_tasks(uuid)')) into definition;
  if definition is null or position('coalesce(blueprint.policy #>> ''{soundtrack,execution_path}'', ''external'')' in definition) = 0 then
    raise exception 'Unable to require an explicit soundtrack execution path';
  end if;
  execute replace(definition, 'coalesce(blueprint.policy #>> ''{soundtrack,execution_path}'', ''external'')', 'blueprint.policy #>> ''{soundtrack,execution_path}'' in (''external'', ''local'')');
end;
$migration$;

revoke all on function public.orchestrate_b_roll_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_b_roll_tasks(uuid) to service_role;
revoke all on function public.orchestrate_soundtrack_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_soundtrack_tasks(uuid) to service_role;
