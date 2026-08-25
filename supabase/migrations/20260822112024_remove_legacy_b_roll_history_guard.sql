drop trigger if exists guard_legacy_b_roll_blueprint_history on public.account_blueprint_versions;
drop trigger if exists guard_legacy_b_roll_series_history on public.series_versions;
drop function if exists public.guard_legacy_b_roll_version_history();
