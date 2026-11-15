-- Four-step observations are distinct from the retained database episode_stage metric.
-- No backfill, new execution authority, or change to the opt-in collection control.
CREATE FUNCTION local_identity.append_production_workflow_milestone(p_episode uuid,p_milestone text,p_workspace uuid DEFAULT NULL,p_export uuid DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes; w local_identity.production_workspaces; x local_identity.workspace_exports;
 o uuid; coverage text; phase text; identity text; payload jsonb; occurred timestamptz; wrote boolean:=false;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM local_identity.production_metric_controls WHERE enabled) THEN RETURN false;END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF NOT FOUND OR e.archived_at IS NOT NULL OR local_identity.is_historical_episode(e.id)
  OR EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin WHERE episode_id=e.id) THEN RETURN false;END IF;
 payload:=jsonb_build_object('version','workflow-milestones/v1','milestone',p_milestone,'script_revision_id',e.main_script_revision_id);
 IF p_milestone='production_created' THEN
  phase:='script';identity:='creation:'||e.id;occurred:=e.created_at;
 ELSIF p_milestone='script_revision_saved' THEN
  IF e.stage<>'waiting_input' OR NOT EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id=e.main_script_revision_id AND episode_id=e.id AND material_type='script') THEN RETURN false;END IF;
  phase:='script';identity:='script_saved:'||e.main_script_revision_id;
 ELSIF p_milestone='script_confirmed' THEN
  IF e.stage<>'script_approved' OR NOT EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id=e.main_script_revision_id AND episode_id=e.id AND is_main_script) THEN RETURN false;END IF;
  phase:='preparation';identity:='script:'||e.main_script_revision_id;
 ELSE
  SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace AND episode_id=e.id AND script_revision_id=e.main_script_revision_id;
  IF NOT FOUND OR w.preparation_revision_id IS NULL OR w.workflow_version<>'four-step/v1' THEN RETURN false;END IF;
  payload:=payload||jsonb_build_object('workspace_id',w.id,'preparation_revision_id',w.preparation_revision_id);
  IF p_milestone='workspace_prepared' THEN
   phase:='preparation';identity:='preparation:'||w.id||':'||w.preparation_revision_id;
  ELSIF p_milestone IN('editing_opened','native_edit_saved') THEN
   phase:='editing';identity:=p_milestone||':'||w.id||':'||w.preparation_revision_id||':'||w.native_edit_revision;
   payload:=payload||jsonb_build_object('native_edit_revision',w.native_edit_revision);
   IF p_milestone='native_edit_saved' THEN payload:=payload||jsonb_build_object('project_revision',w.revision,'content_sha256',w.content_sha256);END IF;
  ELSIF p_milestone IN('export_ready','export_confirmed') THEN
   SELECT * INTO x FROM local_identity.workspace_exports WHERE id=p_export AND workspace_id=w.id AND episode_id=e.id
    AND status='ready' AND project_content_version=w.revision AND content_sha256=w.content_sha256;
   IF NOT FOUND OR p_milestone='export_confirmed' AND x.confirmed_at IS NULL THEN RETURN false;END IF;
   phase:='delivery';identity:=p_milestone||':'||x.id;
   payload:=payload||jsonb_build_object('export_id',x.id,'project_revision',x.project_content_version,'content_sha256',x.content_sha256);
  ELSE RAISE EXCEPTION 'Unsupported workflow milestone';END IF;
 END IF;
 payload:=payload||jsonb_build_object('phase',phase);
 FOR o IN SELECT m.user_id FROM public.account_memberships m JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE m.account_id=e.account_id AND m.role='owner' LOOP
  -- Reopening the same editor version is one occurrence per coverage period. Re-enabling
  -- observes a new actual open, never recreates the activity that happened while disabled.
  IF p_milestone='editing_opened' THEN
   SELECT (extract(epoch FROM started_at)*1000000)::bigint::text INTO coverage FROM local_identity.production_metric_coverage_periods WHERE owner_id=o AND ended_at IS NULL;
   IF coverage IS NULL THEN CONTINUE;END IF;
   wrote:=local_identity.append_production_metric(o,e.id,'workflow_milestone',identity||':'||coverage,payload) OR wrote;
  ELSE wrote:=local_identity.append_production_metric(o,e.id,'workflow_milestone',identity,payload,occurred) OR wrote;END IF;
 END LOOP;
 RETURN wrote;
