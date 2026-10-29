-- Visual request lineage; media bytes and Provider ledgers retain their existing authority.
CREATE TABLE local_identity.workspace_visual_candidates(
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),
 episode_id uuid NOT NULL REFERENCES public.episodes(id),clip_id uuid NOT NULL,shot_id text NOT NULL,target_item_id text NOT NULL,
 input_fingerprint text NOT NULL,target_snapshot jsonb NOT NULL,request_snapshot jsonb NOT NULL,
 material_revision_id uuid REFERENCES public.production_material_revisions(id),task_id uuid UNIQUE REFERENCES public.tasks(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(material_revision_id IS NOT NULL OR task_id IS NOT NULL OR jsonb_typeof(request_snapshot->'execution')='object')
);
ALTER TABLE local_identity.workspace_visual_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_visual_owner ON local_identity.workspace_visual_candidates TO loop_app
 USING(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_visual_candidates.workspace_id AND w.episode_id=workspace_visual_candidates.episode_id))
 WITH CHECK(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_visual_candidates.workspace_id AND w.episode_id=workspace_visual_candidates.episode_id));
REVOKE ALL ON local_identity.workspace_visual_candidates FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT,INSERT ON local_identity.workspace_visual_candidates TO loop_app;
CREATE TABLE local_identity.workspace_visual_submissions(task_id uuid PRIMARY KEY REFERENCES public.tasks(id),outcome text NOT NULL CHECK(outcome IN ('started','received','rejected')),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
REVOKE ALL ON local_identity.workspace_visual_submissions FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
-- Keep legacy RPCs and their stage gates intact. Private clones reuse their exact
-- registered Provider, connection, budget and first-frame task construction.
DO $migration$ DECLARE signature text; definition text; changed text; old_guard text:= 'if e.stage<>''storyboard_approved'' then raise exception ''Return to the approved storyboard shot workbench first''; end if;'; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.request_official_shot_video(uuid,uuid,text,uuid,text,integer,uuid,integer)','public.request_wan_shot_video(uuid,uuid,text,uuid,text,integer,uuid)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  changed:=replace(definition,CASE WHEN signature LIKE '%official%' THEN 'public.request_official_shot_video(' ELSE 'public.request_wan_shot_video(' END,CASE WHEN signature LIKE '%official%' THEN 'local_identity.request_workspace_official_visual(' ELSE 'local_identity.request_workspace_wan_visual(' END);
  IF position(old_guard IN changed)=0 THEN RAISE EXCEPTION 'Video request stage guard changed'; END IF;
  changed:=replace(changed,old_guard,$guard$if not exists(select 1 from local_identity.workspace_visual_candidates v join local_identity.production_workspaces w on w.id=v.workspace_id and w.episode_id=v.episode_id join local_identity.script_productions a on a.episode_id=w.episode_id and a.enabled and a.authorized_at is not null and a.script_revision_id=w.script_revision_id and a.authorization_hash=v.request_snapshot->>'authorizationHash' where v.id=p_request_id and v.episode_id=e.id and v.shot_id=p_shot_id and w.storyboard_package_id=p_review_package_id and w.script_revision_id=e.main_script_revision_id and w.revision=(v.request_snapshot->>'expectedRevision')::bigint and e.archived_at is null and e.stage<>'production_completed') then raise exception 'Current authorized workspace visual lineage required'; end if;$guard$);
  changed:=replace(changed,'''capability'',typ||''_generation''','''workspace_visual'',(select request_snapshot->''mainVoice'' from local_identity.workspace_visual_candidates where id=p_request_id),''workspace_visual_request_id'',p_request_id,''capability'',typ||''_generation''');
  EXECUTE changed;
 END LOOP;
END $migration$;
REVOKE ALL ON FUNCTION local_identity.request_workspace_official_visual(uuid,uuid,text,uuid,text,integer,uuid,integer),local_identity.request_workspace_wan_visual(uuid,uuid,text,uuid,text,integer,uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
CREATE FUNCTION local_identity.queue_workspace_visual(p_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v local_identity.workspace_visual_candidates; w local_identity.production_workspaces; tid uuid; BEGIN
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned visual request required' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=v.workspace_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(v.workspace_id::text||v.target_item_id,0));
 IF v.task_id IS NOT NULL THEN RETURN v.task_id; END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates other JOIN public.tasks t ON t.id=other.task_id LEFT JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id WHERE other.workspace_id=v.workspace_id AND other.target_item_id=v.target_item_id AND (t.status IN ('ready','running') OR (s.outcome IN ('started','received') AND t.status<>'completed'))) THEN RAISE EXCEPTION 'Previous visual submission pending or unknown; reconcile or resume its saved Provider ID' USING ERRCODE='55000'; END IF;
 UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=v.episode_id;
 IF v.request_snapshot#>>'{execution,executor,provider}'='bailian' THEN
 tid:=local_identity.request_workspace_wan_visual(v.episode_id,w.storyboard_package_id,v.shot_id,(v.request_snapshot->>'firstFrameId')::uuid,v.request_snapshot->>'prompt',(v.request_snapshot->>'providerDurationSeconds')::integer,v.id);
 ELSE
 tid:=local_identity.request_workspace_official_visual(v.episode_id,w.storyboard_package_id,v.shot_id,(v.request_snapshot->>'firstFrameId')::uuid,v.request_snapshot->>'prompt',(v.request_snapshot->>'providerDurationSeconds')::integer,v.id,(v.request_snapshot->>'reservationCents')::integer);
 END IF;
 UPDATE local_identity.workspace_visual_candidates SET task_id=tid WHERE id=v.id AND task_id IS NULL;RETURN tid;
END $$;
REVOKE ALL ON FUNCTION local_identity.queue_workspace_visual(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.queue_workspace_visual(uuid) TO loop_owner;
CREATE FUNCTION local_identity.reserve_workspace_visual_generation(p_task uuid,p_attempt integer,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v local_identity.workspace_visual_candidates; w local_identity.production_workspaces; reservation jsonb; BEGIN
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE task_id=p_task;
 IF NOT FOUND THEN RETURN local_identity.reserve_wan_generation(p_task,p_attempt,p_lease); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v.workspace_id::text||v.target_item_id,0));
 -- A saved Provider task is polled using its frozen request even after an edit.
 IF NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations WHERE task_id=p_task AND provider_task_id IS NOT NULL) THEN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=v.workspace_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN public.review_packages p ON p.id=w.storyboard_package_id JOIN local_identity.script_productions a ON a.episode_id=e.id WHERE e.id=v.episode_id AND e.main_script_revision_id=w.script_revision_id AND p.invalidated_at IS NULL AND e.archived_at IS NULL AND e.stage<>'production_completed' AND a.enabled AND a.authorized_at IS NOT NULL AND a.authorization_hash=v.request_snapshot->>'authorizationHash' AND a.script_revision_id=w.script_revision_id) THEN RAISE EXCEPTION 'Visual input or production authorization changed'; END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates other JOIN public.tasks t ON t.id=other.task_id JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id WHERE other.workspace_id=v.workspace_id AND other.target_item_id=v.target_item_id AND other.id<>v.id AND s.outcome IN ('started','received') AND t.status<>'completed') THEN RAISE EXCEPTION 'Previous visual submission outcome unknown'; END IF;
 END IF;
 reservation:=local_identity.reserve_wan_generation(p_task,p_attempt,p_lease);
 IF coalesce((reservation->>'new')::boolean,false) THEN INSERT INTO local_identity.workspace_visual_submissions(task_id,outcome) VALUES(p_task,'started') ON CONFLICT DO NOTHING; END IF;
 RETURN reservation;
