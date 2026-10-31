-- The exact confirmation survives before any filesystem mutation and after Episode deletion.
-- Completed creation intents are immutable history, not a live child directory registry.
ALTER TABLE local_identity.container_creation_intents DROP CONSTRAINT container_creation_intents_account_id_fkey;
CREATE TABLE local_identity.episode_deletion_intents(
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),idempotency_key uuid NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),episode_id uuid NOT NULL,
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','committed','completed','rolled_back')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(owner_id,idempotency_key)
);
CREATE UNIQUE INDEX episode_deletion_reserved ON local_identity.episode_deletion_intents(episode_id) WHERE state='prepared';
ALTER TABLE local_identity.episode_deletion_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY episode_deletion_intent_owner ON local_identity.episode_deletion_intents TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.episode_deletion_intents FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT,INSERT ON local_identity.episode_deletion_intents TO loop_app;
CREATE FUNCTION local_identity.advance_episode_deletion_intent(p_key uuid,p_state text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF session_user<>'loop_app' OR p_state NOT IN ('committed','completed') OR NOT EXISTS(SELECT 1 FROM local_identity.command_receipts WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key AND result->>'cleanupKey'=p_key::text) OR EXISTS(SELECT 1 FROM public.episodes e JOIN local_identity.episode_deletion_intents i ON i.episode_id=e.id WHERE i.owner_id=local_identity.owner_id() AND i.idempotency_key=p_key) THEN RAISE EXCEPTION 'Owned committed deletion required' USING ERRCODE='42501';END IF;
 UPDATE local_identity.episode_deletion_intents SET state=p_state WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key AND (state='prepared' AND p_state='committed' OR state='committed' AND p_state='completed');
END $$;
REVOKE ALL ON FUNCTION local_identity.advance_episode_deletion_intent(uuid,text) FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.advance_episode_deletion_intent(uuid,text) TO loop_app;
CREATE FUNCTION local_identity.reserve_episode_deletion_intent(p_key uuid,p_reserve boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF session_user<>'loop_app' OR EXISTS(SELECT 1 FROM local_identity.command_receipts WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key) THEN RAISE EXCEPTION 'Uncommitted owned intent required' USING ERRCODE='42501';END IF;
 UPDATE local_identity.episode_deletion_intents SET state=CASE WHEN p_reserve THEN 'prepared' ELSE 'rolled_back' END WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key AND state IN ('prepared','rolled_back');
END $$;
REVOKE ALL ON FUNCTION local_identity.reserve_episode_deletion_intent(uuid,boolean) FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.reserve_episode_deletion_intent(uuid,boolean) TO loop_app;

CREATE FUNCTION local_identity.episode_deletion_submission_unknown(p_episode uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f record;rejected uuid[]:='{}';unknowns uuid[]:='{}';table_rejected uuid[];table_unknown uuid[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=p_episode AND m.user_id=local_identity.owner_id() AND m.role='owner') THEN RAISE EXCEPTION 'Owned Episode required' USING ERRCODE='42501';END IF;
 -- Reuse the account migration submission protocols, scoped to this Episode.
 FOR f IN SELECT table_name FROM information_schema.columns WHERE table_schema='local_identity' AND column_name='outcome' AND table_name LIKE '%submissions' LOOP
  EXECUTE format('SELECT coalesce(array_agg(DISTINCT s.task_id) FILTER(WHERE s.outcome=''rejected''),''{}''::uuid[]),coalesce(array_agg(DISTINCT s.task_id) FILTER(WHERE s.outcome IN (''started'',''received'')),''{}''::uuid[]) FROM local_identity.%I s JOIN public.tasks t ON t.id=s.task_id WHERE t.episode_id=$1 AND t.status<>''completed''',f.table_name) INTO table_rejected,table_unknown USING p_episode;
  rejected:=rejected||table_rejected;unknowns:=unknowns||table_unknown;
 END LOOP;
 RETURN EXISTS(SELECT 1 FROM public.tasks t LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id WHERE t.episode_id=p_episode AND t.status<>'completed' AND (t.id=ANY(unknowns) OR r.request_state<>'succeeded' AND NOT t.id=ANY(rejected)));
END $$;
REVOKE ALL ON FUNCTION local_identity.episode_deletion_submission_unknown(uuid) FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.episode_deletion_submission_unknown(uuid) TO loop_app;

-- Literal paths, including percent/underscore/Unicode, never become LIKE patterns.
CREATE OR REPLACE FUNCTION local_identity.history_media_path_referenced(p_path text,p_episode text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT local_identity.history_external_reference(p_path,p_episode)
 OR EXISTS(SELECT 1 FROM local_identity.history_versions v WHERE position(p_path in v.payload::text)>0 AND NOT EXISTS(SELECT 1 FROM local_identity.history_episode_records r WHERE r.owner_id=v.owner_id AND r.table_name=v.table_name AND r.row_key=v.row_key AND r.payload_sha256=v.payload_sha256 AND r.episode_id=p_episode))
$$;
