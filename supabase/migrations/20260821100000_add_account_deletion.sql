create or replace function public.delete_account(p_account_id uuid, p_confirmation text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_role public.member_role;
  account_name text;
  episode_count integer;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid()
  for update;
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to delete an account' using errcode = '42501';
  end if;

  select name into account_name
  from public.accounts
  where id = p_account_id
  for update;
  if not found then
    raise exception 'Account does not exist' using errcode = 'P0002';
  end if;
  if btrim(coalesce(p_confirmation, '')) <> account_name then
    raise exception 'Account name confirmation does not match' using errcode = '22023';
  end if;

  select count(*)::integer into episode_count
  from public.episodes
  where account_id = p_account_id;
  if episode_count > 0 then
    raise exception 'Accounts with production orders cannot be deleted' using errcode = '23503';
  end if;

  delete from public.accounts where id = p_account_id;
  return true;
end;
$$;

revoke execute on function public.delete_account(uuid, text) from public, anon;
grant execute on function public.delete_account(uuid, text) to authenticated;
