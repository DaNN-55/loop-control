-- Keep the latest cleanup error on the existing owned receipt, without changing
-- its immutable file scope or advancing the deletion state.
ALTER TABLE local_identity.episode_deletion_intents ADD COLUMN last_error text;

CREATE FUNCTION local_identity.record_owned_deletion_cleanup_error(p_key uuid,p_message text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 IF session_user<>'loop_app' OR p_message IS NULL THEN RAISE EXCEPTION 'Owned cleanup diagnostic required';END IF;
 SELECT result INTO r FROM local_identity.command_receipts WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key AND result->>'cleanupKey'=p_key::text AND result ? 'cleanupRoot' FOR UPDATE;
 IF r IS NULL THEN
  UPDATE local_identity.episode_deletion_intents SET last_error=p_message WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key AND state='prepared';
  IF NOT FOUND THEN RAISE EXCEPTION 'Owned cleanup receipt unavailable';END IF;
  RETURN NULL;
 END IF;
 IF r->>'cleanupPending'='true' THEN
  r:=jsonb_set(r,'{message}',to_jsonb(p_message));
  UPDATE local_identity.command_receipts SET result=r WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key;
 END IF;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION local_identity.record_owned_deletion_cleanup_error(uuid,text) FROM PUBLIC,loop_app,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.record_owned_deletion_cleanup_error(uuid,text) TO loop_owner;
