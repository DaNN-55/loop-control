-- Account directories are local I/O ownership, independent of creative blueprints.
CREATE TABLE local_identity.account_asset_directories(
 account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
 actual_root text NOT NULL UNIQUE CHECK(left(actual_root,1)='/' AND actual_root<>'/'),
 device_id text NOT NULL,inode_id text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE local_identity.episode_asset_locations(
 episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 asset_root text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Preserve the exact historical references; no disk scan, copy, or path rewrite.
INSERT INTO local_identity.episode_asset_locations(episode_id,account_id,asset_root)
 SELECT e.id,e.account_id,b.policy->>'asset_root' FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE coalesce(b.policy->>'asset_root','')<>'';
ALTER TABLE local_identity.account_asset_directories ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.episode_asset_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_directory_owner ON local_identity.account_asset_directories TO loop_app USING(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=account_asset_directories.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner')) WITH CHECK(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=account_asset_directories.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
CREATE POLICY episode_location_owner ON local_identity.episode_asset_locations TO loop_app USING(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=episode_asset_locations.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
GRANT SELECT,INSERT,UPDATE,DELETE ON local_identity.account_asset_directories TO loop_app;
GRANT SELECT ON local_identity.episode_asset_locations TO loop_app;
CREATE FUNCTION local_identity.episode_asset_root(p_episode uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(l.asset_root,b.policy->>'asset_root') FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN local_identity.episode_asset_locations l ON l.episode_id=e.id
 WHERE e.id=p_episode AND (session_user IN ('loop_worker','postgres') OR EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'))
$$;
REVOKE ALL ON FUNCTION local_identity.episode_asset_root(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.episode_asset_root(uuid) TO loop_app,loop_worker;
CREATE FUNCTION local_identity.freeze_episode_asset_location() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE root text;BEGIN
 SELECT actual_root INTO root FROM local_identity.account_asset_directories WHERE account_id=NEW.account_id;
 IF root IS NULL THEN
  IF session_user='loop_app' THEN RAISE EXCEPTION '请先在账号配置中设置实际专属目录。' USING ERRCODE='55000';END IF;
  SELECT policy->>'asset_root' INTO root FROM public.account_blueprint_versions WHERE id=NEW.blueprint_version_id;
 END IF;
 IF coalesce(root,'')<>'' THEN INSERT INTO local_identity.episode_asset_locations(episode_id,account_id,asset_root) VALUES(NEW.id,NEW.account_id,root);END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION local_identity.freeze_episode_asset_location() FROM PUBLIC;
CREATE TRIGGER freeze_episode_asset_location AFTER INSERT ON public.episodes FOR EACH ROW EXECUTE FUNCTION local_identity.freeze_episode_asset_location();
-- Trusted local service sees occupancy across RLS so hidden accounts are protected too.
CREATE FUNCTION local_identity.account_asset_root_claims() RETURNS TABLE(account_id uuid,asset_root text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT account_id,actual_root FROM local_identity.account_asset_directories WHERE session_user IN ('loop_app','loop_worker')
 UNION SELECT account_id,asset_root FROM local_identity.episode_asset_locations WHERE session_user IN ('loop_app','loop_worker')
 UNION SELECT account_id,policy->>'asset_root' FROM public.account_blueprint_versions WHERE session_user IN ('loop_app','loop_worker') AND coalesce(policy->>'asset_root','')<>''
$$;
REVOKE ALL ON FUNCTION local_identity.account_asset_root_claims() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.account_asset_root_claims() TO loop_app,loop_worker;
CREATE OR REPLACE FUNCTION local_identity.account_directory_has_references(p_paths text[]) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF session_user<>'loop_app' OR local_identity.owner_id() IS NULL THEN RAISE EXCEPTION 'Owner session required' USING ERRCODE='42501';END IF;
 IF cardinality(p_paths) IS NULL OR cardinality(p_paths)=0 OR cardinality(p_paths)>256 OR EXISTS(SELECT 1 FROM unnest(p_paths) p WHERE p IS NULL OR left(p,1)<>'/' OR p='/') THEN RAISE EXCEPTION 'Invalid account directory paths' USING ERRCODE='22023';END IF;
 RETURN EXISTS(SELECT 1 FROM local_identity.account_asset_root_claims() r CROSS JOIN unnest(p_paths) p WHERE rtrim(r.asset_root,'/')=p OR left(rtrim(r.asset_root,'/'),length(p)+1)=p||'/' OR left(p,length(rtrim(r.asset_root,'/'))+1)=rtrim(r.asset_root,'/')||'/');
END $$;
-- The old stage trigger remains a real location guard, without blueprint ownership.
CREATE OR REPLACE FUNCTION public.require_production_asset_root() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.stage NOT IN ('waiting_input','script_review') AND coalesce(local_identity.episode_asset_root(NEW.id),'')='' THEN RAISE EXCEPTION '请先设置账号专属目录。' USING ERRCODE='55000';END IF;RETURN NEW;
END $$;
-- Keep the established scheduler / lease protocol and task-package evidence intact.
DO $account_worker_root$
DECLARE original text;patched text;marker text:='coalesce(blueprint.policy ->> ''asset_root'','''')';BEGIN
 original:=pg_get_functiondef('public.claim_next_worker_task_legacy(uuid)'::regprocedure);
 IF strpos(original,marker)=0 THEN RAISE EXCEPTION 'Worker root protocol changed';END IF;
 patched:=replace(original,marker,'coalesce(local_identity.episode_asset_root(episode.id),'''')');
 EXECUTE patched;
END $account_worker_root$;
-- Existing visual-candidate reads expose the same immutable episode location.
DO $candidate_root$
DECLARE f record;original text;BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='local_identity' AND p.prosrc LIKE '%''root'',b.policy->>''asset_root''%' LOOP
  original:=pg_get_functiondef(f.oid);
  EXECUTE replace(original,'''root'',b.policy->>''asset_root''','''root'',local_identity.episode_asset_root(e.id)');
 END LOOP;
END $candidate_root$;
CREATE POLICY account_directory_worker ON local_identity.account_asset_directories FOR SELECT TO loop_worker USING(true);
GRANT SELECT ON local_identity.account_asset_directories TO loop_worker;
