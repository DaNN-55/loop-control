-- Imported audit events are evidence, never new desktop deliveries.
CREATE TABLE local_identity.historical_audit_events(event_id uuid PRIMARY KEY REFERENCES public.audit_events(id));
REVOKE ALL ON local_identity.historical_audit_events FROM PUBLIC;
INSERT INTO local_identity.historical_audit_events SELECT DISTINCT (h.row_key->>'id')::uuid FROM local_identity.history_projection_results h JOIN public.audit_events a ON a.id::text=h.row_key->>'id' WHERE h.table_name='public.audit_events' AND h.status='inserted' ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.claim_notification_event()
RETURNS TABLE(id uuid,created_at timestamptz,event_type text,payload jsonb,delivery_token uuid)
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT(SELECT initialized FROM public.notification_delivery_state WHERE singleton)THEN RAISE EXCEPTION 'Notification delivery is not initialized';END IF;
 RETURN QUERY WITH candidate AS(
  SELECT d.event_id FROM public.notification_delivery_events d WHERE d.outcome='pending' AND NOT EXISTS(SELECT 1 FROM local_identity.historical_audit_events h WHERE h.event_id=d.event_id) ORDER BY d.event_id FOR UPDATE SKIP LOCKED LIMIT 1
 ),reserved AS(
  UPDATE public.notification_delivery_events d SET outcome='reserved',delivery_token=gen_random_uuid(),reserved_at=clock_timestamp() FROM candidate c WHERE d.event_id=c.event_id RETURNING d.event_id,d.delivery_token
 )SELECT a.id,a.created_at,a.event_type,a.payload,r.delivery_token FROM reserved r JOIN public.audit_events a ON a.id=r.event_id;
END $$;
