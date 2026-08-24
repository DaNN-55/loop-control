create or replace function public.update_current_blueprint(p_account_id uuid, p_policy jsonb)
returns public.account_blueprint_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_account public.accounts;
  snapshot_blueprint public.account_blueprint_versions;
  updated_blueprint public.account_blueprint_versions;
  next_snapshot_version integer;
begin
  if jsonb_typeof(p_policy) <> 'object' then
    raise exception 'Blueprint policy must be a JSON object' using errcode = '22023';
  end if;

  select account.* into current_account
  from public.accounts account
  join public.account_memberships membership
    on membership.account_id = account.id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where account.id = p_account_id
  for update of account;
  if not found then
    raise exception 'Owner membership is required to update a blueprint' using errcode = '42501';
  end if;
  if current_account.current_blueprint_version_id is null then
    raise exception 'The account has no current blueprint' using errcode = '22023';
  end if;

  select blueprint.* into updated_blueprint
  from public.account_blueprint_versions blueprint
  where blueprint.account_id = p_account_id
    and blueprint.id = current_account.current_blueprint_version_id
    and blueprint.is_active
    and blueprint.archived_at is null
  for update;
  if not found then
    raise exception 'The current blueprint is unavailable' using errcode = '22023';
  end if;

  if exists (select 1 from public.episodes where blueprint_version_id = updated_blueprint.id) then
    select coalesce(max(version), 0) + 1 into next_snapshot_version
    from public.account_blueprint_versions
    where account_id = p_account_id;
    insert into public.account_blueprint_versions (account_id, version, policy, is_active, archived_at, is_snapshot)
    values (updated_blueprint.account_id, next_snapshot_version, updated_blueprint.policy, false, now(), true)
    returning * into snapshot_blueprint;
    update public.episodes
    set blueprint_version_id = snapshot_blueprint.id
    where blueprint_version_id = updated_blueprint.id;
  end if;

  update public.account_blueprint_versions
  set policy = p_policy
  where id = updated_blueprint.id
  returning * into updated_blueprint;

  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (
    p_account_id,
    'blueprint_policy_updated',
    jsonb_build_object('blueprint_version_id', updated_blueprint.id, 'version', updated_blueprint.version),
    auth.uid()
  );
  return updated_blueprint;
end;
$$;
