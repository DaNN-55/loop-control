-- Only a deleted, owned deletion intent may advance to completed cleanup.
CREATE FUNCTION local_identity.complete_owned_deletion_cleanup(p_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE r jsonb; BEGIN
 SELECT result INTO r FROM local_identity.command_receipts WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key AND result->>'cleanupKey'=p_key::text AND jsonb_typeof(result->'cleanupRoot')='string' FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.episodes WHERE id=(r->>'episodeId')::uuid) THEN RAISE EXCEPTION 'Owned committed deletion intent required' USING ERRCODE='42501'; END IF;
 r:=jsonb_set(jsonb_set(r,'{cleanupPending}','false'::jsonb),'{localRemoved}','true'::jsonb);
 UPDATE local_identity.command_receipts SET result=r WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION local_identity.complete_owned_deletion_cleanup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.complete_owned_deletion_cleanup(uuid) TO loop_owner;
