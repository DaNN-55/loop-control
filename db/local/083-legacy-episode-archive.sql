-- Lifecycle management does not opt an older order into native production.
-- Keep Owner membership and explicit historical read-only protection.
CREATE OR REPLACE FUNCTION local_identity.archive_owned_input_episode(p_episode_id uuid,p_archived boolean)
RETURNS public.episodes LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT local_identity.lock_owned_episode_cleanup(p_episode_id) OR p_archived IS NULL THEN
  RAISE EXCEPTION 'Owned nonhistorical Episode required' USING ERRCODE='42501';
 END IF;
 RETURN public.set_episode_archived(p_episode_id,p_archived);
END $$;
