-- Final failed tasks need the same durable delivery path as existing media blockers.
CREATE FUNCTION local_identity.audit_production_task_failure() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new.status='failed' AND new.invalidated_at IS NULL AND
    old.status IS DISTINCT FROM new.status THEN
  INSERT INTO public.audit_events(account_id,episode_id,event_type,payload)
  SELECT e.account_id,e.id,'production_task_failed',jsonb_build_object('task_id',new.id,'task_type',new.task_type)
  FROM public.episodes e WHERE e.id=new.episode_id AND e.archived_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM local_identity.historical_tasks h WHERE h.task_id=new.id);
 END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION local_identity.audit_production_task_failure() FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
CREATE TRIGGER owner_production_failure_notification AFTER UPDATE OF status ON public.tasks
 FOR EACH ROW EXECUTE FUNCTION local_identity.audit_production_task_failure();

CREATE OR REPLACE FUNCTION loop_internal.enqueue_notification_event() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new.event_type IN('stage_transition','pre_render_review_package_created','a_roll_task_blocked','b_roll_task_blocked','narration_task_blocked','soundtrack_task_blocked','publish_package_verified','connection_verification_failed','production_task_failed') THEN
  INSERT INTO public.notification_delivery_events(event_id) VALUES(new.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN new;
END $$;

CREATE OR REPLACE FUNCTION local_identity.owner_notification_events()
RETURNS TABLE(id uuid,event_type text,episode_id uuid,created_at timestamptz,payload jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT a.id,a.event_type,a.episode_id,a.created_at,a.payload FROM public.audit_events a
 WHERE local_identity.owner_id() IS NOT NULL
 AND a.event_type IN('publish_package_verified','connection_verification_failed','production_task_failed')
 AND a.created_at>clock_timestamp()-interval '7 days'
 AND NOT EXISTS(SELECT 1 FROM local_identity.historical_audit_events h WHERE h.event_id=a.id)
 AND CASE WHEN a.event_type='connection_verification_failed' THEN a.actor_id=local_identity.owner_id()
 ELSE EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=a.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner') END
 ORDER BY a.created_at DESC,a.id DESC LIMIT 20
$$;
