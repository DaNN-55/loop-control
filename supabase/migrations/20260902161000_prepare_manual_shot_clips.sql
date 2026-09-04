drop index if exists public.tasks_one_a_roll_per_storyboard_shot_configuration_idx;

drop index if exists public.tasks_one_a_roll_per_storyboard_shot_revision_idx;
create unique index tasks_one_a_roll_per_storyboard_shot_revision_idx
on public.tasks (episode_id, (input_snapshot ->> 'storyboard_review_package_id'), (input_snapshot #>> '{shot,id}'), coalesce(input_snapshot ->> 'pre_render_revision', ''))
where task_type = 'generate_a_roll' and status <> 'superseded'::public.task_status;

drop index if exists public.tasks_one_b_roll_per_storyboard_shot_configuration_revision_idx;
create unique index tasks_one_b_roll_per_storyboard_shot_configuration_revision_idx
on public.tasks (episode_id, (input_snapshot ->> 'storyboard_review_package_id'), (input_snapshot #>> '{shot,id}'), (input_snapshot ->> 'configuration_hash'), coalesce(input_snapshot ->> 'pre_render_revision', ''))
where task_type = 'generate_b_roll' and status <> 'superseded'::public.task_status;

create function public.save_manual_shot_clip(
  p_episode_id uuid,
  p_material_revision_id uuid,
  p_shot_id text,
  p_storyboard_review_package_id uuid,
  p_kind text,
  p_clip_start_seconds numeric,
  p_clip_end_seconds numeric
)
returns public.tasks
language plpgsql security definer set search_path = ''
as $$
declare
  current_episode public.episodes;
  selected_shot jsonb;
  target_duration numeric;
  clip_selection jsonb;
  created_task public.tasks;
  replaced_count integer;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to save a manual shot clip' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual shot clips can only be saved before Studio composition' using errcode = '22023'; end if;
  if p_kind not in ('a_roll', 'b_roll') then raise exception 'Manual shot clip kind must be a_roll or b_roll' using errcode = '22023'; end if;

  select shot.value into selected_shot
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  cross join lateral jsonb_array_elements(package.context_snapshot #> '{worker_result,storyboard,shots}') shot(value)
  where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null
    and shot.value ->> 'id' = btrim(p_shot_id) and shot.value ->> 'shotType' = p_kind;
  if not found then raise exception 'Current approved storyboard shot is required' using errcode = '22023'; end if;
  target_duration := (selected_shot ->> 'durationSeconds')::numeric;
  if p_clip_start_seconds < 0 or p_clip_end_seconds <= p_clip_start_seconds or p_clip_end_seconds > 86400 then raise exception 'Clip range is invalid' using errcode = '22023'; end if;
  if abs((p_clip_end_seconds - p_clip_start_seconds) - target_duration) > 0.05 then raise exception 'Clip duration must match the approved storyboard duration' using errcode = '22023'; end if;

  update public.tasks task
  set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner replaced the prepared manual shot clip before Studio composition.'
  where task.episode_id = p_episode_id and task.task_type = case p_kind when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
    and task.status = 'completed' and task.provider = 'manual_upload'
    and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text
    and task.input_snapshot #>> '{shot,id}' = btrim(p_shot_id);
  get diagnostics replaced_count = row_count;

  if p_kind = 'a_roll' then
    created_task := public.register_manual_a_roll(p_episode_id, p_material_revision_id, p_shot_id, p_storyboard_review_package_id);
  else
    created_task := public.register_manual_b_roll(p_episode_id, p_material_revision_id, p_shot_id, p_storyboard_review_package_id);
  end if;

  clip_selection := jsonb_build_object('start_seconds', p_clip_start_seconds, 'end_seconds', p_clip_end_seconds, 'duration_seconds', p_clip_end_seconds - p_clip_start_seconds);
  update public.tasks task
  set input_snapshot = jsonb_set(jsonb_set(task.input_snapshot, '{clip_selection}', clip_selection, true), '{configuration_hash}', to_jsonb('manual-' || md5((jsonb_set(task.input_snapshot, '{clip_selection}', clip_selection, true))::text)), true)
  where task.id = created_task.id
  returning * into created_task;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'manual_shot_clip_saved', jsonb_build_object('kind', p_kind, 'material_revision_id', p_material_revision_id, 'shot_id', btrim(p_shot_id), 'storyboard_review_package_id', p_storyboard_review_package_id, 'task_id', created_task.id, 'clip_selection', clip_selection, 'replaced_task_count', replaced_count), auth.uid());
  return created_task;
end;
$$;

revoke all on function public.save_manual_shot_clip(uuid, uuid, text, uuid, text, numeric, numeric) from public, anon;
grant execute on function public.save_manual_shot_clip(uuid, uuid, text, uuid, text, numeric, numeric) to authenticated;

create function public.freeze_manual_clip_on_pre_render_member()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare clip_selection jsonb;
begin
  if new.member_kind = 'shot_media' then
    select task.input_snapshot -> 'clip_selection' into clip_selection from public.tasks task where task.id = new.source_task_id;
    if jsonb_typeof(clip_selection) = 'object' then new.evidence_snapshot := jsonb_set(new.evidence_snapshot, '{clip_selection}', clip_selection, true); end if;
  end if;
  return new;
end;
$$;

create trigger freeze_manual_clip_on_pre_render_member
before insert on public.pre_render_review_members
for each row execute function public.freeze_manual_clip_on_pre_render_member();

create function public.freeze_prepared_clips_on_review_render_task()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare package_id uuid; member jsonb; clip_selection jsonb; prepared_members jsonb := '[]'::jsonb;
begin
  if new.task_type <> 'generate_review_render' or new.input_snapshot ->> 'capability' <> 'review_rendering' then return new; end if;
  package_id := (new.input_snapshot #>> '{review_render,pre_render_review_package_id}')::uuid;
  for member in select value from jsonb_array_elements(new.input_snapshot #> '{review_render,members}') loop
    if member ->> 'member_kind' = 'shot_media' then
      select evidence_snapshot -> 'clip_selection' into clip_selection
      from public.pre_render_review_members
      where review_package_id = package_id and member_key = member ->> 'member_key';
      if jsonb_typeof(clip_selection) = 'object' then
        member := jsonb_set(jsonb_set(member, '{start_seconds}', clip_selection -> 'start_seconds', true), '{duration_seconds}', clip_selection -> 'duration_seconds', true);
      end if;
    end if;
    prepared_members := prepared_members || jsonb_build_array(member);
  end loop;
  new.input_snapshot := jsonb_set(new.input_snapshot, '{review_render,members}', prepared_members, true);
  return new;
end;
$$;

create trigger freeze_prepared_clips_on_review_render_task
before insert on public.tasks
for each row execute function public.freeze_prepared_clips_on_review_render_task();

revoke all on function public.freeze_manual_clip_on_pre_render_member() from public, anon, authenticated;
revoke all on function public.freeze_prepared_clips_on_review_render_task() from public, anon, authenticated;
