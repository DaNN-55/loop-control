do $$
declare
  recovered_count integer;
begin
  update public.tasks task
  set status = 'ready'::public.task_status,
      max_attempts = task.max_attempts + 1,
      claimed_at = null,
      completed_at = null
  where task.task_type = 'generate_review_render'
    and task.status = 'blocked'::public.task_status
    and task.invalidated_at is null
    and exists (
      select 1
      from public.episodes episode
      where episode.id = task.episode_id
        and episode.stage = 'render_ready'::public.episode_stage
    )
    and exists (
      select 1
      from jsonb_array_elements(
        case
          when jsonb_typeof(task.last_result -> 'blockers') = 'array' then task.last_result -> 'blockers'
          else '[]'::jsonb
        end
      ) blocker
      where blocker ->> 'code' = 'asset_root_unavailable'
        and blocker ->> 'check' = 'asset_root'
        and blocker ->> 'phase' = 'preflight'
    )
    and exists (
      select 1
      from public.task_runs task_run
      where task_run.task_id = task.id
        and task_run.attempt = task.attempt - 1
        and task_run.status = 'blocked'::public.task_status
    );

  get diagnostics recovered_count = row_count;
  raise notice 'Requeued % asset-root review render task(s).', recovered_count;
end;
$$;
