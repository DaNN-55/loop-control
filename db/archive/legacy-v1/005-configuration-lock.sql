-- Lock only an account owned by the asserted transaction Owner. This avoids
-- granting raw UPDATE on business tables merely to use SELECT FOR UPDATE.
CREATE FUNCTION local_identity.lock_owned_account(p_account_id uuid)
RETURNS TABLE(id uuid,current_blueprint_version_id uuid,policy jsonb,revision text)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT a.id,a.current_blueprint_version_id,b.policy,md5(b.policy::text)
 FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id
 LEFT JOIN public.account_blueprint_versions b ON b.id=a.current_blueprint_version_id
 WHERE a.id=p_account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'
 FOR UPDATE OF a
$$;
REVOKE ALL ON FUNCTION local_identity.lock_owned_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.lock_owned_account(uuid) TO loop_owner;
