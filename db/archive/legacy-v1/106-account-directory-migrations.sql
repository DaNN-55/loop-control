-- Durable local migration receipts. Business records and original files are immutable.
CREATE TABLE local_identity.account_directory_migrations(
 id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('planned','copying','failed','completed','rolled_back')),
 manifest jsonb NOT NULL,error text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE local_identity.account_directory_locations(
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 source_root text NOT NULL,actual_root text NOT NULL,migration_id uuid NOT NULL REFERENCES local_identity.account_directory_migrations(id),
 PRIMARY KEY(account_id,source_root)
);
ALTER TABLE local_identity.account_directory_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.account_directory_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY directory_migration_owner ON local_identity.account_directory_migrations TO loop_app USING(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=account_directory_migrations.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner')) WITH CHECK(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=account_directory_migrations.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
CREATE POLICY directory_location_owner ON local_identity.account_directory_locations TO loop_app USING(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=account_directory_locations.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner')) WITH CHECK(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=account_directory_locations.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
GRANT SELECT,INSERT,UPDATE ON local_identity.account_directory_migrations,local_identity.account_directory_locations TO loop_app;
CREATE FUNCTION local_identity.account_mapped_asset_root(p_root text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT l.actual_root FROM local_identity.account_directory_locations l WHERE l.source_root=p_root AND (session_user IN ('postgres','loop_worker') OR EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=l.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner')) LIMIT 1),p_root)
$$;
REVOKE ALL ON FUNCTION local_identity.account_mapped_asset_root(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.account_mapped_asset_root(text) TO loop_app,loop_worker;
CREATE OR REPLACE FUNCTION local_identity.episode_asset_root(p_episode uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT x.actual_root FROM local_identity.account_directory_locations x WHERE x.account_id=e.account_id AND x.source_root=coalesce(l.asset_root,b.policy->>'asset_root')),l.asset_root,b.policy->>'asset_root')
 FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN local_identity.episode_asset_locations l ON l.episode_id=e.id
 WHERE e.id=p_episode AND (session_user IN ('loop_worker','postgres') OR EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'))
$$;
-- Lock the same rows as Owner production and lifecycle commands, plus all tasks.
-- Foreign-key inserts take a key-share on these rows, closing submission races.
CREATE FUNCTION local_identity.lock_account_directory_migration(p_account uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT local_identity.lock_owned_account_row(p_account) THEN RAISE EXCEPTION '账号不可见。' USING ERRCODE='42501';END IF;
 PERFORM id FROM public.episodes WHERE account_id=p_account ORDER BY id FOR UPDATE;
 PERFORM t.id FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id WHERE e.account_id=p_account ORDER BY t.id FOR UPDATE;
END $$;
REVOKE ALL ON FUNCTION local_identity.lock_account_directory_migration(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.lock_account_directory_migration(uuid) TO loop_app;
CREATE FUNCTION local_identity.account_directory_busy(p_account uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;f record;rejected uuid[]:='{}';unknowns uuid[]:='{}';table_rejected uuid[];table_unknown uuid[];BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.account_memberships WHERE account_id=p_account AND user_id=local_identity.owner_id() AND role='owner') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 -- A definite rejection may leave the paid ledger at submitting. Inspect all
 -- submission protocols first; any started/received evidence outweighs rejection.
 FOR f IN SELECT c.table_name FROM information_schema.columns c WHERE c.table_schema='local_identity' AND c.column_name='outcome' AND c.table_name LIKE '%submissions' LOOP
  EXECUTE format('SELECT coalesce(array_agg(DISTINCT s.task_id) FILTER(WHERE s.outcome=''rejected''),''{}''::uuid[]),coalesce(array_agg(DISTINCT s.task_id) FILTER(WHERE s.outcome IN (''started'',''received'')),''{}''::uuid[]) FROM local_identity.%I s JOIN public.tasks t ON t.id=s.task_id JOIN public.episodes e ON e.id=t.episode_id WHERE e.account_id=$1 AND t.status<>''completed''',f.table_name) INTO table_rejected,table_unknown USING p_account;
  rejected:=rejected||table_rejected;unknowns:=unknowns||table_unknown;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('taskId',t.id,'reason',CASE WHEN t.status IN ('ready','running') AND (t.invalidated_at IS NULL OR t.status='running') THEN '存在待执行或运行中的任务，请完成或明确处理后重新盘点。' ELSE '供应商提交结果尚未确认，请先恢复或核对已有请求。' END)),'[]') INTO result
 FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id
 WHERE e.account_id=p_account AND ((t.status IN ('ready','running') AND (t.invalidated_at IS NULL OR t.status='running')) OR (t.status<>'completed' AND (t.id=ANY(unknowns) OR (r.request_state<>'succeeded' AND NOT t.id=ANY(rejected)))));
 IF EXISTS(SELECT 1 FROM public.asset_locks l JOIN public.episodes e ON e.id=l.episode_id WHERE e.account_id=p_account AND l.expires_at>clock_timestamp()) THEN result:=result||jsonb_build_array(jsonb_build_object('reason','存在未释放的生产文件租约。'));END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION local_identity.account_directory_busy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.account_directory_busy(uuid) TO loop_app;
-- Inventory every episode-scoped row, including nested candidates/task snapshots,
-- native documents, exports, delivery records and future episode-scoped tables.
CREATE FUNCTION local_identity.account_directory_evidence(p_account uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f record;rows jsonb;result jsonb:='{}';BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.account_memberships WHERE account_id=p_account AND user_id=local_identity.owner_id() AND role='owner') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 FOR f IN SELECT c.table_schema,c.table_name FROM information_schema.columns c JOIN information_schema.tables t USING(table_schema,table_name) WHERE c.table_schema IN ('public','local_identity') AND c.column_name='episode_id' AND t.table_type='BASE TABLE' ORDER BY c.table_schema,c.table_name LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]'') FROM %I.%I r WHERE r.episode_id::text IN (SELECT id::text FROM public.episodes WHERE account_id=$1)',f.table_schema,f.table_name) INTO rows USING p_account;
  result:=result||jsonb_build_object(f.table_schema||'.'||f.table_name,rows);
 END LOOP;
 FOR f IN SELECT c.table_schema,c.table_name FROM information_schema.columns c JOIN information_schema.tables t USING(table_schema,table_name) WHERE c.table_schema IN ('public','local_identity') AND c.column_name='workspace_id' AND t.table_type='BASE TABLE' AND NOT EXISTS(SELECT 1 FROM information_schema.columns x WHERE x.table_schema=c.table_schema AND x.table_name=c.table_name AND x.column_name='episode_id') ORDER BY c.table_schema,c.table_name LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]'') FROM %I.%I r WHERE r.workspace_id::text IN (SELECT w.id::text FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id WHERE e.account_id=$1)',f.table_schema,f.table_name) INTO rows USING p_account;
  result:=result||jsonb_build_object(f.table_schema||'.'||f.table_name,rows);
 END LOOP;
 RETURN result||jsonb_build_object(
  'account_asset_directories',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM local_identity.account_asset_directories d WHERE d.account_id=p_account),
  'account_directory_locations',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.source_root),'[]') FROM local_identity.account_directory_locations l WHERE l.account_id=p_account),
  'blueprint_asset_roots',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'root',b.policy->>'asset_root') ORDER BY b.id),'[]') FROM public.account_blueprint_versions b WHERE b.account_id=p_account AND coalesce(b.policy->>'asset_root','')<>'')
 );
