-- Shared legacy media roots are read-only episode scopes, never exclusive
-- account write claims. Keep normal account-root overlap protection intact.
CREATE OR REPLACE FUNCTION local_identity.account_asset_root_claims()
 RETURNS TABLE(account_id uuid,asset_root text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH deployment AS (SELECT local_identity.media_deployment() value),
 globals AS (SELECT rtrim(value->>'targetRoot','/') root FROM deployment
  UNION SELECT rtrim(jsonb_array_elements_text(value->'sourceRoots'),'/') FROM deployment),
 roots AS (
  SELECT account_id,rtrim(asset_root,'/') root FROM local_identity.episode_asset_locations
  UNION SELECT account_id,rtrim(policy->>'asset_root','/') FROM public.account_blueprint_versions WHERE coalesce(policy->>'asset_root','')<>''
  UNION SELECT account_id,rtrim(source_root,'/') FROM local_identity.account_directory_locations
  UNION SELECT account_id,rtrim(actual_root,'/') FROM local_identity.account_directory_locations
 )
 SELECT d.account_id,d.actual_root FROM local_identity.account_asset_directories d WHERE session_user IN ('loop_app','loop_worker')
 UNION SELECT r.account_id,r.root FROM roots r WHERE session_user IN ('loop_app','loop_worker') AND NOT EXISTS(SELECT 1 FROM globals g WHERE g.root=r.root)
 UNION SELECT r.account_id,r.root||'/'||coalesce(l.directory_relative_path,'episodes/'||e.id::text)
  FROM roots r JOIN public.episodes e ON e.account_id=r.account_id
  LEFT JOIN local_identity.episode_asset_locations l ON l.episode_id=e.id
  WHERE session_user IN ('loop_app','loop_worker') AND EXISTS(SELECT 1 FROM globals g WHERE g.root=r.root)
 UNION SELECT m.account_id,m.manifest->>'targetRoot' FROM local_identity.account_directory_migrations m
  WHERE session_user IN ('loop_app','loop_worker') AND m.status IN ('planned','copying','failed')
$$;

-- The current location stays SQL110's single row. Edges only prove how an
-- immutable source coordinate reaches that row; they never grant a second root.
-- Completed migration/operation evidence survives ordinary account deletion,
-- just like SQL115's completed creation/deletion history. Live per-episode
-- edges cascade on explicit episode deletion; the immutable operation proof
-- and original migration manifest remain, without authorizing deleted objects.
ALTER TABLE local_identity.account_directory_migrations DROP CONSTRAINT account_directory_migrations_account_id_fkey;
CREATE TABLE local_identity.storage_location_operations(
 id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('adoption','restore','move')),
 migration_id uuid REFERENCES local_identity.account_directory_migrations(id),
 archive_sha256 text,proof jsonb NOT NULL,proof_sha256 text NOT NULL CHECK(proof_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='restore' AND archive_sha256 ~ '^[a-f0-9]{64}$' AND migration_id IS NULL) OR (kind IN ('adoption','move') AND migration_id IS NOT NULL AND archive_sha256 IS NULL))
);
CREATE TABLE local_identity.episode_storage_lineage(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 operation_id text NOT NULL REFERENCES local_identity.storage_location_operations(id),
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 source_root text NOT NULL,source_prefix text NOT NULL,source_device_id text NOT NULL,source_inode_id text NOT NULL,
 target_root text NOT NULL,target_prefix text NOT NULL,target_device_id text NOT NULL,target_inode_id text NOT NULL,
 UNIQUE(operation_id,episode_id,source_root,source_prefix),
 CHECK(left(source_root,1)='/' AND source_root<>'/' AND left(target_root,1)='/' AND target_root<>'/'),
 CHECK(source_prefix<>'' AND source_prefix !~ '(^/|\\|(^|/)\.{1,2}(/|$)|//|/$)' AND target_prefix<>'' AND target_prefix !~ '(^/|\\|(^|/)\.{1,2}(/|$)|//|/$)')
);
REVOKE ALL ON local_identity.storage_location_operations,local_identity.episode_storage_lineage FROM PUBLIC,loop_owner,loop_app,loop_worker,loop_anonymous;
ALTER TABLE local_identity.episode_storage_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.storage_location_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY storage_operation_owner ON local_identity.storage_location_operations FOR SELECT TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.account_directory_migrations d JOIN public.account_memberships m ON m.account_id=d.account_id WHERE d.id=storage_location_operations.migration_id AND m.user_id=local_identity.owner_id() AND m.role='owner') OR EXISTS(SELECT 1 FROM local_identity.episode_storage_lineage l JOIN public.account_memberships m ON m.account_id=l.account_id WHERE l.operation_id=storage_location_operations.id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
CREATE POLICY storage_operation_worker ON local_identity.storage_location_operations FOR SELECT TO loop_worker USING(true);
CREATE POLICY episode_lineage_owner ON local_identity.episode_storage_lineage FOR SELECT TO loop_app USING(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=episode_storage_lineage.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
CREATE POLICY episode_lineage_worker ON local_identity.episode_storage_lineage FOR SELECT TO loop_worker USING(true);
GRANT SELECT ON local_identity.storage_location_operations,local_identity.episode_storage_lineage TO loop_app,loop_worker;
CREATE FUNCTION local_identity.episode_completed_storage_lineage(p_episode uuid)
 RETURNS SETOF local_identity.episode_storage_lineage LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT l.* FROM local_identity.episode_storage_lineage l
 JOIN local_identity.storage_location_operations o ON o.id=l.operation_id
 LEFT JOIN local_identity.account_directory_migrations m ON m.id=o.migration_id
 JOIN public.episodes e ON e.id=l.episode_id AND e.account_id=l.account_id
 WHERE l.episode_id=p_episode AND o.proof_sha256=encode(sha256(convert_to(o.proof::text,'UTF8')),'hex')
 AND ((o.kind='restore' AND o.proof->>'archiveSha256'=o.archive_sha256
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.proof->'bindings') b WHERE b->>'episodeId'=l.episode_id::text AND b->>'accountId'=l.account_id::text
   AND (b->>'sourceRoot',b->>'relativePath',b->>'sourceDeviceId',b->>'sourceInodeId',b->>'actualRoot',b->>'relativePath',b->>'deviceId',b->>'inodeId')=(l.source_root,l.source_prefix,l.source_device_id,l.source_inode_id,l.target_root,l.target_prefix,l.target_device_id,l.target_inode_id)))
 OR (m.status='completed' AND o.proof=m.manifest AND m.account_id=l.account_id AND m.manifest->>'targetRoot'=l.target_root
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(m.manifest->'episodes') ep CROSS JOIN LATERAL jsonb_array_elements(ep->'sources') s
   WHERE ep->>'id'=l.episode_id::text AND ep->>'targetPrefix'=l.target_prefix AND (s->'root'->>'path',s->>'prefix',s->'directory'->>'device',s->'directory'->>'inode')=(l.source_root,l.source_prefix,l.source_device_id,l.source_inode_id))
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(m.manifest->'createdDirectories') d WHERE (d->>'path',d->>'device',d->>'inode')=(l.target_root||'/'||l.target_prefix,l.target_device_id,l.target_inode_id))))
 AND (session_user IN ('postgres','loop_worker') OR EXISTS(SELECT 1 FROM public.account_memberships a WHERE a.account_id=l.account_id AND a.user_id=local_identity.owner_id() AND a.role='owner')) ORDER BY l.id
