-- Extend the frozen workspace request only to supported provider/model/mode pairs.
DO $migration$
DECLARE
 definition text := pg_get_functiondef('local_identity.request_workspace_official_visual(uuid,uuid,text,uuid,text,integer,uuid,integer)'::regprocedure);
 marker text := $old$provider_name<>'volcengine' or jsonb_typeof(visual_inputs)$old$;
BEGIN
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'Workspace video input snapshot contract changed'; END IF;
 definition:=replace(definition,marker,$new$not coalesce((
    (provider_name='volcengine' and model_name in ('doubao-seedance-2-0-260128','doubao-seedance-2-5-260628') and visual_mode in ('keyframes','references'))
    or (provider_name='minimax' and model_name='MiniMax-H3' and visual_mode in ('keyframes','references'))
    or (provider_name='kling' and model_name='kling-v3' and visual_mode='keyframes')
   ),false) or jsonb_typeof(visual_inputs)$new$);
 definition:=replace(definition,'Invalid workspace Seedance inputs','Invalid workspace video inputs');
 EXECUTE definition;
END
$migration$;
