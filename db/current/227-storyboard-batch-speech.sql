-- Batch approvals use the same owner/episode scope and deletion lifecycle as individual calls.
ALTER TABLE local_identity.workspace_call_confirmations
 DROP CONSTRAINT workspace_call_confirmations_command_check,
 ADD CONSTRAINT workspace_call_confirmations_command_check CHECK(command IN ('requestWorkspaceImageCandidates','requestWorkspaceVisualCandidate','generateWorkspaceImage','generateWorkspaceNarration','prepareWorkspaceAudio','confirmStoryboardBatch'));

-- A queued reservation is an Owner commitment. Dispatch still records separate
-- fenced evidence before it can become a submitting reservation.
ALTER TABLE public.paid_generation_reservations
 DROP CONSTRAINT paid_generation_reservations_request_state_check,
 ADD CONSTRAINT paid_generation_reservations_request_state_check CHECK(request_state IN ('queued','submitting','submitted','succeeded'));


CREATE OR REPLACE FUNCTION local_identity.queue_selected_workspace_narration(p_workspace uuid, p_shot text, p_snapshot jsonb, p_retry boolean) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE w local_identity.production_workspaces;n local_identity.workspace_narrations;d local_identity.workspace_narration_inputs;a local_identity.script_productions;e public.episodes;t public.tasks;cfg jsonb;frozen jsonb;amount integer;hash text;caption_text text;batch boolean:=p_snapshot ? 'batchId';BEGIN
 w:=local_identity.lock_current_production_workspace(p_workspace);
 PERFORM pg_advisory_xact_lock(hashtextextended(w.id::text||p_shot,0));
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id;
 SELECT * INTO a FROM local_identity.workspace_production_authorizations WHERE episode_id=e.id AND enabled AND authorized_at IS NOT NULL AND script_revision_id=w.script_revision_id AND authorization_hash=local_identity.current_workspace_call_hash(w.id);
 SELECT * INTO n FROM local_identity.workspace_narrations WHERE workspace_id=w.id AND shot_id=p_shot;
 SELECT * INTO d FROM local_identity.workspace_narration_inputs WHERE workspace_id=w.id AND preparation_revision_id=w.preparation_revision_id AND shot_id=p_shot;
 SELECT contract->>'text' INTO caption_text FROM local_identity.workspace_caption_inputs WHERE workspace_id=w.id AND preparation_revision_id=w.preparation_revision_id AND shot_id=p_shot;
 IF batch THEN
  -- The consumed authorization in this transaction must contain the exact
  -- frozen input. Batch-only values never update the shot preparation inputs.
  IF NOT EXISTS(
   SELECT 1 FROM local_identity.workspace_call_confirmations c
   JOIN local_identity.workspace_call_confirmations parent ON parent.id::text=p_snapshot->>'batchId'
   WHERE c.authorization_hash=a.authorization_hash AND c.command='generateWorkspaceNarration'
    AND parent.command='confirmStoryboardBatch' AND parent.consumed_at IS NULL
    AND parent.owner_id=c.owner_id AND parent.workspace_id=c.workspace_id
    AND parent.script_revision_id=c.script_revision_id AND parent.episode_id=c.episode_id
    AND parent.payload->>'preparationRevisionId'=w.preparation_revision_id::text
    AND (parent.payload->'frozenHashes') ? p_shot
    AND c.payload->'batchInput'=p_snapshot-'authorizationHash'
  ) OR NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(w.bindings) b
   WHERE b->>'shotId'=p_shot AND b->>'id'=p_snapshot#>>'{target,clipId}'
  ) THEN RAISE EXCEPTION 'Current frozen batch authorization required' USING ERRCODE='42501';END IF;
  n.mode:='tts'; n.input_fingerprint:=p_snapshot->>'inputFingerprint';n.confirmed_fingerprint:=n.input_fingerprint;
  n.selection:=p_snapshot->'selection';n.clip_id:=(p_snapshot#>>'{target,clipId}')::uuid;
  d.workspace_id:=w.id; d.mode:='tts'; d.narration_text:=p_snapshot#>>'{context,text}';
  d.voice:=p_snapshot#>>'{context,voice,name}';d.language_code:=p_snapshot#>>'{context,voice,languageCode}';
  d.speaking_rate:=(p_snapshot#>>'{context,voice,speakingRate}')::numeric;
 END IF;
 IF btrim(coalesce(caption_text,''))='' THEN caption_text:=d.narration_text;END IF;
 IF e.archived_at IS NOT NULL OR e.stage='production_completed' OR e.main_script_revision_id<>w.script_revision_id OR a.authorization_hash IS NULL OR a.authorization_hash IS DISTINCT FROM p_snapshot->>'authorizationHash' OR n.mode<>'tts' OR n.confirmed_fingerprint IS DISTINCT FROM n.input_fingerprint OR n.input_fingerprint IS DISTINCT FROM p_snapshot->>'inputFingerprint' OR n.selection IS DISTINCT FROM p_snapshot->'selection' OR NOT local_identity.preparation_source_current(w.preparation_revision_id) THEN RAISE EXCEPTION 'Current authorized speech input required';END IF;
 IF d.workspace_id IS NULL OR d.mode<>'tts' OR p_snapshot#>>'{target,preparationRevisionId}' IS DISTINCT FROM w.preparation_revision_id::text OR p_snapshot#>>'{target,workspaceId}' IS DISTINCT FROM w.id::text OR p_snapshot#>>'{target,shotId}' IS DISTINCT FROM p_shot OR p_snapshot#>>'{target,scriptRevisionId}' IS DISTINCT FROM w.script_revision_id::text OR p_snapshot#>>'{target,projectSha256}' IS DISTINCT FROM w.project_sha256 OR p_snapshot#>>'{context,text}' IS DISTINCT FROM d.narration_text THEN RAISE EXCEPTION 'Current preparation-bound speech input required' USING ERRCODE='40001';END IF;
 cfg:=p_snapshot->'execution';amount:=(p_snapshot->>'reservationCents')::integer;hash:=p_snapshot->>'inputFingerprint';
 IF p_snapshot->>'selectionVersion'<>'1' OR cfg#>>'{executor,provider}'<>'volcengine_tts' OR cfg#>>'{executor,adapter}'<>'volcengine_tts' OR cfg#>>'{executor,model}'<>'seed-tts-2.0' OR cfg->>'credential_ref' IS DISTINCT FROM n.selection->>'connectionVersionId' OR NOT EXISTS(SELECT 1 FROM public.external_connection_versions v JOIN public.external_connections cn ON cn.id=v.connection_id AND cn.created_by=local_identity.owner_id() AND cn.current_version_id=v.id JOIN local_identity.connection_bindings cb ON cb.version_id=v.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=v.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE v.id::text=cfg->>'credential_ref' AND v.provider='volcengine_tts' AND v.adapter='volcengine_tts' AND v.revoked_at IS NULL AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified')) THEN RAISE EXCEPTION 'Verified owned speech connection required';END IF;
 SELECT task.* INTO t FROM public.tasks task JOIN local_identity.workspace_narration_requests r ON r.task_id=task.id WHERE r.workspace_id=w.id AND r.shot_id=p_shot AND r.input_fingerprint=hash ORDER BY task.created_at DESC LIMIT 1;
 IF NOT batch AND FOUND AND (t.status IN ('ready','running','completed') OR t.status IN ('failed','blocked') AND NOT p_retry) THEN RETURN t;END IF;

 IF EXISTS(
  WITH prior AS(
   SELECT task.id,task.status,s.outcome,
    EXISTS(SELECT 1 FROM local_identity.native_output_publications h WHERE h.task_id=task.id) held,
    EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests child WHERE child.workspace_id=w.id AND child.shot_id=p_shot AND child.request_snapshot->>'retryOfTaskId'=task.id::text) retried
   FROM local_identity.workspace_narration_requests r JOIN public.tasks task ON task.id=r.task_id
   LEFT JOIN local_identity.workspace_narration_submissions s ON s.task_id=task.id
   WHERE r.workspace_id=w.id AND r.shot_id=p_shot
  ), unresolved AS(
   SELECT * FROM prior WHERE status IN ('ready','running') OR held OR(outcome IN ('started','received') AND status<>'completed' AND NOT retried AND NOT local_identity.provider_request_not_sent(id))
  ), approved AS(
   SELECT u.id FROM unresolved u JOIN local_identity.workspace_call_confirmations c ON c.authorization_hash=local_identity.current_workspace_call_hash(w.id)
   WHERE u.status IN ('failed','blocked') AND (u.outcome='started' OR(u.outcome='received' AND NOT EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts f WHERE f.task_id=u.id))) AND NOT u.held AND NOT u.retried
    AND u.id::text=p_snapshot->>'retryOfTaskId' AND c.command='generateWorkspaceNarration'
    AND c.payload->>'retryOfTaskId'=u.id::text AND c.payload->>'clipId'=n.clip_id::text
  )
  SELECT 1 FROM unresolved u WHERE NOT EXISTS(SELECT 1 FROM approved x WHERE x.id=u.id)
  UNION ALL SELECT 1 WHERE p_snapshot ? 'retryOfTaskId' AND NOT EXISTS(SELECT 1 FROM approved)
 ) THEN RAISE EXCEPTION 'Previous speech submission pending or unknown' USING ERRCODE='55000';END IF;

 IF amount IS NULL OR amount<greatest(1,char_length(d.narration_text)) OR amount>100000 THEN RAISE EXCEPTION 'Invalid per-request narration reservation' USING ERRCODE='22023';END IF;
 frozen:=jsonb_build_object('selectionVersion',1,'production_selection',n.selection,'production_context',p_snapshot->'context','workspace_target',p_snapshot->'target','cost_basis',p_snapshot->'costBasis','capability','narration_generation','workspace_narration',jsonb_build_object('version','workspace-narration/v2','workspace_id',w.id,'preparation_revision_id',w.preparation_revision_id,'shot_id',p_shot,'mode','tts'),'configuration_hash',hash,'native_tts_retry_id',gen_random_uuid(),'credential_ref',cfg->>'credential_ref','executor',cfg->'executor','media',jsonb_build_object('adapter','volcengine_tts','narration',jsonb_build_object('text',d.narration_text,'voice',jsonb_build_object('name',d.voice,'language_code',d.language_code,'speaking_rate',d.speaking_rate))),'acoustic_alignment',jsonb_build_object('confirmed_text',caption_text,'text_fingerprint',encode(extensions.digest(convert_to(caption_text,'UTF8'),'sha256'),'hex')),'audio_track',jsonb_build_object('kind','narration','cue_id',p_shot,'preparation_revision_id',w.preparation_revision_id,'start_seconds',0,'duration_seconds',0.001),'budget',jsonb_build_object('limit_cents',amount,'max_attempts',1),'allowed_tools',jsonb_build_array('read','write'),'input_artifacts',jsonb_build_array(),'output',jsonb_build_object('required_artifact_types',jsonb_build_array('narration_audio'),'content_type','audio/mpeg','relative_path',format('%s/audio/narration-%s.mp3',(SELECT directory_relative_path FROM local_identity.episode_storage_location(e.id)),gen_random_uuid()),'review_stage','production_ready'));
 UPDATE local_identity.input_episodes SET narration_enabled=true WHERE episode_id=e.id;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(e.id,'generate_narration','ready',frozen,amount,1,'volcengine_tts','seed-tts-2.0','production-request-v1') RETURNING * INTO t;
 INSERT INTO local_identity.workspace_narration_requests(task_id,workspace_id,episode_id,clip_id,shot_id,input_fingerprint,authorization_hash,request_snapshot) VALUES(t.id,w.id,e.id,n.clip_id,p_shot,hash,a.authorization_hash,p_snapshot);
 IF batch THEN
  INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents,request_state)
   VALUES(t.id,e.account_id,'narration',amount,'queued');
 END IF;
 RETURN t;
