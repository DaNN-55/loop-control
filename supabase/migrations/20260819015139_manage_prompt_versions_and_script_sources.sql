create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  capability text not null check (capability in ('script_writing', 'visual_planning', 'storyboard_planning')),
  version integer not null check (version > 0),
  slug text not null,
  name text not null check (char_length(trim(name)) > 0),
  summary text not null check (char_length(trim(summary)) > 0),
  instructions text not null default '',
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (account_id, capability, version),
  unique (account_id, slug)
);

create index prompt_versions_account_capability_idx on public.prompt_versions(account_id, capability, version desc);

alter table public.prompt_versions enable row level security;

create policy "members can read prompt versions" on public.prompt_versions
for select to authenticated
using (public.is_account_member(account_id));

create or replace function public.seed_account_prompt_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.prompt_versions (account_id, capability, version, slug, name, summary, instructions, created_by)
  values
    (new.id, 'script_writing', 1, 'script-writing-v1', '脚本生成 v1', '根据账号定位、系列基线和委托说明生成可审核脚本。', '生成结构完整、可进入审核的脚本初稿。', auth.uid()),
    (new.id, 'visual_planning', 1, 'visual-planning-v1', '视觉规划 v1', '根据脚本和系列基线规划角色、地点和画面参考。', '输出可追溯到脚本的视觉规划和参考素材说明。', auth.uid()),
    (new.id, 'storyboard_planning', 1, 'storyboard-planning-v1', '分镜规划 v1', '根据已审核脚本和视觉规划生成结构化分镜。', '输出可审核的分镜 JSON，并保留脚本和视觉输入依据。', auth.uid())
  on conflict (account_id, slug) do nothing;
  return new;
end;
$$;

create trigger accounts_seed_prompt_versions
after insert on public.accounts
for each row execute function public.seed_account_prompt_versions();

insert into public.prompt_versions (account_id, capability, version, slug, name, summary, instructions, created_by)
select account.id, values.capability, values.version, values.slug, values.name, values.summary, values.instructions,
  (select membership.user_id from public.account_memberships membership where membership.account_id = account.id and membership.role = 'owner' limit 1)
from public.accounts account
cross join (values
  ('script_writing', 1, 'script-writing-v1', '脚本生成 v1', '根据账号定位、系列基线和委托说明生成可审核脚本。', '生成结构完整、可进入审核的脚本初稿。'),
  ('visual_planning', 1, 'visual-planning-v1', '视觉规划 v1', '根据脚本和系列基线规划角色、地点和画面参考。', '输出可追溯到脚本的视觉规划和参考素材说明。'),
  ('storyboard_planning', 1, 'storyboard-planning-v1', '分镜规划 v1', '根据已审核脚本和视觉规划生成结构化分镜。', '输出可审核的分镜 JSON，并保留脚本和视觉输入依据。')
) as values(capability, version, slug, name, summary, instructions)
on conflict (account_id, slug) do nothing;

create or replace function public.create_prompt_version(
  p_account_id uuid,
  p_capability text,
  p_name text,
  p_summary text,
  p_instructions text default ''
)
returns public.prompt_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_role public.member_role;
  next_version integer;
  created_prompt public.prompt_versions;
  prompt_slug text;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to create a prompt version' using errcode = '42501';
  end if;
  if p_capability not in ('script_writing', 'visual_planning', 'storyboard_planning') then
    raise exception 'Prompt capability is invalid' using errcode = '22023';
  end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_summary), '') = '' then
    raise exception 'Prompt name and summary are required' using errcode = '22023';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.prompt_versions
  where account_id = p_account_id and capability = p_capability;
  prompt_slug := replace(p_capability, '_', '-') || '-v' || next_version;

  insert into public.prompt_versions (account_id, capability, version, slug, name, summary, instructions, created_by)
  values (p_account_id, p_capability, next_version, prompt_slug, btrim(p_name), btrim(p_summary), coalesce(p_instructions, ''), auth.uid())
  returning * into created_prompt;

  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (p_account_id, 'prompt_version_created', jsonb_build_object('prompt_version_id', created_prompt.id, 'capability', p_capability, 'version', next_version, 'slug', prompt_slug), auth.uid());
  return created_prompt;
end;
$$;

alter table public.episodes
  add column script_source text not null default 'provided'
  check (script_source in ('provided', 'delegated'));

create or replace function public.set_episode_script_source(p_episode_id uuid, p_script_source text)
returns public.episodes
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  membership_role public.member_role;
begin
  if p_script_source not in ('provided', 'delegated') then
    raise exception 'Script source is invalid' using errcode = '22023';
  end if;
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then
    raise exception 'Owner membership is required to set script source' using errcode = '42501';
  end if;
  if current_episode.stage <> 'waiting_input' or current_episode.main_script_revision_id is not null then
    raise exception 'Script source can only be changed before the main script is fixed' using errcode = '22023';
  end if;
  update public.episodes set script_source = p_script_source, updated_at = now() where id = p_episode_id returning * into current_episode;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'script_source_selected', jsonb_build_object('script_source', p_script_source), auth.uid());
  return current_episode;
end;
$$;

revoke all on public.prompt_versions from anon, authenticated;
grant select on public.prompt_versions to authenticated;
grant execute on function public.create_prompt_version(uuid, text, text, text, text) to authenticated;
grant execute on function public.set_episode_script_source(uuid, text) to authenticated;
