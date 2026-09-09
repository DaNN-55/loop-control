update public.tasks task
set status = 'ready',
    max_attempts = greatest(task.max_attempts, task.attempt + 1),
    claimed_at = null,
    completed_at = null
where task.task_type = 'generate_review_render'
  and task.status = 'blocked'
  and task.invalidated_at is null
  and exists (
    select 1
    from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker
    where blocker ->> 'code' = 'task_package_invalid'
      and blocker ->> 'detail' = '确认快照缺少字幕文本。'
  )
  and exists (
    select 1
    from jsonb_array_elements(coalesce(task.input_snapshot #> '{review_render,confirmed_shots}', '[]'::jsonb)) shot
    where shot -> 'subtitles_enabled' = 'false'::jsonb
      and coalesce(btrim(shot ->> 'subtitle_text'), '') = ''
  );
