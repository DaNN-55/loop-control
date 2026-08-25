alter table public.episodes
  add column archived_at timestamptz;

create index episodes_active_updated_idx
  on public.episodes(updated_at desc)
  where archived_at is null;
