-- Preserve the actual stopped status in the existing retry audit.
CREATE OR REPLACE FUNCTION local_identity.retry_owned_final_render(p_episode_id uuid, p_reason text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE e public.episodes; t public.tasks; previous_status text;
BEGIN
 IF NOT local_identity.owned_delivery_episode(p_episode_id) OR btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Owned delivery Episode and reason required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode_id;
 SELECT task.* INTO t FROM public.tasks task JOIN public.review_packages p ON p.id::text=task.input_snapshot#>>'{final_render,source_review_package_id}' AND p.episode_id=task.episode_id AND p.stage='qc_review' AND p.invalidated_at IS NULL JOIN public.approvals a ON a.review_package_id=p.id AND a.episode_id=p_episode_id AND a.stage='qc_passed' AND a.decision='approved' JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=a.actor_id AND m.role='owner' WHERE task.episode_id=p_episode_id AND task.task_type='generate_final_render' AND task.invalidated_at IS NULL ORDER BY task.created_at DESC LIMIT 1 FOR UPDATE OF task;
 IF NOT FOUND OR e.stage NOT IN ('qc_passed','render_ready') OR t.status NOT IN ('failed','blocked') OR EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode_id AND task_type IN ('generate_review_render','generate_final_render') AND status IN ('ready','running') AND invalidated_at IS NULL) THEN RAISE EXCEPTION 'Current stopped final render required' USING ERRCODE='55000'; END IF;
 previous_status:=t.status;
 IF t.status='failed' AND e.stage='qc_passed' THEN RETURN public.retry_failed_final_render(p_episode_id,p_reason); END IF;
 UPDATE public.tasks SET status='ready',max_attempts=attempt+1,claimed_at=NULL,completed_at=NULL WHERE id=t.id RETURNING * INTO t;
 UPDATE public.episodes SET stage='qc_passed',updated_at=now() WHERE id=p_episode_id;
 IF e.stage<>'qc_passed' THEN INSERT INTO public.state_transitions(episode_id,from_stage,to_stage,reason,actor_id) VALUES(p_episode_id,e.stage,'qc_passed',btrim(p_reason),local_identity.owner_id()); END IF;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,p_episode_id,'final_render_retry_requested',jsonb_build_object('task_id',t.id,'attempt',t.attempt,'reason',btrim(p_reason),'previous_status',previous_status),local_identity.owner_id());
 RETURN t;
END $function$;
