-- Capture start at the actual renderer boundary; persist after rendering so the
-- anonymous daily aggregate never serializes independent long-running exports.
CREATE FUNCTION local_identity.record_workspace_local_export(p_workspace uuid,p_export uuid,p_phase text,p_started_at timestamptz) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces; x local_identity.workspace_exports; o uuid:=local_identity.owner_id();
 at_time timestamptz:=clock_timestamp(); covered boolean; payload jsonb; prior jsonb; event text; identity text;
BEGIN
 SELECT * INTO w FROM local_identity.lock_current_production_workspace(p_workspace);
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
REVOKE ALL ON FUNCTION local_identity.record_workspace_local_export(uuid,uuid,text,timestamptz) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.record_workspace_local_export(uuid,uuid,text,timestamptz) TO loop_app;

-- Only an annotation of the existing host sample, never another CPU sample or
-- an FK to the workspace/episode rows held by the renderer transaction.
CREATE TABLE local_identity.production_metric_export_resources (
 owner_id uuid NOT NULL,
 sampled_at timestamptz NOT NULL,
 active_exports integer NOT NULL CHECK(active_exports>=0),
 PRIMARY KEY(owner_id,sampled_at),
 FOREIGN KEY(owner_id,sampled_at) REFERENCES local_identity.production_metric_resources(owner_id,sampled_at) ON DELETE CASCADE
);
ALTER TABLE local_identity.production_metric_export_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.production_metric_export_resources FORCE ROW LEVEL SECURITY;
CREATE POLICY production_metric_export_resources_owner ON local_identity.production_metric_export_resources FOR SELECT TO loop_app USING(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.production_metric_export_resources FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT ON local_identity.production_metric_export_resources TO loop_app;

CREATE FUNCTION local_identity.record_production_metric_resource_with_exports(p_sample jsonb,p_exports integer) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=local_identity.owner_id(); recorded boolean; at_time timestamptz; old_count integer; sample local_identity.production_metric_resources;
BEGIN
 IF o IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF NOT local_identity.production_metrics_enabled() THEN RETURN false;END IF;
 IF p_exports IS NULL OR p_exports<0 THEN RAISE EXCEPTION 'Invalid local export count' USING ERRCODE='22023';END IF;
 -- Original payload validation, observation window, advisory lock and frequency
 -- are unchanged. No extra keys are accepted by the original general writer.
 recorded:=local_identity.record_production_metric_resource(p_sample);
 at_time:=(p_sample->>'sampled_at')::timestamptz;
 SELECT * INTO sample FROM local_identity.production_metric_resources WHERE owner_id=o AND sampled_at=at_time;
 IF NOT FOUND THEN RETURN false;END IF;
 -- The old writer can throttle an old replay after a newer sample: still
 -- require the exact original resource values before annotating that row.
 IF sample IS DISTINCT FROM jsonb_populate_record(NULL::local_identity.production_metric_resources,p_sample||jsonb_build_object('owner_id',o,'gap_seconds',coalesce((p_sample->>'gap_seconds')::numeric,0))) THEN RAISE EXCEPTION 'Resource sample idempotency content conflict' USING ERRCODE='23505';END IF;
 INSERT INTO local_identity.production_metric_export_resources(owner_id,sampled_at,active_exports) VALUES(o,at_time,p_exports) ON CONFLICT DO NOTHING;
 SELECT active_exports INTO old_count FROM local_identity.production_metric_export_resources WHERE owner_id=o AND sampled_at=at_time;
 IF old_count<>p_exports THEN RAISE EXCEPTION 'Local export sample idempotency content conflict' USING ERRCODE='23505';END IF;
 RETURN recorded;
END $$;
REVOKE ALL ON FUNCTION local_identity.record_production_metric_resource_with_exports(jsonb,integer) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.record_production_metric_resource_with_exports(jsonb,integer) TO loop_app;

-- Activation observations must not wait on long business transactions. Locked
-- episodes/tasks have no invented anchor; the next real fact observes them.
CREATE OR REPLACE FUNCTION local_identity.set_production_metrics_enabled(p_enabled boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=local_identity.owner_id(); previous boolean; e record; q record; at_time timestamptz:=clock_timestamp();
BEGIN
 IF o IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Boolean activation required';END IF;
 INSERT INTO local_identity.production_metric_controls(owner_id) VALUES(o) ON CONFLICT DO NOTHING;
 SELECT enabled INTO previous FROM local_identity.production_metric_controls WHERE owner_id=o FOR UPDATE;
 UPDATE local_identity.production_metric_controls SET enabled=p_enabled,coverage_started_at=CASE WHEN p_enabled THEN coalesce(coverage_started_at,at_time) ELSE coverage_started_at END,updated_at=CASE WHEN previous IS DISTINCT FROM p_enabled THEN at_time ELSE updated_at END WHERE owner_id=o;
 IF previous AND NOT p_enabled THEN UPDATE local_identity.production_metric_coverage_periods SET ended_at=at_time WHERE owner_id=o AND ended_at IS NULL;END IF;
 IF p_enabled AND NOT previous THEN
  INSERT INTO local_identity.production_metric_coverage_periods(owner_id,started_at) VALUES(o,at_time);
  FOR e IN SELECT ep.id,ep.stage FROM public.episodes ep JOIN public.account_memberships m ON m.account_id=ep.account_id WHERE m.user_id=o AND m.role='owner' FOR KEY SHARE OF ep SKIP LOCKED LOOP
   PERFORM local_identity.append_production_metric(o,e.id,'coverage_observation','coverage:'||extract(epoch from at_time)::text,jsonb_build_object('stage',e.stage,'observed_only',true),at_time);
   FOR q IN SELECT t.id,t.attempt,t.available_at FROM public.tasks t WHERE t.episode_id=e.id AND t.status='ready' AND t.invalidated_at IS NULL FOR KEY SHARE OF t SKIP LOCKED LOOP
    INSERT INTO local_identity.production_metric_queue_cycles(owner_id,task_id,episode_id,attempt,enqueued_at,eligible_at,observed_only) VALUES(o,q.id,e.id,q.attempt,at_time,greatest(q.available_at,at_time),true) ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
 END IF;
 RETURN (SELECT jsonb_build_object('enabled',enabled,'coverageStartedAt',coverage_started_at) FROM local_identity.production_metric_controls WHERE owner_id=o);
END $$;
