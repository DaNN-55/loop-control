-- Owner-confirmed queued reservations hold budget before any dispatch.
-- Read the fenced result and retained provider ID together. Older Workers
-- recorded failed polls as rejected even when the original request was accepted.
CREATE FUNCTION local_identity.workspace_video_terminal_failure(p_task uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.tasks t
  JOIN public.paid_generation_reservations r ON r.task_id=t.id AND r.kind='video' AND r.provider_task_id IS NOT NULL
  JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id
  WHERE t.id=p_task AND t.status='failed'
   AND (s.outcome='rejected' OR s.outcome='received' AND t.last_result#>>'{blockers,0,code}'='VIDEO_PROVIDER_TERMINAL_FAILURE')
   AND NOT EXISTS(SELECT 1 FROM local_identity.native_output_publications h WHERE h.task_id=t.id)
 )
$$;
REVOKE ALL ON FUNCTION local_identity.workspace_video_terminal_failure(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION local_identity.allow_provider_preparation_recovery(p_task uuid, p_attempt integer, p_lease uuid, p_kind text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE t public.tasks;used integer;
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO t FROM public.tasks WHERE id=p_task FOR UPDATE;
 IF p_kind NOT IN ('speech','image') OR NOT local_identity.provider_dispatch_context_current(p_task,p_kind) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts f WHERE f.task_id=p_task AND (f.phase NOT IN ('preparing','reserved') OR f.kind<>p_kind OR f.request_hash<>md5(t.input_snapshot::text))) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts WHERE task_id=p_task AND attempt=p_attempt AND lease_token<>p_lease) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts WHERE task_id=p_task AND phase='reserved')
  AND (EXISTS(SELECT 1 FROM public.paid_generation_reservations WHERE task_id=p_task AND request_state<>'queued')
   OR EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions WHERE task_id=p_task)
   OR EXISTS(SELECT 1 FROM local_identity.workspace_visual_submissions WHERE task_id=p_task)) THEN RETURN false;END IF;
 SELECT coalesce(sum(local_recoveries),0) INTO used FROM local_identity.provider_dispatch_facts WHERE task_id=p_task;
 IF used>=2 THEN RETURN false;END IF;
 INSERT INTO local_identity.provider_dispatch_facts(task_id,attempt,lease_token,kind,request_hash,phase)
 VALUES(p_task,p_attempt,p_lease,p_kind,md5(t.input_snapshot::text),'preparing') ON CONFLICT DO NOTHING;
 UPDATE local_identity.provider_dispatch_facts SET local_recoveries=local_recoveries+1,last_reason='temporary_local_failure',updated_at=clock_timestamp() WHERE task_id=p_task AND attempt=p_attempt;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION local_identity.episode_deletion_submission_unknown(p_episode uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE f record;rejected uuid[]:='{}';unknowns uuid[]:='{}';table_rejected uuid[];table_unknown uuid[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=p_episode AND m.user_id=local_identity.owner_id() AND m.role='owner') THEN RAISE EXCEPTION 'Owned Episode required' USING ERRCODE='42501';END IF;
 -- Reuse the account migration submission protocols, scoped to this Episode.
 FOR f IN SELECT table_name FROM information_schema.columns WHERE table_schema='local_identity' AND column_name='outcome' AND table_name LIKE '%submissions' LOOP
  EXECUTE format('SELECT coalesce(array_agg(DISTINCT s.task_id) FILTER(WHERE s.outcome=''rejected''),''{}''::uuid[]),coalesce(array_agg(DISTINCT s.task_id) FILTER(WHERE s.outcome IN (''started'',''received'')),''{}''::uuid[]) FROM local_identity.%I s JOIN public.tasks t ON t.id=s.task_id WHERE t.episode_id=$1 AND t.status<>''completed''',f.table_name) INTO table_rejected,table_unknown USING p_episode;
  rejected:=rejected||table_rejected;unknowns:=unknowns||table_unknown;
 END LOOP;
 RETURN EXISTS(SELECT 1 FROM public.tasks t LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id WHERE t.episode_id=p_episode AND t.status<>'completed' AND (t.id=ANY(unknowns) OR r.request_state NOT IN ('queued','succeeded') AND NOT t.id=ANY(rejected)) AND NOT local_identity.workspace_video_terminal_failure(t.id));
END $_$;

CREATE OR REPLACE FUNCTION local_identity.account_directory_busy(p_account uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE result jsonb;f record;rejected uuid[]:='{}';unknowns uuid[]:='{}';table_rejected uuid[];table_unknown uuid[];BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.account_memberships WHERE account_id=p_account AND user_id=local_identity.owner_id() AND role='owner') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 -- A definite rejection may leave the paid ledger at submitting. Inspect all
 -- submission protocols first; any started/received evidence outweighs rejection.
 FOR f IN SELECT c.table_name FROM information_schema.columns c WHERE c.table_schema='local_identity' AND c.column_name='outcome' AND c.table_name LIKE '%submissions' LOOP
  EXECUTE format('SELECT coalesce(array_agg(DISTINCT s.task_id) FILTER(WHERE s.outcome=''rejected''),''{}''::uuid[]),coalesce(array_agg(DISTINCT s.task_id) FILTER(WHERE s.outcome IN (''started'',''received'')),''{}''::uuid[]) FROM local_identity.%I s JOIN public.tasks t ON t.id=s.task_id JOIN public.episodes e ON e.id=t.episode_id WHERE e.account_id=$1 AND t.status<>''completed''',f.table_name) INTO table_rejected,table_unknown USING p_account;
  rejected:=rejected||table_rejected;unknowns:=unknowns||table_unknown;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('taskId',t.id,'reason',CASE WHEN t.status IN ('ready','running') AND (t.invalidated_at IS NULL OR t.status='running') THEN '存在待执行或运行中的任务，请完成或明确处理后重新盘点。' ELSE '供应商提交结果尚未确认，请先恢复或核对已有请求。' END)),'[]') INTO result
 FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id
 WHERE e.account_id=p_account AND ((t.status IN ('ready','running') AND (t.invalidated_at IS NULL OR t.status='running')) OR (t.status<>'completed' AND (t.id=ANY(unknowns) OR (r.request_state NOT IN ('queued','succeeded') AND NOT t.id=ANY(rejected))) AND NOT local_identity.workspace_video_terminal_failure(t.id)));
 IF EXISTS(SELECT 1 FROM public.asset_locks l JOIN public.episodes e ON e.id=l.episode_id WHERE e.account_id=p_account AND l.expires_at>clock_timestamp()) THEN result:=result||jsonb_build_array(jsonb_build_object('reason','存在未释放的生产文件租约。'));END IF;
 IF EXISTS(SELECT 1 FROM local_identity.episode_creation_intents i WHERE i.account_id=p_account AND i.result IS NULL) THEN result:=result||jsonb_build_array(jsonb_build_object('reason','存在未完成的生产单目录创建，请先恢复原操作。'));END IF;
 RETURN result;
