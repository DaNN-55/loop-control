create function public.create_series_version(p_series_id uuid, p_rules jsonb)
returns public.series_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_series public.series;
  created_version public.series_versions;
  next_version integer;
begin
  select series.* into selected_series
  from public.series
  join public.account_memberships membership
    on membership.account_id = series.account_id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where series.id = p_series_id
  for update of series;
  if not found then raise exception 'Owner membership is required to create a series version' using errcode = '42501'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then raise exception 'Series rules must be a JSON object' using errcode = '22023'; end if;

  select coalesce(max(version), 0) + 1 into next_version from public.series_versions where series_id = selected_series.id;
  insert into public.series_versions (series_id, account_id, version, rules, created_by)
  values (selected_series.id, selected_series.account_id, next_version, p_rules, auth.uid())
  returning * into created_version;
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (selected_series.account_id, 'series_version_created', jsonb_build_object('series_id', selected_series.id, 'series_version_id', created_version.id, 'version', next_version), auth.uid());
  return created_version;
end;
$$;

revoke execute on function public.create_series_version(uuid, jsonb) from public, anon;
grant execute on function public.create_series_version(uuid, jsonb) to authenticated;
