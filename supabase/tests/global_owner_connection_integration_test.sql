begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

insert into auth.users (id, email)
values ('64000000-0000-4000-8000-000000000001', 'owner-integrated@test.invalid');
insert into public.accounts (id, slug, name, timezone)
values ('64000000-0000-4000-8000-000000000011', 'owner-integrated-account', 'Integrated owner', 'Asia/Shanghai');
insert into public.account_memberships (account_id, user_id, role)
values ('64000000-0000-4000-8000-000000000011', '64000000-0000-4000-8000-000000000001', 'owner');
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok($$select public.create_external_connection('freesound', 'freesound_preview', 'Integrated Freesound', 'freesound-secret')$$, 'Owner can create Freesound connection');
select lives_ok($$select public.create_external_connection('openai', 'openai_images', 'Integrated OpenAI', 'openai-secret')$$, 'Owner can create OpenAI Images connection');
select lives_ok($$select public.create_external_connection('google_tts', 'google_tts', 'Integrated Google TTS', 'google-secret')$$, 'Owner can create Google TTS connection');
select ok((select count(*) from public.external_connection_versions) = 3, 'each connection creates one immutable version');

select set_config('request.jwt.claim.role', 'service_role', true);
select public.record_external_connection_verification((select current_version_id from public.external_connections where provider = 'freesound'), 'verified', 'Freesound accepted the connection.');
select public.record_external_connection_verification((select current_version_id from public.external_connections where provider = 'openai'), 'verified', 'OpenAI accepted the connection.');
select public.record_external_connection_verification((select current_version_id from public.external_connections where provider = 'google_tts'), 'verified', 'Google TTS accepted the connection.');
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok($$insert into public.account_blueprint_versions (account_id, version, policy, is_active) values ('64000000-0000-4000-8000-000000000011', 1, jsonb_build_object(
  'soundtrack', jsonb_build_object('credential_ref', (select current_version_id from public.external_connections where provider = 'freesound')),
  'static_visual', jsonb_build_object(
    'credential_ref', (select current_version_id from public.external_connections where provider = 'openai'),
    'executor', jsonb_build_object('provider', 'openai', 'adapter', 'openai_images')
  ),
  'narration', jsonb_build_object(
    'credential_ref', (select current_version_id from public.external_connections where provider = 'google_tts'),
    'executor', jsonb_build_object('provider', 'google_tts', 'adapter', 'google_tts', 'model', 'standard', 'prompt_version', 'narration-v1')
  )
), true)$$, 'blueprint may select all three compatible verified versions');
select ok(not exists (select 1 from public.account_blueprint_versions where policy::text like '%endpoint%'), 'blueprint snapshot contains no endpoint');
select has_function('public', 'apply_external_connection_repair', array['uuid', 'uuid', 'text', 'text'], 'current Episode repair RPC exists');
select has_function('public', 'normalize_manual_media_task', array['uuid', 'jsonb'], 'manual media boundary exists');
select ok((select count(*) from public.external_connection_versions where vault_secret_id::text not like '%secret%') = 3, 'connection versions store Vault references rather than plaintext secrets');

select * from finish();
rollback;
