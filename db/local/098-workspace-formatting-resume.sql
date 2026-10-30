-- An explicit Owner confirmation creates new preparation lineage; old invalidations remain intact.
CREATE FUNCTION local_identity.resume_workspace_formatting_revision(p_workspace uuid,p_revision bigint,p_script uuid,p_project_sha text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces;e public.episodes;old public.review_packages;next_package uuid:=extensions.gen_random_uuid();next_revision integer;BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned workspace required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id FOR UPDATE;
 IF e.archived_at IS NOT NULL OR local_identity.is_historical_episode(e.id) OR e.stage<>'waiting_input' OR e.main_script_revision_id IS DISTINCT FROM p_script OR w.script_revision_id=p_script OR w.revision<>p_revision OR w.project_sha256<>p_project_sha THEN RAISE EXCEPTION 'Current pending script and workspace required' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=e.id AND status IN ('ready','running')) THEN RAISE EXCEPTION 'Finish current tasks before resuming editing';END IF;
 SELECT * INTO old FROM public.review_packages WHERE id=w.storyboard_package_id AND episode_id=e.id AND stage='storyboard_review';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id=p_script AND episode_id=e.id AND is_main_script) THEN RAISE EXCEPTION 'Verified source preparation required';END IF;
 SELECT coalesce(max(revision_number),0)+1 INTO next_revision FROM public.review_packages WHERE episode_id=e.id AND stage='storyboard_review';
 INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,context_snapshot) VALUES(next_package,e.id,'storyboard_review',next_revision,old.artifact_id,old.context_snapshot||jsonb_build_object('workspace_preparation',jsonb_build_object('scriptRevisionId',p_script,'script_revision_id',p_script,'origin','legacy-board','sourceReviewPackageId',old.id,'formattingOnly',true),'continued_project',jsonb_build_object('workspaceId',w.id,'sha256',w.project_sha256,'previousScriptRevisionId',w.script_revision_id)));
 INSERT INTO local_identity.workspace_preparations(package_id,episode_id,script_revision_id,origin,confirmed_by) VALUES(next_package,e.id,p_script,'legacy-board',local_identity.owner_id());
 INSERT INTO local_identity.workspace_shot_inputs(workspace_id,preparation_id,shot_id,origin,baseline_text,shot_type,snapshot) SELECT workspace_id,next_package,shot_id,origin,baseline_text,shot_type,snapshot FROM local_identity.workspace_shot_inputs WHERE workspace_id=w.id AND preparation_id=old.id;
 UPDATE local_identity.production_workspaces SET script_revision_id=p_script,storyboard_package_id=next_package,revision=revision+1,updated_at=clock_timestamp() WHERE id=w.id;
 UPDATE public.episodes SET stage='storyboard_review',updated_at=clock_timestamp() WHERE id=e.id;
 UPDATE local_identity.script_productions SET enabled=false,authorized_at=NULL,last_status='排版修订已确认，沿用原工程；在线制作未授权',updated_at=clock_timestamp() WHERE episode_id=e.id;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,e.id,'workspace_formatting_revision_confirmed',jsonb_build_object('workspace_id',w.id,'source_package_id',old.id,'package_id',next_package,'previous_script_revision_id',w.script_revision_id,'script_revision_id',p_script,'project_sha256',w.project_sha256,'reason','确认脚本排版修订，沿用现有工程继续编辑'),local_identity.owner_id());
END $$;
REVOKE ALL ON FUNCTION local_identity.resume_workspace_formatting_revision(uuid,bigint,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.resume_workspace_formatting_revision(uuid,bigint,uuid,text) TO loop_app;
