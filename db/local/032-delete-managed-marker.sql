-- Remove the native management marker only inside the guarded deletion transaction.
CREATE OR REPLACE FUNCTION local_identity.delete_owned_input_episode(p_episode_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT local_identity.lock_owned_episode_deletion(p_episode_id) THEN RAISE EXCEPTION 'Owned test Episode required' USING ERRCODE='42501'; END IF;
 DELETE FROM local_identity.input_episodes WHERE episode_id=p_episode_id;
 RETURN public.delete_episode(p_episode_id,local_identity.owner_id());
END $$;