END $$;
CREATE FUNCTION local_identity.record_workspace_visual_submission(p_task uuid,p_attempt integer,p_lease uuid,p_outcome text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 IF p_outcome NOT IN ('received','rejected') THEN RAISE EXCEPTION 'Invalid submission outcome'; END IF;
 UPDATE local_identity.workspace_visual_submissions SET outcome=p_outcome WHERE task_id=p_task;
END $$;
REVOKE ALL ON FUNCTION local_identity.reserve_workspace_visual_generation(uuid,integer,uuid),local_identity.record_workspace_visual_submission(uuid,integer,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.reserve_workspace_visual_generation(uuid,integer,uuid),local_identity.record_workspace_visual_submission(uuid,integer,uuid,text) TO loop_worker;
ALTER TABLE local_identity.workspace_visual_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_visual_submission_owner ON local_identity.workspace_visual_submissions TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates v WHERE v.task_id=workspace_visual_submissions.task_id));
GRANT SELECT ON local_identity.workspace_visual_submissions TO loop_app;
CREATE FUNCTION local_identity.retry_workspace_visual(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v local_identity.workspace_visual_candidates; t public.tasks; BEGIN
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned visual request required' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.tasks WHERE id=v.task_id FOR UPDATE;
 IF NOT FOUND OR t.status NOT IN ('failed','blocked') OR t.invalidated_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r JOIN local_identity.workspace_visual_submissions s ON s.task_id=r.task_id WHERE r.task_id=t.id AND r.provider_task_id IS NOT NULL AND s.outcome<>'rejected') THEN RAISE EXCEPTION 'Only a saved Provider ID may resume; unknown submission cannot be repeated' USING ERRCODE='55000'; END IF;
 UPDATE public.tasks SET status='ready',max_attempts=attempt+1,claimed_at=null,completed_at=null WHERE id=t.id;
END $$;
REVOKE ALL ON FUNCTION local_identity.retry_workspace_visual(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.retry_workspace_visual(uuid) TO loop_owner;
-- Return only trusted current project/input identity to the fenced native Worker.
CREATE FUNCTION local_identity.workspace_visual_execution_input(p_task uuid,p_attempt integer,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; BEGIN
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT jsonb_build_object('root',b.policy->>'asset_root','path',w.project_path,'sha256',w.project_sha256,'fileSize',w.project_size,'targetItemId',v.target_item_id,'target',v.target_snapshot,'shotId',v.shot_id,'visualIds',(select jsonb_agg(x->>'itemId') from jsonb_array_elements(w.bindings) x where x->>'shotId'=v.shot_id),'mainVoice',v.request_snapshot->'mainVoice') INTO result
 FROM local_identity.workspace_visual_candidates v JOIN local_identity.production_workspaces w ON w.id=v.workspace_id JOIN public.episodes e ON e.id=v.episode_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id
 WHERE v.task_id=p_task AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=p_task AND r.provider_task_id IS NOT NULL);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION local_identity.workspace_visual_execution_input(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.workspace_visual_execution_input(uuid,integer,uuid) TO loop_worker;
