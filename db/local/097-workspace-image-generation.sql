-- Explicit image requests share the native queue, immutable candidates and budget ledger.
DO $$ DECLARE rule text;BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO rule FROM pg_constraint WHERE conrelid='public.tasks'::regclass AND conname='tasks_task_type_check';
 ALTER TABLE public.tasks DROP CONSTRAINT tasks_task_type_check;
 EXECUTE 'ALTER TABLE public.tasks ADD CONSTRAINT tasks_task_type_check CHECK (('||rule||') OR task_type=''generate_static_visual'')';
END $$;
-- Only new explicit image tasks are assigned this exact private directory.
-- Existing shared namespace and publication guards remain unchanged.
CREATE FUNCTION local_identity.namespace_workspace_image_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.task_type<>'generate_static_visual' THEN RETURN NEW;END IF;
 IF NEW.provider<>'openai' OR NEW.model<>'gpt-image-2' OR NEW.status<>'ready' OR NEW.attempt<>0 OR NOT EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates v WHERE v.id::text=NEW.input_snapshot->>'workspace_image_request_id' AND v.episode_id=NEW.episode_id AND v.request_snapshot->>'kind'='image') THEN RAISE EXCEPTION 'Explicit workspace image request required';END IF;
 NEW.input_snapshot:=jsonb_set(NEW.input_snapshot||jsonb_build_object('native_output_namespace',NEW.id::text),'{output,relative_path}',to_jsonb(format('episodes/%s/native-tasks/%s/image.png',NEW.episode_id,NEW.id)));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION local_identity.namespace_workspace_image_task() FROM PUBLIC;
CREATE TRIGGER zzz_workspace_image_namespace BEFORE INSERT ON public.tasks FOR EACH ROW WHEN(NEW.task_type='generate_static_visual') EXECUTE FUNCTION local_identity.namespace_workspace_image_task();
ALTER TABLE public.paid_generation_reservations DROP CONSTRAINT paid_generation_reservations_kind_check;
ALTER TABLE public.paid_generation_reservations ADD CONSTRAINT paid_generation_reservations_kind_check CHECK(kind IN ('video','narration','image'));
ALTER FUNCTION local_identity.input_task_allowed(uuid,text) RENAME TO input_task_allowed_before_images;
CREATE FUNCTION local_identity.input_task_allowed(p_episode_id uuid,p_task_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT local_identity.input_task_allowed_before_images(p_episode_id,p_task_type) OR (p_task_type='generate_static_visual' AND EXISTS(SELECT 1 FROM local_identity.input_episodes WHERE episode_id=p_episode_id AND enabled AND media_enabled))
$$;
REVOKE ALL ON FUNCTION local_identity.input_task_allowed(uuid,text) FROM PUBLIC;
-- Preserve existing connection checks for every other executor.
ALTER FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid) RENAME TO input_media_connection_before_images;
CREATE FUNCTION local_identity.input_media_connection(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_version_id uuid) RETURNS TABLE(version_id uuid,provider text,adapter text,endpoint text,secret_ref uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tasks task WHERE task.id=p_task_id AND task.task_type='generate_static_visual' AND task.provider='openai') THEN
 RETURN QUERY SELECT * FROM local_identity.input_media_connection_before_images(p_task_id,p_attempt,p_lease_token,p_version_id);RETURN;END IF;
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 RETURN QUERY SELECT v.id,v.provider,v.adapter,v.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.media_enabled
 JOIN public.external_connection_versions v ON v.id=p_version_id AND v.provider='openai' AND v.adapter='openai_images' AND v.revoked_at IS NULL
 JOIN public.external_connections c ON c.id=v.connection_id AND c.created_by=i.owner_id AND c.current_version_id=v.id
 JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=v.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.input_snapshot->>'credential_ref'=v.id::text AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen image connection unavailable';END IF;
