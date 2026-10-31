-- New video requests own their execution. Legacy A/B values remain Worker protocol only.
DO $video_selection$
DECLARE sig text;d text;old text:='cfg:=pol->typ;';
BEGIN
 FOREACH sig IN ARRAY ARRAY['local_identity.request_workspace_official_visual(uuid,uuid,text,uuid,text,integer,uuid,integer)','local_identity.request_workspace_wan_visual(uuid,uuid,text,uuid,text,integer,uuid)'] LOOP
 d:=pg_get_functiondef(sig::regprocedure);
 IF position(old IN d)=0 THEN RAISE EXCEPTION 'Workspace video configuration protocol changed';END IF;
 d:=replace(d,$old$if s is null or s->>'shotType' not in ('a_roll','b_roll') then$old$,$new$if exists(select 1 from local_identity.workspace_visual_candidates where id=p_request_id and request_snapshot->>'selectionVersion'='1') and s is not null then s:=jsonb_set(s,'{shotType}','"b_roll"');end if; if s is null or s->>'shotType' not in ('a_roll','b_roll') then$new$);
 d:=replace(d,old,$new$cfg:=case when exists(select 1 from local_identity.workspace_visual_candidates where id=p_request_id and request_snapshot->>'selectionVersion'='1') then (select request_snapshot->'execution' from local_identity.workspace_visual_candidates where id=p_request_id) else pol->typ end;$new$);
 EXECUTE d;
 END LOOP;
END $video_selection$;

ALTER FUNCTION local_identity.queue_workspace_visual(uuid) RENAME TO queue_workspace_visual_before_selection;
CREATE FUNCTION local_identity.queue_workspace_visual(p_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v local_identity.workspace_visual_candidates;tid uuid;aid uuid;account_budget public.generation_account_budgets;cfg jsonb;BEGIN
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned video request required' USING ERRCODE='42501';END IF;
 IF v.task_id IS NOT NULL THEN RETURN v.task_id;END IF;
 IF v.request_snapshot->>'selectionVersion'='1' THEN
 cfg:=v.request_snapshot->'execution';
 IF v.request_snapshot#>>'{selection,capability}'<>'video' OR cfg->>'credential_ref' IS DISTINCT FROM v.request_snapshot#>>'{selection,connectionVersionId}' OR NOT EXISTS(SELECT 1 FROM public.external_connection_versions cv JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=local_identity.owner_id() AND cn.current_version_id=cv.id JOIN local_identity.connection_bindings cb ON cb.version_id=cv.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=cv.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE cv.id::text=cfg->>'credential_ref' AND cv.provider=cfg#>>'{executor,provider}' AND cv.adapter=cfg#>>'{executor,adapter}' AND cv.revoked_at IS NULL AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence p WHERE p.version_id=cv.id AND p.owner_id=cn.created_by AND p.mode='live' AND p.outcome='verified')) THEN RAISE EXCEPTION 'Validated owned video connection required';END IF;
 SELECT account_id INTO aid FROM public.episodes WHERE id=v.episode_id;
 SELECT * INTO account_budget FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF account_budget.account_id IS NULL THEN RAISE EXCEPTION 'Approve a generation budget first';END IF;
 IF (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+(SELECT coalesce(sum(t.budget_limit_cents),0) FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id WHERE e.account_id=aid AND t.status IN ('ready','running') AND t.provider IN ('bailian','volcengine','minimax','kling','openai') AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id))+(v.request_snapshot->>'reservationCents')::integer>account_budget.total_limit_cents THEN RAISE EXCEPTION 'Video generation budget insufficient' USING ERRCODE='22023';END IF;
 END IF;
 tid:=local_identity.queue_workspace_visual_before_selection(p_id);
 IF v.request_snapshot->>'selectionVersion'='1' THEN
 UPDATE public.tasks SET input_snapshot=input_snapshot||jsonb_build_object('production_selection',v.request_snapshot->'selection','production_context',v.request_snapshot->'context','workspace_target',v.request_snapshot->'target','cost_basis',v.request_snapshot->'costBasis','configuration_hash',v.input_fingerprint),budget_limit_cents=(v.request_snapshot->>'reservationCents')::integer WHERE id=tid;
 UPDATE public.tasks SET input_snapshot=jsonb_set(jsonb_set(input_snapshot,'{media,wan_video,prompt}',v.request_snapshot->'actualPrompt'),'{budget,limit_cents}',v.request_snapshot->'reservationCents') WHERE id=tid;
 END IF;
 RETURN tid;
END $$;
REVOKE ALL ON FUNCTION local_identity.queue_workspace_visual(uuid),local_identity.queue_workspace_visual_before_selection(uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.queue_workspace_visual(uuid) TO loop_owner;

-- Rotation changes future submissions; a queued exact verified version stays usable.
ALTER FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid) RENAME TO input_media_connection_before_video_selection;
CREATE FUNCTION local_identity.input_media_connection(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_version_id uuid) RETURNS TABLE(version_id uuid,provider text,adapter text,endpoint text,secret_ref uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND t.input_snapshot#>>'{production_selection,capability}'='video') THEN RETURN QUERY SELECT * FROM local_identity.input_media_connection_before_video_selection(p_task_id,p_attempt,p_lease_token,p_version_id);RETURN;END IF;
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 RETURN QUERY SELECT cv.id,cv.provider,cv.adapter,cv.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled AND i.media_enabled
 JOIN public.external_connection_versions cv ON cv.id=p_version_id AND cv.provider=t.provider AND cv.adapter=t.input_snapshot#>>'{executor,adapter}' AND cv.revoked_at IS NULL
 JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=i.owner_id
 JOIN local_identity.connection_bindings b ON b.version_id=cv.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=cv.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND t.input_snapshot->>'credential_ref'=cv.id::text AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=cv.id AND pe.owner_id=i.owner_id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen video connection unavailable';END IF;
END $$;
REVOKE ALL ON FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid),local_identity.input_media_connection_before_video_selection(uuid,integer,uuid,uuid) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.input_media_connection(uuid,integer,uuid,uuid) TO loop_worker;
