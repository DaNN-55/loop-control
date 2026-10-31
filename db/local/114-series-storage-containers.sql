-- Physical collection is independent of frozen creative series versions.
-- Display names are not identities; concurrent same-name series own distinct UUID folders.
ALTER TABLE public.series DROP CONSTRAINT series_account_id_name_key;
CREATE TABLE local_identity.account_storage_containers(
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('series','unassigned')), series_id uuid,
 directory_relative_path text NOT NULL CHECK(directory_relative_path<>'' AND directory_relative_path NOT IN ('.','..') AND directory_relative_path !~ '[/\\\\[:cntrl:]]'),
 device_id text NOT NULL,inode_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='series' AND series_id IS NOT NULL) OR (kind='unassigned' AND series_id IS NULL)),
 FOREIGN KEY(account_id,series_id) REFERENCES public.series(account_id,id) ON DELETE CASCADE,
 UNIQUE(account_id,directory_relative_path),UNIQUE(series_id)
);
CREATE UNIQUE INDEX account_unassigned_container ON local_identity.account_storage_containers(account_id) WHERE kind='unassigned';
CREATE TABLE local_identity.container_creation_intents(
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),idempotency_key uuid NOT NULL,payload_hash text NOT NULL,
 container_id uuid NOT NULL UNIQUE,account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN ('series','unassigned')),
 directory_relative_path text NOT NULL,account_root text NOT NULL,account_device_id text NOT NULL,account_inode_id text NOT NULL,
 root_binding jsonb NOT NULL,marker uuid NOT NULL,device_id text,inode_id text,marker_device_id text,marker_inode_id text,cleanup_owned boolean NOT NULL DEFAULT false,
 result jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(owner_id,idempotency_key),
 CHECK((device_id IS NULL)=(inode_id IS NULL)),CHECK((marker_device_id IS NULL)=(marker_inode_id IS NULL)),UNIQUE(account_id,directory_relative_path)
);
CREATE UNIQUE INDEX unassigned_creation_intent ON local_identity.container_creation_intents(account_id) WHERE kind='unassigned';
REVOKE ALL ON local_identity.account_storage_containers,local_identity.container_creation_intents FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
ALTER TABLE local_identity.account_storage_containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.container_creation_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY container_owner ON local_identity.account_storage_containers TO loop_app USING(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=account_storage_containers.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner')) WITH CHECK(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=account_storage_containers.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
CREATE POLICY container_creation_owner ON local_identity.container_creation_intents TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
GRANT SELECT,INSERT,UPDATE ON local_identity.account_storage_containers,local_identity.container_creation_intents TO loop_app;
CREATE POLICY container_worker ON local_identity.account_storage_containers FOR SELECT TO loop_worker USING(true);
GRANT SELECT ON local_identity.account_storage_containers TO loop_worker;
CREATE FUNCTION local_identity.create_series_at_id(p_id uuid,p_account uuid,p_name text,p_rules jsonb) RETURNS public.series_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE created public.series_versions;
BEGIN
 IF NOT local_identity.lock_owned_account_row(p_account) THEN RAISE EXCEPTION 'Owner membership required' USING ERRCODE='42501';END IF;
 IF trim(coalesce(p_name,''))='' OR p_rules IS NULL OR jsonb_typeof(p_rules)<>'object' THEN RAISE EXCEPTION 'Series name and rules required' USING ERRCODE='22023';END IF;
 INSERT INTO public.series(id,account_id,name) VALUES(p_id,p_account,trim(p_name));
 INSERT INTO public.series_versions(series_id,account_id,version,rules,created_by) VALUES(p_id,p_account,1,p_rules,local_identity.owner_id()) RETURNING * INTO created;
 INSERT INTO public.audit_events(account_id,event_type,payload,actor_id) VALUES(p_account,'series_created',jsonb_build_object('series_id',p_id,'series_version_id',created.id,'version',1),local_identity.owner_id());
 RETURN created;
END $$;
CREATE FUNCTION public.rename_series(p_series uuid,p_name text) RETURNS public.series LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected public.series;
BEGIN
 SELECT s.* INTO selected FROM public.series s JOIN public.account_memberships m ON m.account_id=s.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner' WHERE s.id=p_series FOR UPDATE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner membership required' USING ERRCODE='42501';END IF;
 IF trim(coalesce(p_name,''))='' THEN RAISE EXCEPTION 'Series name required' USING ERRCODE='22023';END IF;
 UPDATE public.series SET name=trim(p_name) WHERE id=p_series RETURNING * INTO selected;
 INSERT INTO public.audit_events(account_id,event_type,payload,actor_id) VALUES(selected.account_id,'series_renamed',jsonb_build_object('series_id',p_series,'name',selected.name),local_identity.owner_id());
 RETURN selected;
END $$;
REVOKE ALL ON FUNCTION local_identity.create_series_at_id(uuid,uuid,text,jsonb),public.rename_series(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.create_series_at_id(uuid,uuid,text,jsonb),public.rename_series(uuid,text) TO loop_app;
