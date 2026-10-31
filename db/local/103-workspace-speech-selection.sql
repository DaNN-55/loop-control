-- Speech drafts/defaults are editable; every request retains its own execution record.
ALTER TABLE local_identity.production_workspaces ADD COLUMN narration_defaults jsonb;
ALTER TABLE local_identity.workspace_narrations ADD COLUMN selection jsonb;
ALTER TABLE local_identity.workspace_narration_requests ADD COLUMN request_snapshot jsonb;

CREATE FUNCTION local_identity.save_selected_workspace_narration(p_episode uuid,p_review uuid,p_shot text,p_text text,p_voice text,p_rate numeric,p_language text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.shot_preparation_drafts;previous public.shot_preparation_drafts;BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501';END IF;
 SELECT * INTO previous FROM public.shot_preparation_drafts WHERE episode_id=p_episode AND review_package_id=p_review AND shot_id=p_shot;
 saved:=public.save_shot_preparation_draft(p_episode,p_review,p_shot,'tts',coalesce(previous.subtitle_text,p_text),coalesce(previous.subtitles_enabled,true),p_text,p_voice,p_rate);
 UPDATE public.shot_preparation_drafts SET subtitle_text=coalesce(previous.subtitle_text,p_text),tts_text=p_text,tts_voice=p_voice,tts_override_voice=p_voice,tts_speaking_rate=p_rate,tts_override_speaking_rate=p_rate,tts_language_code=p_language WHERE id=saved.id;
END $$;
REVOKE ALL ON FUNCTION local_identity.save_selected_workspace_narration(uuid,uuid,text,text,text,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.save_selected_workspace_narration(uuid,uuid,text,text,text,numeric,text) TO loop_owner;

CREATE FUNCTION local_identity.queue_selected_workspace_narration(p_workspace uuid,p_shot text,p_snapshot jsonb,p_retry boolean) RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces;n local_identity.workspace_narrations;d public.shot_preparation_drafts;a local_identity.script_productions;e public.episodes;t public.tasks;b public.generation_account_budgets;cfg jsonb;frozen jsonb;amount integer;hash text;BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned speech workspace required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(w.id::text||p_shot,0));
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id;
 SELECT * INTO a FROM local_identity.script_productions WHERE episode_id=e.id AND enabled AND authorized_at IS NOT NULL AND script_revision_id=w.script_revision_id;
 SELECT * INTO n FROM local_identity.workspace_narrations WHERE workspace_id=w.id AND shot_id=p_shot;
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE episode_id=e.id AND review_package_id=w.storyboard_package_id AND shot_id=p_shot;
 IF e.archived_at IS NOT NULL OR e.stage='production_completed' OR e.main_script_revision_id<>w.script_revision_id OR a.authorization_hash IS NULL OR a.authorization_hash IS DISTINCT FROM p_snapshot->>'authorizationHash' OR n.mode<>'tts' OR n.confirmed_fingerprint IS DISTINCT FROM n.input_fingerprint OR n.input_fingerprint IS DISTINCT FROM p_snapshot->>'inputFingerprint' OR n.selection IS DISTINCT FROM p_snapshot->'selection' OR NOT EXISTS(SELECT 1 FROM public.review_packages WHERE id=w.storyboard_package_id AND invalidated_at IS NULL) THEN RAISE EXCEPTION 'Current authorized speech input required';END IF;
 cfg:=p_snapshot->'execution';amount:=(p_snapshot->>'reservationCents')::integer;hash:=p_snapshot->>'inputFingerprint';
 IF p_snapshot->>'selectionVersion'<>'1' OR cfg#>>'{executor,provider}'<>'volcengine_tts' OR cfg#>>'{executor,adapter}'<>'volcengine_tts' OR cfg#>>'{executor,model}'<>'seed-tts-2.0' OR cfg->>'credential_ref' IS DISTINCT FROM n.selection->>'connectionVersionId' OR NOT EXISTS(SELECT 1 FROM public.external_connection_versions v JOIN public.external_connections cn ON cn.id=v.connection_id AND cn.created_by=local_identity.owner_id() AND cn.current_version_id=v.id JOIN local_identity.connection_bindings cb ON cb.version_id=v.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=v.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE v.id::text=cfg->>'credential_ref' AND v.provider='volcengine_tts' AND v.adapter='volcengine_tts' AND v.revoked_at IS NULL AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified')) THEN RAISE EXCEPTION 'Verified owned speech connection required';END IF;
 SELECT task.* INTO t FROM public.tasks task JOIN local_identity.workspace_narration_requests r ON r.task_id=task.id WHERE r.workspace_id=w.id AND r.shot_id=p_shot AND r.input_fingerprint=hash ORDER BY task.created_at DESC LIMIT 1;
 IF FOUND AND (t.status IN ('ready','running') OR t.status IN ('failed','blocked') AND NOT p_retry) THEN RETURN t;END IF;
 IF EXISTS(SELECT 1 FROM public.tasks task JOIN local_identity.workspace_narration_requests r ON r.task_id=task.id LEFT JOIN local_identity.workspace_narration_submissions s ON s.task_id=task.id WHERE r.workspace_id=w.id AND r.shot_id=p_shot AND (task.status IN ('ready','running') OR (s.outcome IN ('started','received') AND task.status<>'completed'))) THEN RAISE EXCEPTION 'Previous speech submission pending or unknown' USING ERRCODE='55000';END IF;
 SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=e.account_id FOR UPDATE;
 IF b.account_id IS NULL OR amount<greatest(1,char_length(d.tts_text)) OR amount>100000 OR (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=e.account_id)+(SELECT coalesce(sum(task.budget_limit_cents),0) FROM public.tasks task JOIN public.episodes ep ON ep.id=task.episode_id WHERE ep.account_id=e.account_id AND task.status IN ('ready','running') AND task.task_type='generate_narration' AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=task.id))+amount>b.total_limit_cents THEN RAISE EXCEPTION '口播生成预算不足，请先允许账号生成额度并填写本次预留' USING ERRCODE='22023';END IF;
 frozen:=jsonb_build_object('selectionVersion',1,'production_selection',n.selection,'production_context',p_snapshot->'context','workspace_target',p_snapshot->'target','cost_basis',p_snapshot->'costBasis','capability','narration_generation','storyboard_review_package_id',w.storyboard_package_id,'configuration_hash',hash,'native_tts_retry_id',gen_random_uuid(),'credential_ref',cfg->>'credential_ref','executor',cfg->'executor','shot_preparation',jsonb_build_object('draft_id',d.id,'episode_id',e.id,'review_package_id',w.storyboard_package_id,'shot_id',p_shot),'media',jsonb_build_object('adapter','volcengine_tts','narration',jsonb_build_object('text',d.tts_text,'voice',jsonb_build_object('name',d.tts_voice,'language_code',d.tts_language_code,'speaking_rate',d.tts_speaking_rate))),'acoustic_alignment',jsonb_build_object('confirmed_text',d.subtitle_text,'text_fingerprint',encode(extensions.digest(convert_to(d.subtitle_text,'UTF8'),'sha256'),'hex')),'audio_track',jsonb_build_object('kind','narration','cue_id',p_shot,'source_review_package_id',w.storyboard_package_id,'start_seconds',0,'duration_seconds',0.001),'budget',jsonb_build_object('limit_cents',amount,'max_attempts',1),'allowed_tools',jsonb_build_array('read','write'),'input_artifacts',jsonb_build_array(),'output',jsonb_build_object('required_artifact_types',jsonb_build_array('narration_audio'),'content_type','audio/mpeg','relative_path',format('episodes/%s/audio/shot-narration-%s-%s.mp3',e.id,p_shot,gen_random_uuid()),'review_stage','production_ready'));
 UPDATE local_identity.input_episodes SET narration_enabled=true WHERE episode_id=e.id;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(e.id,'generate_narration','ready',frozen,amount,1,'volcengine_tts','seed-tts-2.0','production-request-v1') RETURNING * INTO t;
 INSERT INTO local_identity.workspace_narration_requests(task_id,workspace_id,episode_id,clip_id,shot_id,input_fingerprint,authorization_hash,request_snapshot) VALUES(t.id,w.id,e.id,n.clip_id,p_shot,hash,a.authorization_hash,p_snapshot);
 RETURN t;
