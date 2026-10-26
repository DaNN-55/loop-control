do $$
declare definition text; changed text;
begin
 definition:=pg_get_functiondef('public.request_wan_shot_video(uuid,uuid,text,uuid,text,integer,uuid)'::regprocedure);
 changed:=replace(definition,$old$'output',jsonb_build_object('required_artifact_types'$old$,$new$'output',jsonb_build_object('content_type','video/mp4','required_artifact_types'$new$);
 if changed=definition then raise exception 'Wan output contract changed upstream'; end if;
 execute changed;
end $$;
