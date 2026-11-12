-- Extend the existing guarded deletion transaction; no FK or file scope changes.
DO $workspace_delete$
DECLARE original text;patched text;marker text:='  delete from public.shot_preparation_drafts where episode_id = p_episode_id;';
BEGIN
 original:=pg_get_functiondef('public.delete_episode(uuid,uuid)'::regprocedure);
 IF strpos(original,marker)=0 THEN RAISE EXCEPTION 'Guarded Episode deletion protocol changed'; END IF;
 patched:=replace(original,marker,$cleanup$
DELETE FROM local_identity.workspace_narration_submissions
 WHERE task_id IN (SELECT id FROM public.tasks WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_visual_submissions
 WHERE task_id IN (SELECT id FROM public.tasks WHERE episode_id=p_episode_id);

DELETE FROM local_identity.workspace_audio_requests
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_deliveries
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_export_issues
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);

DELETE FROM local_identity.workspace_caption_evidence
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_candidate_adoptions
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_candidate_decisions
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_image_requests
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_narration_requests
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_narrations
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_visual_candidates
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_audio_preparations
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_exports
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_shot_inputs
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_legacy_recoveries
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.production_workspace_versions
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.production_workspaces WHERE episode_id=p_episode_id;
DELETE FROM local_identity.workspace_preparations WHERE episode_id=p_episode_id;

$cleanup$||marker);
 EXECUTE patched;
END $workspace_delete$;