END $_$;

-- Only a freshly confirmed batch retry can follow a definitive provider task failure.
-- Keep the previous receipt and cost reservation for audit and recovery.

CREATE OR REPLACE FUNCTION local_identity.queue_workspace_visual(p_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v local_identity.workspace_visual_candidates;w local_identity.production_workspaces;tid uuid;aid uuid;cfg jsonb;
BEGIN
SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned video request required' USING ERRCODE='42501';END IF;
 IF v.task_id IS NOT NULL THEN RETURN v.task_id;END IF;
 IF v.request_snapshot->>'authorizationHash' IS DISTINCT FROM local_identity.current_workspace_call_hash(v.workspace_id) OR local_identity.current_workspace_call_hash(v.workspace_id) IS NULL THEN RAISE EXCEPTION 'Current call confirmation required' USING ERRCODE='42501';END IF;
 IF v.request_snapshot->>'selectionVersion'='1' THEN
 cfg:=v.request_snapshot->'execution';
 IF v.request_snapshot#>>'{selection,capability}'<>'video' OR cfg->>'credential_ref' IS DISTINCT FROM v.request_snapshot#>>'{selection,connectionVersionId}' OR NOT EXISTS(SELECT 1 FROM public.external_connection_versions cv JOIN public.external_connections cn ON cn.id=cv.connection_id AND cn.created_by=local_identity.owner_id() AND cn.current_version_id=cv.id JOIN local_identity.connection_bindings cb ON cb.version_id=cv.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=cv.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE cv.id::text=cfg->>'credential_ref' AND cv.provider=cfg#>>'{executor,provider}' AND cv.adapter=cfg#>>'{executor,adapter}' AND cv.revoked_at IS NULL AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence p WHERE p.version_id=cv.id AND p.owner_id=cn.created_by AND p.mode='live' AND p.outcome='verified')) THEN RAISE EXCEPTION 'Validated owned video connection required';END IF;
 SELECT account_id INTO aid FROM public.episodes WHERE id=v.episode_id;
 END IF;
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned visual request required' USING ERRCODE='42501'; END IF;
 w:=local_identity.lock_current_production_workspace(v.workspace_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(v.workspace_id::text||v.target_item_id,0));
 IF v.task_id IS NOT NULL THEN RETURN v.task_id; END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates other JOIN public.tasks t ON t.id=other.task_id LEFT JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id WHERE other.workspace_id=v.workspace_id AND other.target_item_id=v.target_item_id AND t.task_type IN ('generate_shot_video','search_shot_video','preview_shot_video','generate_a_roll', 'generate_b_roll') AND (t.status='running' OR (t.status='ready' AND (t.invalidated_at IS NULL OR EXISTS(SELECT 1 FROM public.paid_generation_reservations prior_reservation WHERE prior_reservation.task_id=t.id AND prior_reservation.request_state<>'queued') OR EXISTS(SELECT 1 FROM local_identity.native_output_publications prior_publication WHERE prior_publication.task_id=t.id))) OR ((s.outcome IN ('started','received') AND t.status<>'completed' OR local_identity.workspace_video_terminal_failure(t.id))
  AND NOT ((v.request_snapshot ? 'batchRetryOfTaskId' OR EXISTS(
   SELECT 1 FROM local_identity.workspace_visual_candidates child WHERE child.workspace_id=v.workspace_id
    AND child.target_item_id=v.target_item_id AND child.task_id IS NOT NULL
    AND child.request_snapshot->>'batchRetryOfTaskId'=t.id::text
  )) AND local_identity.workspace_video_terminal_failure(t.id))))) THEN RAISE EXCEPTION 'Previous visual submission pending or unknown; reconcile or resume its saved Provider ID' USING ERRCODE='55000'; END IF;
 UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=v.episode_id;
 IF v.request_snapshot#>>'{execution,executor,provider}'='bailian' THEN
 tid:=local_identity.request_workspace_wan_visual(v.episode_id,w.preparation_revision_id,v.shot_id,(v.request_snapshot->>'firstFrameId')::uuid,v.request_snapshot->>'prompt',(v.request_snapshot->>'providerDurationSeconds')::integer,v.id);
 ELSE
 tid:=local_identity.request_workspace_official_visual(v.episode_id,w.preparation_revision_id,v.shot_id,(v.request_snapshot->>'firstFrameId')::uuid,v.request_snapshot->>'prompt',(v.request_snapshot->>'providerDurationSeconds')::integer,v.id,(v.request_snapshot->>'reservationCents')::integer);
 END IF;
 UPDATE local_identity.workspace_visual_candidates SET task_id=tid WHERE id=v.id AND task_id IS NULL;
 IF v.request_snapshot ? 'videoSettings' OR v.request_snapshot ? 'firstFrameComposition' THEN
 UPDATE public.tasks SET input_snapshot=jsonb_set(input_snapshot,'{media,wan_video}',input_snapshot#>'{media,wan_video}'||jsonb_build_object('settings',v.request_snapshot->'videoSettings','composition',v.request_snapshot->'firstFrameComposition')) WHERE id=tid AND status='ready';
 END IF;

 IF v.request_snapshot->>'selectionVersion'='1' THEN
 UPDATE public.tasks SET input_snapshot=input_snapshot||jsonb_build_object('production_selection',v.request_snapshot->'selection','production_context',v.request_snapshot->'context','workspace_target',v.request_snapshot->'target','cost_basis',v.request_snapshot->'costBasis','configuration_hash',v.input_fingerprint),budget_limit_cents=(v.request_snapshot->>'reservationCents')::integer WHERE id=tid;
 UPDATE public.tasks SET input_snapshot=jsonb_set(jsonb_set(input_snapshot,'{media,wan_video,prompt}',v.request_snapshot->'actualPrompt'),'{budget,limit_cents}',v.request_snapshot->'reservationCents') WHERE id=tid;
 END IF;
 UPDATE public.tasks SET input_snapshot=local_identity.shot_video_snapshot(input_snapshot)
 WHERE id=tid AND task_type IN ('generate_shot_video','search_shot_video','preview_shot_video') AND status='ready';
 RETURN tid;
END;
$$;

CREATE OR REPLACE FUNCTION local_identity.reserve_workspace_visual_generation(p_task uuid, p_attempt integer, p_lease uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v local_identity.workspace_visual_candidates; w local_identity.production_workspaces; reservation jsonb; BEGIN
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE task_id=p_task;
 IF NOT FOUND THEN RETURN local_identity.reserve_wan_generation(p_task,p_attempt,p_lease); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v.workspace_id::text||v.target_item_id,0));
 -- A saved Provider task is polled using its frozen request even after an edit.
 IF NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations WHERE task_id=p_task AND provider_task_id IS NOT NULL) THEN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=v.workspace_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=e.id AND p.script_revision_id=w.script_revision_id JOIN local_identity.workspace_production_authorizations a ON a.episode_id=e.id WHERE e.id=v.episode_id AND e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id) AND local_identity.workspace_task_preparation_current(p_task,w.id) AND e.archived_at IS NULL AND e.stage<>'production_completed' AND a.enabled AND a.authorized_at IS NOT NULL AND a.authorization_hash=v.request_snapshot->>'authorizationHash' AND a.script_revision_id=w.script_revision_id) THEN RAISE EXCEPTION 'Visual input or production authorization changed'; END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates other JOIN public.tasks t ON t.id=other.task_id JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id WHERE other.workspace_id=v.workspace_id AND other.target_item_id=v.target_item_id AND t.task_type IN ('generate_shot_video','search_shot_video','preview_shot_video','generate_a_roll', 'generate_b_roll') AND other.id<>v.id AND s.outcome IN ('started','received') AND t.status<>'completed'
  AND NOT ((v.request_snapshot ? 'batchRetryOfTaskId' OR EXISTS(
   SELECT 1 FROM local_identity.workspace_visual_candidates child WHERE child.workspace_id=v.workspace_id
    AND child.target_item_id=v.target_item_id AND child.task_id IS NOT NULL
    AND child.request_snapshot->>'batchRetryOfTaskId'=t.id::text
  )) AND local_identity.workspace_video_terminal_failure(t.id))) THEN RAISE EXCEPTION 'Previous visual submission outcome unknown'; END IF;
 END IF;
 reservation:=local_identity.reserve_wan_generation(p_task,p_attempt,p_lease);
 IF coalesce((reservation->>'new')::boolean,false) THEN INSERT INTO local_identity.workspace_visual_submissions(task_id,outcome) VALUES(p_task,'started') ON CONFLICT DO NOTHING; END IF;
 RETURN reservation;
