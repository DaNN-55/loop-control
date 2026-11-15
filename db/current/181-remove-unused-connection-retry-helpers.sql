-- ADR-0061: no current SQL/source, saved-runtime or recovery consumers.
-- Keep verification history, local probes, persisted backoff and all Worker fences.
-- Default RESTRICT rejects unexpected dependencies; never cascade or rewrite data.
DROP FUNCTION public.record_external_connection_verification(uuid,text,text);
DROP FUNCTION public.worker_retry_delay_ms();
