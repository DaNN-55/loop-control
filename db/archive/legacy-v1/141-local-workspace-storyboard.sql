-- An unfinished model plan can be superseded by a storyboard from the same confirmed script.
DO $migration$
DECLARE definition text; guard constant text := ' IF e.main_script_revision_id';
BEGIN
 definition:=pg_get_functiondef('local_identity.register_workspace_preparation(uuid,uuid,uuid,jsonb,jsonb,text)'::regprocedure);
 IF strpos(definition,guard)=0 THEN RAISE EXCEPTION 'Preparation stage guard changed'; END IF;
 EXECUTE replace(definition,guard,$body$
 IF p_origin='script-segment' AND e.main_script_revision_id=p_script AND e.stage='storyboard_draft' AND e.archived_at IS NULL THEN
  UPDATE public.tasks SET invalidated_at=clock_timestamp(),invalidated_reason='Replaced by local script preparation.'
   WHERE episode_id=e.id AND task_type='draft_storyboard' AND invalidated_at IS NULL
    AND input_snapshot#>>'{workspace_preparation,scriptRevisionId}'=p_script::text;
  IF FOUND THEN
   UPDATE public.episodes SET stage='script_approved',updated_at=clock_timestamp() WHERE id=e.id;
   INSERT INTO public.state_transitions(episode_id,from_stage,to_stage,reason,actor_id)
    VALUES(e.id,'storyboard_draft','script_approved','Continue from the confirmed script with local preparation.',local_identity.owner_id());
   e.stage:='script_approved';
  END IF;
 END IF;
 IF e.main_script_revision_id$body$);
END $migration$;
