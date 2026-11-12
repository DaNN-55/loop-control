CREATE TABLE local_identity.owner_preferences(
 owner_id uuid PRIMARY KEY REFERENCES local_identity.owners(id) ON DELETE RESTRICT,
 preferences jsonb NOT NULL CHECK(jsonb_typeof(preferences)='object'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON local_identity.owner_preferences FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
ALTER TABLE local_identity.owner_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_preferences_self ON local_identity.owner_preferences TO loop_app
 USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
GRANT SELECT,INSERT,UPDATE ON local_identity.owner_preferences TO loop_app;

-- The desktop consumer still reserves and finishes each event through the existing ledger.
CREATE FUNCTION local_identity.native_notification_enabled(p_event uuid,p_category text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE enabled boolean;
BEGIN
 IF session_user<>'loop_app' OR p_category NOT IN('review','failure','delivery') THEN RAISE EXCEPTION 'Invalid notification preference request' USING ERRCODE='42501'; END IF;
 SELECT bool_or(coalesce((p.preferences#>>ARRAY['notifications',p_category])::boolean,true)) INTO enabled
 FROM public.audit_events a JOIN public.account_memberships m ON m.account_id=a.account_id AND m.role='owner'
 LEFT JOIN local_identity.owner_preferences p ON p.owner_id=m.user_id
 WHERE a.id=p_event AND (a.event_type<>'connection_verification_failed' OR m.user_id=a.actor_id);
 RETURN coalesce(enabled,false);
END $$;
REVOKE ALL ON FUNCTION local_identity.native_notification_enabled(uuid,text) FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.native_notification_enabled(uuid,text) TO loop_app;

CREATE FUNCTION local_identity.owner_notification_events()
RETURNS TABLE(id uuid,event_type text,episode_id uuid,created_at timestamptz,payload jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT a.id,a.event_type,a.episode_id,a.created_at,a.payload FROM public.audit_events a
 WHERE local_identity.owner_id() IS NOT NULL
 AND a.event_type IN('publish_package_verified','connection_verification_failed')
 AND a.created_at>clock_timestamp()-interval '7 days'
 AND NOT EXISTS(SELECT 1 FROM local_identity.historical_audit_events h WHERE h.event_id=a.id)
 AND CASE WHEN a.event_type='connection_verification_failed' THEN a.actor_id=local_identity.owner_id()
 ELSE EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=a.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner') END
 ORDER BY a.created_at DESC,a.id DESC LIMIT 20
$$;
REVOKE ALL ON FUNCTION local_identity.owner_notification_events() FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.owner_notification_events() TO loop_app;

CREATE OR REPLACE FUNCTION loop_internal.enqueue_notification_event() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new.event_type IN('stage_transition','pre_render_review_package_created','a_roll_task_blocked','b_roll_task_blocked','narration_task_blocked','soundtrack_task_blocked','publish_package_verified','connection_verification_failed') THEN
  INSERT INTO public.notification_delivery_events(event_id) VALUES(new.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN new;
END $$;

-- Probe evidence is the source of truth; rebinds and simulated checks do not notify.
-- Global connections use the Owner's first owned account as their audit scope.
CREATE FUNCTION local_identity.audit_failed_connection_probe() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE connection public.external_connections; scope_account uuid;
BEGIN
 IF new.mode<>'live' OR new.outcome NOT IN('invalid','retryable') THEN RETURN new; END IF;
 SELECT c.* INTO connection FROM public.external_connections c WHERE c.current_version_id=new.version_id AND c.created_by=new.owner_id;
 IF NOT FOUND THEN RETURN new; END IF;
 SELECT m.account_id INTO scope_account FROM public.account_memberships m WHERE m.user_id=new.owner_id AND m.role='owner' ORDER BY m.account_id LIMIT 1;
 IF scope_account IS NOT NULL THEN
  INSERT INTO public.audit_events(account_id,event_type,payload,actor_id) VALUES(scope_account,'connection_verification_failed',jsonb_build_object('connection_id',connection.id,'name',connection.name,'probe_id',new.id,'outcome',new.outcome),new.owner_id);
 END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION local_identity.audit_failed_connection_probe() FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
CREATE TRIGGER owner_connection_failure_notification AFTER INSERT ON local_identity.connection_probe_evidence
 FOR EACH ROW EXECUTE FUNCTION local_identity.audit_failed_connection_probe();
