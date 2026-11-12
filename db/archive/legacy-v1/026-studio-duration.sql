-- T21: read duration settings through the managed Owner boundary, not a public global grant.
CREATE FUNCTION local_identity.studio_duration_settings(p_episode_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RAISE EXCEPTION 'Owner Studio Episode required' USING ERRCODE='42501'; END IF;
 RETURN public.shot_duration_settings(p_episode_id);
END $$;
REVOKE ALL ON FUNCTION local_identity.studio_duration_settings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.studio_duration_settings(uuid) TO loop_owner;
