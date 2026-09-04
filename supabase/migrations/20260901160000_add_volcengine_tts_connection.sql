create or replace function public.official_external_connection_endpoint(p_provider text, p_adapter text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_provider = 'pexels' and p_adapter = 'pexels_video' then 'https://api.pexels.com'
    when p_provider = 'freesound' and p_adapter = 'freesound_preview' then 'https://freesound.org/apiv2'
    when p_provider = 'openai' and p_adapter = 'openai_images' then 'https://api.openai.com/v1'
    when p_provider = 'cloudflare' and p_adapter = 'workers_ai_images' then 'https://api.cloudflare.com/client/v4'
    when p_provider = 'google_tts' and p_adapter = 'google_tts' then 'https://texttospeech.googleapis.com/v1'
    when p_provider = 'volcengine_tts' and p_adapter = 'volcengine_tts' then 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse'
    else null
  end;
$$;

alter table public.external_connections
  drop constraint if exists external_connections_provider_adapter_check;

alter table public.external_connections
  add constraint external_connections_provider_adapter_check check (
    (provider, adapter) in (
      ('pexels', 'pexels_video'),
      ('freesound', 'freesound_preview'),
      ('openai', 'openai_images'),
      ('cloudflare', 'workers_ai_images'),
      ('google_tts', 'google_tts'),
      ('volcengine_tts', 'volcengine_tts')
    )
  );

create or replace function public.validate_blueprint_external_connections()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare capability_key text; connection_ref text; expected_provider text; expected_adapter text;
begin
  foreach capability_key in array array['b_roll', 'soundtrack', 'narration', 'static_visual'] loop
    connection_ref := nullif(btrim(new.policy #>> array[capability_key, 'credential_ref']), '');
    if connection_ref is null then continue; end if;
    if capability_key in ('static_visual', 'narration') then
      expected_provider := new.policy #>> array[capability_key, 'executor', 'provider'];
      expected_adapter := new.policy #>> array[capability_key, 'executor', 'adapter'];
      if capability_key = 'static_visual' and (expected_provider, expected_adapter) not in (('openai', 'openai_images'), ('cloudflare', 'workers_ai_images')) then
        raise exception 'static_visual blueprint must use a registered image Adapter' using errcode = '22023';
      end if;
      if capability_key = 'narration' and (expected_provider, expected_adapter) not in (('google_tts', 'google_tts'), ('volcengine_tts', 'volcengine_tts')) then
        raise exception 'narration blueprint must use a registered TTS Adapter' using errcode = '22023';
      end if;
    else
      expected_provider := case capability_key when 'b_roll' then 'pexels' else 'freesound' end;
      expected_adapter := case capability_key when 'b_roll' then 'pexels_video' else 'freesound_preview' end;
    end if;
    if connection_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (
      select 1 from public.external_connection_versions version
      join public.external_connections connection on connection.id = version.connection_id
      join public.account_memberships membership on membership.account_id = new.account_id and membership.user_id = connection.created_by and membership.role = 'owner'
      where version.id = connection_ref::uuid and connection.created_by = auth.uid() and connection.current_version_id = version.id and version.revoked_at is null and version.provider = expected_provider and version.adapter = expected_adapter and public.connection_version_is_verified(version.id)
    ) then raise exception '% blueprint must reference this Owner’s current verified % connection version', capability_key, expected_provider using errcode = '22023'; end if;
  end loop;
  return new;
end;
$$;
