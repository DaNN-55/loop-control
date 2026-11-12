-- A statement that begins waiting for a lock may keep its old joined policy
-- snapshot. Lock first; the app reads the revision in a subsequent statement.
CREATE FUNCTION local_identity.lock_owned_account_row(p_account_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id
 WHERE a.id=p_account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'
 FOR UPDATE OF a;
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION local_identity.lock_owned_account_row(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.lock_owned_account_row(uuid) TO loop_owner;
REVOKE EXECUTE ON FUNCTION local_identity.lock_owned_account(uuid) FROM loop_owner;
