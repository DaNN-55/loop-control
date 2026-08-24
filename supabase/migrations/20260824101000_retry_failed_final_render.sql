create function public.retry_failed_final_render(p_episode_id uuid, p_reason text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_episode public.episodes;
  selected_task public.tasks;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Retry reason is required' using errcode = '22023';
  end if;

  select episode.* into selected_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id
    and membership.user_id = auth.uid()
    and membership.role = 'owner'
  for update of episode;
  if not found then
    raise exception 'Owner membership is required to retry final rendering' using errcode = '42501';
  end if;
  if selected_episode.stage <> 'qc_passed' then
    raise exception 'Only qc-passed episodes can retry final rendering' using errcode = '22023';
  end if;

  select task.* into selected_task
  from public.tasks task
  join public.review_packages package on package.id::text = task.input_snapshot #>> '{final_render,source_review_package_id}'
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'qc_passed' and approval.decision = 'approved'
  where task.episode_id = selected_episode.id
    and task.task_type = 'generate_final_render'
    and package.invalidated_at is null
  order by task.created_at desc
  limit 1
  for update of task;
  if not found or selected_task.status <> 'failed' then
    raise exception 'The current final render has not failed' using errcode = '22023';
  end if;

  update public.tasks
  set status = 'ready',
      max_attempts = selected_task.attempt + 1,
      claimed_at = null,
      completed_at = null
  where id = selected_task.id
  returning * into selected_task;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    selected_episode.account_id,
    selected_episode.id,
    'final_render_retry_requested',
    jsonb_build_object('task_id', selected_task.id, 'attempt', selected_task.attempt, 'reason', btrim(p_reason)),
    auth.uid()
  );
  return selected_task;
end;
$$;

revoke all on function public.retry_failed_final_render(uuid, text) from public, anon, authenticated;
grant execute on function public.retry_failed_final_render(uuid, text) to authenticated;
