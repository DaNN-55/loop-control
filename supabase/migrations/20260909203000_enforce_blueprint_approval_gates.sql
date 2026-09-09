create or replace function public.approval_gate_enabled(p_episode_id uuid, p_gate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when jsonb_typeof(blueprint.policy -> 'approval_gates') = 'array'
        then (blueprint.policy -> 'approval_gates') ? p_gate
      else true
    end,
    true
  )
  from public.episodes episode
  join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
  where episode.id = p_episode_id;
$$;

create or replace function public.auto_advance_disabled_approval_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate_key text;
  review_stage public.episode_stage;
  approved_stage public.episode_stage;
  current_episode public.episodes;
  current_package public.review_packages;
  responsible_owner_id uuid;
  reason text;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  if new.task_type = 'verify_publish_package' then
    if public.approval_gate_enabled(new.episode_id, 'publish') then
      return new;
    end if;
    select * into current_episode from public.episodes where id = new.episode_id for update;
    if current_episode.stage <> 'qc_passed' or not public.has_required_artifacts(new.episode_id, 'publish_ready') then
      return new;
    end if;
    reason := 'Publish package validation passed; the frozen blueprint skips the additional publication approval stop.';
    update public.episodes set stage = 'publish_ready', updated_at = now() where id = new.episode_id;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
    values (new.episode_id, 'qc_passed', 'publish_ready', reason, null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, new.episode_id, 'approval_gate_auto_advanced', jsonb_build_object('gate', 'publish', 'task_id', new.id, 'to_stage', 'publish_ready'), null);
    return new;
  end if;

  select mapped.gate_key, mapped.review_stage, mapped.approved_stage
  into gate_key, review_stage, approved_stage
  from (values
    ('draft_script', 'script', 'script_review'::public.episode_stage, 'script_approved'::public.episode_stage),
    ('prepare_visual_brief', 'visual', 'visual_review'::public.episode_stage, 'visual_approved'::public.episode_stage),
    ('draft_storyboard', 'storyboard', 'storyboard_review'::public.episode_stage, 'storyboard_approved'::public.episode_stage),
    ('draft_storyboard_revision', 'storyboard', 'storyboard_review'::public.episode_stage, 'storyboard_approved'::public.episode_stage),
    ('generate_review_render', 'qc', 'qc_review'::public.episode_stage, 'qc_passed'::public.episode_stage)
  ) mapped(task_type, gate_key, review_stage, approved_stage)
  where mapped.task_type = new.task_type;

  if gate_key is null or public.approval_gate_enabled(new.episode_id, gate_key) then
    return new;
  end if;

  select * into current_episode from public.episodes where id = new.episode_id for update;
  if current_episode.stage <> review_stage then
    return new;
  end if;
  if not public.has_required_artifacts(new.episode_id, approved_stage) then
    return new;
  end if;
  if gate_key = 'qc' and exists (
    select 1
    from public.qc_review_issues issue
    join public.review_packages package on package.id = issue.review_package_id
    where package.episode_id = new.episode_id
      and package.stage = 'qc_review'
      and package.invalidated_at is null
      and issue.severity = 'blocking'
      and issue.status = 'open'
  ) then
    return new;
  end if;

  select * into current_package
  from public.review_packages package
  where package.episode_id = new.episode_id
    and package.task_id = new.id
    and package.stage = review_stage
    and package.invalidated_at is null
  order by package.revision_number desc
  limit 1;
  if not found then
    return new;
  end if;

  select membership.user_id into responsible_owner_id
  from public.account_memberships membership
  where membership.account_id = current_episode.account_id and membership.role = 'owner'
  order by membership.user_id::text
  limit 1;
  if responsible_owner_id is null then
    raise exception 'An account Owner is required to auto-advance a disabled approval gate' using errcode = '42501';
  end if;

  reason := format('Validated %s artifact auto-advanced because the frozen blueprint disables this Owner approval gate.', gate_key);
  update public.episodes set stage = approved_stage, updated_at = now() where id = new.episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (new.episode_id, review_stage, approved_stage, reason, null);
  insert into public.approvals (episode_id, review_package_id, stage, decision, reason, actor_id)
  values (new.episode_id, current_package.id, approved_stage, 'approved', reason, responsible_owner_id);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, new.episode_id, 'approval_gate_auto_advanced', jsonb_build_object('gate', gate_key, 'review_package_id', current_package.id, 'task_id', new.id, 'to_stage', approved_stage), null);
  return new;
end;
$$;

drop trigger if exists zz_auto_advance_disabled_approval_gate_after_task on public.tasks;
create trigger zz_auto_advance_disabled_approval_gate_after_task
after update of status on public.tasks
for each row execute function public.auto_advance_disabled_approval_gate();

revoke all on function public.approval_gate_enabled(uuid, text) from public, anon, authenticated;
revoke all on function public.auto_advance_disabled_approval_gate() from public, anon, authenticated;
grant execute on function public.approval_gate_enabled(uuid, text) to service_role;
