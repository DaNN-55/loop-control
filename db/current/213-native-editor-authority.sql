-- A verified native document owns final editing and delivery. Generation
-- continues to require its original confirmed preparation and authorization.
ALTER TABLE local_identity.production_workspaces ADD COLUMN editor_authority text NOT NULL DEFAULT 'preparation' CHECK(editor_authority IN ('preparation','native'));

CREATE OR REPLACE FUNCTION local_identity.sync_production_workspace_shots(p_workspace uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE w local_identity.production_workspaces; p local_identity.production_preparation_revisions; shot record; position integer;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned workspace required' USING ERRCODE='42501';END IF;
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF w.editor_authority='native' THEN
  IF NOT EXISTS(SELECT 1 FROM public.episodes e WHERE e.id=w.episode_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_historical_episode(e.id)) THEN RAISE EXCEPTION 'Writable native workspace required' USING ERRCODE='55000';END IF;
  RETURN;
 END IF;
 SELECT * INTO p FROM local_identity.production_preparation_revisions WHERE id=coalesce(w.preparation_revision_id,w.storyboard_package_id) AND episode_id=w.episode_id AND script_revision_id=w.script_revision_id;
 IF p.id IS NULL OR NOT local_identity.preparation_source_current(p.id) OR NOT EXISTS(SELECT 1 FROM public.episodes e WHERE e.id=w.episode_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_historical_episode(e.id)) THEN
  RAISE EXCEPTION 'Imported current preparation required before editing' USING ERRCODE='40001';
 END IF;
 UPDATE local_identity.production_workspaces SET preparation_revision_id=p.id WHERE id=w.id AND preparation_revision_id IS DISTINCT FROM p.id;
 SELECT coalesce(max(v.position),0) INTO position FROM local_identity.production_shot_versions v WHERE v.preparation_revision_id=p.id;
 FOR shot IN SELECT b->>'shotId' id FROM jsonb_array_elements(w.bindings) WITH ORDINALITY a(b,ordinal) GROUP BY b->>'shotId' ORDER BY min(ordinal) LOOP
  IF shot.id IS NULL OR btrim(shot.id)='' THEN RAISE EXCEPTION 'Stable shot identity required' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT 1 FROM local_identity.production_shot_versions v WHERE v.preparation_revision_id=p.id AND v.shot_id=shot.id) THEN
   position:=position+1;
   INSERT INTO local_identity.production_shots(episode_id,shot_id) VALUES(w.episode_id,shot.id) ON CONFLICT DO NOTHING;
   INSERT INTO local_identity.production_shot_versions(preparation_revision_id,episode_id,shot_id,position,origin,baseline_text,snapshot) VALUES(p.id,w.episode_id,shot.id,position,'local','',jsonb_build_object('id',shot.id));
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION local_identity.stop_workspace_queued_tasks(p_workspace uuid, p_kind text, p_shot text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE w local_identity.production_workspaces; stopped integer;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned current workspace required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=w.episode_id AND p.script_revision_id=w.script_revision_id
  WHERE e.id=w.episode_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_historical_episode(e.id)
  AND (w.editor_authority='native' OR e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id))) THEN RAISE EXCEPTION 'Current writable workspace required' USING ERRCODE='55000';END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('narration','bgm','sfx','shot') OR
  (p_kind IN ('narration','shot') AND (p_shot IS NULL OR length(p_shot)=0)) OR
  (p_kind IN ('bgm','sfx') AND p_shot IS NOT NULL) THEN RAISE EXCEPTION 'Invalid stopped content scope' USING ERRCODE='22023';END IF;
 IF p_kind='shot' AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot) THEN RAISE EXCEPTION 'Shot is still in the current workspace' USING ERRCODE='22023';END IF;
 WITH scoped AS (
  SELECT r.task_id FROM local_identity.workspace_narration_requests r WHERE r.workspace_id=w.id AND r.shot_id=p_shot AND p_kind IN ('narration','shot')
  UNION SELECT r.task_id FROM local_identity.workspace_audio_requests r JOIN local_identity.workspace_audio_preparations p ON p.id=r.preparation_id
   WHERE r.workspace_id=w.id AND (p_kind IN ('bgm','sfx') AND p.kind=p_kind OR p_kind='shot' AND p.shot_id=p_shot)
  UNION SELECT v.task_id FROM local_identity.workspace_visual_candidates v WHERE v.workspace_id=w.id AND p_kind='shot' AND v.shot_id=p_shot
 )
 UPDATE public.tasks t SET status='superseded',invalidated_at=clock_timestamp(),invalidated_reason='当前用途已关闭或删除，不再自动执行。'
 WHERE t.id IN (SELECT task_id FROM scoped) AND t.episode_id=w.episode_id AND t.status='ready' AND t.invalidated_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions s WHERE s.task_id=t.id AND s.outcome IN ('started','received'))
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_visual_submissions s WHERE s.task_id=t.id AND s.outcome IN ('started','received'))
  AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id)
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_publication_holds(w.episode_id) h WHERE h.task_id=t.id)
  AND NOT (coalesce(t.last_result#>'{preflight,checks}','[]'::jsonb) @> '[{"check":"provider_result_unknown"}]'::jsonb);
 GET DIAGNOSTICS stopped=ROW_COUNT;
 IF stopped>0 THEN INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id)
  SELECT e.account_id,e.id,'workspace_queued_content_stopped',jsonb_build_object('workspace_id',w.id,'kind',p_kind,'shot_id',p_shot,'stopped_count',stopped),local_identity.owner_id() FROM public.episodes e WHERE e.id=w.episode_id;END IF;
 RETURN stopped;
END $$;

CREATE OR REPLACE FUNCTION local_identity.workspace_delivery_current(p_workspace uuid, p_export uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 SELECT EXISTS(SELECT 1 FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=w.episode_id AND p.script_revision_id=w.script_revision_id JOIN local_identity.workspace_exports x ON x.workspace_id=w.id
 WHERE w.id=p_workspace AND x.id=p_export AND x.status='ready' AND x.confirmed_at IS NOT NULL AND x.project_content_version=w.revision AND x.content_sha256=w.content_sha256 AND (w.editor_authority='native' OR e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id)) AND e.archived_at IS NULL
 AND x.id=(SELECT id FROM local_identity.workspace_exports WHERE workspace_id=w.id ORDER BY created_at DESC,id DESC LIMIT 1)
 AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_export_issues i WHERE i.workspace_id=w.id AND (i.resolved_at IS NULL OR i.created_at>x.confirmed_at)))
