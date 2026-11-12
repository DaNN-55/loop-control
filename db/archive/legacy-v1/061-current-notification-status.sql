-- Imported delivery outcomes remain immutable evidence, not current alerts.
-- Match the historical exclusion already used by claim_notification_event.
CREATE OR REPLACE FUNCTION local_identity.unresolved_native_notifications()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF session_user<>'loop_app' THEN
  RAISE EXCEPTION 'Internal service only' USING ERRCODE='42501';
 END IF;
 RETURN (
  SELECT count(*) FROM public.notification_delivery_events d
  WHERE d.outcome IN ('reserved','uncertain')
   AND NOT EXISTS (
    SELECT 1 FROM local_identity.historical_audit_events h WHERE h.event_id=d.event_id
   )
 );
END $$;
