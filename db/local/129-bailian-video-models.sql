-- Extend only the current workspace entry. Historical storyboard RPCs remain unchanged.
DO $migration$
DECLARE d text;old text;BEGIN
 d:=pg_get_functiondef('local_identity.request_workspace_wan_visual(uuid,uuid,text,uuid,text,integer,uuid)'::regprocedure);
 old:=$needle$cfg#>>'{executor,model}' is distinct from 'wan2.6-i2v-flash'$needle$;
 IF position(old IN d)=0 THEN RAISE EXCEPTION 'Wan workspace model guard changed';END IF;
 d:=replace(d,old,$new$coalesce(cfg#>>'{executor,model}','') NOT IN ('wan2.6-i2v-flash','wan2.6-i2v','wan2.5-i2v-preview','wan2.2-i2v-flash','wan2.2-i2v-plus','wanx2.1-i2v-plus','wanx2.1-i2v-turbo')$new$);
 old:=$needle$'ready','bailian','wan2.6-i2v-flash','wan-video-v1'$needle$;
 IF position(old IN d)=0 THEN RAISE EXCEPTION 'Wan task model insertion changed';END IF;
 d:=replace(d,old,$new$'ready','bailian',cfg#>>'{executor,model}','wan-video-v1'$new$);
 d:=replace(d,'p_duration*15',$new$coalesce((SELECT (request_snapshot->>'reservationCents')::integer FROM local_identity.workspace_visual_candidates WHERE id=p_request_id AND request_snapshot->>'selectionVersion'='1'),p_duration*15)$new$);
 d:=replace(d,'''estimated_cents''','''reserved_cents''');
 EXECUTE d;
 d:=pg_get_functiondef('local_identity.reserve_wan_generation(uuid,integer,uuid)'::regprocedure);
 old:=$needle$CASE WHEN t.provider='bailian' THEN (t.input_snapshot#>>'{media,wan_video,duration_seconds}')::integer*15 ELSE t.budget_limit_cents END$needle$;
 IF position(old IN d)=0 THEN RAISE EXCEPTION 'Wan reservation basis changed';END IF;
 d:=replace(d,old,$new$CASE WHEN t.provider='bailian' AND t.input_snapshot#>>'{production_selection,provider}' IS DISTINCT FROM 'bailian' THEN (t.input_snapshot#>>'{media,wan_video,duration_seconds}')::integer*15 ELSE t.budget_limit_cents END$new$);
 EXECUTE d;
END $migration$;
