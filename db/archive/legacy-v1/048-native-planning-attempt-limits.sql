-- Honor configured attempt limits for future native planning tasks.
-- Only future INSERTs for native managed planning tasks; no frozen rows changed.
CREATE FUNCTION local_identity.freeze_native_planning_attempt_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE executor jsonb;
BEGIN
 IF NEW.task_type NOT IN ('prepare_visual_brief','draft_storyboard')
  OR NOT EXISTS(SELECT 1 FROM local_identity.input_episodes WHERE episode_id=NEW.episode_id) THEN RETURN NEW; END IF;
 SELECT b.policy#>ARRAY['executors',CASE WHEN NEW.task_type='prepare_visual_brief' AND b.is_snapshot THEN 'visual_planning' ELSE 'storyboard_planning' END]
 INTO executor FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=NEW.episode_id;
 IF executor->>'max_attempts' IS NULL THEN RETURN NEW; END IF;
 NEW.max_attempts:=(executor->>'max_attempts')::integer;
 NEW.input_snapshot:=jsonb_set(NEW.input_snapshot,'{budget}',coalesce(NEW.input_snapshot->'budget','{}'::jsonb)||jsonb_build_object('max_attempts',NEW.max_attempts),true);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION local_identity.freeze_native_planning_attempt_limit() FROM PUBLIC;
CREATE TRIGGER zy_freeze_native_planning_attempt_limit BEFORE INSERT ON public.tasks
FOR EACH ROW EXECUTE FUNCTION local_identity.freeze_native_planning_attempt_limit();
