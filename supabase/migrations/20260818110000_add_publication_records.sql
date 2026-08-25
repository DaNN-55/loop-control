create type public.publication_source as enum ('manual', 'automated');
create type public.publication_status as enum ('pending', 'published', 'failed');

create table public.publication_records (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  platform text not null check (char_length(trim(platform)) > 0),
  publishing_account text not null check (char_length(trim(publishing_account)) > 0),
  external_url text,
  external_content_id text,
  published_at timestamptz,
  status public.publication_status not null,
  notes text not null default '',
  source public.publication_source not null default 'manual',
  adapter text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (external_url is null or external_url ~ '^https?://\S+$'),
  check (status <> 'published' or (published_at is not null and (external_url is not null or external_content_id is not null))),
  check (source <> 'automated' or char_length(trim(coalesce(adapter, ''))) > 0)
);

create index publication_records_episode_created_idx on public.publication_records(episode_id, created_at desc);

alter table public.publication_records enable row level security;

create policy "members can read publication records" on public.publication_records
  for select using (exists (
    select 1 from public.episodes
    where episodes.id = publication_records.episode_id
      and public.is_account_member(episodes.account_id)
  ));

create function public.record_publication(
  p_episode_id uuid,
  p_platform text,
  p_publishing_account text,
  p_external_url text default null,
  p_external_content_id text default null,
  p_published_at timestamptz default null,
  p_status public.publication_status default 'published',
  p_notes text default '',
  p_source public.publication_source default 'manual',
  p_adapter text default null
)
returns public.publication_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  created_record public.publication_records;
  membership_role public.member_role;
  normalized_platform text := btrim(coalesce(p_platform, ''));
  normalized_account text := btrim(coalesce(p_publishing_account, ''));
  normalized_url text := nullif(btrim(coalesce(p_external_url, '')), '');
  normalized_content_id text := nullif(btrim(coalesce(p_external_content_id, '')), '');
  normalized_notes text := btrim(coalesce(p_notes, ''));
  normalized_adapter text := nullif(btrim(coalesce(p_adapter, '')), '');
begin
  if p_source = 'manual' then
    select role into membership_role
    from public.account_memberships
    where account_id = (select account_id from public.episodes where id = p_episode_id)
      and user_id = auth.uid();
    if membership_role is distinct from 'owner' then
      raise exception 'Owner membership is required to record a manual publication' using errcode = '42501';
    end if;
  elsif auth.role() is distinct from 'service_role' then
    raise exception 'Only the publication adapter service may record automated publications' using errcode = '42501';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  where episode.id = p_episode_id
  for update;
  if not found then
    raise exception 'Episode % does not exist', p_episode_id using errcode = 'P0002';
  end if;
  if p_source = 'manual' and current_episode.stage <> 'publishing_review' then
    raise exception 'Manual publication requires publishing_review' using errcode = '22023';
  end if;
  if p_source = 'automated' and current_episode.stage not in ('publishing_review', 'published') then
    raise exception 'Automated publication requires publishing_review or published' using errcode = '22023';
  end if;
  if normalized_platform = '' then raise exception 'Publication platform is required' using errcode = '22023'; end if;
  if normalized_account = '' then raise exception 'Publishing account is required' using errcode = '22023'; end if;
  if normalized_url is not null and normalized_url !~ '^https?://\S+$' then raise exception 'Publication URL must use http or https' using errcode = '22023'; end if;
  if p_status = 'published' and (p_published_at is null or (normalized_url is null and normalized_content_id is null)) then
    raise exception 'Published records require publication time and an external URL or content ID' using errcode = '22023';
  end if;
  if p_source = 'manual' and p_status <> 'published' then raise exception 'Manual publication must be published' using errcode = '22023'; end if;
  if p_source = 'automated' and normalized_adapter is null then raise exception 'Automated publication requires an adapter' using errcode = '22023'; end if;

  insert into public.publication_records (
    episode_id, platform, publishing_account, external_url, external_content_id,
    published_at, status, notes, source, adapter, created_by
  ) values (
    current_episode.id, normalized_platform, normalized_account, normalized_url, normalized_content_id,
    p_published_at, p_status, normalized_notes, p_source, normalized_adapter, auth.uid()
  ) returning * into created_record;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    current_episode.id,
    'publication_record_created',
    jsonb_build_object(
      'publication_record_id', created_record.id,
      'platform', created_record.platform,
      'publishing_account', created_record.publishing_account,
      'status', created_record.status,
      'source', created_record.source,
      'adapter', created_record.adapter
    ),
    auth.uid()
  );
  return created_record;
end;
$$;

create function public.record_manual_publication(
  p_episode_id uuid,
  p_platform text,
  p_publishing_account text,
  p_external_url text default null,
  p_external_content_id text default null,
  p_published_at timestamptz default null,
  p_notes text default ''
)
returns public.publication_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_record public.publication_records;
begin
  created_record := public.record_publication(
    p_episode_id,
    p_platform,
    p_publishing_account,
    p_external_url,
    p_external_content_id,
    p_published_at,
    'published'::public.publication_status,
    p_notes,
    'manual'::public.publication_source,
    null
  );
  perform public.transition_episode(
    p_episode_id,
    'published'::public.episode_stage,
    format('Owner confirmed manual publication on %s via %s.', created_record.platform, created_record.publishing_account)
  );
  return created_record;
end;
$$;

revoke all on public.publication_records from public, anon, authenticated;
grant select on public.publication_records to authenticated;
revoke all on function public.record_publication(uuid, text, text, text, text, timestamptz, public.publication_status, text, public.publication_source, text) from public, anon;
grant execute on function public.record_publication(uuid, text, text, text, text, timestamptz, public.publication_status, text, public.publication_source, text) to authenticated, service_role;
revoke all on function public.record_manual_publication(uuid, text, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.record_manual_publication(uuid, text, text, text, text, timestamptz, text) to authenticated;