END $$;
REVOKE ALL ON FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid) TO loop_worker;
CREATE FUNCTION local_identity.queue_workspace_images(p_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v local_identity.workspace_visual_candidates;w local_identity.production_workspaces;cfg jsonb;auth local_identity.script_productions;tid uuid;frozen jsonb;BEGIN
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned image request required' USING ERRCODE='42501';END IF;
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=v.workspace_id FOR UPDATE;
 IF v.task_id IS NOT NULL THEN RETURN v.task_id;END IF;
 SELECT b.policy->'static_visual' INTO cfg FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=v.episode_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed';
 SELECT * INTO auth FROM local_identity.script_productions WHERE episode_id=v.episode_id AND script_revision_id=w.script_revision_id AND enabled AND authorized_at IS NOT NULL;
 IF cfg IS NULL OR cfg IS DISTINCT FROM v.request_snapshot->'execution' OR cfg->>'execution_path'<>'external' OR cfg#>>'{executor,provider}'<>'openai' OR cfg#>>'{executor,adapter}'<>'openai_images' OR cfg#>>'{executor,model}'<>'gpt-image-2' OR auth.authorization_hash IS DISTINCT FROM v.request_snapshot->>'authorizationHash' OR auth.authorization_hash IS NULL THEN RAISE EXCEPTION 'Current authorized image configuration required';END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates x JOIN public.tasks t ON t.id=x.task_id LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id LEFT JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id WHERE x.workspace_id=v.workspace_id AND x.target_item_id=v.target_item_id AND x.request_snapshot->>'kind'='image' AND (t.status IN ('ready','running') OR (r.request_state='submitting' AND t.status<>'completed' AND coalesce(s.outcome,'started')<>'rejected'))) THEN RAISE EXCEPTION 'Previous image submission pending or unknown' USING ERRCODE='55000';END IF;
 frozen:=jsonb_build_object('capability','static_visual_generation','configuration_hash',v.input_fingerprint,'workspace_image_request_id',v.id,'credential_ref',cfg->>'credential_ref','executor',cfg->'executor','allowed_tools',jsonb_build_array('read','write'),'input_artifacts',coalesce(v.request_snapshot->'references','[]'::jsonb),'budget',jsonb_build_object('limit_cents',(v.request_snapshot->>'reservationCents')::integer,'max_attempts',1),'media',jsonb_build_object('adapter','openai_images','static_visual',jsonb_build_object('prompt',v.request_snapshot->>'prompt','settings',v.request_snapshot->'imageSettings','references',coalesce(v.request_snapshot->'references','[]'::jsonb))),'output',jsonb_build_object('required_artifact_types',jsonb_build_array('static_visual'),'content_type','image/png','relative_path',format('episodes/%s/workspace-images/%s/image.png',v.episode_id,v.id),'review_stage','production_ready'));
 UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=v.episode_id;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(v.episode_id,'generate_static_visual','ready',frozen,(v.request_snapshot->>'reservationCents')::integer,1,'openai','gpt-image-2','workspace-image-v1') RETURNING id INTO tid;
 UPDATE local_identity.workspace_visual_candidates SET task_id=tid WHERE id=v.id;RETURN tid;
END $$;
REVOKE ALL ON FUNCTION local_identity.queue_workspace_images(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.queue_workspace_images(uuid) TO loop_owner;
CREATE FUNCTION local_identity.reserve_workspace_images(p_task uuid,p_attempt integer,p_lease uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tasks;v local_identity.workspace_visual_candidates;aid uuid;b public.generation_account_budgets;BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required';END IF;
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO t FROM public.tasks WHERE id=p_task AND task_type='generate_static_visual' AND provider='openai' AND status='running' FOR UPDATE;
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE task_id=t.id;
 IF t.id IS NULL OR v.id IS NULL OR NOT EXISTS(SELECT 1 FROM local_identity.script_productions a JOIN local_identity.production_workspaces w ON w.id=v.workspace_id JOIN public.episodes e ON e.id=w.episode_id JOIN public.review_packages p ON p.id=w.storyboard_package_id WHERE a.episode_id=e.id AND a.enabled AND a.authorized_at IS NOT NULL AND a.authorization_hash=v.request_snapshot->>'authorizationHash' AND a.script_revision_id=w.script_revision_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND p.invalidated_at IS NULL) THEN RAISE EXCEPTION 'Current image request required';END IF;
 SELECT account_id INTO aid FROM public.episodes WHERE id=t.episode_id;
 SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF b.account_id IS NULL THEN RAISE EXCEPTION 'Approve a generation budget first';END IF;
 IF EXISTS(SELECT 1 FROM public.paid_generation_reservations WHERE task_id=t.id) THEN RAISE EXCEPTION 'Previous image submission outcome unknown; do not resubmit';END IF;
 IF (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+t.budget_limit_cents>b.total_limit_cents THEN RAISE EXCEPTION '图片生成预算不足';END IF;
 INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents) VALUES(t.id,aid,'image',t.budget_limit_cents);
 INSERT INTO local_identity.workspace_visual_submissions(task_id,outcome) VALUES(t.id,'started');
END $$;
REVOKE ALL ON FUNCTION local_identity.reserve_workspace_images(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.reserve_workspace_images(uuid,integer,uuid) TO loop_worker;
CREATE FUNCTION local_identity.register_workspace_images() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v local_identity.workspace_visual_candidates; a jsonb; mid uuid; rev integer;ownerid uuid;idx integer:=0;BEGIN
 IF NEW.task_type<>'generate_static_visual' OR NEW.status<>'completed' OR OLD.status='completed' THEN RETURN NEW;END IF;
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE task_id=NEW.id FOR UPDATE;
 IF v.id IS NULL OR v.material_revision_id IS NOT NULL THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v.episode_id::text,0));
 SELECT owner_id INTO ownerid FROM local_identity.input_episodes WHERE episode_id=v.episode_id;
 FOR a IN SELECT value FROM jsonb_array_elements(NEW.last_result->'artifacts') LOOP
 IF a->>'artifactType'<>'static_visual' OR a->>'relativePath' IS DISTINCT FROM (CASE WHEN idx=0 THEN NEW.input_snapshot#>>'{output,relative_path}' ELSE regexp_replace(NEW.input_snapshot#>>'{output,relative_path}','[.]png$',format('-%s.png',idx+1)) END) THEN RAISE EXCEPTION 'Invalid generated image artifact';END IF;
 SELECT coalesce(max(revision_number),0)+1 INTO rev FROM public.production_material_revisions WHERE episode_id=v.episode_id;
 INSERT INTO public.production_material_revisions(episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES(v.episode_id,rev,'image','file',v.shot_id||'-generated-'||(idx+1)::text||'.png',a->>'relativePath','image/png',a->>'sha256',(a->>'fileSize')::bigint,false,ownerid,'visual_reference') RETURNING id INTO mid;
 IF idx=0 THEN UPDATE local_identity.workspace_visual_candidates SET material_revision_id=mid WHERE id=v.id;
 ELSE INSERT INTO local_identity.workspace_visual_candidates(workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot,material_revision_id) VALUES(v.workspace_id,v.episode_id,v.clip_id,v.shot_id,v.target_item_id,v.input_fingerprint||'-'||idx,v.target_snapshot,v.request_snapshot||jsonb_build_object('batchId',v.id),mid);END IF;
 idx:=idx+1;END LOOP;
 IF idx<>(v.request_snapshot#>>'{imageSettings,count}')::integer THEN RAISE EXCEPTION 'Incomplete image batch';END IF;
 UPDATE public.paid_generation_reservations SET request_state='succeeded',material_revision_id=(SELECT material_revision_id FROM local_identity.workspace_visual_candidates WHERE id=v.id) WHERE task_id=NEW.id;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER register_workspace_images AFTER UPDATE ON public.tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION local_identity.register_workspace_images();
-- A still may remain selected as a fallback/reference while the native timeline uses video.
CREATE TABLE local_identity.workspace_visual_image_choices(workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id) ON DELETE CASCADE,target_item_id text NOT NULL,candidate_id uuid NOT NULL REFERENCES local_identity.workspace_visual_candidates(id) ON DELETE CASCADE,PRIMARY KEY(workspace_id,target_item_id));
ALTER TABLE local_identity.workspace_visual_image_choices ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_visual_image_choice_owner ON local_identity.workspace_visual_image_choices TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id)) WITH CHECK(EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates v WHERE v.id=candidate_id AND v.workspace_id=workspace_visual_image_choices.workspace_id AND v.target_item_id=workspace_visual_image_choices.target_item_id));
GRANT SELECT,INSERT,UPDATE ON local_identity.workspace_visual_image_choices TO loop_app;
-- Freeze explicit video settings with the existing request before the Worker can claim it.
ALTER FUNCTION local_identity.queue_workspace_visual(uuid) RENAME TO queue_workspace_visual_before_settings;
CREATE FUNCTION local_identity.queue_workspace_visual(p_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tid uuid;v local_identity.workspace_visual_candidates;BEGIN
 tid:=local_identity.queue_workspace_visual_before_settings(p_id);
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id;
 IF v.request_snapshot ? 'videoSettings' OR v.request_snapshot ? 'firstFrameComposition' THEN
 UPDATE public.tasks SET input_snapshot=jsonb_set(input_snapshot,'{media,wan_video}',input_snapshot#>'{media,wan_video}'||jsonb_build_object('settings',v.request_snapshot->'videoSettings','composition',v.request_snapshot->'firstFrameComposition')) WHERE id=tid AND status='ready';
 END IF;
 RETURN tid;
END $$;
REVOKE ALL ON FUNCTION local_identity.queue_workspace_visual(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.queue_workspace_visual(uuid) TO loop_owner;
-- A configured Wan request may explicitly reserve more than the legacy 720P silent amount.
-- Reuse the existing ledger first, and atomically check both account limits before increasing it.
CREATE FUNCTION local_identity.reserve_workspace_configured_video(p_task uuid,p_attempt integer,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;v local_identity.workspace_visual_candidates;r public.paid_generation_reservations;b public.generation_account_budgets;amount integer;used integer;video_used integer;BEGIN
 result:=local_identity.reserve_workspace_visual_generation(p_task,p_attempt,p_lease);
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE task_id=p_task;
 IF v.id IS NULL OR v.request_snapshot#>>'{execution,executor,provider}'<>'bailian' OR v.request_snapshot->>'reservationCents' IS NULL OR NOT coalesce((result->>'new')::boolean,false) THEN RETURN result;END IF;
 SELECT * INTO r FROM public.paid_generation_reservations WHERE task_id=p_task;
 amount:=(v.request_snapshot->>'reservationCents')::integer;
 IF amount<r.reserved_cents OR amount>100000 THEN RAISE EXCEPTION '费用预留不足，请提高本次预留后重试';END IF;
 SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=r.account_id FOR UPDATE;
 SELECT coalesce(sum(reserved_cents),0),coalesce(sum(reserved_cents) FILTER(WHERE kind='video'),0) INTO used,video_used FROM public.paid_generation_reservations WHERE account_id=r.account_id;
 IF used-r.reserved_cents+amount>b.total_limit_cents OR (NOT b.full_generation_enabled AND video_used-r.reserved_cents+amount>b.trial_video_limit_cents) THEN RAISE EXCEPTION '账号生成预算不足';END IF;
 UPDATE public.paid_generation_reservations SET reserved_cents=amount WHERE task_id=p_task;
 RETURN result||jsonb_build_object('reserved_cents',amount);
END $$;
REVOKE ALL ON FUNCTION local_identity.reserve_workspace_configured_video(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.reserve_workspace_configured_video(uuid,integer,uuid) TO loop_worker;
