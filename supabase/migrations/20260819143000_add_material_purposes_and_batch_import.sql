alter table public.production_material_revisions
  add column if not exists material_purpose text not null default 'general_reference';

update public.production_material_revisions
set material_purpose = case
  when is_main_script then 'main_script'
  when material_type = 'script' then 'supplemental_script'
  else 'general_reference'
end
where material_purpose = 'general_reference';

alter table public.production_material_revisions
  drop constraint if exists production_material_revisions_material_purpose_check;

alter table public.production_material_revisions
  add constraint production_material_revisions_material_purpose_check
  check (material_purpose in ('main_script', 'supplemental_script', 'general_reference', 'visual_reference', 'b_roll', 'narration', 'background_music', 'sound_effect'));

drop function if exists public.import_production_material(uuid, text, text, text, text, text, text, bigint, boolean);

create or replace function public.import_production_material(
  p_episode_id uuid,
  p_material_type text,
  p_source_kind text,
  p_source_path text,
  p_storage_path text,
  p_mime_type text,
  p_sha256 text,
  p_file_size bigint,
  p_is_main_script boolean,
  p_material_purpose text
)
returns public.production_material_revisions
language plpgsql security definer set search_path = ''
as $$
declare
  created_revision public.production_material_revisions;
  current_episode public.episodes;
  next_revision integer;
begin
  select episode.*
  into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;

  if not found then
    raise exception 'Owner membership is required to import production material' using errcode = '42501';
  end if;
  if p_material_purpose not in ('main_script', 'supplemental_script', 'general_reference', 'visual_reference', 'b_roll', 'narration', 'background_music', 'sound_effect') then
    raise exception 'Unsupported material purpose' using errcode = '22023';
  end if;
  if p_is_main_script and trim(p_material_type) <> 'script' then
    raise exception 'Main script material must have script type' using errcode = '22023';
  end if;
  if p_is_main_script and p_material_purpose <> 'main_script' then
    raise exception 'Main script material must have main_script purpose' using errcode = '22023';
  end if;
  if not p_is_main_script and p_material_purpose = 'main_script' then
    raise exception 'Only the confirmed main script can use main_script purpose' using errcode = '22023';
  end if;
  if p_is_main_script and current_episode.stage <> 'waiting_input' then
    raise exception 'A main script can only be imported while the episode is waiting for input' using errcode = '22023';
  end if;
  if p_is_main_script and current_episode.main_script_revision_id is not null then
    raise exception 'A main script is already confirmed for this episode' using errcode = '22023';
  end if;
  if p_storage_path !~ ('^episodes/' || p_episode_id::text || '/materials/[0-9a-f]{64}-[^/]+$') then
    raise exception 'Material storage path is outside the episode material directory' using errcode = '22023';
  end if;

  select coalesce(max(revision_number), 0) + 1
  into next_revision
  from public.production_material_revisions
  where episode_id = p_episode_id and material_type = trim(p_material_type);

  insert into public.production_material_revisions (
    episode_id,
    revision_number,
    material_type,
    material_purpose,
    source_kind,
    source_path,
    storage_path,
    mime_type,
    sha256,
    file_size,
    is_main_script,
    created_by
  )
  values (
    p_episode_id,
    next_revision,
    trim(p_material_type),
    p_material_purpose,
    p_source_kind,
    trim(p_source_path),
    p_storage_path,
    p_mime_type,
    p_sha256,
    p_file_size,
    p_is_main_script,
    auth.uid()
  )
  returning * into created_revision;

  insert into public.material_revision_approvals (material_revision_id, approved_by)
  values (created_revision.id, auth.uid());

  if p_is_main_script then
    update public.episodes
    set main_script_revision_id = created_revision.id, updated_at = now()
    where id = p_episode_id;
  end if;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    p_episode_id,
    'production_material_imported',
    jsonb_build_object(
      'material_revision_id', created_revision.id,
      'material_type', created_revision.material_type,
      'material_purpose', created_revision.material_purpose,
      'sha256', created_revision.sha256,
      'source_kind', created_revision.source_kind,
      'is_main_script', created_revision.is_main_script,
      'approval_id', (select id from public.material_revision_approvals where material_revision_id = created_revision.id)
    ),
    auth.uid()
  );

  return created_revision;
end;
$$;

revoke all on function public.import_production_material(uuid, text, text, text, text, text, text, bigint, boolean, text) from public, anon;
grant execute on function public.import_production_material(uuid, text, text, text, text, text, text, bigint, boolean, text) to authenticated;
