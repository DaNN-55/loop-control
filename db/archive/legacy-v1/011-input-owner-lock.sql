-- Acquire row locks without granting the application direct business UPDATE.
CREATE FUNCTION local_identity.lock_owned_input_episode(p_episode_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM e.id FROM public.episodes e
 JOIN local_identity.input_episodes i ON i.episode_id=e.id AND i.owner_id=local_identity.owner_id()
 JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'
 WHERE e.id=p_episode_id FOR UPDATE OF e;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION local_identity.lock_owned_input_episode(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.lock_owned_input_episode(uuid) TO loop_owner;
