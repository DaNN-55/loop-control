-- Native service state; no browser/Worker table or event-consumer privileges.
CREATE TABLE local_identity.automation_plans(
 kind text PRIMARY KEY CHECK(kind IN ('health','backup')),
 timezone text NOT NULL DEFAULT 'Asia/Shanghai' CHECK(timezone='Asia/Shanghai'),
 next_due_at timestamptz NOT NULL
);
CREATE TABLE local_identity.automation_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL REFERENCES local_identity.automation_plans(kind),
 due_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','running','completed','failed')),
 available_at timestamptz NOT NULL,
 attempt integer NOT NULL DEFAULT 0 CHECK(attempt>=0),
 token uuid, lease_until timestamptz,
 completed_at timestamptz, passed boolean, detail text CHECK(length(detail)<=1000),
 UNIQUE(kind,due_at),
 CHECK((status='running')=(token IS NOT NULL AND lease_until IS NOT NULL))
);
REVOKE ALL ON local_identity.automation_plans,local_identity.automation_jobs FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT,INSERT,UPDATE ON local_identity.automation_plans,local_identity.automation_jobs TO loop_app;
-- Reuse the T09 transactional enqueue + durable reservation ledger unchanged.
CREATE FUNCTION local_identity.initialize_native_notifications() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF session_user<>'loop_app' THEN RAISE EXCEPTION 'Internal service only' USING ERRCODE='42501'; END IF;
 PERFORM public.initialize_notification_delivery();
END $$;
CREATE FUNCTION local_identity.claim_native_notification() RETURNS TABLE(id uuid,created_at timestamptz,event_type text,payload jsonb,delivery_token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF session_user<>'loop_app' THEN RAISE EXCEPTION 'Internal service only' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM public.claim_notification_event();
END $$;
CREATE FUNCTION local_identity.finish_native_notification(p_id uuid,p_token uuid,p_outcome text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF session_user<>'loop_app' THEN RAISE EXCEPTION 'Internal service only' USING ERRCODE='42501'; END IF;
 RETURN public.finish_notification_delivery(p_id,p_token,p_outcome);
END $$;
CREATE FUNCTION local_identity.unresolved_native_notifications() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF session_user<>'loop_app' THEN RAISE EXCEPTION 'Internal service only' USING ERRCODE='42501'; END IF;
 RETURN (SELECT count(*) FROM public.notification_delivery_events WHERE outcome IN ('reserved','uncertain'));
END $$;
REVOKE ALL ON FUNCTION local_identity.initialize_native_notifications(),local_identity.claim_native_notification(),local_identity.finish_native_notification(uuid,uuid,text),local_identity.unresolved_native_notifications() FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.initialize_native_notifications(),local_identity.claim_native_notification(),local_identity.finish_native_notification(uuid,uuid,text),local_identity.unresolved_native_notifications() TO loop_app;
