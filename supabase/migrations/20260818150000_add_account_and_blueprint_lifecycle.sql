alter table public.account_blueprint_versions
  add column archived_at timestamptz;

create index account_blueprint_versions_account_archived_idx
  on public.account_blueprint_versions(account_id, archived_at, version desc);

create or replace function public.rename_account(p_account_id uuid, p_account_name text)
returns public.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_role public.member_role;
  renamed_account public.accounts;
  previous_name text;
begin
  if char_length(trim(p_account_name)) = 0 then
    raise exception 'Account name is required' using errcode = '22023';
  end if;
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to rename an account' using errcode = '42501';
  end if;
  select name into previous_name from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Account does not exist' using errcode = 'P0002';
  end if;
  update public.accounts
  set name = trim(p_account_name)
  where id = p_account_id
  returning * into renamed_account;
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (p_account_id, 'account_renamed', jsonb_build_object('previous_name', previous_name, 'name', renamed_account.name), auth.uid());
  return renamed_account;
end;
$$;

create or replace function public.activate_blueprint_version(p_account_id uuid, p_blueprint_version_id uuid)
returns public.account_blueprint_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_role public.member_role;
  activated_blueprint public.account_blueprint_versions;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to activate a blueprint version' using errcode = '42501';
  end if;
  select * into activated_blueprint
  from public.account_blueprint_versions
  where account_id = p_account_id and id = p_blueprint_version_id
  for update;
  if not found then
    raise exception 'Blueprint version does not belong to this account' using errcode = '22023';
  end if;
  if activated_blueprint.archived_at is not null then
    raise exception 'Archived blueprint versions must be restored before activation' using errcode = '22023';
  end if;
  update public.account_blueprint_versions
  set is_active = false
  where account_id = p_account_id and is_active;
  update public.account_blueprint_versions
  set is_active = true
  where account_id = p_account_id and id = p_blueprint_version_id
  returning * into activated_blueprint;
  update public.accounts set current_blueprint_version_id = p_blueprint_version_id where id = p_account_id;
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (p_account_id, 'blueprint_version_activated', jsonb_build_object('blueprint_version_id', p_blueprint_version_id, 'version', activated_blueprint.version), auth.uid());
  return activated_blueprint;
end;
$$;

create function public.deactivate_blueprint_version(p_account_id uuid, p_blueprint_version_id uuid)
returns public.account_blueprint_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_role public.member_role;
  deactivated_blueprint public.account_blueprint_versions;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to deactivate a blueprint version' using errcode = '42501';
  end if;
  select blueprint.* into deactivated_blueprint
  from public.account_blueprint_versions blueprint
  join public.accounts account on account.id = blueprint.account_id
  where blueprint.account_id = p_account_id
    and blueprint.id = p_blueprint_version_id
    and blueprint.is_active
    and account.current_blueprint_version_id = blueprint.id
  for update;
  if not found then
    raise exception 'Only the current active blueprint can be deactivated' using errcode = '22023';
  end if;
  update public.account_blueprint_versions
  set is_active = false
  where id = p_blueprint_version_id
  returning * into deactivated_blueprint;
  update public.accounts set current_blueprint_version_id = null where id = p_account_id;
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (p_account_id, 'blueprint_version_deactivated', jsonb_build_object('blueprint_version_id', p_blueprint_version_id, 'version', deactivated_blueprint.version), auth.uid());
  return deactivated_blueprint;
end;
$$;

create function public.set_blueprint_archived(p_account_id uuid, p_blueprint_version_id uuid, p_archived boolean)
returns public.account_blueprint_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_role public.member_role;
  target_blueprint public.account_blueprint_versions;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to archive a blueprint version' using errcode = '42501';
  end if;
  select * into target_blueprint
  from public.account_blueprint_versions
  where account_id = p_account_id and id = p_blueprint_version_id
  for update;
  if not found then
    raise exception 'Blueprint version does not belong to this account' using errcode = '22023';
  end if;
  if p_archived and target_blueprint.is_active then
    raise exception 'The active blueprint must be deactivated before it can be archived' using errcode = '22023';
  end if;
  update public.account_blueprint_versions
  set archived_at = case when p_archived then now() else null end
  where id = p_blueprint_version_id
  returning * into target_blueprint;
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (p_account_id, case when p_archived then 'blueprint_version_archived' else 'blueprint_version_unarchived' end, jsonb_build_object('blueprint_version_id', p_blueprint_version_id, 'version', target_blueprint.version), auth.uid());
  return target_blueprint;
end;
$$;

revoke execute on function public.rename_account(uuid, text) from public, anon;
revoke execute on function public.deactivate_blueprint_version(uuid, uuid) from public, anon;
revoke execute on function public.set_blueprint_archived(uuid, uuid, boolean) from public, anon;
grant execute on function public.rename_account(uuid, text) to authenticated;
grant execute on function public.deactivate_blueprint_version(uuid, uuid) to authenticated;
grant execute on function public.set_blueprint_archived(uuid, uuid, boolean) to authenticated;
