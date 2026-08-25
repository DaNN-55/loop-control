create table public.external_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'openai'),
  adapter text not null check (adapter = 'openai_images'),
  name text not null check (char_length(trim(name)) between 1 and 100),
  status text not null default 'unverified' check (status in ('unverified', 'verified', 'invalid', 'retryable')),
  current_version_id uuid,
  last_verification_detail text,
  last_verified_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.external_connection_versions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.external_connections(id) on delete cascade,
  version integer not null check (version > 0),
  provider text not null check (provider = 'openai'),
  adapter text not null check (adapter = 'openai_images'),
  endpoint text not null default 'https://api.openai.com/v1/images/generations',
  status text not null default 'unverified' check (status in ('unverified', 'verified', 'invalid', 'retryable', 'revoked')),
  vault_secret_id uuid not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (connection_id, version)
);

alter table public.external_connections
  add constraint external_connections_current_version_fk
  foreign key (current_version_id) references public.external_connection_versions(id);

alter table public.external_connections enable row level security;
alter table public.external_connection_versions enable row level security;

create policy "owners can read their OpenAI connections"
on public.external_connections for select to authenticated
using (created_by = auth.uid());

create policy "owners can read their OpenAI connection versions"
on public.external_connection_versions for select to authenticated
using (exists (
  select 1 from public.external_connections connection
  where connection.id = external_connection_versions.connection_id
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
  created_version_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or not exists (
    select 1 from public.account_memberships membership
    where membership.user_id = auth.uid() and membership.role = 'owner'
  ) then
    raise exception 'Owner membership is required' using errcode = '42501';
  end if;
  if p_provider <> 'openai' or p_adapter <> 'openai_images' then
    raise exception 'Only the registered OpenAI Images connection is supported' using errcode = '22023';
  end if;
  if char_length(trim(p_name)) not between 1 and 100 or char_length(trim(p_secret)) not between 1 and 4096 then
    raise exception 'Connection name and secret are required' using errcode = '22023';
  end if;

  insert into public.external_connections (provider, adapter, name, created_by)
  values (p_provider, p_adapter, trim(p_name), auth.uid())
  returning * into created_connection;
  insert into public.external_connection_versions (id, connection_id, version, provider, adapter, vault_secret_id)
  values (created_version_id, created_connection.id, 1, p_provider, p_adapter, vault.create_secret(trim(p_secret)));
  update public.external_connections
  set current_version_id = created_version_id
  where id = created_connection.id
  returning * into created_connection;
  return created_connection;
end;
$$;

create function public.resolve_external_connection_secret(p_connection_id uuid, p_account_id uuid)
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
  join public.external_connections connection on connection.id = version.connection_id
  join public.account_memberships membership on membership.user_id = connection.created_by and membership.account_id = p_account_id and membership.role = 'owner'
  join vault.decrypted_secrets secret on secret.id = version.vault_secret_id
  where version.id = p_connection_id
    and connection.current_version_id = version.id;
  return resolved_secret;
end;
$$;

revoke all on function public.create_external_connection(text, text, text, text) from public, anon;
grant execute on function public.create_external_connection(text, text, text, text) to authenticated;

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
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Worker service role is required to record a connection verification' using errcode = '42501';
  end if;
  if p_status not in ('verified', 'invalid', 'retryable') or char_length(trim(p_detail)) not between 1 and 500 then
    raise exception 'Connection verification is invalid' using errcode = '22023';
  end if;
  update public.external_connection_versions
  set status = p_status
  where id = p_connection_id;
  update public.external_connections connection
  set status = p_status,
      last_verification_detail = trim(p_detail),
      last_verified_at = now()
  where connection.current_version_id = p_connection_id
  returning * into updated_connection;
  if not found then raise exception 'External connection version does not exist' using errcode = 'P0002'; end if;
  return updated_connection;
end;
$$;

create or replace function public.validate_openai_images_blueprint_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_ref text := nullif(btrim(new.policy #>> '{static_visual,credential_ref}'), '');
  model_name text := nullif(btrim(new.policy #>> '{static_visual,executor,model}'), '');
begin
  if new.is_snapshot then return new; end if;
  if model_name is not null and model_name <> 'gpt-image-1' then
    raise exception 'Static visual model must come from the OpenAI Images Adapter catalog' using errcode = '22023';
  end if;
  if connection_ref is null then return new; end if;
  if connection_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or not exists (
      select 1
      from public.external_connection_versions version
      join public.external_connections connection on connection.id = version.connection_id
      where version.id = connection_ref::uuid
        and connection.current_version_id = version.id
        and connection.created_by = auth.uid()
        and connection.provider = 'openai'
        and connection.adapter = 'openai_images'
        and connection.status = 'verified'
    ) then
    raise exception 'Static visual blueprint must reference this Owner''s verified OpenAI Images connection version' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_openai_images_blueprint_connection_before_write on public.account_blueprint_versions;
create trigger validate_openai_images_blueprint_connection_before_write
before insert or update of policy on public.account_blueprint_versions
for each row execute function public.validate_openai_images_blueprint_connection();

create or replace function public.freeze_openai_image_generation_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  blueprint_policy jsonb;
  image_generation jsonb;
begin
  if new.task_type <> 'prepare_visual_brief' then return new; end if;
  select policy into blueprint_policy
  from public.account_blueprint_versions blueprint
  where blueprint.id = (select blueprint_version_id from public.episodes where id = new.episode_id);
  image_generation := new.input_snapshot #> '{visual_assets,image_generation}';
  if image_generation is null then return new; end if;
  new.input_snapshot := jsonb_set(
    new.input_snapshot,
    '{visual_assets,image_generation}',
    jsonb_build_object(
      'provider', 'openai',
      'adapter', 'openai_images',
      'model', blueprint_policy #>> '{static_visual,executor,model}',
      'credential_ref', blueprint_policy #>> '{static_visual,credential_ref}'
    )
  );
  return new;
end;
$$;

drop trigger if exists freeze_openai_image_generation_config_before_insert on public.tasks;
create trigger freeze_openai_image_generation_config_before_insert
before insert on public.tasks
for each row execute function public.freeze_openai_image_generation_config();

revoke all on table public.external_connection_versions from public, anon, authenticated;
grant select on table public.external_connections to authenticated;
revoke all on function public.resolve_external_connection_secret(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_external_connection_secret(uuid, uuid) to service_role;
revoke all on function public.record_external_connection_verification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_external_connection_verification(uuid, text, text) to service_role;
revoke all on function public.validate_openai_images_blueprint_connection() from public, anon, authenticated;
revoke all on function public.freeze_openai_image_generation_config() from public, anon, authenticated;
