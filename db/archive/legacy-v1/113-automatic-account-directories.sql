-- Creation intent survives process exit independently of the business transaction.
CREATE TABLE local_identity.account_creation_intents(
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id), idempotency_key uuid NOT NULL,
 payload_hash text NOT NULL, account_id uuid NOT NULL UNIQUE, path text NOT NULL UNIQUE,
 root_binding jsonb NOT NULL, marker uuid NOT NULL, device_id text, inode_id text, marker_device_id text, marker_inode_id text, cleanup_owned boolean NOT NULL DEFAULT false,
 result jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,idempotency_key), CHECK((device_id IS NULL)=(inode_id IS NULL)), CHECK((marker_device_id IS NULL)=(marker_inode_id IS NULL))
);
REVOKE ALL ON local_identity.account_creation_intents FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
ALTER TABLE local_identity.account_creation_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_creation_owner ON local_identity.account_creation_intents TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
GRANT SELECT,INSERT,UPDATE ON local_identity.account_creation_intents TO loop_app;
CREATE FUNCTION local_identity.create_account_at_id(p_id uuid,p_account_name text,p_account_slug text,p_timezone text,p_policy jsonb) RETURNS public.accounts LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE created public.accounts; blueprint public.account_blueprint_versions;
BEGIN
 IF local_identity.owner_id() IS NULL OR local_identity.owner_id() IS DISTINCT FROM (SELECT owner_id FROM local_identity.media_root_binding WHERE singleton) THEN RAISE EXCEPTION 'Workspace storage Owner required' USING ERRCODE='42501'; END IF;
 IF char_length(trim(p_account_name))=0 OR char_length(trim(p_account_slug))=0 OR jsonb_typeof(p_policy)<>'object' THEN RAISE EXCEPTION 'Account fields required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.accounts(id,name,slug,timezone) VALUES(p_id,trim(p_account_name),trim(p_account_slug),p_timezone) RETURNING * INTO created;
 INSERT INTO public.account_blueprint_versions(account_id,version,policy,is_active) VALUES(p_id,1,p_policy,true) RETURNING * INTO blueprint;
 UPDATE public.accounts SET current_blueprint_version_id=blueprint.id WHERE id=p_id RETURNING * INTO created;
 INSERT INTO public.account_memberships(account_id,user_id,role) VALUES(p_id,local_identity.owner_id(),'owner');
 INSERT INTO public.audit_events(account_id,event_type,payload,actor_id) VALUES(p_id,'account_created',jsonb_build_object('blueprint_version_id',blueprint.id),local_identity.owner_id());
 RETURN created;
END $$;
REVOKE ALL ON FUNCTION local_identity.create_account_at_id(uuid,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.create_account_at_id(uuid,text,text,text,jsonb) TO loop_app;