END $$;

CREATE OR REPLACE FUNCTION local_identity.prepare_provider_dispatch(p_task uuid, p_attempt integer, p_lease uuid, p_kind text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE t public.tasks;f local_identity.provider_dispatch_facts;prior local_identity.provider_dispatch_facts;r text;ok boolean;
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO t FROM public.tasks WHERE id=p_task FOR UPDATE;
 IF p_kind NOT IN ('speech','image') THEN RAISE EXCEPTION 'Invalid dispatch kind' USING ERRCODE='22023';END IF;
 IF NOT local_identity.provider_dispatch_context_current(p_task,p_kind) THEN RETURN jsonb_build_object('phase','not_sent','reason','input_changed');END IF;
 IF EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts x WHERE x.task_id=p_task AND (x.request_hash<>md5(t.input_snapshot::text) OR x.kind<>p_kind)) THEN RETURN jsonb_build_object('phase','not_sent','reason','input_changed');END IF;
 IF EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts x WHERE x.task_id=p_task AND x.phase IN ('dispatching','received')) THEN RETURN jsonb_build_object('phase','unknown','reason','previous_submission');END IF;
 IF EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts x WHERE x.task_id=p_task AND x.phase='rejected') THEN RETURN jsonb_build_object('phase','not_sent','reason','previous_rejected');END IF;
 SELECT * INTO f FROM local_identity.provider_dispatch_facts WHERE task_id=p_task AND attempt=p_attempt;
 IF FOUND AND f.lease_token IS DISTINCT FROM p_lease THEN RAISE EXCEPTION 'Dispatch fence changed' USING ERRCODE='42501';END IF;
 SELECT * INTO prior FROM local_identity.provider_dispatch_facts WHERE task_id=p_task AND phase='reserved' ORDER BY attempt DESC LIMIT 1;
 -- No new-protocol proof: a historical reservation remains unknown forever.
 IF prior.task_id IS NULL AND (EXISTS(SELECT 1 FROM public.paid_generation_reservations WHERE task_id=p_task AND request_state<>'queued')
  OR EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions WHERE task_id=p_task)
  OR EXISTS(SELECT 1 FROM local_identity.workspace_visual_submissions WHERE task_id=p_task)) THEN RETURN jsonb_build_object('phase','unknown','reason','legacy_submission');END IF;
 INSERT INTO local_identity.provider_dispatch_facts(task_id,attempt,lease_token,kind,request_hash,phase)
 VALUES(p_task,p_attempt,p_lease,p_kind,md5(t.input_snapshot::text),'preparing') ON CONFLICT DO NOTHING;
 IF prior.task_id IS NOT NULL THEN r:=prior.route;
 ELSIF p_kind='speech' THEN
  r:=local_identity.reserve_workspace_narration_route(p_task,p_attempt,p_lease);
  IF r IS NULL THEN
   UPDATE local_identity.provider_dispatch_facts SET last_reason='input_or_prior_request',updated_at=clock_timestamp() WHERE task_id=p_task AND attempt=p_attempt;
   RETURN jsonb_build_object('phase','not_sent','reason','input_or_prior_request');
  END IF;
 ELSE
  PERFORM local_identity.reserve_workspace_images(p_task,p_attempt,p_lease);r:='confirmed';
 END IF;
 UPDATE local_identity.provider_dispatch_facts SET phase='reserved',route=r,last_reason=NULL,updated_at=clock_timestamp() WHERE task_id=p_task AND attempt=p_attempt;
 RETURN jsonb_build_object('phase','reserved','route',r);
