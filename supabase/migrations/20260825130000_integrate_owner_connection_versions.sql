-- One forward migration for the four registered Owner-managed providers.
-- Secrets stay in Vault; JSON task/blueprint snapshots carry only version IDs.

alter table public.external_connections
  add column if not exists description text not null default '',
  add column if not exists endpoint text not null default 'https://api.pexels.com';

alter table public.external_connections
  drop constraint if exists external_connections_provider_check,
  drop constraint if exists external_connections_adapter_check,
  drop constraint if exists external_connections_provider_adapter_check;

alter table public.external_connection_versions
  add column if not exists provider text,
  add column if not exists adapter text,
  add column if not exists endpoint text,
  add column if not exists revoked_at timestamptz;

create or replace function public.official_external_connection_endpoint(p_provider text, p_adapter text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_provider = 'pexels' and p_adapter = 'pexels_video' then 'https://api.pexels.com'
    when p_provider = 'freesound' and p_adapter = 'freesound_preview' then 'https://freesound.org/apiv2'
    when p_provider = 'openai' and p_adapter = 'openai_images' then 'https://api.openai.com/v1'
    when p_provider = 'google_tts' and p_adapter = 'google_tts' then 'https://texttospeech.googleapis.com/v1'
    else null
  end;
$$;

update public.external_connection_versions version
set provider = connection.provider,
    adapter = connection.adapter,
    endpoint = public.official_external_connection_endpoint(connection.provider, connection.adapter)
from public.external_connections connection
where connection.id = version.connection_id;

update public.external_connections
set endpoint = public.official_external_connection_endpoint(provider, adapter);

alter table public.external_connections
  add constraint external_connections_provider_adapter_check check (
    (provider, adapter) in (
      ('pexels', 'pexels_video'),
      ('freesound', 'freesound_preview'),
      ('openai', 'openai_images'),
      ('google_tts', 'google_tts')
    )
  );

alter table public.external_connection_versions
  alter column provider set not null,
  alter column adapter set not null,
  alter column endpoint set not null;

-- Historical migrations used environment-style placeholders. Keep those blueprints
-- editable but make the missing Owner connection explicit instead of pretending
-- that a default provider secret exists.
update public.account_blueprint_versions
set policy = case
  when policy #>> '{b_roll,credential_ref}' in ('pexels-default', 'pexels') then jsonb_set(policy, '{b_roll}', (policy -> 'b_roll') - 'credential_ref')
  when policy #>> '{narration,credential_ref}' = 'google-tts-default' then jsonb_set(policy, '{narration}', (policy -> 'narration') - 'credential_ref')
  when policy #>> '{soundtrack,credential_ref}' = 'freesound-default' then jsonb_set(policy, '{soundtrack}', (policy -> 'soundtrack') - 'credential_ref')
  else policy
end
where policy #>> '{b_roll,credential_ref}' in ('pexels-default', 'pexels')
   or policy #>> '{narration,credential_ref}' = 'google-tts-default'
   or policy #>> '{soundtrack,credential_ref}' = 'freesound-default';

update public.tasks
set input_snapshot = input_snapshot - 'credential_ref'
where input_snapshot ->> 'credential_ref' is not null
  and input_snapshot ->> 'credential_ref' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

update public.account_blueprint_versions
set policy = jsonb_set(policy, '{static_visual}', (policy -> 'static_visual') - 'credential_ref', true)
where policy #>> '{static_visual,credential_ref}' is not null
  and policy #>> '{static_visual,credential_ref}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

update public.tasks
set input_snapshot = jsonb_set(input_snapshot, '{visual_assets,image_generation}', (input_snapshot #> '{visual_assets,image_generation}') - 'credential_ref', true)
where input_snapshot #>> '{visual_assets,image_generation,credential_ref}' is not null
  and input_snapshot #>> '{visual_assets,image_generation,credential_ref}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

create or replace function public.connection_version_is_verified(p_version_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.external_connection_versions version
    join public.external_connections connection on connection.id = version.connection_id
    where version.id = p_version_id
      and version.revoked_at is null
      and connection.current_version_id = version.id
      and (select verification.status
           from public.external_connection_verifications verification
           where verification.connection_version_id = version.id
           order by verification.created_at desc, verification.id desc
           limit 1) = 'verified'
  );
$$;

create or replace function public.create_external_connection(
  p_provider text, p_adapter text, p_name text, p_secret text
)
returns public.external_connections
language plpgsql security definer set search_path = ''
as $$
declare
  created_connection public.external_connections;
  connection_id uuid := gen_random_uuid();
  version_id uuid := gen_random_uuid();
  endpoint text := public.official_external_connection_endpoint(trim(p_provider), trim(p_adapter));
begin
  if auth.uid() is null then raise exception 'Owner login is required' using errcode = '42501'; end if;
  if endpoint is null then raise exception 'Only registered external connections are supported' using errcode = '22023'; end if;
  if not exists (select 1 from public.account_memberships where user_id = auth.uid() and role = 'owner') then raise exception 'Owner membership is required' using errcode = '42501'; end if;
  if char_length(trim(p_name)) not between 1 and 100 or char_length(trim(p_secret)) not between 1 and 4096 then raise exception 'Connection name and secret are required' using errcode = '22023'; end if;

  insert into public.external_connections (id, provider, adapter, name, created_by, current_version_id, endpoint)
  values (connection_id, trim(p_provider), trim(p_adapter), trim(p_name), auth.uid(), version_id, endpoint)
  returning * into created_connection;
  insert into public.external_connection_versions (id, connection_id, version, provider, adapter, endpoint, vault_secret_id)
  values (version_id, connection_id, 1, trim(p_provider), trim(p_adapter), endpoint, vault.create_secret(trim(p_secret)));
  return created_connection;
end;
$$;

create or replace function public.resolve_external_connection_secret(p_connection_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare resolved_secret text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Worker service role is required to resolve a connection secret' using errcode = '42501'; end if;
  select secret.decrypted_secret into resolved_secret
  from public.external_connection_versions version
  join vault.decrypted_secrets secret on secret.id = version.vault_secret_id
  where version.id = p_connection_id and version.revoked_at is null;
  return resolved_secret;
end;
$$;

create or replace function public.resolve_external_connection_secret(p_connection_id uuid, p_account_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare resolved_secret text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Worker service role is required to resolve a connection secret' using errcode = '42501'; end if;
  select secret.decrypted_secret into resolved_secret
  from public.external_connection_versions version
  join public.external_connections connection on connection.id = version.connection_id
  join vault.decrypted_secrets secret on secret.id = version.vault_secret_id
  where version.id = p_connection_id and version.revoked_at is null
    and connection.current_version_id = version.id
    and public.connection_version_is_verified(version.id)
    and exists (select 1 from public.account_memberships membership where membership.account_id = p_account_id and membership.user_id = connection.created_by and membership.role = 'owner');
  if resolved_secret is null then raise exception 'External connection is not owned by the task account' using errcode = '42501'; end if;
  return resolved_secret;
end;
$$;

create or replace function public.record_external_connection_verification(p_connection_id uuid, p_status text, p_detail text)
returns public.external_connections
language plpgsql security definer set search_path = ''
as $$
declare updated_connection public.external_connections; version_id uuid;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Worker service role is required to record a connection verification' using errcode = '42501'; end if;
  if p_status not in ('verified', 'invalid', 'retryable') or char_length(trim(p_detail)) not between 1 and 500 then raise exception 'Connection verification is invalid' using errcode = '22023'; end if;
  select version.id into version_id from public.external_connection_versions version where version.id = p_connection_id and version.revoked_at is null;
  if version_id is null then raise exception 'External connection version does not exist' using errcode = 'P0002'; end if;
  update public.external_connections connection
  set status = p_status, last_verification_detail = trim(p_detail), last_verified_at = now()
  from public.external_connection_versions version
  where version.id = p_connection_id and connection.id = version.connection_id and connection.current_version_id = version.id
  returning connection.* into updated_connection;
  if not found then raise exception 'Current external connection version does not exist' using errcode = 'P0002'; end if;
  insert into public.external_connection_verifications (connection_id, connection_version_id, status, detail)
  values (updated_connection.id, p_connection_id, p_status, trim(p_detail));
  return updated_connection;
end;
$$;

create or replace function public.update_external_connection(p_connection_id uuid, p_name text, p_description text)
returns public.external_connections
language plpgsql security definer set search_path = ''
as $$
declare updated_connection public.external_connections;
begin
  if auth.uid() is null then raise exception 'Owner login is required' using errcode = '42501'; end if;
  if char_length(trim(p_name)) not between 1 and 100 or char_length(coalesce(p_description, '')) > 500 then raise exception 'Connection name or description is invalid' using errcode = '22023'; end if;
  update public.external_connections set name = trim(p_name), description = trim(coalesce(p_description, '')) where id = p_connection_id and created_by = auth.uid() returning * into updated_connection;
  if not found then raise exception 'External connection does not exist' using errcode = 'P0002'; end if;
  return updated_connection;
end;
$$;

create or replace function public.rotate_external_connection(p_connection_id uuid, p_provider text, p_adapter text, p_secret text)
returns public.external_connections
language plpgsql security definer set search_path = ''
as $$
declare connection public.external_connections; next_version integer; next_id uuid := gen_random_uuid(); official_endpoint text := public.official_external_connection_endpoint(trim(p_provider), trim(p_adapter));
begin
  select candidate.* into connection from public.external_connections candidate where candidate.id = p_connection_id and candidate.created_by = auth.uid() for update;
  if not found then raise exception 'External connection does not exist' using errcode = 'P0002'; end if;
  if official_endpoint is null or char_length(trim(p_secret)) not between 1 and 4096 then raise exception 'Registered provider, adapter, and secret are required' using errcode = '22023'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.external_connection_versions where connection_id = p_connection_id;
  insert into public.external_connection_versions (id, connection_id, version, provider, adapter, endpoint, vault_secret_id)
  values (next_id, p_connection_id, next_version, trim(p_provider), trim(p_adapter), official_endpoint, vault.create_secret(trim(p_secret)));
  update public.external_connections set provider = trim(p_provider), adapter = trim(p_adapter), endpoint = official_endpoint, current_version_id = next_id, status = 'unverified', last_verification_detail = null, last_verified_at = null where id = p_connection_id returning * into connection;
  return connection;
end;
$$;

create or replace function public.list_external_connection_versions(p_connection_id uuid default null)
returns table (id uuid, connection_id uuid, version integer, provider text, adapter text, endpoint text, created_at timestamptz, revoked_at timestamptz, is_current boolean, status text)
language sql security definer set search_path = ''
as $$
  select version.id, version.connection_id, version.version, version.provider, version.adapter, version.endpoint, version.created_at, version.revoked_at, connection.current_version_id = version.id,
    case when version.revoked_at is not null then 'revoked' else coalesce((select verification.status from public.external_connection_verifications verification where verification.connection_version_id = version.id order by verification.created_at desc, verification.id desc limit 1), 'unverified') end
  from public.external_connection_versions version join public.external_connections connection on connection.id = version.connection_id
  where connection.created_by = auth.uid() and (p_connection_id is null or version.connection_id = p_connection_id)
  order by version.connection_id, version.version desc;
$$;

create or replace function public.revoke_external_connection_version(p_version_id uuid)
returns public.external_connection_versions
language plpgsql security definer set search_path = ''
as $$
declare selected_version public.external_connection_versions;
begin
  select version.* into selected_version from public.external_connection_versions version join public.external_connections connection on connection.id = version.connection_id where version.id = p_version_id and connection.created_by = auth.uid() for update of version;
  if not found then raise exception 'External connection version does not exist' using errcode = 'P0002'; end if;
  update public.external_connection_versions set revoked_at = coalesce(revoked_at, now()) where id = p_version_id returning * into selected_version;
  if selected_version.id = (select current_version_id from public.external_connections where id = selected_version.connection_id) then update public.external_connections set status = 'invalid', last_verification_detail = '当前连接版本已被 Owner 撤销。', last_verified_at = now() where id = selected_version.connection_id; end if;
  return selected_version;
end;
$$;

create or replace function public.delete_external_connection_version(p_version_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare selected_version public.external_connection_versions;
begin
  select version.* into selected_version from public.external_connection_versions version join public.external_connections connection on connection.id = version.connection_id where version.id = p_version_id and connection.created_by = auth.uid() for update of version;
  if not found then raise exception 'External connection version does not exist' using errcode = 'P0002'; end if;
  if selected_version.id = (select current_version_id from public.external_connections where id = selected_version.connection_id) then raise exception 'Current external connection version cannot be deleted' using errcode = '22023'; end if;
  if selected_version.revoked_at is not null or exists (select 1 from public.external_connection_verifications where connection_version_id = selected_version.id) then raise exception 'Only an unverified draft connection version can be deleted' using errcode = '22023'; end if;
  if exists (select 1 from public.account_blueprint_versions blueprint where blueprint.policy @> jsonb_build_object('credential_ref', selected_version.id::text) or blueprint.policy @> jsonb_build_object('b_roll', jsonb_build_object('credential_ref', selected_version.id::text)) or blueprint.policy @> jsonb_build_object('narration', jsonb_build_object('credential_ref', selected_version.id::text)) or blueprint.policy @> jsonb_build_object('soundtrack', jsonb_build_object('credential_ref', selected_version.id::text)) or blueprint.policy @> jsonb_build_object('static_visual', jsonb_build_object('credential_ref', selected_version.id::text))) or exists (select 1 from public.tasks task where task.input_snapshot::text like '%' || selected_version.id::text || '%') then raise exception 'Referenced external connection version cannot be deleted' using errcode = '22023'; end if;
  perform vault.delete_secret(selected_version.vault_secret_id);
  delete from public.external_connection_versions where id = selected_version.id;
end;
$$;

create or replace function public.validate_blueprint_external_connections()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare capability_key text; connection_ref text; expected_provider text; expected_adapter text;
begin
  foreach capability_key in array array['b_roll', 'soundtrack', 'narration', 'static_visual'] loop
    connection_ref := nullif(btrim(new.policy #>> array[capability_key, 'credential_ref']), '');
    if connection_ref is null then continue; end if;
    expected_provider := case capability_key when 'b_roll' then 'pexels' when 'soundtrack' then 'freesound' when 'narration' then 'google_tts' else 'openai' end;
    expected_adapter := case capability_key when 'b_roll' then 'pexels_video' when 'soundtrack' then 'freesound_preview' when 'narration' then 'google_tts' else 'openai_images' end;
    if connection_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (
      select 1 from public.external_connection_versions version join public.external_connections connection on connection.id = version.connection_id
      join public.account_memberships membership on membership.account_id = new.account_id and membership.user_id = connection.created_by and membership.role = 'owner'
      where version.id = connection_ref::uuid and connection.created_by = auth.uid() and connection.current_version_id = version.id and version.revoked_at is null and version.provider = expected_provider and version.adapter = expected_adapter and public.connection_version_is_verified(version.id)
    ) then raise exception '% blueprint must reference this Owner’s current verified % connection version', capability_key, expected_provider using errcode = '22023'; end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists validate_blueprint_external_connections_before_write on public.account_blueprint_versions;
create trigger validate_blueprint_external_connections_before_write before insert or update of policy on public.account_blueprint_versions for each row execute function public.validate_blueprint_external_connections();

create or replace function public.freeze_owner_connection_version()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare policy jsonb; config_key text; ref text; image jsonb;
begin
  if new.provider = 'manual_upload' then return new; end if;
  select blueprint.policy into policy from public.episodes episode join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = new.episode_id;
  config_key := case new.task_type when 'generate_b_roll' then 'b_roll' when 'generate_narration' then 'narration' when 'generate_soundtrack' then 'soundtrack' else null end;
  if config_key is not null then
    ref := nullif(btrim(policy #>> array[config_key, 'credential_ref']), '');
    if ref is not null and new.input_snapshot ->> 'credential_ref' is null then new.input_snapshot := jsonb_set(coalesce(new.input_snapshot, '{}'::jsonb), '{credential_ref}', to_jsonb(ref), true); end if;
  elsif new.task_type = 'prepare_visual_brief' then
    image := new.input_snapshot #> '{visual_assets,image_generation}';
    ref := nullif(btrim(policy #>> '{static_visual,credential_ref}'), '');
    if jsonb_typeof(image) = 'object' and ref is not null and image ->> 'credential_ref' is null then new.input_snapshot := jsonb_set(new.input_snapshot, '{visual_assets,image_generation,credential_ref}', to_jsonb(ref), true); end if;
  end if;
  return new;
end;
$$;

drop trigger if exists freeze_owner_connection_version_before_insert on public.tasks;
create trigger freeze_owner_connection_version_before_insert before insert on public.tasks for each row execute function public.freeze_owner_connection_version();

create or replace function public.normalize_manual_media_task(p_episode_id uuid, p_input_snapshot jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare snapshot jsonb := coalesce(p_input_snapshot, '{}'::jsonb); capability text := snapshot ->> 'capability'; task_type text; target text;
begin
  if capability not in ('a_roll_manual_upload', 'b_roll_manual_upload', 'narration_manual_upload', 'soundtrack_manual_upload') then return snapshot; end if;
  task_type := case capability when 'a_roll_manual_upload' then 'generate_a_roll' when 'b_roll_manual_upload' then 'generate_b_roll' when 'narration_manual_upload' then 'generate_narration' else 'generate_soundtrack' end;
  target := case when task_type in ('generate_a_roll', 'generate_b_roll') then snapshot #>> '{shot,id}' else snapshot #>> '{audio_track,cue_id}' end;
  update public.tasks task set status = 'superseded'::public.task_status, invalidated_at = now(), invalidated_reason = 'Owner replaced automatic media with a fully satisfying manual upload.'
  where task.episode_id = p_episode_id and task.task_type = task_type and task.provider <> 'manual_upload' and task.status in ('ready', 'blocked', 'failed') and case when task_type in ('generate_a_roll', 'generate_b_roll') then task.input_snapshot #>> '{shot,id}' else task.input_snapshot #>> '{audio_track,cue_id}' end = target;
  return jsonb_set(snapshot, '{configuration_hash}', to_jsonb('manual-' || md5(snapshot::text)), true);
end;
$$;

create or replace function public.freeze_manual_media_configuration_hash()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.provider = 'manual_upload' then new.input_snapshot := public.normalize_manual_media_task(new.episode_id, new.input_snapshot); end if;
  return new;
end;
$$;

drop trigger if exists freeze_manual_media_connection_boundary on public.tasks;
create trigger freeze_manual_media_connection_boundary before insert on public.tasks for each row execute function public.freeze_manual_media_configuration_hash();
revoke all on function public.normalize_manual_media_task(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.freeze_manual_media_configuration_hash() from public, anon, authenticated;
grant execute on function public.freeze_manual_media_configuration_hash() to service_role;

create or replace function public.apply_external_connection_repair(p_episode_id uuid, p_connection_version_id uuid, p_blocker_code text default null, p_blocker_detail text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare current_episode public.episodes; target_version public.external_connection_versions; blocked_task public.tasks; source_ref text; source_version public.external_connection_versions; expected_provider text; expected_adapter text; next_snapshot jsonb; superseded_count integer := 0; recreated_count integer := 0;
begin
  select episode.* into current_episode from public.episodes episode join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner' where episode.id = p_episode_id for update of episode;
  if not found then raise exception 'Owner membership is required to repair an episode connection' using errcode = '42501'; end if;
  select version.* into target_version from public.external_connection_versions version join public.external_connections connection on connection.id = version.connection_id where version.id = p_connection_version_id and connection.created_by = auth.uid() and public.connection_version_is_verified(version.id);
  if not found then raise exception 'Episode repair requires an Owner’s current verified, non-revoked connection version' using errcode = '22023'; end if;

  for blocked_task in select task.* from public.tasks task where task.episode_id = p_episode_id and task.status in ('blocked'::public.task_status, 'failed'::public.task_status) and task.task_type in ('prepare_visual_brief', 'generate_b_roll', 'generate_narration', 'generate_soundtrack') and exists (select 1 from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker where (p_blocker_code is null or blocker ->> 'code' = p_blocker_code) and (p_blocker_detail is null or blocker ->> 'detail' = p_blocker_detail) and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) ~ '(credential|connection|network|凭据|连接|认证)') order by task.created_at, task.id for update
  loop
    source_ref := coalesce(blocked_task.input_snapshot ->> 'credential_ref', blocked_task.input_snapshot #>> '{visual_assets,image_generation,credential_ref}');
    if source_ref is null or source_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then continue; end if;
    expected_provider := case blocked_task.task_type when 'prepare_visual_brief' then 'openai' when 'generate_b_roll' then 'pexels' when 'generate_narration' then 'google_tts' when 'generate_soundtrack' then 'freesound' else null end;
    expected_adapter := case blocked_task.task_type when 'prepare_visual_brief' then 'openai_images' when 'generate_b_roll' then 'pexels_video' when 'generate_narration' then 'google_tts' when 'generate_soundtrack' then 'freesound_preview' else null end;
    select version.* into source_version from public.external_connection_versions version where version.id = source_ref::uuid;
    if not found or source_version.connection_id <> target_version.connection_id or source_version.id = target_version.id or target_version.provider <> expected_provider or target_version.adapter <> expected_adapter or source_version.provider <> expected_provider or source_version.adapter <> expected_adapter then continue; end if;
    next_snapshot := blocked_task.input_snapshot;
    if blocked_task.task_type = 'prepare_visual_brief' then next_snapshot := jsonb_set(next_snapshot, '{visual_assets,image_generation,credential_ref}', to_jsonb(target_version.id::text), true); else next_snapshot := jsonb_set(next_snapshot, '{credential_ref}', to_jsonb(target_version.id::text), true); end if;
    update public.tasks set status = 'superseded'::public.task_status, budget_limit_cents = 0, claimed_at = null, completed_at = coalesce(completed_at, now()), input_snapshot = input_snapshot || jsonb_build_object('superseded_by_connection_version_id', target_version.id, 'superseded_at', now()), last_result = coalesce(last_result, '{}'::jsonb) || jsonb_build_object('status', 'superseded', 'superseded_by_connection_version_id', target_version.id) where id = blocked_task.id;
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version) values (p_episode_id, blocked_task.task_type, 'ready'::public.task_status, next_snapshot, blocked_task.budget_limit_cents, greatest(blocked_task.max_attempts, 1), blocked_task.provider, blocked_task.model, blocked_task.prompt_version);
    superseded_count := superseded_count + 1; recreated_count := recreated_count + 1;
  end loop;
  if superseded_count = 0 then raise exception '当前生产单没有可通过连接版本修复的受阻任务' using errcode = '22023'; end if;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, p_episode_id, 'external_connection_repaired', jsonb_build_object('connection_version_id', target_version.id, 'superseded_task_count', superseded_count, 'recreated_task_count', recreated_count, 'blocker_code', p_blocker_code), auth.uid());
  return jsonb_build_object('episode_id', p_episode_id, 'connection_version_id', target_version.id, 'superseded_task_count', superseded_count, 'recreated_task_count', recreated_count);
end;
$$;

revoke all on function public.create_external_connection(text, text, text, text) from public, anon;
revoke all on function public.resolve_external_connection_secret(uuid) from public, anon, authenticated;
revoke all on function public.resolve_external_connection_secret(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_external_connection_verification(uuid, text, text) from public, anon, authenticated;
revoke all on function public.update_external_connection(uuid, text, text) from public, anon;
revoke all on function public.rotate_external_connection(uuid, text, text, text) from public, anon;
revoke all on function public.list_external_connection_versions(uuid) from public, anon;
revoke all on function public.revoke_external_connection_version(uuid) from public, anon;
revoke all on function public.delete_external_connection_version(uuid) from public, anon;
revoke all on function public.apply_external_connection_repair(uuid, uuid, text, text) from public, anon;
grant execute on function public.create_external_connection(text, text, text, text) to authenticated;
grant execute on function public.resolve_external_connection_secret(uuid) to service_role;
grant execute on function public.resolve_external_connection_secret(uuid, uuid) to service_role;
grant execute on function public.record_external_connection_verification(uuid, text, text) to service_role;
grant execute on function public.update_external_connection(uuid, text, text) to authenticated;
grant execute on function public.rotate_external_connection(uuid, text, text, text) to authenticated;
grant execute on function public.list_external_connection_versions(uuid) to authenticated;
grant execute on function public.revoke_external_connection_version(uuid) to authenticated;
grant execute on function public.delete_external_connection_version(uuid) to authenticated;
grant execute on function public.apply_external_connection_repair(uuid, uuid, text, text) to authenticated;
