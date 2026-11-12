-- New workspace tasks use one shot-video protocol. Never rewrite stored tasks.
DO $constraint$
DECLARE definition text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public.tasks'::regclass AND conname='tasks_task_type_check';
 IF definition IS NULL OR strpos(definition,'''generate_b_roll''')=0 THEN RAISE EXCEPTION 'Task type constraint changed';END IF;
 EXECUTE 'ALTER TABLE public.tasks DROP CONSTRAINT tasks_task_type_check';
 EXECUTE 'ALTER TABLE public.tasks ADD CONSTRAINT tasks_task_type_check '||replace(definition,'''generate_b_roll''::text','''generate_b_roll''::text, ''generate_shot_video''::text, ''search_shot_video''::text, ''preview_shot_video''::text');
END $constraint$;

CREATE FUNCTION local_identity.shot_video_snapshot(p jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result jsonb:=p; media jsonb:=p->'media';types jsonb;
BEGIN
 result:=jsonb_set(result,'{capability}',to_jsonb(CASE coalesce(p#>>'{media,video,request,operation}',p#>>'{media,b_roll,request,operation}') WHEN 'search' THEN 'shot_video_search' WHEN 'preview' THEN 'shot_video_preview' ELSE 'shot_video_generation' END));
 IF media ? 'wan_video' THEN result:=jsonb_set(result,'{media}',(media-'wan_video')||jsonb_build_object('video',media->'wan_video'));
 ELSIF media ? 'b_roll' THEN result:=jsonb_set(result,'{media}',(media-'b_roll')||jsonb_build_object('video',media->'b_roll'));END IF;
 IF jsonb_typeof(result->'shot')='object' THEN result:=jsonb_set(result,'{shot}',(result->'shot')-'shotType');END IF;
 SELECT jsonb_agg(CASE WHEN value IN ('"a_roll_video"'::jsonb,'"b_roll_asset"'::jsonb) THEN '"shot_video"'::jsonb ELSE value END) INTO types FROM jsonb_array_elements(p#>'{output,required_artifact_types}');
 IF types IS NOT NULL THEN result:=jsonb_set(result,'{output,required_artifact_types}',types);END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION local_identity.shot_video_snapshot(jsonb) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;

-- Canonical identity is assigned before the existing immutable native-output
-- trigger runs. Retried or already stored requests keep their original protocol.
CREATE FUNCTION local_identity.assign_workspace_shot_video_protocol() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.task_type IN ('generate_a_roll','generate_b_roll') AND (
 EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates v WHERE v.id::text=NEW.input_snapshot->>'workspace_visual_request_id' AND v.task_id IS NULL AND v.request_snapshot->>'selectionVersion'='1') OR
 EXISTS(SELECT 1 FROM local_identity.workspace_pexels_requests r WHERE r.id::text=NEW.input_snapshot->>'workspace_pexels_request_id' AND r.task_id IS NULL)) THEN
 NEW.task_type:=CASE NEW.input_snapshot#>>'{media,b_roll,request,operation}' WHEN 'search' THEN 'search_shot_video' WHEN 'preview' THEN 'preview_shot_video' ELSE 'generate_shot_video' END;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION local_identity.assign_workspace_shot_video_protocol() FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
CREATE TRIGGER aaa_workspace_shot_video_protocol BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION local_identity.assign_workspace_shot_video_protocol();

-- The existing queue owns every validation, reservation and input freeze. The
-- wrapper translates only the task created by this call, after settings freeze.
ALTER FUNCTION local_identity.queue_workspace_visual(uuid) RENAME TO queue_workspace_visual_before_shot_protocol;
CREATE FUNCTION local_identity.queue_workspace_visual(p_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous uuid; tid uuid;
BEGIN
 SELECT task_id INTO previous FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 tid:=local_identity.queue_workspace_visual_before_shot_protocol(p_id);
 IF previous IS NULL THEN
 UPDATE public.tasks SET input_snapshot=local_identity.shot_video_snapshot(input_snapshot)
 WHERE id=tid AND task_type IN ('generate_shot_video','search_shot_video','preview_shot_video') AND status='ready';
 END IF;
 RETURN tid;
END $$;
ALTER FUNCTION local_identity.queue_workspace_pexels(uuid) RENAME TO queue_workspace_pexels_before_shot_protocol;
CREATE FUNCTION local_identity.queue_workspace_pexels(p_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous uuid;tid uuid;
BEGIN
 SELECT task_id INTO previous FROM local_identity.workspace_pexels_requests WHERE id=p_id FOR UPDATE;
 tid:=local_identity.queue_workspace_pexels_before_shot_protocol(p_id);
 IF previous IS NULL THEN
 UPDATE public.tasks SET input_snapshot=local_identity.shot_video_snapshot(input_snapshot)
 WHERE id=tid AND task_type IN ('generate_shot_video','search_shot_video','preview_shot_video') AND status='ready';
 END IF;
 RETURN tid;
END $$;
REVOKE ALL ON FUNCTION local_identity.queue_workspace_visual(uuid),local_identity.queue_workspace_pexels(uuid),local_identity.queue_workspace_visual_before_shot_protocol(uuid),local_identity.queue_workspace_pexels_before_shot_protocol(uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.queue_workspace_visual(uuid),local_identity.queue_workspace_pexels(uuid) TO loop_owner;

-- Shared read guards must see both old and new tasks. Expand only task-type IN
-- predicates, preserving their ownership, lease, capacity and submission tests.
DO $guards$
DECLARE signature regprocedure;definition text;changed text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'local_identity.input_task_allowed_before_workspace_delivery(uuid,text)'::regprocedure,
 'local_identity.input_media_connection_before_images(uuid,integer,uuid,uuid)'::regprocedure,
 'local_identity.queue_workspace_visual_before_settings(uuid)'::regprocedure,
 'local_identity.reserve_workspace_visual_generation(uuid,integer,uuid)'::regprocedure,
 'local_identity.retry_input_media(uuid,uuid)'::regprocedure,
 'local_identity.namespace_native_task_output()'::regprocedure
 ] LOOP
 definition:=pg_get_functiondef(signature);
 changed:=regexp_replace(definition,'(\m(?:[a-z_]+\.)?(?:task_type|p_task_type)\s+(?:NOT\s+)?IN\s*\()([^)]*''generate_b_roll''[^)]*)(\))','\1''generate_shot_video'',''search_shot_video'',''preview_shot_video'',\2\3','gi');
 IF changed=definition THEN RAISE EXCEPTION 'Shot task read guard changed in %',signature;END IF;
 EXECUTE changed;
 END LOOP;
 -- New generated materials use the same neutral purpose as uploads.
 signature:='local_identity.register_wan_material(uuid,integer,uuid,text,text,bigint)'::regprocedure;
 definition:=pg_get_functiondef(signature);
 changed:=replace(definition,'case t.task_type when ''generate_a_roll'' then ''a_roll'' else ''b_roll'' end','case t.task_type when ''generate_shot_video'' then ''visual_reference'' when ''generate_a_roll'' then ''a_roll'' else ''b_roll'' end');
 IF changed=definition THEN RAISE EXCEPTION 'Generated material purpose changed';END IF;
 EXECUTE changed;
END $guards$;
