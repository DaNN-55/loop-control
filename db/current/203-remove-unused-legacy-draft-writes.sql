-- Close the remaining unused Owner-callable legacy draft writers.
-- Current narration, gain and caption inputs use production workspace contracts.
-- Keep original migrations, history reads, shared tasks and immutable records.
DO $retired_dependency_check$
DECLARE targets text[] := ARRAY[
 'local_identity.use_workspace_narration_track(uuid,uuid,text,uuid)',
 'local_identity.save_script_shot_gains(uuid,uuid,text,numeric,numeric,numeric)',
 'local_identity.save_workspace_caption_input(uuid,uuid,jsonb)'
]; blockers text;
BEGIN
 SELECT string_agg(p.oid::regprocedure::text||' -> '||t.signature,E'\n' ORDER BY p.oid::regprocedure::text,t.signature)
 INTO blockers
 FROM unnest(targets) AS t(signature)
 JOIN pg_proc target ON target.oid=to_regprocedure(t.signature)
 CROSS JOIN pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','local_identity','loop_internal') AND p.prokind='f'
 AND NOT EXISTS(SELECT 1 FROM unnest(targets) own(signature) WHERE to_regprocedure(own.signature)=p.oid)
 AND p.prosrc ~ ('\m'||target.proname||'\s*\(');
 IF blockers IS NOT NULL THEN RAISE EXCEPTION 'Retired execution functions still have consumers: %',blockers USING ERRCODE='2BP01'; END IF;
END
$retired_dependency_check$;

DROP FUNCTION IF EXISTS local_identity.use_workspace_narration_track(uuid,uuid,text,uuid) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.save_script_shot_gains(uuid,uuid,text,numeric,numeric,numeric) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.save_workspace_caption_input(uuid,uuid,jsonb) RESTRICT;
