-- The application may change only the password belonging to a live Owner session.
CREATE OR REPLACE FUNCTION local_identity.change_owner_password(p_owner uuid,p_token_hash text,p_digest jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF coalesce(p_digest->>'version','')<>'scrypt-v1' OR coalesce(p_digest->>'salt','') !~ '^[0-9a-f]{64}$' OR coalesce(p_digest->>'digest','') !~ '^[0-9a-f]{128}$' THEN RAISE EXCEPTION 'Invalid password digest' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM local_identity.sessions WHERE token_hash=p_token_hash AND owner_id=p_owner AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 UPDATE local_identity.credentials SET password_digest=p_digest,failed_attempts=0,locked_until=NULL,updated_at=clock_timestamp() WHERE owner_id=p_owner;
 IF NOT FOUND THEN RETURN false;END IF;
 UPDATE local_identity.sessions SET revoked_at=clock_timestamp() WHERE owner_id=p_owner AND token_hash<>p_token_hash AND revoked_at IS NULL;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION local_identity.change_owner_password(uuid,text,jsonb) FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.change_owner_password(uuid,text,jsonb) TO loop_app;
