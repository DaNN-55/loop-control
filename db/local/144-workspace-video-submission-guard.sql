-- Scope duplicate protection to video tasks at both enqueue and reservation.
-- Use the task type so older video snapshots are covered too.
DO $video_guard$
DECLARE
 signature regprocedure;
 definition text;
 target_filter constant text := 'WHERE other.workspace_id=v.workspace_id AND other.target_item_id=v.target_item_id';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'local_identity.queue_workspace_visual_before_settings(uuid)'::regprocedure,
  'local_identity.reserve_workspace_visual_generation(uuid,integer,uuid)'::regprocedure
 ] LOOP
  definition := pg_get_functiondef(signature);
  IF strpos(definition, target_filter) = 0 THEN
   RAISE EXCEPTION 'Workspace video duplicate check changed in %', signature;
  END IF;
  EXECUTE replace(definition, target_filter,
   target_filter || ' AND t.task_type IN (''generate_a_roll'', ''generate_b_roll'')');
 END LOOP;
END $video_guard$;
