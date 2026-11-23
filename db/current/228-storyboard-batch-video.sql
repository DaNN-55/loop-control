-- Keep video task registration inside the existing candidate queue, and reserve
-- each approved amount in the same transaction as the batch receipt.
CREATE FUNCTION local_identity.queue_storyboard_batch_video(p_candidate uuid) RETURNS uuid
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
 ) THEN RAISE EXCEPTION 'Current batch video approval required' USING ERRCODE='42501'; END IF;
 tid:=local_identity.queue_workspace_visual(p_candidate);
 INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents,request_state)
 SELECT t.id,e.account_id,'video',t.budget_limit_cents,'queued'
 FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id WHERE t.id=tid;
 RETURN tid;
END $$;

REVOKE ALL ON FUNCTION local_identity.queue_storyboard_batch_video(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.queue_storyboard_batch_video(uuid) TO loop_owner;

-- The existing fenced Worker reservation still decides whether this is the
-- first possible dispatch. The Owner's queued reservation has sent nothing.
CREATE OR REPLACE FUNCTION local_identity.reserve_wan_generation(p_task_id uuid, p_attempt integer, p_lease_token uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare t public.tasks; aid uuid; r public.paid_generation_reservations; amount integer; k text;
begin
 PERFORM local_identity.assert_current_worker_execution(p_task_id,p_attempt,p_lease_token);
 if local_identity.actor_role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501'; end if;
 perform public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
 if not exists(select 1 from public.tasks managed where managed.id=p_task_id and managed.provider IN ('bailian','volcengine','minimax','kling') and local_identity.input_task_allowed(managed.episode_id,managed.task_type)) then raise exception 'Managed Wan task required' using errcode='42501'; end if;
 select * into t from public.tasks where id=p_task_id and status='running' and attempt=p_attempt+1 for update;
 if not found then raise exception 'Current running task attempt required'; end if;
 select account_id into aid from public.episodes where id=t.episode_id;
 select * into r from public.paid_generation_reservations where task_id=t.id FOR UPDATE;
 if found then
  if r.request_state='queued' AND r.kind='video' AND r.account_id=aid AND r.reserved_cents=t.budget_limit_cents
   AND EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates v WHERE v.task_id=t.id AND v.request_snapshot ? 'batchId') THEN
   UPDATE public.paid_generation_reservations SET request_state='submitting' WHERE task_id=t.id AND request_state='queued' RETURNING * INTO r;
   IF FOUND THEN RETURN to_jsonb(r)||jsonb_build_object('new',true); END IF;
  END IF;
  return to_jsonb(r)||jsonb_build_object('new',false);
 end if;
 if t.provider IN ('bailian','volcengine','minimax','kling') then
  k:='video'; amount:=CASE WHEN t.provider='bailian' AND t.input_snapshot#>>'{production_selection,provider}' IS DISTINCT FROM 'bailian' THEN (t.input_snapshot#>>'{media,wan_video,duration_seconds}')::integer*15 ELSE t.budget_limit_cents END;
  if amount is null or amount<1 or amount>100000 then raise exception 'Invalid frozen video duration'; end if;
 elsif t.provider in ('volcengine_tts') and t.task_type='generate_narration' then
  k:='narration'; amount:=greatest(1,char_length(t.input_snapshot#>>'{media,narration,text}'));
  -- Conservatively reserve 0.01 CNY per character, above the approved public
  -- standard-voice rate. This is a reservation, not a claim about actual billing.
 else raise exception 'Unsupported paid task'; end if;
 insert into public.paid_generation_reservations(task_id,account_id,kind,reserved_cents) values(t.id,aid,k,amount) returning * into r;
 return to_jsonb(r)||jsonb_build_object('new',true);
end $$;
