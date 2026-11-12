-- #144: output ownership is frozen before a capability is enabled for dispatch.
-- Only future ready native tasks change; all dispatch/lease/budget gates stay intact.
CREATE OR REPLACE FUNCTION local_identity.namespace_native_task_output() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prefix text; path text; field text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'ready' OR NEW.attempt<>0
   OR NEW.task_type NOT IN ('prepare_visual_brief','draft_storyboard','draft_storyboard_revision','generate_narration','generate_a_roll','generate_b_roll','generate_soundtrack','extract_embedded_audio','align_shot_captions','generate_shot_sync_preview','generate_review_render','generate_final_render')
   OR NOT EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=NEW.episode_id AND e.enabled) THEN RETURN NEW; END IF;
  NEW.input_snapshot:=NEW.input_snapshot||jsonb_build_object('native_output_namespace',NEW.id::text);
 ELSE
  IF OLD.input_snapshot->>'native_output_namespace' IS DISTINCT FROM OLD.id::text THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.task_type IS DISTINCT FROM OLD.task_type OR NEW.episode_id IS DISTINCT FROM OLD.episode_id OR NEW.input_snapshot->>'native_output_namespace' IS DISTINCT FROM OLD.id::text THEN RAISE EXCEPTION 'Native output identity is immutable' USING ERRCODE='22023'; END IF;
  IF NEW.attempt<>0 OR OLD.attempt<>0 THEN
   IF NEW.input_snapshot#>'{output}' IS DISTINCT FROM OLD.input_snapshot#>'{output}' OR NEW.input_snapshot#>'{review_render,project_relative_path}' IS DISTINCT FROM OLD.input_snapshot#>'{review_render,project_relative_path}' OR NEW.input_snapshot#>'{final_render,project_relative_path}' IS DISTINCT FROM OLD.input_snapshot#>'{final_render,project_relative_path}' THEN RAISE EXCEPTION 'Claimed native output is immutable' USING ERRCODE='22023'; END IF;
   RETURN NEW;
  END IF;
 END IF;
 prefix:=format('episodes/%s/native-tasks/%s/',NEW.episode_id,NEW.id);
 path:=NEW.input_snapshot#>>'{output,relative_path}';
 IF path IS NULL OR path !~ ('^episodes/'||NEW.episode_id::text||'/') OR path ~ '(^|/)\.\.(/|$)' OR path ~ E'\\\\' OR path ~ '/$' THEN RAISE EXCEPTION 'Native output path is invalid' USING ERRCODE='22023'; END IF;
 NEW.input_snapshot:=jsonb_set(NEW.input_snapshot,'{output,relative_path}',to_jsonb(prefix||regexp_replace(path,'^.*/','')));
 FOREACH field IN ARRAY ARRAY['review_render','final_render'] LOOP
  path:=NEW.input_snapshot#>>ARRAY[field,'project_relative_path'];
  IF path IS NOT NULL THEN
   IF path !~ ('^episodes/'||NEW.episode_id::text||'/') OR path ~ '(^|/)\.\.(/|$)' OR path ~ E'\\\\' OR path ~ '/$' THEN RAISE EXCEPTION 'Native output project path is invalid' USING ERRCODE='22023'; END IF;
   NEW.input_snapshot:=jsonb_set(NEW.input_snapshot,ARRAY[field,'project_relative_path'],to_jsonb(prefix||regexp_replace(path,'^.*/','')));
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
