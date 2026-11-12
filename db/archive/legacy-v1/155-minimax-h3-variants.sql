-- Same owned immutable MiniMax connection; expand only the workspace V2 contract.
DO $migration$
DECLARE
 definition text := pg_get_functiondef('local_identity.request_workspace_official_visual(uuid,uuid,text,uuid,text,integer,uuid,integer)'::regprocedure);
 models text := $old$('minimax','minimax_video','MiniMax-H3')$old$;
 modes text := $old$provider_name='minimax' and model_name='MiniMax-H3' and visual_mode$old$;
 candidate text := $old$'audio',provider_name='minimax')$old$;
 resolution text := $old$case when provider_name='minimax' then '768P' else '720P' end$old$;
BEGIN
 IF strpos(definition,models)=0 OR strpos(definition,modes)=0 OR strpos(definition,resolution)=0 OR strpos(definition,candidate)=0 THEN
  RAISE EXCEPTION 'MiniMax workspace contract changed';
 END IF;
 definition:=replace(definition,models,models||$new$,('minimax','minimax_video','MiniMax-H3-Highspeed'),('minimax','minimax_video','MiniMax-H3-Lite')$new$);
 definition:=replace(definition,modes,$new$provider_name='minimax' and model_name in ('MiniMax-H3','MiniMax-H3-Highspeed','MiniMax-H3-Lite') and visual_mode$new$);
 definition:=replace(definition,resolution,$new$case when provider_name='minimax' then coalesce((select request_snapshot->>'videoResolution' from local_identity.workspace_visual_candidates where id=p_request_id),'768P') else '720P' end$new$);
 definition:=replace(definition,candidate,$new$'audio',provider_name='minimax','candidate_only',provider_name='minimax' and coalesce((select request_snapshot->>'origin'='candidate' from local_identity.workspace_visual_candidates where id=p_request_id),false))$new$);
 EXECUTE definition;
END
$migration$;