$$;

-- Editing observations must not reopen or authorize generation from an old script.
CREATE FUNCTION local_identity.lock_editable_production_workspace(p_workspace uuid)
RETURNS local_identity.production_workspaces LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE w local_identity.production_workspaces;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned workspace required' USING ERRCODE='42501';END IF;
 IF w.editor_authority<>'native' THEN RETURN local_identity.lock_current_production_workspace(p_workspace);END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e WHERE e.id=w.episode_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_historical_episode(e.id) AND NOT local_identity.is_recycled_episode(e.id)) THEN RAISE EXCEPTION 'Writable native workspace required' USING ERRCODE='55000';END IF;
 RETURN w;
END $$;
REVOKE ALL ON FUNCTION local_identity.lock_editable_production_workspace(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION local_identity.record_workspace_editing_milestone(p_workspace uuid, p_milestone text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE w local_identity.production_workspaces;
BEGIN
 IF p_milestone NOT IN ('editing_opened','native_edit_saved') THEN RAISE EXCEPTION 'Unsupported editor milestone' USING ERRCODE='22023';END IF;
 SELECT * INTO w FROM local_identity.lock_editable_production_workspace(p_workspace);
 IF p_milestone='native_edit_saved' AND w.native_edit_revision=0 THEN RETURN false;END IF;
 RETURN local_identity.append_production_workflow_milestone(w.episode_id,p_milestone,w.id);
END $$;

CREATE OR REPLACE FUNCTION local_identity.record_workspace_local_export(p_workspace uuid, p_export uuid, p_phase text, p_started_at timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE w local_identity.production_workspaces; x local_identity.workspace_exports; o uuid:=local_identity.owner_id();
 at_time timestamptz:=clock_timestamp(); covered boolean; payload jsonb; prior jsonb; event text; identity text;
BEGIN
 SELECT * INTO w FROM local_identity.lock_editable_production_workspace(p_workspace);
 IF NOT local_identity.production_metrics_enabled() THEN RETURN false;END IF;
 IF p_export IS NULL OR p_phase IS NULL OR p_phase NOT IN('finished','rejected') OR p_started_at IS NOT NULL AND (NOT isfinite(p_started_at) OR p_started_at>at_time OR p_phase='rejected') THEN RAISE EXCEPTION 'Invalid local export observation' USING ERRCODE='22023';END IF;
 SELECT * INTO x FROM local_identity.workspace_exports WHERE id=p_export AND workspace_id=w.id AND episode_id=w.episode_id AND project_content_version=w.revision AND content_sha256=w.content_sha256;
 IF NOT FOUND OR x.status NOT IN('ready','failed') OR p_phase='rejected' AND x.status<>'failed' THEN RAISE EXCEPTION 'Current local export result required' USING ERRCODE='42501';END IF;
 event:='local_export_'||p_phase;identity:='local-export:'||p_export||':'||p_phase;
 payload:=jsonb_build_object('version','local-export/v1','workspace_id',w.id,'export_id',p_export,'project_revision',w.revision,'content_sha256',w.content_sha256,'phase',p_phase,'started_at',p_started_at);
 SELECT e.payload INTO prior FROM local_identity.production_metric_events e WHERE e.owner_id=o AND e.episode_id=w.episode_id AND e.event_type=event AND e.source_key=identity;
 IF prior IS NOT NULL THEN
  IF NOT prior @> payload THEN RAISE EXCEPTION 'Local export observation identity conflict' USING ERRCODE='23505';END IF;
  RETURN false;
 END IF;
 covered:=p_phase='finished' AND p_started_at IS NOT NULL AND EXISTS(SELECT 1 FROM local_identity.production_metric_coverage_periods WHERE owner_id=o AND started_at<=p_started_at AND (ended_at IS NULL OR ended_at>at_time));
 IF covered THEN
  PERFORM local_identity.append_production_metric(o,w.episode_id,'local_export_started','local-export:'||p_export||':started',jsonb_build_object('version','local-export/v1','workspace_id',w.id,'export_id',p_export,'project_revision',w.revision,'content_sha256',w.content_sha256,'phase','started'),p_started_at);
 END IF;
 payload:=payload||jsonb_build_object('outcome',x.status,'start_observed',covered,'duration_seconds',CASE WHEN covered THEN extract(epoch FROM at_time-p_started_at) ELSE NULL END,
  'reason_code',CASE WHEN p_phase='rejected' THEN 'preflight_or_runtime_unavailable' WHEN x.status='failed' THEN 'render_or_checks_failed' ELSE 'verified_output' END);
 RETURN local_identity.append_production_metric(o,w.episode_id,event,identity,payload,at_time);
END $$;

CREATE OR REPLACE FUNCTION local_identity.record_workspace_sound_use(p_workspace uuid, p_revision bigint, p_role text, p_action text, p_source_kind text, p_source uuid, p_sha text, p_instance text, p_usage text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE w local_identity.production_workspaces;
BEGIN
 SELECT * INTO w FROM local_identity.lock_editable_production_workspace(p_workspace);
 IF NOT local_identity.production_metrics_enabled() THEN RETURN false;END IF;
 IF p_revision IS DISTINCT FROM w.revision OR p_role IS NULL OR p_role NOT IN('bgm','sfx','source','ambience','narration','other')
  OR p_action IS NULL OR p_action NOT IN('used','withdrawn','changed') OR p_source_kind IS NULL OR p_source_kind NOT IN('material','audio_track','task_artifact','unresolved')
  OR coalesce(p_instance,'') !~ '^[0-9a-f]{64}$' OR coalesce(p_usage,'') !~ '^[0-9a-f]{64}$'
  OR (p_source_kind='unresolved' AND (p_source IS NOT NULL OR p_sha IS NOT NULL))
  OR (p_source_kind<>'unresolved' AND (p_source IS NULL OR coalesce(p_sha,'') !~ '^[0-9a-f]{64}$')) THEN
  RAISE EXCEPTION 'Invalid sound observation' USING ERRCODE='22023';END IF;
 IF p_source_kind='material' THEN
  IF NOT EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id=p_source AND episode_id=w.episode_id AND material_type IN('audio','video') AND sha256=p_sha) THEN RAISE EXCEPTION 'Sound material scope mismatch' USING ERRCODE='42501';END IF;
 ELSIF p_source_kind='audio_track' THEN
  IF NOT EXISTS(SELECT 1 FROM public.audio_tracks WHERE id=p_source AND episode_id=w.episode_id AND sha256=p_sha) THEN RAISE EXCEPTION 'Sound track scope mismatch' USING ERRCODE='42501';END IF;
 ELSIF p_source_kind='task_artifact' THEN
  IF NOT EXISTS(SELECT 1 FROM public.artifacts WHERE id=p_source AND episode_id=w.episode_id AND sha256=p_sha AND artifact_type IN('narration_audio','soundtrack_audio','source_audio','shot_source_audio','legacy_recovered_media','shot_video','a_roll_video','b_roll_asset','render','shot_clip','generated_video')) THEN RAISE EXCEPTION 'Sound artifact scope mismatch' USING ERRCODE='42501';END IF;
 END IF;
 -- Role describes the saved native use, not a generation/preparation entitlement.
 -- An Owner can replace a native sound with another registered source directly.
 RETURN local_identity.append_production_metric(local_identity.owner_id(),w.episode_id,CASE WHEN p_source_kind='unresolved' THEN 'sound_unresolved' ELSE 'sound_'||p_action END,'sound:'||w.id||':'||p_revision||':'||p_instance||':'||p_action,
  jsonb_build_object('version','sound-use/v1','workspace_id',w.id,'project_revision',p_revision,'content_sha256',w.content_sha256,'role',p_role,'action',p_action,'source_kind',p_source_kind,'source_id',p_source,'source_sha256',p_sha,'instance_sha256',p_instance,'use_sha256',p_usage));
END $_$;
