-- Runtime storage authorization is deployment metadata, never creative policy.
CREATE TABLE local_identity.media_root_binding(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 path text NOT NULL, device_id text NOT NULL, inode_id text NOT NULL, mount_path text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON local_identity.media_root_binding FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
CREATE FUNCTION local_identity.media_root_binding() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('path',path,'deviceId',device_id,'inodeId',inode_id,'mountPath',mount_path) FROM local_identity.media_root_binding WHERE singleton
$$;
CREATE FUNCTION local_identity.media_root_owner() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT owner_id FROM local_identity.media_root_binding WHERE singleton),
 (SELECT CASE WHEN count(DISTINCT user_id)=1 THEN min(user_id::text)::uuid END FROM public.account_memberships WHERE role='owner'),
 (SELECT CASE WHEN count(*)=1 THEN min(owner_id::text)::uuid END FROM local_identity.credentials))
$$;
CREATE FUNCTION local_identity.media_workspace_empty() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.accounts) AND NOT EXISTS(SELECT 1 FROM public.episodes)
$$;
CREATE FUNCTION local_identity.bind_media_root(p_path text,p_device text,p_inode text,p_mount text,p_initialize boolean,p_owner uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 LOCK TABLE public.accounts,public.episodes,local_identity.import_record IN SHARE ROW EXCLUSIVE MODE;
 IF p_initialize THEN
  IF local_identity.owner_id() IS NULL OR local_identity.owner_id() IS DISTINCT FROM local_identity.media_root_owner() THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
  IF NOT local_identity.media_workspace_empty() THEN RAISE EXCEPTION 'Existing workspace requires migration' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM local_identity.media_root_binding WHERE singleton AND (path,device_id,inode_id,mount_path) IS DISTINCT FROM (p_path,p_device,p_inode,p_mount)) THEN RAISE EXCEPTION 'Media identity mismatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM local_identity.media_root_binding) AND EXISTS(SELECT 1 FROM local_identity.restore_record WHERE media_root<>p_path) THEN RAISE EXCEPTION 'Restore root mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF coalesce(p_owner,local_identity.media_root_owner()) IS NULL OR EXISTS(SELECT 1 FROM local_identity.media_root_binding WHERE owner_id IS DISTINCT FROM coalesce(p_owner,local_identity.media_root_owner())) THEN RAISE EXCEPTION 'Storage Owner binding required' USING ERRCODE='42501'; END IF;
 INSERT INTO local_identity.media_root_binding(owner_id,path,device_id,inode_id,mount_path) VALUES(coalesce(p_owner,local_identity.media_root_owner()),p_path,p_device,p_inode,p_mount)
 ON CONFLICT(singleton) DO UPDATE SET path=excluded.path,device_id=excluded.device_id,inode_id=excluded.inode_id,mount_path=excluded.mount_path,updated_at=clock_timestamp();
END $$;
CREATE OR REPLACE FUNCTION local_identity.media_deployment() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('targetRoot',coalesce((SELECT path FROM local_identity.media_root_binding WHERE singleton),(SELECT media_root FROM local_identity.restore_record WHERE singleton)),
 'binding',local_identity.media_root_binding(),'sourceRoots',coalesce((SELECT jsonb_agg(DISTINCT r) FROM local_identity.import_record i CROSS JOIN LATERAL unnest(i.media_source_roots||ARRAY[i.source_media_root])r WHERE r IS NOT NULL AND r<>''),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION local_identity.media_root_binding(),local_identity.media_root_owner(),local_identity.media_workspace_empty(),local_identity.bind_media_root(text,text,text,text,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.media_root_binding() TO loop_app,loop_owner,loop_worker;
GRANT EXECUTE ON FUNCTION local_identity.media_root_owner(),local_identity.media_workspace_empty(),local_identity.bind_media_root(text,text,text,text,boolean,uuid) TO loop_app;
