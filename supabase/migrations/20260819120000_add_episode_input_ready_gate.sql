create or replace function public.import_production_material(
  p_episode_id uuid, p_material_type text, p_source_kind text, p_source_path text, p_storage_path text, p_mime_type text, p_sha256 text, p_file_size bigint, p_is_main_script boolean
)
returns public.production_material_revisions
language plpgsql security definer set search_path = ''
as $$
declare created_revision public.production_material_revisions; current_episode public.episodes; next_revision integer;
begin
  select episode.* into current_episode from public.episodes episode join public.account_memberships membership on membership.account_id = episode.account_id where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner' for update of episode;
  if not found then raise exception 'Owner membership is required to import production material' using errcode = '42501'; end if;
  if p_is_main_script and trim(p_material_type) <> 'script' then raise exception 'Main script material must have script type' using errcode = '22023'; end if;
  if p_is_main_script and current_episode.stage <> 'waiting_input' then raise exception 'A main script can only be imported while the episode is waiting for input' using errcode = '22023'; end if;
  if p_is_main_script and current_episode.main_script_revision_id is not null then raise exception 'A main script is already confirmed for this episode' using errcode = '22023'; end if;
  if p_storage_path !~ ('^episodes/' || p_episode_id::text || '/materials/[0-9a-f]{64}-[^/]+$') then raise exception 'Material storage path is outside the episode material directory' using errcode = '22023'; end if;
  select coalesce(max(revision_number), 0) + 1 into next_revision from public.production_material_revisions where episode_id = p_episode_id and material_type = trim(p_material_type);
  insert into public.production_material_revisions (episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by)
  values (p_episode_id,next_revision,trim(p_material_type),p_source_kind,trim(p_source_path),p_storage_path,p_mime_type,p_sha256,p_file_size,p_is_main_script,auth.uid()) returning * into created_revision;
  insert into public.material_revision_approvals (material_revision_id,approved_by) values (created_revision.id,auth.uid());
  if p_is_main_script then
    update public.episodes set main_script_revision_id = created_revision.id, updated_at = now() where id = p_episode_id;
  end if;
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) values (current_episode.account_id,p_episode_id,'production_material_imported',jsonb_build_object('material_revision_id',created_revision.id,'material_type',created_revision.material_type,'sha256',created_revision.sha256,'source_kind',created_revision.source_kind,'is_main_script',created_revision.is_main_script,'approval_id',(select id from public.material_revision_approvals where material_revision_id = created_revision.id)),auth.uid());
  return created_revision;
end;
$$;

create or replace function public.start_episode_production(p_episode_id uuid)
returns public.episodes
language plpgsql security definer set search_path = ''
as $$
declare current_episode public.episodes;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;

  if not found then raise exception 'Owner membership is required to start episode production' using errcode = '42501'; end if;
  if current_episode.stage <> 'waiting_input' then raise exception 'Episode production can only start while the episode is waiting for input' using errcode = '22023'; end if;
  if current_episode.main_script_revision_id is null then raise exception 'A confirmed main script is required before starting production' using errcode = '22023'; end if;

  update public.episodes
  set stage = 'script_approved', updated_at = now()
  where id = p_episode_id;

  insert into public.state_transitions (episode_id,from_stage,to_stage,reason,actor_id)
  values (p_episode_id,'waiting_input','script_approved','Owner confirmed all production materials are ready; start production.',auth.uid());
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id)
  values (current_episode.account_id,p_episode_id,'episode_production_started',jsonb_build_object('main_script_revision_id',current_episode.main_script_revision_id),auth.uid());

  select episode.* into current_episode from public.episodes episode where episode.id = p_episode_id;
  return current_episode;
end;
$$;

revoke all on function public.import_production_material(uuid,text,text,text,text,text,text,bigint,boolean) from public, anon;
grant execute on function public.import_production_material(uuid,text,text,text,text,text,text,bigint,boolean) to authenticated;
revoke all on function public.start_episode_production(uuid) from public, anon;
grant execute on function public.start_episode_production(uuid) to authenticated;