$$;
REVOKE ALL ON FUNCTION local_identity.episode_completed_storage_lineage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.episode_completed_storage_lineage(uuid) TO loop_app,loop_worker;

CREATE FUNCTION local_identity.complete_storage_adoption(p_migration uuid,p_targets jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m local_identity.account_directory_migrations;e jsonb;s jsonb;t jsonb;op text;BEGIN
 IF session_user<>'loop_app' THEN RAISE EXCEPTION 'Trusted local service required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM local_identity.account_directory_migrations WHERE id=p_migration FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_account_row(m.account_id) THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF m.status<>'copying' OR m.manifest->>'kind'<>'adoption' OR jsonb_array_length(m.manifest->'conflicts')<>0 THEN RAISE EXCEPTION 'Adoption plan not executable' USING ERRCODE='55000';END IF;
 op:='adoption:'||m.id::text;
 INSERT INTO local_identity.storage_location_operations(id,kind,migration_id,proof,proof_sha256) VALUES(op,'adoption',m.id,m.manifest,encode(sha256(convert_to(m.manifest::text,'UTF8')),'hex'));
 FOR e IN SELECT value FROM jsonb_array_elements(m.manifest->'episodes') WHERE NOT (value->>'managed')::boolean LOOP
  SELECT value INTO t FROM jsonb_array_elements(p_targets) WHERE value->>'episodeId'=e->>'id';
  IF t IS NULL OR t->>'prefix'<>e->>'targetPrefix' OR t->>'path'<>(m.manifest->>'targetRoot')||'/'||(e->>'targetPrefix') OR NOT EXISTS(SELECT 1 FROM public.episodes WHERE id=(e->>'id')::uuid AND account_id=m.account_id) THEN RAISE EXCEPTION 'Adoption target mismatch';END IF;
  FOR s IN SELECT value FROM jsonb_array_elements(e->'sources') LOOP
   INSERT INTO local_identity.episode_storage_lineage(operation_id,episode_id,account_id,source_root,source_prefix,source_device_id,source_inode_id,target_root,target_prefix,target_device_id,target_inode_id)
    VALUES(op,(e->>'id')::uuid,m.account_id,s->'root'->>'path',s->>'prefix',s->'directory'->>'device',s->'directory'->>'inode',m.manifest->>'targetRoot',e->>'targetPrefix',t->>'device',t->>'inode');
  END LOOP;
  INSERT INTO local_identity.episode_asset_locations(episode_id,account_id,asset_root,directory_relative_path,directory_device_id,directory_inode_id,storage_series_id,layout_version)
   VALUES((e->>'id')::uuid,m.account_id,m.manifest->>'targetRoot',e->>'targetPrefix',t->>'device',t->>'inode',(e->>'seriesId')::uuid,2)
   ON CONFLICT(episode_id) DO UPDATE SET asset_root=excluded.asset_root,directory_relative_path=excluded.directory_relative_path,directory_device_id=excluded.directory_device_id,directory_inode_id=excluded.directory_inode_id,storage_series_id=excluded.storage_series_id,layout_version=2;
 END LOOP;
 UPDATE local_identity.account_directory_migrations SET status='completed',error=NULL,updated_at=clock_timestamp() WHERE id=m.id;
END $$;
REVOKE ALL ON FUNCTION local_identity.complete_storage_adoption(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.complete_storage_adoption(uuid,jsonb) TO loop_app;

CREATE FUNCTION local_identity.storage_physical_root(p_root text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH input AS(SELECT rtrim(p_root,'/') root),d AS(SELECT local_identity.media_deployment() value), a AS(SELECT jsonb_array_elements_text(value->'sourceRoots') root FROM d)
 SELECT CASE WHEN input.root=d.value->>'targetRoot' OR left(input.root,length(d.value->>'targetRoot')+1)=(d.value->>'targetRoot')||'/' THEN input.root
 ELSE coalesce((SELECT (d.value->>'targetRoot')||substring(input.root from length(a.root)+1) FROM a WHERE input.root=a.root OR left(input.root,length(a.root)+1)=a.root||'/' ORDER BY length(a.root) DESC LIMIT 1),input.root) END FROM d CROSS JOIN input
$$;
REVOKE ALL ON FUNCTION local_identity.storage_physical_root(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.storage_physical_root(text) TO loop_app,loop_worker;
CREATE FUNCTION local_identity.episode_storage_collection(p_episode uuid)
 RETURNS TABLE(container_id uuid,account_root text,kind text,series_id uuid,directory_relative_path text,device_id text,inode_id text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT c.id,a.actual_root,c.kind,c.series_id,c.directory_relative_path,c.device_id,c.inode_id
 FROM local_identity.episode_storage_location(p_episode) l
 JOIN local_identity.account_asset_directories a ON a.account_id=l.account_id AND a.actual_root=local_identity.storage_physical_root(l.asset_root)
 JOIN local_identity.account_storage_containers c ON c.account_id=l.account_id AND c.series_id IS NOT DISTINCT FROM l.storage_series_id
  AND c.kind=CASE WHEN l.storage_series_id IS NULL THEN 'unassigned' ELSE 'series' END
  AND left(l.directory_relative_path,length(c.directory_relative_path)+1)=c.directory_relative_path||'/'
  AND position('/' IN substring(l.directory_relative_path from length(c.directory_relative_path)+2))=0
 WHERE l.directory_device_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION local_identity.episode_storage_collection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.episode_storage_collection(uuid) TO loop_app,loop_worker;
CREATE FUNCTION local_identity.episode_current_reference(p_episode uuid,p_reference text) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH RECURSIVE current AS(SELECT *,local_identity.storage_physical_root(asset_root) root FROM local_identity.episode_storage_location(p_episode)),
 edges AS(SELECT * FROM local_identity.episode_completed_storage_lineage(p_episode)),
 walk(root,prefix,device,inode,suffix) AS(
  SELECT source_root,source_prefix,source_device_id,source_inode_id,substring(p_reference from length(source_prefix)+2)
   FROM edges WHERE left(p_reference,length(source_prefix)+1)=source_prefix||'/'
  UNION
  SELECT e.target_root,e.target_prefix,e.target_device_id,e.target_inode_id,w.suffix FROM walk w JOIN edges e
   ON (w.root,w.prefix,w.device,w.inode)=(e.source_root,e.source_prefix,e.source_device_id,e.source_inode_id)
 ), matches AS(SELECT c.directory_relative_path||'/'||w.suffix path FROM walk w CROSS JOIN current c
   WHERE (w.root,w.prefix,w.device,w.inode)=(c.root,c.directory_relative_path,c.directory_device_id,c.directory_inode_id))
 SELECT CASE WHEN p_reference ~ '(^/|\\|(^|/)\.{1,2}(/|$)|//|/$)' THEN NULL
 WHEN left(p_reference,length(c.directory_relative_path)+1)=c.directory_relative_path||'/' THEN p_reference
 ELSE (SELECT min(path) FROM matches HAVING count(DISTINCT path)=1) END FROM current c
$$;
REVOKE ALL ON FUNCTION local_identity.episode_current_reference(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.episode_current_reference(uuid,text) TO loop_app,loop_worker;
CREATE OR REPLACE FUNCTION local_identity.owned_studio_frozen_reference(p_episode uuid,p_reference jsonb) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(local_identity.episode_current_reference(p_episode,p_reference->>'relative_path') IS NOT NULL
 AND p_reference->>'relative_path' ~ '/(studio-frozen/[0-9a-f-]{36}/index[.]html|openchatcut-frozen/[0-9a-f-]{36}/project[.]json)$'
 AND EXISTS(SELECT 1 FROM public.artifacts a WHERE a.episode_id=p_episode AND a.relative_path=p_reference->>'relative_path' AND a.sha256=p_reference->>'sha256' AND a.file_size=(p_reference->>'file_size')::bigint),false)
$$;
DO $physical_publication$
DECLARE original text;patched text;BEGIN
 original:=pg_get_functiondef('local_identity.native_output_authority(uuid,integer,uuid,text[])'::regprocedure);
 patched:=replace(original,'PERFORM pg_advisory_xact_lock(hashtextextended(''native-output:''||path,0));',
 $new$IF local_identity.episode_current_reference(selected.episode_id,path) IS NULL THEN RAISE EXCEPTION 'Publication location proof missing' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-output:'||selected.episode_id::text||':'||local_identity.episode_current_reference(selected.episode_id,path),0));$new$);
 IF patched=original THEN RAISE EXCEPTION 'Native publication lock contract changed';END IF;
 original:=patched;
 patched:=replace(original,'a.producer_task_id IS DISTINCT FROM p_task_id AND a.relative_path=ANY(p_paths)',
 $new$a.producer_task_id IS DISTINCT FROM p_task_id AND a.episode_id=selected.episode_id AND local_identity.episode_current_reference(selected.episode_id,a.relative_path) IN (SELECT local_identity.episode_current_reference(selected.episode_id,p) FROM unnest(p_paths) p)$new$);
 IF patched=original THEN RAISE EXCEPTION 'Native publication conflict contract changed';END IF;EXECUTE patched;
END $physical_publication$;