END $$;

CREATE OR REPLACE FUNCTION local_identity.reserve_workspace_narration_submission(p_task_id uuid, p_attempt integer, p_lease_token uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE r local_identity.workspace_narration_requests;t public.tasks;aid uuid;BEGIN
 SELECT * INTO r FROM local_identity.workspace_narration_requests WHERE task_id=p_task_id;
 IF r.request_snapshot->>'selectionVersion' IS DISTINCT FROM '1' THEN RETURN local_identity.reject_unsupported_narration_submission(p_task_id,p_attempt,p_lease_token);END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 PERFORM pg_advisory_xact_lock(hashtextextended(r.workspace_id::text||r.shot_id,0));
 IF NOT local_identity.provider_dispatch_context_current(p_task_id,'speech') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests x JOIN local_identity.workspace_narration_submissions s ON s.task_id=x.task_id JOIN public.tasks other_task ON other_task.id=x.task_id WHERE x.workspace_id=r.workspace_id AND x.shot_id=r.shot_id AND x.task_id<>p_task_id AND s.outcome IN ('started','received') AND other_task.status<>'completed'
  AND NOT local_identity.provider_request_not_sent(x.task_id)
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests child
   WHERE child.workspace_id=x.workspace_id AND child.shot_id=x.shot_id AND child.request_snapshot->>'retryOfTaskId'=x.task_id::text)) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions WHERE task_id=p_task_id) THEN RETURN false;END IF;
 SELECT * INTO t FROM public.tasks WHERE id=p_task_id;SELECT account_id INTO aid FROM public.episodes WHERE id=t.episode_id;
 IF r.request_snapshot ? 'batchId' THEN
  UPDATE public.paid_generation_reservations SET request_state='submitting'
   WHERE task_id=t.id AND kind='narration' AND request_state='queued' AND reserved_cents=t.budget_limit_cents;
  IF NOT FOUND THEN RETURN false;END IF;
 ELSE
  INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents) VALUES(t.id,aid,'narration',t.budget_limit_cents);
 END IF;
 INSERT INTO local_identity.workspace_narration_submissions(task_id,attempt,outcome) VALUES(p_task_id,p_attempt,'started') ON CONFLICT DO NOTHING;RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION local_identity.stop_workspace_queued_tasks(p_workspace uuid, p_kind text, p_shot text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE w local_identity.production_workspaces; stopped integer;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned current workspace required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=w.episode_id AND p.script_revision_id=w.script_revision_id
  WHERE e.id=w.episode_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_historical_episode(e.id)
  AND e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id)) THEN RAISE EXCEPTION 'Current writable workspace required' USING ERRCODE='55000';END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('narration','bgm','sfx','shot') OR
  (p_kind IN ('narration','shot') AND (p_shot IS NULL OR length(p_shot)=0)) OR
  (p_kind IN ('bgm','sfx') AND p_shot IS NOT NULL) THEN RAISE EXCEPTION 'Invalid stopped content scope' USING ERRCODE='22023';END IF;
 IF p_kind='shot' AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot) THEN RAISE EXCEPTION 'Shot is still in the current workspace' USING ERRCODE='22023';END IF;
 WITH scoped AS (
  SELECT r.task_id FROM local_identity.workspace_narration_requests r WHERE r.workspace_id=w.id AND r.shot_id=p_shot AND p_kind IN ('narration','shot')
  UNION SELECT r.task_id FROM local_identity.workspace_audio_requests r JOIN local_identity.workspace_audio_preparations p ON p.id=r.preparation_id
   WHERE r.workspace_id=w.id AND (p_kind IN ('bgm','sfx') AND p.kind=p_kind OR p_kind='shot' AND p.shot_id=p_shot)
  UNION SELECT v.task_id FROM local_identity.workspace_visual_candidates v WHERE v.workspace_id=w.id AND p_kind='shot' AND v.shot_id=p_shot
 )
 UPDATE public.tasks t SET status='superseded',invalidated_at=clock_timestamp(),invalidated_reason='当前用途已关闭或删除，不再自动执行。'
 WHERE t.id IN (SELECT task_id FROM scoped) AND t.episode_id=w.episode_id AND t.status='ready' AND t.invalidated_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions s WHERE s.task_id=t.id AND s.outcome IN ('started','received'))
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_visual_submissions s WHERE s.task_id=t.id AND s.outcome IN ('started','received'))
  AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id AND r.request_state<>'queued')
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_publication_holds(w.episode_id) h WHERE h.task_id=t.id)
  AND NOT (coalesce(t.last_result#>'{preflight,checks}','[]'::jsonb) @> '[{"check":"provider_result_unknown"}]'::jsonb);
 GET DIAGNOSTICS stopped=ROW_COUNT;
 IF stopped>0 THEN INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id)
  SELECT e.account_id,e.id,'workspace_queued_content_stopped',jsonb_build_object('workspace_id',w.id,'kind',p_kind,'shot_id',p_shot,'stopped_count',stopped),local_identity.owner_id() FROM public.episodes e WHERE e.id=w.episode_id;END IF;
 RETURN stopped;
END $$;

CREATE OR REPLACE FUNCTION local_identity.provider_dispatch_context_current(p_task uuid, p_kind text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id
  JOIN local_identity.production_workspaces w ON w.episode_id=e.id
  JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=e.id AND p.script_revision_id=w.script_revision_id
  WHERE t.id=p_task AND t.invalidated_at IS NULL AND e.archived_at IS NULL
   AND e.stage<>'production_completed' AND NOT local_identity.is_recycled_episode(e.id)
   AND e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id)
   AND CASE WHEN p_kind='speech' THEN
    t.task_type='generate_narration' AND EXISTS(
     SELECT 1 FROM local_identity.workspace_narration_requests r
     JOIN local_identity.workspace_production_authorizations a ON a.episode_id=r.episode_id
     WHERE r.task_id=t.id AND r.workspace_id=w.id AND a.enabled AND a.authorized_at IS NOT NULL
      AND a.script_revision_id=w.script_revision_id AND a.authorization_hash=r.authorization_hash
      AND CASE WHEN t.input_snapshot ? 'workspace_narration' THEN
       t.input_snapshot#>>'{workspace_narration,version}'='workspace-narration/v2'
       AND t.input_snapshot#>>'{workspace_narration,workspace_id}'=w.id::text
       AND t.input_snapshot#>>'{workspace_narration,shot_id}'=r.shot_id
       AND t.input_snapshot#>>'{workspace_narration,preparation_revision_id}'=p.id::text
       AND r.request_snapshot#>>'{target,preparationRevisionId}'=p.id::text
       AND r.request_snapshot#>>'{target,workspaceId}'=w.id::text
       AND r.request_snapshot#>>'{target,shotId}'=r.shot_id
       AND r.request_snapshot#>>'{target,scriptRevisionId}'=w.script_revision_id::text
      ELSE p.source_format='storyboard/v1'
       AND t.input_snapshot->>'storyboard_review_package_id'=p.source_reference_id::text
      END
      AND CASE WHEN r.request_snapshot ? 'batchId'
       THEN EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=r.shot_id)
       WHEN r.request_snapshot->>'selectionVersion'='1'
       THEN w.project_sha256=r.request_snapshot#>>'{target,projectSha256}'
       ELSE EXISTS(SELECT 1 FROM local_identity.workspace_narrations n WHERE n.workspace_id=w.id AND n.shot_id=r.shot_id AND n.mode='tts' AND n.task_id=t.id AND n.input_fingerprint=r.input_fingerprint AND n.confirmed_fingerprint=r.input_fingerprint) END)
   ELSE p_kind='image' AND t.task_type='generate_static_visual' AND t.provider='openai'
    AND local_identity.workspace_task_preparation_current(t.id,w.id) AND EXISTS(
    SELECT 1 FROM local_identity.workspace_visual_candidates v
    JOIN local_identity.workspace_production_authorizations a ON a.episode_id=v.episode_id
    WHERE v.task_id=t.id AND v.workspace_id=w.id AND a.enabled AND a.authorized_at IS NOT NULL
     AND a.script_revision_id=w.script_revision_id AND a.authorization_hash=v.request_snapshot->>'authorizationHash'
     AND (v.request_snapshot#>>'{target,projectSha256}' IS NULL OR w.project_sha256=v.request_snapshot#>>'{target,projectSha256}')
     AND (NOT(t.input_snapshot ? 'production_preparation') OR v.request_snapshot#>>'{target,workspaceId}'=w.id::text AND v.request_snapshot#>>'{target,preparationRevisionId}'=w.preparation_revision_id::text AND v.request_snapshot#>>'{target,shotId}'=v.shot_id AND v.request_snapshot#>>'{target,scriptRevisionId}'=w.script_revision_id::text)) END
 )
$$;
