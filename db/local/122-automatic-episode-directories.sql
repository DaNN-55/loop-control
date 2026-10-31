-- Formal Owner creation reserves identity and creative references before touching disk.
-- No business/account FK: completed creation intents remain immutable history after deletion.
CREATE TABLE local_identity.episode_creation_intents(
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),idempotency_key uuid NOT NULL,payload_hash text NOT NULL,payload jsonb NOT NULL,
 episode_id uuid NOT NULL UNIQUE,account_id uuid NOT NULL,blueprint_version_id uuid NOT NULL,series_version_id uuid,
 container_id uuid NOT NULL,storage_series_id uuid,directory_relative_path text NOT NULL,
 account_root text NOT NULL,account_device_id text NOT NULL,account_inode_id text NOT NULL,
 container_relative_path text NOT NULL,container_device_id text NOT NULL,container_inode_id text NOT NULL,
 root_binding jsonb NOT NULL,marker uuid NOT NULL,device_id text,inode_id text,marker_device_id text,marker_inode_id text,cleanup_owned boolean NOT NULL DEFAULT false,
 result jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(owner_id,idempotency_key),
 CHECK((device_id IS NULL)=(inode_id IS NULL)),CHECK((marker_device_id IS NULL)=(marker_inode_id IS NULL)),UNIQUE(account_id,directory_relative_path)
);
REVOKE ALL ON local_identity.episode_creation_intents FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
ALTER TABLE local_identity.episode_creation_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY episode_creation_owner ON local_identity.episode_creation_intents TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
GRANT SELECT,INSERT,UPDATE ON local_identity.episode_creation_intents TO loop_app;

-- Only this trusted fixed-intent boundary may register layout2. No general location UPDATE grant.
-- A reserved blueprint may cease to be current while disk is unavailable; its fixed ID remains valid.
CREATE FUNCTION local_identity.create_episode_from_intent(p_key uuid) RETURNS public.episodes LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i local_identity.episode_creation_intents;created public.episodes;
BEGIN
 SELECT * INTO i FROM local_identity.episode_creation_intents WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key AND result IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_account_row(i.account_id) THEN RAISE EXCEPTION 'Owned creation intent required' USING ERRCODE='42501';END IF;
 IF i.device_id IS NULL OR i.marker_device_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=i.account_id AND archived_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM public.account_blueprint_versions WHERE id=i.blueprint_version_id AND account_id=i.account_id)
 OR (i.series_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.series_versions WHERE id=i.series_version_id AND account_id=i.account_id AND series_id=i.storage_series_id))
 OR NOT EXISTS(SELECT 1 FROM local_identity.account_asset_directories WHERE account_id=i.account_id AND actual_root=i.account_root AND device_id=i.account_device_id AND inode_id=i.account_inode_id)
 OR NOT EXISTS(SELECT 1 FROM local_identity.account_storage_containers WHERE id=i.container_id AND account_id=i.account_id AND series_id IS NOT DISTINCT FROM i.storage_series_id AND directory_relative_path=i.container_relative_path AND device_id=i.container_device_id AND inode_id=i.container_inode_id)
 THEN RAISE EXCEPTION 'Creation intent references changed' USING ERRCODE='40001';END IF;
 INSERT INTO public.episodes(id,account_id,blueprint_version_id,series_version_id,title,stage,is_test) VALUES(i.episode_id,i.account_id,i.blueprint_version_id,i.series_version_id,trim(coalesce(i.payload->>'title','')),'waiting_input',coalesce((i.payload->>'isTest')::boolean,false)) RETURNING * INTO created;
 UPDATE local_identity.episode_asset_locations SET asset_root=i.account_root,directory_relative_path=i.directory_relative_path,directory_device_id=i.device_id,directory_inode_id=i.inode_id,storage_series_id=i.storage_series_id,layout_version=2 WHERE episode_id=i.episode_id AND account_id=i.account_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Episode location registration missing' USING ERRCODE='40001';END IF;
 INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES(i.episode_id,i.owner_id);
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(i.account_id,i.episode_id,'episode_created',jsonb_build_object('blueprint_version_id',i.blueprint_version_id,'series_version_id',i.series_version_id,'is_test',created.is_test),i.owner_id);
 RETURN created;
END $$;
REVOKE ALL ON FUNCTION local_identity.create_episode_from_intent(uuid) FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.create_episode_from_intent(uuid) TO loop_app;

-- Pending reservations freeze creative rules just as committed episodes do.
CREATE OR REPLACE FUNCTION public.update_current_blueprint(p_account_id uuid,p_policy jsonb) RETURNS public.account_blueprint_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.accounts;b public.account_blueprint_versions;next_version integer;
BEGIN
 IF jsonb_typeof(p_policy) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Blueprint policy must be a JSON object' USING ERRCODE='22023';END IF;
 SELECT account.* INTO a FROM public.accounts account JOIN public.account_memberships m ON m.account_id=account.id AND m.user_id=local_identity.owner_id() AND m.role='owner' WHERE account.id=p_account_id FOR UPDATE OF account;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner membership is required to update a blueprint' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.account_blueprint_versions WHERE id=a.current_blueprint_version_id AND account_id=a.id AND is_active AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The current blueprint is unavailable' USING ERRCODE='22023';END IF;
 p_policy:=public.creative_account_rules(p_policy);
 IF b.policy IS DISTINCT FROM p_policy AND (EXISTS(SELECT 1 FROM public.episodes WHERE blueprint_version_id=b.id) OR EXISTS(SELECT 1 FROM local_identity.episode_creation_intents WHERE blueprint_version_id=b.id AND result IS NULL)) THEN
  SELECT coalesce(max(version),0)+1 INTO next_version FROM public.account_blueprint_versions WHERE account_id=a.id;
  UPDATE public.account_blueprint_versions SET is_active=false,archived_at=now(),is_snapshot=true WHERE id=b.id;
  INSERT INTO public.account_blueprint_versions(account_id,version,policy,is_active) VALUES(a.id,next_version,p_policy,true) RETURNING * INTO b;
  UPDATE public.accounts SET current_blueprint_version_id=b.id WHERE id=a.id;
 ELSIF b.policy IS DISTINCT FROM p_policy THEN
  UPDATE public.account_blueprint_versions SET policy=p_policy WHERE id=b.id RETURNING * INTO b;
 END IF;
 INSERT INTO public.audit_events(account_id,event_type,payload,actor_id) VALUES(a.id,'blueprint_policy_updated',jsonb_build_object('blueprint_version_id',b.id,'version',b.version),local_identity.owner_id());RETURN b;
END $$;

-- The existing migration/quiescence boundary also includes reserved production directories.
CREATE OR REPLACE FUNCTION local_identity.account_directory_busy(p_account uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
 IF EXISTS(SELECT 1 FROM local_identity.episode_creation_intents i WHERE i.account_id=p_account AND i.result IS NULL) THEN result:=result||jsonb_build_array(jsonb_build_object('reason','存在未完成的生产单目录创建，请先恢复原操作。'));END IF;
 RETURN result;
END $$;
