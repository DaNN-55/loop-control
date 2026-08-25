alter table public.external_connections
  drop constraint external_connections_provider_check,
  drop constraint external_connections_adapter_check;

alter table public.external_connections
  add constraint external_connections_provider_adapter_check check (
    (provider = 'pexels' and adapter = 'pexels_video')
    or (provider = 'google_tts' and adapter = 'google_tts')
  );

update public.account_blueprint_versions blueprint
set policy = blueprint.policy - 'narration'
where jsonb_typeof(blueprint.policy -> 'narration') = 'object'
  and blueprint.is_snapshot = false
  and blueprint.is_active = true
  and blueprint.archived_at is null
  and blueprint.policy #>> '{narration,executor,provider}' = 'google_tts'
  and blueprint.policy #>> '{narration,executor,adapter}' = 'google_tts'
  and blueprint.policy #>> '{narration,credential_ref}' = 'google-tts-default';

create or replace function public.create_external_connection(
  p_provider text,
  p_adapter text,
  p_name text,
  p_secret text
)
returns public.external_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_connection public.external_connections;
  created_connection_id uuid := gen_random_uuid();
  created_version_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Owner login is required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.account_memberships where user_id = auth.uid() and role = 'owner') then
    raise exception 'Owner permission is required' using errcode = '42501';
  end if;
  if not ((p_provider = 'pexels' and p_adapter = 'pexels_video') or (p_provider = 'google_tts' and p_adapter = 'google_tts')) then
    raise exception 'Unsupported external connection provider and adapter' using errcode = '22023';
  end if;
  if char_length(trim(p_name)) not between 1 and 100 or char_length(trim(p_secret)) not between 1 and 4096 then
    raise exception 'Connection name and secret are required' using errcode = '22023';
  end if;

  created_version_id := gen_random_uuid();
  insert into public.external_connections (id, provider, adapter, name, created_by, current_version_id)
  values (created_connection_id, p_provider, p_adapter, trim(p_name), auth.uid(), created_version_id)
  returning * into created_connection;

  insert into public.external_connection_versions (id, connection_id, version, vault_secret_id)
  values (created_version_id, created_connection.id, 1, vault.create_secret(trim(p_secret)));

  return created_connection;
end;
$$;

revoke all on function public.create_external_connection(text, text, text, text) from public, anon;
grant execute on function public.create_external_connection(text, text, text, text) to authenticated;

create or replace function public.validate_blueprint_external_connections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  capability_key text;
  connection_ref text;
  expected_provider text;
  expected_adapter text;
begin
  foreach capability_key in array array['b_roll', 'narration'] loop
    connection_ref := nullif(btrim(new.policy #>> array[capability_key, 'credential_ref']), '');
    if connection_ref is null then
      continue;
    end if;

    if capability_key = 'b_roll' then
      expected_provider := 'pexels';
      expected_adapter := 'pexels_video';
    else
      expected_provider := 'google_tts';
      expected_adapter := 'google_tts';
    end if;

    if connection_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception '% blueprint must reference this Owner’s verified % connection version', capability_key, expected_provider using errcode = '22023';
    elsif not exists (
      select 1
      from public.external_connection_versions version
      join public.external_connections connection on connection.id = version.connection_id
      join public.account_memberships membership
        on membership.account_id = new.account_id
       and membership.user_id = connection.created_by
       and membership.role = 'owner'
      where version.id = connection_ref::uuid
        and connection.current_version_id = version.id
        and connection.created_by = auth.uid()
        and connection.provider = expected_provider
        and connection.adapter = expected_adapter
        and connection.status = 'verified'
    ) then
      raise exception '% blueprint must reference this Owner’s verified % connection version', capability_key, expected_provider using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;
