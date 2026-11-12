-- A root plan is deployment maintenance evidence, never another location system.
CREATE TABLE local_identity.media_root_migrations(
 id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 idempotency_key uuid NOT NULL,request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned')),
 manifest jsonb NOT NULL,manifest_sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(owner_id,idempotency_key)
);
CREATE FUNCTION local_identity.fingerprint_media_root_plan() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 NEW.manifest_sha256:=encode(sha256(convert_to(NEW.manifest::text,'UTF8')),'hex');RETURN NEW;
END $$;
CREATE TRIGGER fingerprint_media_root_plan BEFORE INSERT ON local_identity.media_root_migrations FOR EACH ROW EXECUTE FUNCTION local_identity.fingerprint_media_root_plan();
ALTER TABLE local_identity.media_root_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON local_identity.media_root_migrations FROM PUBLIC,loop_owner,loop_anonymous,loop_worker;
CREATE POLICY media_root_plan_owner ON local_identity.media_root_migrations TO loop_app USING(owner_id=local_identity.owner_id() AND owner_id=local_identity.media_root_owner()) WITH CHECK(owner_id=local_identity.owner_id() AND owner_id=local_identity.media_root_owner());
GRANT SELECT,INSERT ON local_identity.media_root_migrations TO loop_app;

CREATE FUNCTION local_identity.media_root_scope_accounts() RETURNS TABLE(id uuid,name text,owned boolean) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF local_identity.owner_id() IS DISTINCT FROM local_identity.media_root_owner() THEN RAISE EXCEPTION 'Storage Owner required' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT a.id,a.name,EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=a.id AND m.user_id=local_identity.owner_id() AND m.role='owner') FROM public.accounts a ORDER BY a.id;
END $$;
CREATE FUNCTION local_identity.media_root_pending_operations() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE pending_result jsonb;BEGIN
 IF local_identity.owner_id() IS DISTINCT FROM local_identity.media_root_owner() THEN RAISE EXCEPTION 'Storage Owner required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(x),'[]') INTO pending_result FROM(
 SELECT 'account_creation' kind,account_id object_id,'未完成的账号创建，请先恢复原操作。' reason FROM local_identity.account_creation_intents WHERE result IS NULL
 UNION ALL SELECT 'container_creation',account_id,'未完成的系列或未分系列目录创建，请先恢复原操作。' FROM local_identity.container_creation_intents WHERE result IS NULL
 UNION ALL SELECT 'episode_creation',episode_id,'未完成的生产单创建，请先恢复原操作。' FROM local_identity.episode_creation_intents WHERE result IS NULL
 UNION ALL SELECT 'episode_deletion',episode_id,'未完成的生产单删除，请先恢复原操作。' FROM local_identity.episode_deletion_intents WHERE state IN ('prepared','committed')
 UNION ALL SELECT 'account_migration',id,'存在未完成的账号目录计划，请先完成或回滚。' FROM local_identity.account_directory_migrations WHERE status IN ('planned','copying','failed')
 UNION ALL SELECT 'backup',id,'完整备份正在执行，请先完成或恢复原操作。' FROM local_identity.automation_jobs WHERE kind='backup' AND status='running'
 )x;RETURN pending_result;
END $$;
REVOKE ALL ON FUNCTION local_identity.media_root_scope_accounts(),local_identity.media_root_pending_operations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.media_root_scope_accounts(),local_identity.media_root_pending_operations() TO loop_app;

-- No business rows does not mean no reserved filesystem work. This function is
-- also called by bind_media_root inside the same global admission transaction.
CREATE OR REPLACE FUNCTION local_identity.media_workspace_empty() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.accounts) AND NOT EXISTS(SELECT 1 FROM public.episodes)
 AND NOT EXISTS(SELECT 1 FROM local_identity.account_creation_intents WHERE result IS NULL)
 AND NOT EXISTS(SELECT 1 FROM local_identity.container_creation_intents WHERE result IS NULL)
 AND NOT EXISTS(SELECT 1 FROM local_identity.episode_creation_intents WHERE result IS NULL)
 AND NOT EXISTS(SELECT 1 FROM local_identity.episode_deletion_intents WHERE state IN ('prepared','committed'))
 AND NOT EXISTS(SELECT 1 FROM local_identity.account_directory_migrations WHERE status IN ('planned','copying','failed'))
$$;
