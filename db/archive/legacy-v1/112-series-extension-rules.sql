-- Preserve series extension keys while keeping independent immutable versions and Owner checks.
CREATE OR REPLACE FUNCTION public.create_series(p_account_id uuid, p_name text, p_rules jsonb) RETURNS public.series_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  created_series public.series;
  created_version public.series_versions;
begin
  if not exists (select 1 from public.account_memberships where account_id = p_account_id and user_id = local_identity.owner_id() and role = 'owner') then
    raise exception 'Owner membership is required to create a series' using errcode = '42501';
  end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'Series name is required' using errcode = '22023'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    raise exception 'Series rules must be a JSON object' using errcode = '22023';
  end if;
  insert into public.series (account_id, name) values (p_account_id, trim(p_name)) returning * into created_series;
  insert into public.series_versions (series_id, account_id, version, rules, created_by) values (created_series.id, p_account_id, 1, p_rules, local_identity.owner_id()) returning * into created_version;
  insert into public.audit_events (account_id, event_type, payload, actor_id) values (p_account_id, 'series_created', jsonb_build_object('series_id', created_series.id, 'series_version_id', created_version.id, 'version', 1), local_identity.owner_id());
  return created_version;
end;
$$;

CREATE OR REPLACE FUNCTION public.create_series_version(p_series_id uuid, p_rules jsonb) RETURNS public.series_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  selected_series public.series;
  created_version public.series_versions;
  next_version integer;
begin
  select series.* into selected_series from public.series series join public.account_memberships membership on membership.account_id = series.account_id and membership.user_id = local_identity.owner_id() and membership.role = 'owner' where series.id = p_series_id for update;
  if not found then raise exception 'Owner membership is required to create a series version' using errcode = '42501'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    raise exception 'Series rules must be a JSON object' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.series_versions where series_id = selected_series.id;
  insert into public.series_versions (series_id, account_id, version, rules, created_by) values (selected_series.id, selected_series.account_id, next_version, p_rules, local_identity.owner_id()) returning * into created_version;
  insert into public.audit_events (account_id, event_type, payload, actor_id) values (selected_series.account_id, 'series_version_created', jsonb_build_object('series_id', selected_series.id, 'series_version_id', created_version.id, 'version', next_version), local_identity.owner_id());
  return created_version;
end;
$$;
