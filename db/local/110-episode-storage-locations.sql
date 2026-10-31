-- Storage collection is independent of frozen creative ancestry. Legacy layout
-- stays active until all production/lifecycle consumers adopt this contract.
ALTER TABLE local_identity.episode_asset_locations
 ADD COLUMN directory_relative_path text,
 ADD COLUMN directory_device_id text,
 ADD COLUMN directory_inode_id text,
 ADD COLUMN storage_series_id uuid,
 ADD COLUMN layout_version integer NOT NULL DEFAULT 1 CHECK(layout_version IN (1,2)),
 ADD CONSTRAINT episode_directory_relative_path CHECK(directory_relative_path IS NULL OR (length(directory_relative_path) BETWEEN 1 AND 2048 AND directory_relative_path !~ '(^/|\\|(^|/)\.{1,2}(/|$)|//|/$)')),
 ADD CONSTRAINT episode_directory_identity CHECK((directory_device_id IS NULL)=(directory_inode_id IS NULL)),
 ADD CONSTRAINT episode_managed_directory_identity CHECK(layout_version=1 OR (directory_relative_path IS NOT NULL AND directory_device_id IS NOT NULL));
CREATE FUNCTION local_identity.episode_storage_location(p_episode uuid)
 RETURNS TABLE(account_id uuid,asset_root text,directory_relative_path text,directory_device_id text,directory_inode_id text,storage_series_id uuid,layout_version integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT e.account_id,local_identity.episode_asset_root(e.id),coalesce(l.directory_relative_path,'episodes/'||e.id::text),l.directory_device_id,l.directory_inode_id,l.storage_series_id,coalesce(l.layout_version,1)
 FROM public.episodes e LEFT JOIN local_identity.episode_asset_locations l ON l.episode_id=e.id AND l.account_id=e.account_id
 WHERE e.id=p_episode AND (session_user IN ('postgres','loop_worker') OR EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'))
$$;
REVOKE ALL ON FUNCTION local_identity.episode_storage_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.episode_storage_location(uuid) TO loop_app,loop_worker;
