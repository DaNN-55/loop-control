CREATE SCHEMA local_identity;
REVOKE ALL ON SCHEMA local_identity FROM PUBLIC;
CREATE TABLE local_identity.owners(id uuid PRIMARY KEY, email text NOT NULL);
-- Only the trusted app login can assert a verified Owner for its transaction.
CREATE FUNCTION local_identity.owner_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM local_identity.owners WHERE id=nullif(current_setting('loop.owner_id',true),'')::uuid AND session_user='loop_app'
$$;
CREATE FUNCTION local_identity.actor_role() RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN session_user='loop_app' AND local_identity.owner_id() IS NOT NULL THEN 'authenticated' WHEN session_user='loop_worker' THEN 'service_role' END
$$;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
