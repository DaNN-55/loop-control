-- Additive integration: immutable connection versions, explicit shot requests,
-- and transactional pre-call reservations. Never invokes a provider.
alter table public.external_connections drop constraint external_connections_provider_adapter_check;
alter table public.external_connections add constraint external_connections_provider_adapter_check check ((provider,adapter) in (('pexels','pexels_video'),('freesound','freesound_preview'),('openai','openai_images'),('cloudflare','workers_ai_images'),('google_tts','google_tts'),('volcengine_tts','volcengine_tts'),('bailian','wan_video')));

create or replace function public.official_external_connection_endpoint(p_provider text,p_adapter text)
returns text language sql immutable set search_path='' as $$
select case
 when p_provider='bailian' and p_adapter='wan_video' then 'https://dashscope.aliyuncs.com'
 when p_provider='pexels' and p_adapter='pexels_video' then 'https://api.pexels.com'
 when p_provider='freesound' and p_adapter='freesound_preview' then 'https://freesound.org/apiv2'
 when p_provider='openai' and p_adapter='openai_images' then 'https://api.openai.com/v1'
 when p_provider='cloudflare' and p_adapter='workers_ai_images' then 'https://api.cloudflare.com/client/v4'
 when p_provider='google_tts' and p_adapter='google_tts' then 'https://texttospeech.googleapis.com/v1'
 when p_provider='volcengine_tts' and p_adapter='volcengine_tts' then 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse'
end $$;

create or replace function public.validate_blueprint_external_connections()
returns trigger language plpgsql security definer set search_path='' as $$
declare k text; ref text; expected_provider text; expected_adapter text;
begin
 foreach k in array array['a_roll','b_roll','soundtrack','narration','static_visual'] loop
  ref:=nullif(btrim(new.policy #>> array[k,'credential_ref']),'');
  if ref is null then continue; end if;
  expected_provider:=new.policy #>> array[k,'executor','provider']; expected_adapter:=new.policy #>> array[k,'executor','adapter'];
  if not coalesce(case k
   when 'a_roll' then (expected_provider,expected_adapter)=('bailian','wan_video')
   when 'b_roll' then (expected_provider,expected_adapter) in (('bailian','wan_video'),('pexels','pexels_video'))
   when 'soundtrack' then (expected_provider,expected_adapter)=('freesound','freesound_preview')
   when 'narration' then (expected_provider,expected_adapter) in (('google_tts','google_tts'),('volcengine_tts','volcengine_tts'))
   when 'static_visual' then (expected_provider,expected_adapter) in (('openai','openai_images'),('cloudflare','workers_ai_images')) end,false)
  then raise exception '% uses an incompatible connection Adapter',k using errcode='22023'; end if;
  if ref !~ '^[0-9a-f-]{36}$' or not exists (
   select 1 from public.external_connection_versions v join public.external_connections c on c.id=v.connection_id
   join public.account_memberships m on m.account_id=new.account_id and m.user_id=c.created_by and m.role='owner'
   where v.id=ref::uuid and c.created_by=auth.uid() and c.current_version_id=v.id and v.revoked_at is null
   and v.provider=expected_provider and v.adapter=expected_adapter and public.connection_version_is_verified(v.id)
  ) then raise exception '% requires this Owner current verified connection',k using errcode='22023'; end if;
 end loop;
 return new;
end $$;
