-- Remove the remaining disconnected pre-independent-input compatibility surface.
-- Keep immutable history, current storage checks and shared Worker execution.
-- Reject unreviewed body consumers; RESTRICT also checks catalog dependencies.
DO $retired_dependency_check$
DECLARE targets text[] := ARRAY[
 'local_identity.caption_text_is_confirmed(uuid)',
 'local_identity.lock_owned_revision_tasks(uuid)',
 'local_identity.record_script_production_configuration(uuid,text)',
 'local_identity.register_workspace_manual_narration(uuid,text,uuid,numeric,text)',
 'local_identity.register_workspace_preparation(uuid,uuid,uuid,jsonb,jsonb,text)',
 'local_identity.request_workspace_caption_alignment(uuid,uuid,text,boolean,uuid,text,uuid)',
 'local_identity.studio_audio_members(uuid,uuid)',
 'local_identity.studio_duration_settings(uuid)',
 'public.shot_duration_settings(uuid)',
 'public.storyboard_selected_audio_members(uuid,uuid)'
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


DROP FUNCTION IF EXISTS local_identity.caption_text_is_confirmed(uuid) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.lock_owned_revision_tasks(uuid) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.record_script_production_configuration(uuid,text) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.register_workspace_manual_narration(uuid,text,uuid,numeric,text) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.register_workspace_preparation(uuid,uuid,uuid,jsonb,jsonb,text) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.request_workspace_caption_alignment(uuid,uuid,text,boolean,uuid,text,uuid) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.studio_audio_members(uuid,uuid) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.studio_duration_settings(uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.shot_duration_settings(uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.storyboard_selected_audio_members(uuid,uuid) RESTRICT;
