create function public.replace_manual_shot_media(
  p_episode_id uuid,
  p_material_revision_id uuid,
  p_shot_id text,
  p_storyboard_review_package_id uuid,
  p_kind text
)
returns public.tasks
language plpgsql security definer set search_path = ''
as $$
declare
  current_episode public.episodes;
  created_task public.tasks;
  replaced_count integer;
  target_task_type text;
begin
  if p_kind not in ('a_roll', 'b_roll') then
    raise exception 'Manual shot media kind must be a_roll or b_roll' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to replace manual shot media' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual shot media can only be replaced before production advances' using errcode = '22023'; end if;

  target_task_type := case p_kind when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end;
  update public.tasks task
  set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner replaced the confirmed manual shot media before production advanced.'
  where task.episode_id = p_episode_id
    and task.task_type = target_task_type
    and task.status = 'completed'
    and task.provider = 'manual_upload'
    and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text
    and task.input_snapshot #>> '{shot,id}' = btrim(p_shot_id);
  get diagnostics replaced_count = row_count;
  if replaced_count = 0 then raise exception 'Confirmed manual shot media does not exist' using errcode = 'P0002'; end if;

  if p_kind = 'a_roll' then
    created_task := public.register_manual_a_roll(p_episode_id, p_material_revision_id, p_shot_id, p_storyboard_review_package_id);
  else
    created_task := public.register_manual_b_roll(p_episode_id, p_material_revision_id, p_shot_id, p_storyboard_review_package_id);
  end if;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'manual_shot_media_replaced', jsonb_build_object('kind', p_kind, 'material_revision_id', p_material_revision_id, 'shot_id', btrim(p_shot_id), 'storyboard_review_package_id', p_storyboard_review_package_id, 'task_id', created_task.id, 'replaced_task_count', replaced_count), auth.uid());
  return created_task;
end;
$$;

revoke all on function public.replace_manual_shot_media(uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.replace_manual_shot_media(uuid, uuid, text, uuid, text) to authenticated;