END $$;
REVOKE ALL ON FUNCTION local_identity.account_directory_evidence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.account_directory_evidence(uuid) TO loop_app;
CREATE FUNCTION local_identity.guard_directory_migration_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.episodes e JOIN local_identity.account_directory_migrations m ON m.account_id=e.account_id WHERE e.id=NEW.episode_id AND m.status='copying') THEN RAISE EXCEPTION '账号目录正在迁移，请完成或恢复迁移后继续制作。' USING ERRCODE='55000';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_directory_migration_task BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION local_identity.guard_directory_migration_task();

-- Reserve originals, pending targets and effective roots across hidden accounts.
CREATE OR REPLACE FUNCTION local_identity.account_asset_root_claims() RETURNS TABLE(account_id uuid,asset_root text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT account_id,actual_root FROM local_identity.account_asset_directories WHERE session_user IN ('loop_app','loop_worker')
 UNION SELECT account_id,asset_root FROM local_identity.episode_asset_locations WHERE session_user IN ('loop_app','loop_worker')
 UNION SELECT account_id,policy->>'asset_root' FROM public.account_blueprint_versions WHERE session_user IN ('loop_app','loop_worker') AND coalesce(policy->>'asset_root','')<>''
 UNION SELECT account_id,source_root FROM local_identity.account_directory_locations WHERE session_user IN ('loop_app','loop_worker')
 UNION SELECT account_id,actual_root FROM local_identity.account_directory_locations WHERE session_user IN ('loop_app','loop_worker')
 UNION SELECT account_id,manifest->>'targetRoot' FROM local_identity.account_directory_migrations WHERE session_user IN ('loop_app','loop_worker') AND status IN ('planned','copying','failed')
$$;
CREATE POLICY directory_migration_worker ON local_identity.account_directory_migrations FOR SELECT TO loop_worker USING(true);
GRANT SELECT ON local_identity.account_directory_migrations TO loop_worker;
