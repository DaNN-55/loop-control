-- A completed Wan clip remains completed when the Owner explicitly generates a
-- new take. Preserve all legacy A-roll uniqueness and permit only one active
-- Wan request for a shot; request UUIDs remain globally idempotent.
DROP INDEX public.tasks_one_a_roll_per_storyboard_shot_revision_idx;
CREATE UNIQUE INDEX tasks_one_a_roll_per_storyboard_shot_revision_idx
ON public.tasks(episode_id,(input_snapshot->>'storyboard_review_package_id'),(input_snapshot#>>'{shot,id}'),coalesce(input_snapshot->>'pre_render_revision',''))
WHERE task_type='generate_a_roll' AND status<>'superseded' AND provider IS DISTINCT FROM 'bailian';
CREATE UNIQUE INDEX tasks_one_active_native_wan_shot_idx
ON public.tasks(episode_id,(input_snapshot->>'storyboard_review_package_id'),(input_snapshot#>>'{shot,id}'))
WHERE provider='bailian' AND task_type IN ('generate_a_roll','generate_b_roll') AND status IN ('ready','running');
