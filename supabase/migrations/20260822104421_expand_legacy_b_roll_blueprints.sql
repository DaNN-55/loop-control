do $$
declare
  legacy record;
  expanded_blueprint public.account_blueprint_versions;
  expanded_policy jsonb;
  next_version integer;
begin
  for legacy in
    select blueprint.*
    from public.accounts account
    join public.account_blueprint_versions blueprint
      on blueprint.account_id = account.id
     and blueprint.id = account.current_blueprint_version_id
     and blueprint.is_active
     and blueprint.archived_at is null
    where blueprint.policy #>> '{b_roll,executor,provider}' = 'pexels'
      and blueprint.policy #>> '{b_roll,executor,adapter}' = 'pexels_video'
      and coalesce(btrim(blueprint.policy #>> '{b_roll,credential_ref}'), '') = ''
    order by blueprint.account_id
    for update of account
  loop
    expanded_policy := jsonb_set(legacy.policy, '{b_roll,credential_ref}', to_jsonb('pexels-default'::text), true);
    select coalesce(max(version), 0) + 1
    into next_version
    from public.account_blueprint_versions
    where account_id = legacy.account_id;

    update public.account_blueprint_versions
    set is_active = false
    where id = legacy.id;

    insert into public.account_blueprint_versions (account_id, version, policy, is_active)
    values (legacy.account_id, next_version, expanded_policy, true)
    returning * into expanded_blueprint;

    update public.accounts
    set current_blueprint_version_id = expanded_blueprint.id
    where id = legacy.account_id;

    insert into public.audit_events (account_id, event_type, payload, actor_id)
    values (
      legacy.account_id,
      'legacy_b_roll_blueprint_expanded',
      jsonb_build_object(
        'source_blueprint_version_id', legacy.id,
        'blueprint_version_id', expanded_blueprint.id,
        'version', expanded_blueprint.version,
        'credential_ref', 'pexels-default'
      ),
      null
    );
  end loop;
end;
$$;
