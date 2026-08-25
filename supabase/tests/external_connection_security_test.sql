begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

insert into auth.users (id, email)
values
  ('63000000-0000-4000-8000-000000000001', 'owner-one@test.invalid'),
  ('63000000-0000-4000-8000-000000000002', 'owner-two@test.invalid');

insert into public.accounts (id, slug, name, timezone)
values
  ('63000000-0000-4000-8000-000000000011', 'owner-one-account', 'Owner one', 'Asia/Shanghai'),
  ('63000000-0000-4000-8000-000000000012', 'owner-two-account', 'Owner two', 'Asia/Shanghai');

insert into public.account_memberships (account_id, user_id, role)
values
  ('63000000-0000-4000-8000-000000000011', '63000000-0000-4000-8000-000000000001', 'owner'),
  ('63000000-0000-4000-8000-000000000012', '63000000-0000-4000-8000-000000000002', 'owner');

select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.create_external_connection('pexels', 'pexels_video', 'Owner one Pexels', 'pexels-secret-value')$$,
  'an Owner creates a Pexels connection without a business-table secret'
);
select ok(
  exists (select 1 from public.external_connection_versions),
  'a connection receives an immutable version record'
);
select hasnt_table('public', 'external_connection_secrets', 'the plaintext secret table is removed');
select isnt(
  (select vault_secret_id::text from public.external_connection_versions limit 1),
  'pexels-secret-value',
  'the connection version stores only a Vault reference'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.resolve_external_connection_secret((select current_version_id from public.external_connections limit 1))$$,
  '42501',
  'Worker service role is required to resolve a connection secret',
  'an Owner cannot resolve the Vault secret'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  public.resolve_external_connection_secret((select current_version_id from public.external_connections limit 1)),
  'pexels-secret-value',
  'only the Worker service role can resolve the Vault secret for the frozen version'
);
select lives_ok(
  $$select public.record_external_connection_verification(
    (select current_version_id from public.external_connections limit 1),
    'verified',
    'Pexels accepted the connection.'
  )$$,
  'the Worker records verification for the current version'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$insert into public.account_blueprint_versions (account_id, version, policy, is_active)
    values (
      '63000000-0000-4000-8000-000000000011',
      1,
      jsonb_build_object('b_roll', jsonb_build_object('credential_ref', (select current_version_id from public.external_connections limit 1))),
      true
    )$$,
  'the owning Owner can select the verified connection version'
);

select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.account_blueprint_versions (account_id, version, policy, is_active)
    values (
      '63000000-0000-4000-8000-000000000012',
      1,
      jsonb_build_object('b_roll', jsonb_build_object('credential_ref', (select current_version_id from public.external_connections limit 1))),
      true
    )$$,
  '22023',
  'B-roll blueprint must reference this Owner’s verified Pexels connection version',
  'another Owner cannot select the first Owner’s connection version'
);

select * from finish();
rollback;
