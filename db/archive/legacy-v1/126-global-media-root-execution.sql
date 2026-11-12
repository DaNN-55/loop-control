-- Execution extends the original immutable global plan. Mutable recovery facts
-- never replace its server-fingerprinted inventory or completed source proof.
ALTER TABLE local_identity.media_root_migrations DROP CONSTRAINT media_root_migrations_status_check;
ALTER TABLE local_identity.media_root_migrations ADD CONSTRAINT media_root_migrations_status_check CHECK(status IN ('planned','copying','failed','committed','completed','rolled_back')),
 ADD COLUMN progress jsonb NOT NULL DEFAULT '{}',ADD COLUMN publication jsonb,ADD COLUMN error text,ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE UNIQUE INDEX media_root_single_execution ON local_identity.media_root_migrations((true)) WHERE status IN ('copying','failed','committed');
CREATE FUNCTION local_identity.guard_media_root_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF (NEW.id,NEW.owner_id,NEW.idempotency_key,NEW.request_sha256,NEW.manifest,NEW.manifest_sha256,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.owner_id,OLD.idempotency_key,OLD.request_sha256,OLD.manifest,OLD.manifest_sha256,OLD.created_at) THEN RAISE EXCEPTION 'Original media root plan is immutable';END IF;RETURN NEW;END $$;
CREATE TRIGGER guard_media_root_manifest BEFORE UPDATE ON local_identity.media_root_migrations FOR EACH ROW EXECUTE FUNCTION local_identity.guard_media_root_manifest();
CREATE FUNCTION local_identity.media_root_write_blocked() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM local_identity.media_root_migrations WHERE status IN ('copying','failed','committed')) $$;
CREATE FUNCTION local_identity.require_media_root_writable() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF local_identity.media_root_write_blocked() THEN RAISE EXCEPTION '媒体根迁移尚未完成，请继续或回滚原计划。' USING ERRCODE='55000';END IF;END $$;
REVOKE ALL ON FUNCTION local_identity.media_root_write_blocked(),local_identity.require_media_root_writable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.media_root_write_blocked(),local_identity.require_media_root_writable() TO loop_app,loop_worker;
CREATE FUNCTION local_identity.update_media_root_execution(p_id uuid,p_status text,p_progress jsonb,p_error text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m local_identity.media_root_migrations;BEGIN
 IF session_user<>'loop_app' OR local_identity.owner_id() IS DISTINCT FROM local_identity.media_root_owner() THEN RAISE EXCEPTION 'Storage Owner required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM local_identity.media_root_migrations WHERE id=p_id AND owner_id=local_identity.owner_id() FOR UPDATE;
 IF NOT FOUND OR m.manifest_sha256<>encode(sha256(convert_to(m.manifest::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Migration plan proof missing';END IF;
 IF NOT ((p_status='copying' AND m.status IN ('planned','copying','failed') AND (m.manifest->>'canExecute')::boolean) OR (p_status='failed' AND m.status='copying') OR (p_status='rolled_back' AND m.status IN ('planned','copying','failed'))) THEN RAISE EXCEPTION 'Migration state does not permit this operation' USING ERRCODE='55000';END IF;
 UPDATE local_identity.media_root_migrations SET status=p_status,progress=p_progress,error=p_error,updated_at=clock_timestamp() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION local_identity.update_media_root_execution(uuid,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.update_media_root_execution(uuid,text,jsonb,text) TO loop_app;

ALTER TABLE local_identity.storage_location_operations ADD COLUMN media_root_migration_id uuid REFERENCES local_identity.media_root_migrations(id);
ALTER TABLE local_identity.storage_location_operations DROP CONSTRAINT storage_location_operations_kind_check,DROP CONSTRAINT storage_location_operations_check;
ALTER TABLE local_identity.storage_location_operations ADD CHECK(kind IN ('adoption','restore','move','root_migration')),
 ADD CHECK((kind='restore' AND archive_sha256 ~ '^[a-f0-9]{64}$' AND migration_id IS NULL AND media_root_migration_id IS NULL) OR (kind IN ('adoption','move') AND migration_id IS NOT NULL AND archive_sha256 IS NULL AND media_root_migration_id IS NULL) OR (kind='root_migration' AND media_root_migration_id IS NOT NULL AND migration_id IS NULL AND archive_sha256 IS NULL));

CREATE FUNCTION local_identity.commit_media_root_migration(p_id uuid,p_sha text,p_targets jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m local_identity.media_root_migrations;ep jsonb;d jsonb;t jsonb;old local_identity.episode_asset_locations;proof jsonb;op text;new_root text;prefix text;actual jsonb;bindings jsonb:='[]';BEGIN
 IF session_user<>'loop_app' OR local_identity.owner_id() IS DISTINCT FROM local_identity.media_root_owner() THEN RAISE EXCEPTION 'Storage Owner required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM local_identity.media_root_migrations WHERE id=p_id AND owner_id=local_identity.owner_id() FOR UPDATE;
 IF NOT FOUND OR m.status<>'copying' OR m.manifest_sha256<>p_sha OR p_sha<>encode(sha256(convert_to(m.manifest::text,'UTF8')),'hex') OR NOT (m.manifest->>'canExecute')::boolean OR local_identity.media_root_binding() IS DISTINCT FROM m.manifest->'sourceBinding' THEN RAISE EXCEPTION 'Migration source or plan changed' USING ERRCODE='55000';END IF;
 IF (SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'owned',true) ORDER BY a.id),'[]') FROM public.accounts a) IS DISTINCT FROM m.manifest->'accounts' OR jsonb_array_length(local_identity.media_root_pending_operations())<>0 THEN RAISE EXCEPTION 'Workspace scope or pending operation changed' USING ERRCODE='55000';END IF;
 FOR ep IN SELECT value FROM jsonb_array_elements(m.manifest->'episodes') LOOP
  IF NOT local_identity.lock_owned_account_row((ep->>'accountId')::uuid) THEN RAISE EXCEPTION 'Account Owner required';END IF;
  IF NOT EXISTS(SELECT 1 FROM local_identity.episode_storage_location((ep->>'id')::uuid) l WHERE l.account_id=(ep->>'accountId')::uuid AND local_identity.storage_physical_root(l.asset_root)=ep->'location'->>'assetRoot' AND l.directory_relative_path=ep->'location'->>'relativePath' AND l.directory_device_id IS NOT DISTINCT FROM ep->'location'->>'deviceId' AND l.directory_inode_id IS NOT DISTINCT FROM ep->'location'->>'inodeId') THEN RAISE EXCEPTION 'Episode source changed';END IF;
  SELECT value INTO d FROM jsonb_array_elements(m.manifest->'directories') WHERE value->>'kind'='episode' AND value->>'episodeId'=ep->>'id';
  SELECT value INTO t FROM jsonb_array_elements(p_targets) WHERE value->>'sourcePath'=d->'source'->>'path';
  IF t IS NULL OR t->>'path'<>(m.manifest->'targetBinding'->>'path')||'/'||(d->>'targetRelativePath') OR t->>'device' IS NULL OR t->>'inode' IS NULL THEN RAISE EXCEPTION 'Episode target identity missing';END IF;
  new_root:=(m.manifest->'targetBinding'->>'path')||substring(ep->'location'->>'assetRoot' from length(m.manifest->'sourceBinding'->>'path')+1);prefix:=ep->'location'->>'relativePath';
  bindings:=bindings||jsonb_build_array(jsonb_build_object('episodeId',ep->>'id','accountId',ep->>'accountId','sourceRoot',ep->'location'->>'assetRoot','sourcePrefix',prefix,'sourceDeviceId',d->'source'->>'device','sourceInodeId',d->'source'->>'inode','actualRoot',new_root,'relativePath',prefix,'deviceId',t->>'device','inodeId',t->>'inode'));
 END LOOP;
 FOR d IN SELECT value FROM jsonb_array_elements(m.manifest->'directories') WHERE value->>'kind' IN ('account','series','unassigned') LOOP
  SELECT value INTO t FROM jsonb_array_elements(p_targets) WHERE value->>'sourcePath'=d->'source'->>'path';
  IF t IS NULL OR t->>'path'<>(m.manifest->'targetBinding'->>'path')||'/'||(d->>'targetRelativePath') THEN RAISE EXCEPTION 'Parent target identity missing';END IF;
  IF d->>'kind'='account' THEN
   UPDATE local_identity.account_asset_directories SET actual_root=t->>'path',device_id=t->>'device',inode_id=t->>'inode',updated_at=clock_timestamp() WHERE account_id=(d->>'accountId')::uuid AND actual_root=d->'source'->>'path' AND device_id=d->'source'->>'device' AND inode_id=d->'source'->>'inode';
  ELSE
   UPDATE local_identity.account_storage_containers SET device_id=t->>'device',inode_id=t->>'inode' WHERE id=(d->>'containerId')::uuid AND account_id=(d->>'accountId')::uuid AND device_id=d->'source'->>'device' AND inode_id=d->'source'->>'inode';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parent source registration changed';END IF;
 END LOOP;
 -- These are current alias destinations, never original manifests or task inputs.
 UPDATE local_identity.account_directory_locations SET actual_root=(m.manifest->'targetBinding'->>'path')||substring(actual_root from length(m.manifest->'sourceBinding'->>'path')+1) WHERE actual_root=m.manifest->'sourceBinding'->>'path' OR left(actual_root,length(m.manifest->'sourceBinding'->>'path')+1)=(m.manifest->'sourceBinding'->>'path')||'/';
 proof:=jsonb_build_object('planId',m.id,'manifestSha256',m.manifest_sha256,'bindings',bindings,'directories',p_targets,'targetBinding',m.manifest->'targetBinding');op:='root-migration:'||m.id::text;
 INSERT INTO local_identity.storage_location_operations(id,kind,media_root_migration_id,proof,proof_sha256) VALUES(op,'root_migration',m.id,proof,encode(sha256(convert_to(proof::text,'UTF8')),'hex'));
 FOR t IN SELECT value FROM jsonb_array_elements(bindings) LOOP
  INSERT INTO local_identity.episode_storage_lineage(operation_id,episode_id,account_id,source_root,source_prefix,source_device_id,source_inode_id,target_root,target_prefix,target_device_id,target_inode_id) VALUES(op,(t->>'episodeId')::uuid,(t->>'accountId')::uuid,t->>'sourceRoot',t->>'sourcePrefix',t->>'sourceDeviceId',t->>'sourceInodeId',t->>'actualRoot',t->>'relativePath',t->>'deviceId',t->>'inodeId');
  SELECT * INTO old FROM local_identity.episode_asset_locations WHERE episode_id=(t->>'episodeId')::uuid;
  INSERT INTO local_identity.episode_asset_locations(episode_id,account_id,asset_root,directory_relative_path,directory_device_id,directory_inode_id,storage_series_id,layout_version) VALUES((t->>'episodeId')::uuid,(t->>'accountId')::uuid,t->>'actualRoot',t->>'relativePath',t->>'deviceId',t->>'inodeId',old.storage_series_id,coalesce(old.layout_version,1)) ON CONFLICT(episode_id) DO UPDATE SET asset_root=excluded.asset_root,directory_relative_path=excluded.directory_relative_path,directory_device_id=excluded.directory_device_id,directory_inode_id=excluded.directory_inode_id;
 END LOOP;
 UPDATE local_identity.media_root_binding SET path=m.manifest->'targetBinding'->>'path',device_id=m.manifest->'targetBinding'->>'deviceId',inode_id=m.manifest->'targetBinding'->>'inodeId',mount_path=m.manifest->'targetBinding'->>'mountPath',updated_at=clock_timestamp();
 UPDATE local_identity.media_root_migrations SET status='committed',publication=proof,error=NULL,updated_at=clock_timestamp() WHERE id=m.id;
END $$;
REVOKE ALL ON FUNCTION local_identity.commit_media_root_migration(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.commit_media_root_migration(uuid,text,jsonb) TO loop_app;

DO $extend_lineage$ DECLARE original text;patched text;BEGIN
 original:=pg_get_functiondef('local_identity.episode_completed_storage_lineage(uuid)'::regprocedure);
 patched:=replace(original,'JOIN public.episodes e ON e.id=l.episode_id AND e.account_id=l.account_id','LEFT JOIN local_identity.media_root_migrations g ON g.id=o.media_root_migration_id JOIN public.episodes e ON e.id=l.episode_id AND e.account_id=l.account_id');
 patched:=replace(patched,'AND ((o.kind=''restore''', $patch$AND ((o.kind='root_migration' AND g.status IN ('committed','completed') AND o.proof=g.publication AND g.manifest_sha256=encode(sha256(convert_to(g.manifest::text,'UTF8')),'hex') AND o.proof->>'manifestSha256'=g.manifest_sha256 AND o.proof->>'planId'=g.id::text
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(g.manifest->'episodes') ep JOIN LATERAL jsonb_array_elements(g.manifest->'directories') d ON d->>'episodeId'=ep->>'id' AND d->>'kind'='episode' WHERE ep->>'id'=l.episode_id::text AND ep->>'accountId'=l.account_id::text AND (ep->'location'->>'assetRoot',ep->'location'->>'relativePath',d->'source'->>'device',d->'source'->>'inode')=(l.source_root,l.source_prefix,l.source_device_id,l.source_inode_id))
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.proof->'bindings') b WHERE b->>'episodeId'=l.episode_id::text AND b->>'accountId'=l.account_id::text AND (b->>'sourceRoot',b->>'sourcePrefix',b->>'sourceDeviceId',b->>'sourceInodeId',b->>'actualRoot',b->>'relativePath',b->>'deviceId',b->>'inodeId')=(l.source_root,l.source_prefix,l.source_device_id,l.source_inode_id,l.target_root,l.target_prefix,l.target_device_id,l.target_inode_id))) OR (o.kind='restore'$patch$);
 IF patched=original THEN RAISE EXCEPTION 'Completed lineage contract changed';END IF;EXECUTE patched;
END $extend_lineage$;

CREATE OR REPLACE FUNCTION local_identity.media_deployment() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('targetRoot',coalesce((SELECT path FROM local_identity.media_root_binding WHERE singleton),(SELECT media_root FROM local_identity.restore_record WHERE singleton)),'binding',local_identity.media_root_binding(),'writeBlocked',local_identity.media_root_write_blocked(),'sourceRoots',coalesce((SELECT jsonb_agg(DISTINCT r) FROM(
 SELECT unnest(i.media_source_roots||ARRAY[i.source_media_root]) r FROM local_identity.import_record i UNION ALL SELECT unnest(x.media_source_roots) FROM local_identity.restore_record x UNION ALL SELECT manifest->'sourceBinding'->>'path' FROM local_identity.media_root_migrations WHERE status IN ('committed','completed')) aliases WHERE r IS NOT NULL AND r<>''),'[]'::jsonb)) $$;

-- Runtime readback is independently callable before session/Worker assembly.
CREATE FUNCTION local_identity.media_root_publication_proof(p_id uuid,p_sha text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m local_identity.media_root_migrations;ep jsonb;d jsonb;t jsonb;runtime_dirs jsonb:='[]';BEGIN
 IF session_user NOT IN ('loop_app','postgres') THEN RAISE EXCEPTION 'Trusted runtime required';END IF;
 SELECT * INTO m FROM local_identity.media_root_migrations WHERE id=p_id;
 IF NOT FOUND OR m.manifest_sha256<>p_sha OR p_sha<>encode(sha256(convert_to(m.manifest::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Migration manifest authority missing';END IF;
 PERFORM set_config('loop.owner_id',m.owner_id::text,true);
 IF m.status IN ('committed','completed') THEN
  IF local_identity.media_root_binding() IS DISTINCT FROM m.manifest->'targetBinding' OR NOT EXISTS(SELECT 1 FROM local_identity.storage_location_operations o WHERE o.media_root_migration_id=m.id AND o.kind='root_migration' AND o.proof=m.publication AND o.proof_sha256=encode(sha256(convert_to(o.proof::text,'UTF8')),'hex')) THEN RAISE EXCEPTION 'Migration publication incomplete';END IF;
  IF m.status='completed' THEN
   -- Completed proof is history. Legitimate later moves append verified edges;
   -- explicit deletion removes live edges but never rewrites this operation.
   FOR t IN SELECT value FROM jsonb_array_elements(m.publication->'bindings') LOOP
    IF EXISTS(SELECT 1 FROM public.episodes WHERE id=(t->>'episodeId')::uuid) THEN
     IF NOT EXISTS(WITH RECURSIVE edges AS(SELECT * FROM local_identity.episode_completed_storage_lineage((t->>'episodeId')::uuid)),walk(root,prefix,device,inode) AS(
      SELECT t->>'actualRoot',t->>'relativePath',t->>'deviceId',t->>'inodeId'
      UNION SELECT e.target_root,e.target_prefix,e.target_device_id,e.target_inode_id FROM walk w JOIN edges e ON (w.root,w.prefix,w.device,w.inode)=(e.source_root,e.source_prefix,e.source_device_id,e.source_inode_id))
      SELECT 1 FROM walk w CROSS JOIN local_identity.episode_storage_location((t->>'episodeId')::uuid) l WHERE (w.root,w.prefix,w.device,w.inode)=(local_identity.storage_physical_root(l.asset_root),l.directory_relative_path,l.directory_device_id,l.directory_inode_id))
      OR NOT EXISTS(SELECT 1 FROM local_identity.episode_completed_storage_lineage((t->>'episodeId')::uuid) l WHERE l.operation_id='root-migration:'||m.id::text) THEN RAISE EXCEPTION 'Completed migration has no valid current lineage';END IF;
     SELECT to_jsonb(l) INTO ep FROM local_identity.episode_storage_location((t->>'episodeId')::uuid) l;
     runtime_dirs:=runtime_dirs||jsonb_build_array(jsonb_build_object('path',local_identity.storage_physical_root(ep->>'asset_root')||'/'||(ep->>'directory_relative_path'),'device',ep->>'directory_device_id','inode',ep->>'directory_inode_id'));
    END IF;
   END LOOP;
   FOR d IN SELECT jsonb_build_object('path',a.actual_root,'device',a.device_id,'inode',a.inode_id) FROM local_identity.account_asset_directories a WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(m.manifest->'accounts') x WHERE x->>'id'=a.account_id::text) LOOP
    IF left(d->>'path',length(m.manifest->'targetBinding'->>'path')+1)<>(m.manifest->'targetBinding'->>'path')||'/' THEN RAISE EXCEPTION 'Current account root leaves media binding';END IF;
    runtime_dirs:=runtime_dirs||jsonb_build_array(d);
   END LOOP;
   FOR d IN SELECT jsonb_build_object('path',a.actual_root||'/'||c.directory_relative_path,'device',c.device_id,'inode',c.inode_id) FROM local_identity.account_storage_containers c JOIN local_identity.account_asset_directories a ON a.account_id=c.account_id WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(m.manifest->'accounts') x WHERE x->>'id'=a.account_id::text) LOOP runtime_dirs:=runtime_dirs||jsonb_build_array(d);END LOOP;
   RETURN to_jsonb(m)||jsonb_build_object('runtimeDirectories',runtime_dirs);
  END IF;
  FOR t IN SELECT value FROM jsonb_array_elements(m.publication->'bindings') LOOP
   IF NOT EXISTS(SELECT 1 FROM local_identity.episode_storage_location((t->>'episodeId')::uuid) l WHERE (l.asset_root,l.directory_relative_path,l.directory_device_id,l.directory_inode_id)=(t->>'actualRoot',t->>'relativePath',t->>'deviceId',t->>'inodeId')) OR NOT EXISTS(SELECT 1 FROM local_identity.episode_completed_storage_lineage((t->>'episodeId')::uuid) l WHERE l.operation_id='root-migration:'||m.id::text) THEN RAISE EXCEPTION 'Migration episode publication mismatch';END IF;
  END LOOP;
  FOR d IN SELECT value FROM jsonb_array_elements(m.manifest->'directories') WHERE value->>'kind' IN ('account','series','unassigned') LOOP
   SELECT value INTO t FROM jsonb_array_elements(m.publication->'directories') WHERE value->>'sourcePath'=d->'source'->>'path';
   IF d->>'kind'='account' THEN
    IF NOT EXISTS(SELECT 1 FROM local_identity.account_asset_directories a WHERE a.account_id=(d->>'accountId')::uuid AND (a.actual_root,a.device_id,a.inode_id)=(t->>'path',t->>'device',t->>'inode')) THEN RAISE EXCEPTION 'Migration account publication mismatch';END IF;
   ELSIF NOT EXISTS(SELECT 1 FROM local_identity.account_storage_containers c WHERE c.id=(d->>'containerId')::uuid AND (c.device_id,c.inode_id)=(t->>'device',t->>'inode')) THEN RAISE EXCEPTION 'Migration container publication mismatch';END IF;
  END LOOP;
 ELSE
  IF m.status NOT IN ('copying','failed') OR local_identity.media_root_binding() IS DISTINCT FROM m.manifest->'sourceBinding' THEN RAISE EXCEPTION 'Migration source publication mismatch';END IF;
 END IF;
 RETURN to_jsonb(m);
END $$;
CREATE FUNCTION local_identity.finish_media_root_migration(p_id uuid,p_sha text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM local_identity.media_root_publication_proof(p_id,p_sha);
 UPDATE local_identity.media_root_migrations SET status='completed',error=NULL,updated_at=clock_timestamp() WHERE id=p_id AND status IN ('committed','completed');
 IF NOT FOUND THEN RAISE EXCEPTION 'Migration not committed';END IF;
END $$;
REVOKE ALL ON FUNCTION local_identity.media_root_publication_proof(uuid,text),local_identity.finish_media_root_migration(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.media_root_publication_proof(uuid,text),local_identity.finish_media_root_migration(uuid,text) TO loop_app;

CREATE FUNCTION local_identity.guard_global_media_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM local_identity.require_media_root_writable();RETURN coalesce(NEW,OLD);END $$;
-- New durable work must not bypass the native application's HTTP drain.
CREATE TRIGGER global_media_task BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION local_identity.guard_global_media_write();
CREATE TRIGGER global_media_episode BEFORE INSERT OR DELETE ON public.episodes FOR EACH ROW EXECUTE FUNCTION local_identity.guard_global_media_write();
CREATE TRIGGER global_media_account BEFORE INSERT OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION local_identity.guard_global_media_write();

CREATE TRIGGER global_media_account_intent BEFORE INSERT ON local_identity.account_creation_intents FOR EACH ROW EXECUTE FUNCTION local_identity.guard_global_media_write();
CREATE TRIGGER global_media_container_intent BEFORE INSERT ON local_identity.container_creation_intents FOR EACH ROW EXECUTE FUNCTION local_identity.guard_global_media_write();
CREATE TRIGGER global_media_episode_intent BEFORE INSERT ON local_identity.episode_creation_intents FOR EACH ROW EXECUTE FUNCTION local_identity.guard_global_media_write();

-- Ordinary empty initialization shares the same durable global admission. A
-- zero-account failed copy is still an unfinished storage publication.
CREATE OR REPLACE FUNCTION local_identity.media_workspace_empty() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT local_identity.media_root_write_blocked()
 AND NOT EXISTS(SELECT 1 FROM public.accounts) AND NOT EXISTS(SELECT 1 FROM public.episodes)
 AND NOT EXISTS(SELECT 1 FROM local_identity.account_creation_intents WHERE result IS NULL)
 AND NOT EXISTS(SELECT 1 FROM local_identity.container_creation_intents WHERE result IS NULL)
 AND NOT EXISTS(SELECT 1 FROM local_identity.episode_creation_intents WHERE result IS NULL)
 AND NOT EXISTS(SELECT 1 FROM local_identity.episode_deletion_intents WHERE state IN ('prepared','committed'))
 AND NOT EXISTS(SELECT 1 FROM local_identity.account_directory_migrations WHERE status IN ('planned','copying','failed'))
$$;
