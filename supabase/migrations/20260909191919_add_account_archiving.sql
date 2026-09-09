alter table public.accounts
  add column archived_at timestamptz;

create index accounts_archived_created_idx
  on public.accounts(archived_at, created_at);

create or replace function public.set_account_archived(p_account_id uuid, p_archived boolean)
returns public.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_role public.member_role;
  updated_account public.accounts;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid()
  for update;
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to archive an account' using errcode = '42501';
  end if;

  update public.accounts
  set archived_at = case when p_archived then now() else null end
  where id = p_account_id
  returning * into updated_account;
  if not found then
    raise exception 'Account does not exist' using errcode = 'P0002';
  end if;

  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (
    p_account_id,
    case when p_archived then 'account_archived' else 'account_restored' end,
    jsonb_build_object('archived_at', updated_account.archived_at),
    auth.uid()
  );
  return updated_account;
end;
$$;

create function public.prevent_episode_for_archived_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.accounts
    where id = new.account_id and archived_at is not null
  ) then
    raise exception 'Archived accounts cannot create production orders' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger prevent_episode_for_archived_account_before_insert
before insert on public.episodes
for each row execute function public.prevent_episode_for_archived_account();

revoke execute on function public.set_account_archived(uuid, boolean) from public, anon;
grant execute on function public.set_account_archived(uuid, boolean) to authenticated;
revoke all on function public.prevent_episode_for_archived_account() from public, anon, authenticated;
