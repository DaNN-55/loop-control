-- T20: a frozen extraction retry must still refer to the current ready prepared video.
DO $migration$
DECLARE definition text; old_fragment text:='d.episode_id=p_episode_id AND p.invalidated_at IS NULL AND d.current_video_artifact_id::text=previous.input_snapshot';
BEGIN
 definition:=pg_get_functiondef('local_identity.retry_input_media(uuid,uuid)'::regprocedure);
 IF strpos(definition,old_fragment)=0 THEN RAISE EXCEPTION 'Unexpected source-retry definition'; END IF;
 EXECUTE replace(definition,old_fragment,'d.episode_id=p_episode_id AND d.video_status=''ready'' AND p.invalidated_at IS NULL AND d.current_video_artifact_id::text=previous.input_snapshot');
END $migration$;
