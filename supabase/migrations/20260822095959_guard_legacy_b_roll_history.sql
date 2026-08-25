create function public.guard_legacy_b_roll_version_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  return old;
end;
$$;

create trigger guard_legacy_b_roll_blueprint_history
before update of policy on public.account_blueprint_versions
for each row execute function public.guard_legacy_b_roll_version_history();

create trigger guard_legacy_b_roll_series_history
before update of rules on public.series_versions
for each row execute function public.guard_legacy_b_roll_version_history();