END $$;
REVOKE ALL ON FUNCTION local_identity.queue_selected_workspace_narration(uuid,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.queue_selected_workspace_narration(uuid,text,jsonb,boolean) TO loop_owner;

-- Legacy requests retain their original guards. New requests validate frozen target and authorization, never editable defaults.
ALTER FUNCTION local_identity.reserve_workspace_narration_submission(uuid,integer,uuid) RENAME TO reserve_workspace_narration_submission_legacy;
CREATE FUNCTION local_identity.reserve_workspace_narration_submission(p_task_id uuid,p_attempt integer,p_lease_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r local_identity.workspace_narration_requests;t public.tasks;b public.generation_account_budgets;aid uuid;BEGIN
 SELECT * INTO r FROM local_identity.workspace_narration_requests WHERE task_id=p_task_id;
 IF r.request_snapshot->>'selectionVersion' IS DISTINCT FROM '1' THEN RETURN local_identity.reserve_workspace_narration_submission_legacy(p_task_id,p_attempt,p_lease_token);END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 PERFORM pg_advisory_xact_lock(hashtextextended(r.workspace_id::text||r.shot_id,0));
 IF NOT EXISTS(SELECT 1 FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id JOIN local_identity.script_productions p ON p.episode_id=e.id JOIN public.review_packages rp ON rp.id=w.storyboard_package_id WHERE w.id=r.workspace_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND rp.invalidated_at IS NULL AND p.enabled AND p.authorized_at IS NOT NULL AND p.authorization_hash=r.authorization_hash AND p.script_revision_id=e.main_script_revision_id AND w.project_sha256=r.request_snapshot#>>'{target,projectSha256}') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests x JOIN local_identity.workspace_narration_submissions s ON s.task_id=x.task_id JOIN public.tasks other_task ON other_task.id=x.task_id WHERE x.workspace_id=r.workspace_id AND x.shot_id=r.shot_id AND x.task_id<>p_task_id AND s.outcome IN ('started','received') AND other_task.status<>'completed') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions WHERE task_id=p_task_id) THEN RETURN false;END IF;
 SELECT * INTO t FROM public.tasks WHERE id=p_task_id;SELECT account_id INTO aid FROM public.episodes WHERE id=t.episode_id;
 SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF b.account_id IS NULL OR (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+t.budget_limit_cents>b.total_limit_cents THEN RAISE EXCEPTION '口播生成预算不足';END IF;
 INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents) VALUES(t.id,aid,'narration',t.budget_limit_cents); 
 INSERT INTO local_identity.workspace_narration_submissions(task_id,attempt,outcome) VALUES(p_task_id,p_attempt,'started') ON CONFLICT DO NOTHING;RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION local_identity.reserve_workspace_narration_submission(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.reserve_workspace_narration_submission(uuid,integer,uuid) TO loop_worker;

-- The exact verified task version remains valid after a current-version rotation.
DO $$DECLARE original text;changed text;BEGIN
 original:=pg_get_functiondef('local_identity.input_task_connection(uuid,integer,uuid)'::regprocedure);
 changed:=replace(original,'AND c.current_version_id=v.id','AND (c.current_version_id=v.id OR t.input_snapshot->>''selectionVersion''=''1'')');
 IF changed=original THEN RAISE EXCEPTION 'Speech connection guard changed';END IF;EXECUTE changed;
END $$;

CREATE FUNCTION local_identity.complete_selected_workspace_narration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN
 IF NEW.task_type='generate_narration' AND NEW.status='completed' AND NEW.input_snapshot->>'selectionVersion'='1' THEN UPDATE public.paid_generation_reservations SET request_state='succeeded' WHERE task_id=NEW.id;END IF;RETURN NEW;
END $$;
CREATE TRIGGER complete_selected_workspace_narration AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION local_identity.complete_selected_workspace_narration();
