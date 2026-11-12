-- Owner revisions preserve immutable history and fence concurrent production.
CREATE FUNCTION local_identity.reconfirm_episode_script(p_episode uuid,p_expected uuid,p_source text,p_storage text,p_sha text,p_size bigint,p_reason text)
RETURNS public.production_material_revisions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes; m public.production_material_revisions;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned production required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF e.archived_at IS NOT NULL OR e.stage='production_completed' OR e.main_script_revision_id IS DISTINCT FROM p_expected OR p_expected IS NULL THEN RAISE EXCEPTION '当前脚本版本或生产单状态已变化，请刷新。' USING ERRCODE='22023'; END IF;
 IF btrim(coalesce(p_reason,''))='' OR length(p_reason)>4000 THEN RAISE EXCEPTION '请填写修订原因。' USING ERRCODE='22023'; END IF;
 PERFORM id FROM public.tasks WHERE episode_id=p_episode FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode AND status='running') THEN RAISE EXCEPTION '制作任务正在运行，请完成或停止后修订脚本。' USING ERRCODE='22023'; END IF;
 IF p_sha !~ '^[0-9a-f]{64}$' OR p_size<=0 OR p_size>2097152 OR p_sha=(SELECT sha256 FROM public.production_material_revisions WHERE id=p_expected) THEN RAISE EXCEPTION '脚本内容未改变或无效。' USING ERRCODE='22023'; END IF;
 UPDATE local_identity.input_episodes SET enabled=false,storyboard_enabled=false,visual_media_enabled=false,narration_enabled=false,media_enabled=false,alignment_enabled=false,preview_enabled=false,studio_enabled=false,delivery_enabled=false WHERE episode_id=p_episode;
 UPDATE local_identity.script_productions SET enabled=false,authorized_at=NULL,last_status='脚本已修订，请重新确认制作计划',updated_at=clock_timestamp() WHERE episode_id=p_episode;
 PERFORM public.invalidate_dependent_production_work('material_revision',p_expected,p_reason);
 UPDATE public.tasks SET invalidated_at=now(),invalidated_reason=p_reason WHERE episode_id=p_episode AND invalidated_at IS NULL;
 UPDATE public.review_packages SET invalidated_at=now(),invalidated_reason=p_reason WHERE episode_id=p_episode AND invalidated_at IS NULL;
 UPDATE public.episodes SET stage='waiting_input',main_script_revision_id=NULL,updated_at=now() WHERE id=p_episode;
 SELECT * INTO m FROM public.import_production_material(p_episode,'script','file',p_source,p_storage,'text/markdown',p_sha,p_size,true,'main_script');
 -- Import triggers may invalidate prior dependencies; the new input remains the gate.
 UPDATE public.episodes SET stage='waiting_input',updated_at=now() WHERE id=p_episode;
 INSERT INTO public.state_transitions(episode_id,from_stage,to_stage,reason,actor_id) VALUES(p_episode,e.stage,'waiting_input',p_reason,local_identity.owner_id());
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,p_episode,'main_script_reconfirmed',jsonb_build_object('previous_material_id',p_expected,'material_id',m.id,'reason',p_reason),local_identity.owner_id());
 RETURN m;
END $$;
REVOKE ALL ON FUNCTION local_identity.reconfirm_episode_script(uuid,uuid,text,text,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.reconfirm_episode_script(uuid,uuid,text,text,text,bigint,text) TO loop_owner;

CREATE FUNCTION local_identity.request_shot_revision(p_episode uuid,p_package uuid,p_operation jsonb,p_reason text)
RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes; t public.tasks;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned production required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF e.archived_at IS NOT NULL OR e.stage NOT IN ('storyboard_approved','production_ready','render_ready','qc_review') THEN RAISE EXCEPTION '当前阶段不能修订分镜。' USING ERRCODE='22023'; END IF;
 PERFORM id FROM public.tasks WHERE episode_id=p_episode FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode AND status='running') THEN RAISE EXCEPTION '制作任务正在运行，请完成或停止后修订分镜。' USING ERRCODE='22023'; END IF;
 UPDATE public.episodes SET stage='storyboard_approved',updated_at=now() WHERE id=p_episode;
 -- Reuse the canonical operation validator, immutable base and task receipt.
 SELECT * INTO t FROM public.request_shot_structure_revision(p_episode,p_package,p_operation,p_reason);
 UPDATE public.tasks SET invalidated_at=now(),invalidated_reason=p_reason WHERE episode_id=p_episode AND invalidated_at IS NULL AND task_type IN ('generate_review_render','generate_final_render','prepare_publish_package','verify_publish_package','register_publish_input');
 UPDATE public.review_packages SET invalidated_at=now(),invalidated_reason=p_reason WHERE episode_id=p_episode AND invalidated_at IS NULL AND stage IN ('production_ready','qc_review');
 UPDATE local_identity.script_productions SET enabled=false,authorized_at=NULL,last_status='分镜已修订，请重新确认制作计划',updated_at=clock_timestamp() WHERE episode_id=p_episode;
 IF e.stage<>'storyboard_approved' THEN INSERT INTO public.state_transitions(episode_id,from_stage,to_stage,reason,actor_id) VALUES(p_episode,e.stage,'storyboard_approved',p_reason,local_identity.owner_id()); END IF;
 RETURN t;
END $$;
REVOKE ALL ON FUNCTION local_identity.request_shot_revision(uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.request_shot_revision(uuid,uuid,jsonb,text) TO loop_owner;
