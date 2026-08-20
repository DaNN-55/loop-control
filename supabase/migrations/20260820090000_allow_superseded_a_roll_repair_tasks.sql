drop index if exists public.tasks_one_a_roll_per_storyboard_shot_revision_idx;

create unique index tasks_one_a_roll_per_storyboard_shot_revision_idx
on public.tasks (
  episode_id,
  (input_snapshot ->> 'storyboard_review_package_id'),
  (input_snapshot #>> '{shot,id}'),
  coalesce(input_snapshot ->> 'pre_render_revision', '')
)
where task_type = 'generate_a_roll'
  and status <> 'superseded'::public.task_status;
