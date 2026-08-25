create table public.external_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'pexels'),
  adapter text not null check (adapter = 'pexels_video'),
  name text not null check (char_length(trim(name)) between 1 and 100),
  status text not null default 'unverified' check (status in ('unverified', 'verified', 'invalid', 'retryable')),
  last_verification_detail text,
  last_verified_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.external_connection_secrets (
  connection_id uuid primary key references public.external_connections(id) on delete cascade,
  secret text not null check (char_length(secret) between 1 and 4096),
  updated_at timestamptz not null default now()
);

create table public.external_connection_verifications (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.external_connections(id) on delete cascade,
  status text not null check (status in ('verified', 'invalid', 'retryable')),
  detail text not null check (char_length(trim(detail)) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.external_connections enable row level security;
alter table public.external_connection_secrets enable row level security;
alter table public.external_connection_verifications enable row level security;

revoke all on public.external_connection_secrets from public, anon, authenticated;
revoke all on public.external_connections from anon;
revoke all on public.external_connection_verifications from anon;
grant select on public.external_connections to authenticated;
grant select on public.external_connection_verifications to authenticated;

create policy "owners can read their external connections"
on public.external_connections for select to authenticated
using (created_by = auth.uid());

create policy "owners can read their connection verifications"
on public.external_connection_verifications for select to authenticated
using (exists (
  select 1 from public.external_connections connection
  where connection.id = external_connection_verifications.connection_id
    and connection.created_by = auth.uid()
));

create function public.create_external_connection(
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
begin
  if auth.uid() is null then
    raise exception 'Owner login is required' using errcode = '42501';
  end if;
  if p_provider <> 'pexels' or p_adapter <> 'pexels_video' then
    raise exception 'Only the Pexels video connection is supported' using errcode = '22023';
  end if;
  if char_length(trim(p_name)) not between 1 and 100 or char_length(trim(p_secret)) not between 1 and 4096 then
    raise exception 'Connection name and secret are required' using errcode = '22023';
  end if;

  insert into public.external_connections (provider, adapter, name, created_by)
  values (p_provider, p_adapter, trim(p_name), auth.uid())
  returning * into created_connection;
  insert into public.external_connection_secrets (connection_id, secret)
  values (created_connection.id, trim(p_secret));
  return created_connection;
end;
$$;

create function public.resolve_external_connection_secret(p_connection_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select secret
  from public.external_connection_secrets
  where connection_id = p_connection_id;
$$;

create function public.record_external_connection_verification(
  p_connection_id uuid,
  p_status text,
  p_detail text
)
returns public.external_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_connection public.external_connections;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Worker service role is required to record a connection verification' using errcode = '42501';
  end if;
  if p_status not in ('verified', 'invalid', 'retryable') or char_length(trim(p_detail)) not between 1 and 500 then
    raise exception 'Connection verification is invalid' using errcode = '22023';
  end if;

  update public.external_connections
  set status = p_status,
      last_verification_detail = trim(p_detail),
      last_verified_at = now()
  where id = p_connection_id
  returning * into updated_connection;
  if not found then
    raise exception 'External connection does not exist' using errcode = 'P0002';
  end if;
  insert into public.external_connection_verifications (connection_id, status, detail)
  values (p_connection_id, p_status, trim(p_detail));
  return updated_connection;
end;
$$;

revoke all on function public.create_external_connection(text, text, text, text) from public, anon;
revoke all on function public.resolve_external_connection_secret(uuid) from public, anon, authenticated;
revoke all on function public.record_external_connection_verification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_external_connection(text, text, text, text) to authenticated;
grant execute on function public.resolve_external_connection_secret(uuid) to service_role;
grant execute on function public.record_external_connection_verification(uuid, text, text) to service_role;

update public.account_blueprint_versions blueprint
set policy = blueprint.policy - 'b_roll'
where jsonb_typeof(blueprint.policy -> 'b_roll') = 'object'
  and (
    blueprint.policy #>> '{b_roll,executor,provider}' = 'pexels'
    or blueprint.policy #>> '{b_roll,credential_ref}' = 'pexels-default'
  );

update public.series_versions series_version
set rules = series_version.rules - 'b_roll'
where jsonb_typeof(series_version.rules -> 'b_roll') = 'object'
  and series_version.rules #>> '{b_roll,executor,provider}' = 'pexels';

create or replace function public.validate_blueprint_external_connections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_ref text;
begin
  connection_ref := nullif(btrim(new.policy #>> '{b_roll,credential_ref}'), '');
  if connection_ref is not null and (
    connection_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or not exists (
      select 1 from public.external_connections connection
      where connection.id = connection_ref::uuid
        and connection.provider = 'pexels'
        and connection.adapter = 'pexels_video'
        and connection.status = 'verified'
    )
  ) then
    raise exception 'B-roll blueprint must reference a verified Pexels connection' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger validate_blueprint_external_connections_before_write
before insert or update of policy on public.account_blueprint_versions
for each row execute function public.validate_blueprint_external_connections();
