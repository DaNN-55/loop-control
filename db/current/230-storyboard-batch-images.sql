-- Freeze the per-shot budget during batch confirmation. Only a leased Worker may dispatch it.
CREATE FUNCTION local_identity.queue_storyboard_batch_image(p_candidate uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v local_identity.workspace_visual_candidates; tid uuid;
BEGIN
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE id=p_candidate FOR UPDATE;
 IF NOT FOUND OR v.request_snapshot->>'kind' IS DISTINCT FROM 'image' OR NOT EXISTS(
  SELECT 1 FROM local_identity.workspace_call_confirmations child
  JOIN local_identity.workspace_call_confirmations parent ON parent.id::text=child.payload->>'batchId'
   AND parent.owner_id=child.owner_id AND parent.workspace_id=child.workspace_id
   AND parent.episode_id=child.episode_id AND parent.script_revision_id=child.script_revision_id
  WHERE child.authorization_hash=local_identity.current_workspace_call_hash(v.workspace_id)
   AND child.command='requestWorkspaceImageCandidates'
   AND child.payload->>'targetItemId'=v.target_item_id AND child.payload->'reservationCents'=v.request_snapshot->'reservationCents'
   AND child.payload->'selection'=v.request_snapshot->'selection'
   AND parent.id::text=v.request_snapshot->>'batchId' AND parent.command='confirmStoryboardBatch'
   AND parent.payload#>>'{request,kind}'='image' AND (parent.payload->'frozenHashes') ? v.shot_id
   AND (parent.payload#>'{request,retryFailures}' IS NULL OR
    parent.payload#>'{request,retryFailures}' @> jsonb_build_array(jsonb_build_object('shotId',v.shot_id,'taskId',child.payload->>'batchRetryOfTaskId')))
   AND parent.consumed_at IS NULL AND parent.expires_at>clock_timestamp()
 ) THEN RAISE EXCEPTION 'Current batch image approval required' USING ERRCODE='42501'; END IF;
 tid:=local_identity.queue_workspace_images(p_candidate);
 INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents,request_state)
 SELECT t.id,e.account_id,'image',t.budget_limit_cents,'queued'
 FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id WHERE t.id=tid;
 RETURN tid;
END $$;
REVOKE ALL ON FUNCTION local_identity.queue_storyboard_batch_image(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.queue_storyboard_batch_image(uuid) TO loop_owner;

CREATE OR REPLACE FUNCTION local_identity.reserve_workspace_images(p_task uuid, p_attempt integer, p_lease uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE t public.tasks;v local_identity.workspace_visual_candidates;aid uuid;BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker required';END IF;
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 SELECT * INTO t FROM public.tasks WHERE id=p_task AND task_type='generate_static_visual' AND provider='openai' AND status='running' FOR UPDATE;
 SELECT * INTO v FROM local_identity.workspace_visual_candidates WHERE task_id=t.id;
 IF t.id IS NULL OR v.id IS NULL OR NOT local_identity.provider_dispatch_context_current(t.id,'image') THEN RAISE EXCEPTION 'Current image request required';END IF;
 SELECT account_id INTO aid FROM public.episodes WHERE id=t.episode_id;
 UPDATE public.paid_generation_reservations SET request_state='submitting'
  WHERE task_id=t.id AND request_state='queued' AND kind='image'
   AND account_id=aid AND reserved_cents=t.budget_limit_cents AND v.request_snapshot ? 'batchId';
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.paid_generation_reservations WHERE task_id=t.id) THEN
   RAISE EXCEPTION 'Previous image submission outcome unknown; do not resubmit';
  END IF;
  INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents) VALUES(t.id,aid,'image',t.budget_limit_cents);
 END IF;
 INSERT INTO local_identity.workspace_visual_submissions(task_id,outcome) VALUES(t.id,'started');
END $$;