END $$;
REVOKE ALL ON FUNCTION local_identity.append_production_workflow_milestone(uuid,text,uuid,uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;

CREATE FUNCTION local_identity.capture_production_workflow_milestone() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='episodes' THEN
  IF TG_OP='INSERT' THEN PERFORM local_identity.append_production_workflow_milestone(NEW.id,'production_created');
  ELSIF NEW.stage='waiting_input' AND NEW.main_script_revision_id IS NOT NULL AND OLD.main_script_revision_id IS DISTINCT FROM NEW.main_script_revision_id THEN
   PERFORM local_identity.append_production_workflow_milestone(NEW.id,'script_revision_saved');
  ELSIF NEW.stage='script_approved' AND (OLD.stage IS DISTINCT FROM NEW.stage OR OLD.main_script_revision_id IS DISTINCT FROM NEW.main_script_revision_id) THEN
   PERFORM local_identity.append_production_workflow_milestone(NEW.id,'script_confirmed');
  END IF;
 ELSIF TG_TABLE_NAME='production_workspaces' THEN
  IF TG_OP='INSERT' THEN PERFORM local_identity.append_production_workflow_milestone(NEW.episode_id,'workspace_prepared',NEW.id);
  ELSE
   IF OLD.preparation_revision_id IS DISTINCT FROM NEW.preparation_revision_id OR OLD.script_revision_id IS DISTINCT FROM NEW.script_revision_id THEN
    PERFORM local_identity.append_production_workflow_milestone(NEW.episode_id,'workspace_prepared',NEW.id);
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='workspace_exports' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.status='ready' THEN PERFORM local_identity.append_production_workflow_milestone(NEW.episode_id,'export_ready',NEW.workspace_id,NEW.id);END IF;
  ELSIF OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL THEN
   PERFORM local_identity.append_production_workflow_milestone(NEW.episode_id,'export_confirmed',NEW.workspace_id,NEW.id);
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION local_identity.capture_production_workflow_milestone() FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
CREATE TRIGGER production_workflow_script AFTER INSERT OR UPDATE OF stage,main_script_revision_id ON public.episodes FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_workflow_milestone();
CREATE TRIGGER production_workflow_workspace AFTER INSERT OR UPDATE OF preparation_revision_id,script_revision_id ON local_identity.production_workspaces FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_workflow_milestone();
CREATE TRIGGER production_workflow_export AFTER INSERT OR UPDATE OF confirmed_at ON local_identity.workspace_exports FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_workflow_milestone();

-- The authenticated backend records actual SDK opens and changed saves, never tab clicks.
CREATE FUNCTION local_identity.record_workspace_editing_milestone(p_workspace uuid,p_milestone text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces;
BEGIN
 IF p_milestone NOT IN ('editing_opened','native_edit_saved') THEN RAISE EXCEPTION 'Unsupported editor milestone' USING ERRCODE='22023';END IF;
 SELECT * INTO w FROM local_identity.lock_current_production_workspace(p_workspace);
 IF p_milestone='native_edit_saved' AND w.native_edit_revision=0 THEN RETURN false;END IF;
 RETURN local_identity.append_production_workflow_milestone(w.episode_id,p_milestone,w.id);
END $$;
REVOKE ALL ON FUNCTION local_identity.record_workspace_editing_milestone(uuid,text) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.record_workspace_editing_milestone(uuid,text) TO loop_app;
