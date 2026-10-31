-- Single-order collection moves reuse the completed migration proof and SQL110
-- current location. Creative references and immutable task inputs stay intact.
CREATE FUNCTION local_identity.complete_storage_move(p_migration uuid,p_targets jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m local_identity.account_directory_migrations;e jsonb;s jsonb;t jsonb;
 l record;c record;a record;op text;
BEGIN
 IF session_user<>'loop_app' THEN RAISE EXCEPTION 'Trusted local service required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM local_identity.account_directory_migrations WHERE id=p_migration FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_account_row(m.account_id) THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF m.status<>'copying' OR m.manifest->>'kind'<>'move' OR jsonb_array_length(m.manifest->'conflicts')<>0
  OR jsonb_array_length(m.manifest->'episodes')<>1 OR jsonb_array_length(p_targets)<>1 THEN RAISE EXCEPTION 'Move plan not executable' USING ERRCODE='55000';END IF;
 e:=m.manifest->'episodes'->0;s:=e->'sources'->0;t:=p_targets->0;
 SELECT * INTO l FROM local_identity.episode_storage_location((e->>'id')::uuid);
 SELECT * INTO c FROM local_identity.account_storage_containers WHERE id=(m.manifest->>'targetContainerId')::uuid AND account_id=m.account_id AND series_id IS NOT DISTINCT FROM (e->>'seriesId')::uuid;
 SELECT * INTO a FROM local_identity.account_asset_directories WHERE account_id=m.account_id;
 IF l.account_id IS DISTINCT FROM m.account_id OR c.id IS NULL OR a.actual_root IS DISTINCT FROM m.manifest->>'targetRoot'
  OR jsonb_array_length(e->'sources')<>1 OR (e->>'managed')::boolean
  OR (local_identity.storage_physical_root(l.asset_root),l.directory_relative_path,l.directory_device_id,l.directory_inode_id)
    IS DISTINCT FROM (s->'root'->>'path',s->>'prefix',s->'directory'->>'device',s->'directory'->>'inode')
  OR NOT EXISTS(SELECT 1 FROM local_identity.episode_storage_collection((e->>'id')::uuid) x WHERE x.container_id=(m.manifest->>'sourceContainerId')::uuid AND x.container_id<>c.id)
  OR left(e->>'targetPrefix',length(c.directory_relative_path)+1)<>c.directory_relative_path||'/'
  OR position('/' IN substring(e->>'targetPrefix' FROM length(c.directory_relative_path)+2))<>0
  OR e->>'targetPrefix'=l.directory_relative_path
  OR (t->>'episodeId',t->>'prefix',t->>'path') IS DISTINCT FROM (e->>'id',e->>'targetPrefix',a.actual_root||'/'||(e->>'targetPrefix'))
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m.manifest->'containers') x WHERE x->>'id'=c.id::text AND (x->>'prefix',x->'identity'->>'device',x->'identity'->>'inode')=(c.directory_relative_path,c.device_id,c.inode_id))
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m.manifest->'createdDirectories') x WHERE (x->>'path',x->>'device',x->>'inode')=(t->>'path',t->>'device',t->>'inode'))
 THEN RAISE EXCEPTION 'Move location or container changed' USING ERRCODE='55000';END IF;
 op:='move:'||m.id::text;
 INSERT INTO local_identity.storage_location_operations(id,kind,migration_id,proof,proof_sha256)
  VALUES(op,'move',m.id,m.manifest,encode(sha256(convert_to(m.manifest::text,'UTF8')),'hex'));
 INSERT INTO local_identity.episode_storage_lineage(operation_id,episode_id,account_id,source_root,source_prefix,source_device_id,source_inode_id,target_root,target_prefix,target_device_id,target_inode_id)
  VALUES(op,(e->>'id')::uuid,m.account_id,s->'root'->>'path',s->>'prefix',s->'directory'->>'device',s->'directory'->>'inode',a.actual_root,e->>'targetPrefix',t->>'device',t->>'inode');
 UPDATE local_identity.episode_asset_locations SET asset_root=a.actual_root,directory_relative_path=e->>'targetPrefix',directory_device_id=t->>'device',directory_inode_id=t->>'inode',storage_series_id=c.series_id,layout_version=2 WHERE episode_id=(e->>'id')::uuid;
 UPDATE local_identity.account_directory_migrations SET status='completed',error=NULL,updated_at=clock_timestamp() WHERE id=m.id;
END $$;
REVOKE ALL ON FUNCTION local_identity.complete_storage_move(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.complete_storage_move(uuid,jsonb) TO loop_app;
