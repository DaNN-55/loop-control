-- This replay fence belongs to the live audit row. Deleting an empty account
-- already cascades to its audit events; remove their markers in the same step.
-- Original history_versions/source_rows/projection_results stay independent.
ALTER TABLE local_identity.historical_audit_events
 DROP CONSTRAINT historical_audit_events_event_id_fkey;
ALTER TABLE local_identity.historical_audit_events
 ADD CONSTRAINT historical_audit_events_event_id_fkey
 FOREIGN KEY(event_id) REFERENCES public.audit_events(id) ON DELETE CASCADE;