END $$;

CREATE OR REPLACE FUNCTION local_identity.retry_workspace_visual(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v local_identity.workspace_visual_candidates; t public.tasks; BEGIN
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(v.episode_id) THEN RAISE EXCEPTION 'Owned visual request required' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.tasks WHERE id=v.task_id FOR UPDATE;
 IF NOT FOUND OR t.status NOT IN ('failed','blocked') OR t.invalidated_at IS NOT NULL OR local_identity.workspace_video_terminal_failure(t.id) OR NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r JOIN local_identity.workspace_visual_submissions s ON s.task_id=r.task_id WHERE r.task_id=t.id AND r.provider_task_id IS NOT NULL AND s.outcome<>'rejected') THEN RAISE EXCEPTION 'Only a saved Provider ID may resume; unknown submission cannot be repeated' USING ERRCODE='55000'; END IF;
 UPDATE public.tasks SET status='ready',max_attempts=attempt+1,claimed_at=null,completed_at=null WHERE id=t.id;
END $$;

CREATE OR REPLACE FUNCTION local_identity.queue_storyboard_batch_video(p_candidate uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v local_identity.workspace_visual_candidates; tid uuid;
BEGIN
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_candidate FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(
  SELECT 1 FROM local_identity.workspace_call_confirmations child
  JOIN local_identity.workspace_call_confirmations parent ON parent.id::text=child.payload->>'batchId'
   AND parent.owner_id=child.owner_id AND parent.workspace_id=child.workspace_id
   AND parent.episode_id=child.episode_id AND parent.script_revision_id=child.script_revision_id
  WHERE child.authorization_hash=local_identity.current_workspace_call_hash(v.workspace_id)
   AND child.command='requestWorkspaceVisualCandidate' AND child.workspace_id=v.workspace_id
   AND child.payload->>'targetItemId'=v.target_item_id AND child.payload->'reservationCents'=v.request_snapshot->'reservationCents'
   AND child.payload->'selection'=v.request_snapshot->'selection'
   AND parent.id::text=v.request_snapshot->>'batchId' AND parent.command='confirmStoryboardBatch'
   AND parent.payload#>>'{request,kind}'='video' AND (parent.payload->'frozenHashes') ? v.shot_id
   AND parent.consumed_at IS NULL AND parent.expires_at>clock_timestamp()
   AND (NOT v.request_snapshot ? 'batchRetryOfTaskId' OR (
    v.request_snapshot->>'batchRetryOfTaskId'=child.payload->>'batchRetryOfTaskId'
    AND parent.payload#>'{request,retryFailures}' @> jsonb_build_array(jsonb_build_object('shotId',v.shot_id,'taskId',v.request_snapshot->>'batchRetryOfTaskId'))
   ))
 ) THEN RAISE EXCEPTION 'Current batch video approval required' USING ERRCODE='42501'; END IF;
 tid:=local_identity.queue_workspace_visual(p_candidate);
 INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents,request_state)
 SELECT t.id,e.account_id,'video',t.budget_limit_cents,'queued'
 FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id WHERE t.id=tid;
 RETURN tid;
END $$;
