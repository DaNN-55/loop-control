create table public.external_connection_versions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.external_connections(id) on delete cascade,
  version integer not null check (version > 0),
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  unique (connection_id, version)
);

alter table public.external_connection_versions enable row level security;
revoke all on public.external_connection_versions from public, anon, authenticated;

alter table public.external_connections
  add column current_version_id uuid;

insert into public.external_connection_versions (connection_id, version, vault_secret_id, created_at)
select secret.connection_id, 1, vault.create_secret(secret.secret), secret.updated_at
from public.external_connection_secrets secret;

update public.external_connections connection
set current_version_id = version.id
from public.external_connection_versions version
where version.connection_id = connection.id;

do $$
begin
  if exists (select 1 from public.external_connections where current_version_id is null) then
    raise exception 'Every external connection must have a migrated secret version';
  end if;
end;
$$;

alter table public.external_connections
  alter column current_version_id set not null,
  add constraint external_connections_current_version_id_fkey
    foreign key (current_version_id) references public.external_connection_versions(id) on delete restrict deferrable initially deferred;

alter table public.external_connection_verifications
  add column connection_version_id uuid;

update public.external_connection_verifications verification
set connection_version_id = connection.current_version_id
from public.external_connections connection
where connection.id = verification.connection_id;

alter table public.external_connection_verifications
  alter column connection_version_id set not null,
  add constraint external_connection_verifications_connection_version_id_fkey
    foreign key (connection_version_id) references public.external_connection_versions(id) on delete restrict;

drop table public.external_connection_secrets;

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
  if p_provider <> 'pexels' or p_adapter <> 'pexels_video' then
    raise exception 'Only the Pexels video connection is supported' using errcode = '22023';
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

create or replace function public.resolve_external_connection_secret(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_secret text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Worker service role is required to resolve a connection secret' using errcode = '42501';
  end if;

  select secret.decrypted_secret into resolved_secret
  from public.external_connection_versions version
  join vault.decrypted_secrets secret on secret.id = version.vault_secret_id
  where version.id = p_connection_id;
  return resolved_secret;
end;
$$;

create or replace function public.record_external_connection_verification(
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
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Worker service role is required to record a connection verification' using errcode = '42501';
  end if;
  if p_status not in ('verified', 'invalid', 'retryable') or char_length(trim(p_detail)) not between 1 and 500 then
    raise exception 'Connection verification is invalid' using errcode = '22023';
  end if;

  update public.external_connections connection
  set status = p_status,
      last_verification_detail = trim(p_detail),
      last_verified_at = now()
  from public.external_connection_versions version
  where version.id = p_connection_id
    and connection.id = version.connection_id
    and connection.current_version_id = version.id
  returning connection.* into updated_connection;
  if not found then
    raise exception 'Current external connection version does not exist' using errcode = 'P0002';
  end if;

  insert into public.external_connection_verifications (connection_id, connection_version_id, status, detail)
  values (updated_connection.id, p_connection_id, p_status, trim(p_detail));
  return updated_connection;
end;
$$;

revoke all on function public.create_external_connection(text, text, text, text) from public, anon;
revoke all on function public.resolve_external_connection_secret(uuid) from public, anon, authenticated;
revoke all on function public.record_external_connection_verification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_external_connection(text, text, text, text) to authenticated;
grant execute on function public.resolve_external_connection_secret(uuid) to service_role;
grant execute on function public.record_external_connection_verification(uuid, text, text) to service_role;

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
        and connection.provider = 'pexels'
        and connection.adapter = 'pexels_video'
        and connection.status = 'verified'
    )
  ) then
    raise exception 'B-roll blueprint must reference this Owner’s verified Pexels connection version' using errcode = '22023';
  end if;
  return new;
end;
$$;
