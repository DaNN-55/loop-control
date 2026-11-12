ALTER TABLE local_identity.workspace_visual_submissions
 ADD COLUMN video_phase text CHECK (video_phase IN ('queued','processing','saving'));

CREATE FUNCTION local_identity.record_workspace_video_phase(p_task uuid,p_attempt integer,p_lease uuid,p_phase text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.refresh_worker_task_lease(p_task,p_attempt,p_lease);
 IF p_phase IS NULL OR p_phase NOT IN ('queued','processing','saving') THEN
  RAISE EXCEPTION 'Invalid video phase';
 END IF;
 UPDATE local_identity.workspace_visual_submissions s SET video_phase=p_phase
 WHERE s.task_id=p_task AND s.outcome='received' AND s.video_phase IS DISTINCT FROM p_phase
  AND EXISTS(SELECT 1 FROM public.paid_generation_reservations r
             WHERE r.task_id=s.task_id AND r.kind='video' AND r.provider_task_id IS NOT NULL);
END $$;

REVOKE ALL ON FUNCTION local_identity.record_workspace_video_phase(uuid,integer,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.record_workspace_video_phase(uuid,integer,uuid,text) TO loop_worker;
