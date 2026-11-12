-- Owner-authorized consolidation. History is readable, never an execution queue.
CREATE TABLE local_identity.history_sources(
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 kind text NOT NULL,label text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',imported_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE local_identity.history_versions(
 table_name text NOT NULL,row_key jsonb NOT NULL,payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),payload jsonb NOT NULL,
 PRIMARY KEY(table_name,row_key,payload_sha256));
CREATE TABLE local_identity.history_source_rows(
 source_id text NOT NULL REFERENCES local_identity.history_sources(id),table_name text NOT NULL,row_key jsonb NOT NULL,payload_sha256 text NOT NULL,
 PRIMARY KEY(source_id,table_name,row_key,payload_sha256),
 FOREIGN KEY(table_name,row_key,payload_sha256) REFERENCES local_identity.history_versions(table_name,row_key,payload_sha256));
CREATE TABLE local_identity.history_files(
 source_id text NOT NULL REFERENCES local_identity.history_sources(id),logical_path text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes bigint NOT NULL CHECK(bytes>=0),kind text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(source_id,logical_path,sha256));
CREATE TABLE local_identity.historical_tasks(task_id uuid PRIMARY KEY REFERENCES public.tasks(id));
REVOKE ALL ON local_identity.history_sources,local_identity.history_versions,local_identity.history_source_rows,local_identity.history_files,local_identity.historical_tasks FROM PUBLIC;
ALTER TABLE local_identity.history_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.history_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.history_source_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.history_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_history_sources ON local_identity.history_sources TO loop_owner USING(owner_id=local_identity.owner_id());
CREATE POLICY owner_history_versions ON local_identity.history_versions TO loop_owner USING(owner_id=local_identity.owner_id());
CREATE POLICY owner_history_source_rows ON local_identity.history_source_rows TO loop_owner USING(EXISTS(SELECT 1 FROM local_identity.history_sources s WHERE s.id=source_id AND s.owner_id=local_identity.owner_id()));
CREATE POLICY owner_history_files ON local_identity.history_files TO loop_owner USING(EXISTS(SELECT 1 FROM local_identity.history_sources s WHERE s.id=source_id AND s.owner_id=local_identity.owner_id()));
GRANT SELECT ON local_identity.history_sources,local_identity.history_versions,local_identity.history_source_rows,local_identity.history_files TO loop_owner;
-- All three claimants share this explicit fence, including direct task claims.
DO $$DECLARE sig text;body text;changed text;BEGIN
 FOREACH sig IN ARRAY ARRAY['local_identity.claim_input_task_pre_lease(uuid,integer)','public.claim_next_worker_task_legacy(uuid)','public.claim_next_worker_task_pre_lease(uuid,integer)'] LOOP
 body:=pg_get_functiondef(sig::regprocedure);
 changed:=regexp_replace(body,'(task\.status\s*=\s*''ready'')','\1 AND NOT EXISTS(SELECT 1 FROM local_identity.historical_tasks h WHERE h.task_id=task.id)','gi');
 IF changed=body THEN RAISE EXCEPTION 'Claim history fence target changed: %',sig;END IF;EXECUTE changed;
 END LOOP;
END $$;
