-- ADR-0068: preserve original IDs and evidence when importing an existing preparation.
-- Private import accepts only a proven old preparation/workspace reference; it never queues work.
ALTER TABLE local_identity.production_preparation_revisions ADD COLUMN parent_preparation_revision_id uuid;
ALTER TABLE local_identity.production_preparation_revisions ADD CONSTRAINT preparation_script_identity UNIQUE(episode_id,script_revision_id,id);
ALTER TABLE local_identity.production_preparation_revisions ADD CONSTRAINT preparation_parent_same_order
 FOREIGN KEY(episode_id,parent_preparation_revision_id) REFERENCES local_identity.production_preparation_revisions(episode_id,id);
ALTER TABLE local_identity.production_preparation_revisions ADD CONSTRAINT preparation_parent_not_self CHECK(parent_preparation_revision_id IS DISTINCT FROM id);
CREATE INDEX production_preparation_parent ON local_identity.production_preparation_revisions(parent_preparation_revision_id);

CREATE FUNCTION local_identity.import_preparation_source(p_episode uuid,p_script uuid,p_source uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes; package public.review_packages; source public.production_material_revisions;
 file public.artifacts; basis local_identity.workspace_preparations; existing local_identity.production_preparation_revisions; parent local_identity.production_preparation_revisions;
 board jsonb; manifest jsonb; evidence jsonb; reference jsonb; actor uuid; actors uuid[]; origin text; next_revision integer;
 shot jsonb; position integer:=0; recorded record;
BEGIN
 SELECT * INTO e FROM public.episodes WHERE id=p_episode FOR UPDATE;
 SELECT * INTO package FROM public.review_packages WHERE id=p_source AND episode_id=p_episode AND stage='storyboard_review';
 SELECT * INTO source FROM public.production_material_revisions WHERE id=p_script AND episode_id=p_episode AND material_type='script';
 IF e.id IS NULL OR package.id IS NULL OR source.id IS NULL THEN RAISE EXCEPTION 'Same-order preparation and script required' USING ERRCODE='22023';END IF;
 IF NOT(EXISTS(SELECT 1 FROM local_identity.workspace_preparations WHERE package_id=p_source AND episode_id=p_episode AND script_revision_id=p_script)
  OR EXISTS(SELECT 1 FROM local_identity.production_workspaces WHERE storyboard_package_id=p_source AND episode_id=p_episode AND script_revision_id=p_script)
  OR EXISTS(SELECT 1 FROM local_identity.production_workspace_versions WHERE storyboard_package_id=p_source AND episode_id=p_episode AND script_revision_id=p_script)) THEN
  RAISE EXCEPTION 'Recorded preparation reference required' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM (
  SELECT episode_id,script_revision_id FROM local_identity.workspace_preparations WHERE package_id=p_source
  UNION SELECT episode_id,script_revision_id FROM local_identity.production_workspaces WHERE storyboard_package_id=p_source
  UNION SELECT episode_id,script_revision_id FROM local_identity.production_workspace_versions WHERE storyboard_package_id=p_source
 ) r WHERE r.episode_id IS DISTINCT FROM p_episode OR r.script_revision_id IS DISTINCT FROM p_script) THEN
  RAISE EXCEPTION 'Conflicting preparation provenance' USING ERRCODE='40001';
 END IF;
 SELECT * INTO file FROM public.artifacts WHERE id=package.artifact_id AND episode_id=p_episode;
 IF file.id IS NULL THEN RAISE EXCEPTION 'Original preparation file reference required' USING ERRCODE='22023';END IF;
 board:=coalesce(package.context_snapshot#>'{worker_result,storyboard}',package.context_snapshot->'storyboard');
 IF board->>'version' IS DISTINCT FROM 'storyboard/v1' OR jsonb_typeof(board->'shots') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Supported original storyboard required' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(board->'shots')<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(board->'shots') s WHERE jsonb_typeof(s->'id') IS DISTINCT FROM 'string' OR btrim(s->>'id')='' OR jsonb_typeof(s->'scriptSegment') IS DISTINCT FROM 'string')
  OR (SELECT count(*)<>count(DISTINCT s->>'id') FROM jsonb_array_elements(board->'shots') s) THEN RAISE EXCEPTION 'Unambiguous original shots required' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_shot_inputs s WHERE s.preparation_id=p_source GROUP BY s.shot_id HAVING count(DISTINCT jsonb_build_object('text',s.baseline_text,'snapshot',s.snapshot,'origin',s.origin,'classification',s.shot_type))>1) THEN
  RAISE EXCEPTION 'Conflicting recorded shot versions' USING ERRCODE='40001';
 END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_shot_inputs s JOIN local_identity.production_workspaces w ON w.id=s.workspace_id WHERE s.preparation_id=p_source AND w.episode_id IS DISTINCT FROM p_episode) THEN
  RAISE EXCEPTION 'Recorded shot belongs to another order' USING ERRCODE='40001';
 END IF;
 manifest:=(board-'version'-'shots')||jsonb_build_object('version','production-preparation/v1','shots',(
  SELECT jsonb_agg((s-'shotType')||jsonb_build_object('visualSource',coalesce(s->>'visualSource','unassigned')) ORDER BY ordinal)
  FROM jsonb_array_elements(board->'shots') WITH ORDINALITY a(s,ordinal)));
 IF package.context_snapshot#>'{workspace_preparation,formattingOnly}'='true'::jsonb THEN
  SELECT * INTO parent FROM local_identity.production_preparation_revisions p WHERE p.episode_id=p_episode
   AND p.id::text=package.context_snapshot#>>'{workspace_preparation,sourceReviewPackageId}'
   AND p.script_revision_id::text=package.context_snapshot#>>'{continued_project,previousScriptRevisionId}'
   AND p.source_format='storyboard/v1' AND p.source_reference_id=p.id AND p.id<>p_source;
  IF parent.id IS NULL THEN RAISE EXCEPTION 'Proven formatting preparation parent required' USING ERRCODE='40001';END IF;
  manifest:=parent.manifest;
 END IF;
 reference:=jsonb_build_object('relativePath',file.relative_path,'sha256',file.sha256,'fileSize',file.file_size);
 IF parent.id IS NOT NULL AND (reference IS DISTINCT FROM parent.file_reference OR board IS DISTINCT FROM coalesce(parent.source_evidence#>'{package,context_snapshot,worker_result,storyboard}',parent.source_evidence#>'{package,context_snapshot,storyboard}')) THEN
  RAISE EXCEPTION 'Formatting source differs from the frozen parent' USING ERRCODE='40001';
 END IF;
 SELECT * INTO existing FROM local_identity.production_preparation_revisions WHERE id=p_source;
 IF FOUND THEN
  IF existing.episode_id IS DISTINCT FROM p_episode OR existing.script_revision_id IS DISTINCT FROM p_script
   OR existing.script_sha256 IS DISTINCT FROM source.sha256 OR existing.source_reference_id IS DISTINCT FROM p_source
   OR existing.source_format<>'storyboard/v1' OR existing.manifest IS DISTINCT FROM manifest OR existing.file_reference IS DISTINCT FROM reference
   OR existing.parent_preparation_revision_id IS DISTINCT FROM parent.id THEN
   RAISE EXCEPTION 'Imported identity conflicts with frozen provenance' USING ERRCODE='40001';
  END IF;
  RETURN p_source;
 END IF;
 SELECT * INTO basis FROM local_identity.workspace_preparations WHERE package_id=p_source;
 actor:=basis.confirmed_by;
 IF actor IS NULL THEN
  SELECT array_agg(DISTINCT created_by) INTO actors FROM local_identity.production_workspace_versions WHERE storyboard_package_id=p_source;
  IF coalesce(array_length(actors,1),0)>1 THEN RAISE EXCEPTION 'Ambiguous preparation creator' USING ERRCODE='40001';END IF;
  actor:=actors[1];
 END IF;
 IF actor IS NULL THEN
  SELECT array_agg(DISTINCT user_id) INTO actors FROM public.account_memberships WHERE account_id=e.account_id AND role='owner';
  IF coalesce(array_length(actors,1),0)<>1 THEN RAISE EXCEPTION 'Proven preparation creator required' USING ERRCODE='40001';END IF;
  actor:=actors[1];
 END IF;
 origin:=coalesce(parent.origin,CASE basis.origin WHEN 'script-segment' THEN 'script' WHEN 'planner' THEN 'plan-import' ELSE 'historical-import' END);
 evidence:=jsonb_build_object('package',to_jsonb(package),'artifact',to_jsonb(file),'preparation',to_jsonb(basis),
  'shot_inputs',CASE WHEN parent.id IS NOT NULL THEN parent.source_evidence->'shot_inputs' ELSE (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.workspace_id,s.shot_id),'[]'::jsonb) FROM local_identity.workspace_shot_inputs s WHERE s.preparation_id=p_source) END);
 SELECT coalesce(max(revision_number),0)+1 INTO next_revision FROM local_identity.production_preparation_revisions WHERE episode_id=p_episode;
 INSERT INTO local_identity.production_preparation_revisions(id,episode_id,script_revision_id,script_sha256,revision_number,origin,source_format,file_reference,manifest,content_sha256,source_reference_id,source_evidence,created_by,created_at,invalidated_at,parent_preparation_revision_id)
 VALUES(p_source,p_episode,p_script,source.sha256,next_revision,origin,'storyboard/v1',reference,manifest,encode(extensions.digest(manifest::text,'sha256'),'hex'),p_source,evidence,actor,coalesce(basis.confirmed_at,package.created_at),package.invalidated_at,parent.id);
 IF parent.id IS NOT NULL THEN
  INSERT INTO local_identity.production_shots(episode_id,shot_id) SELECT p_episode,shot_id FROM local_identity.production_shot_versions WHERE preparation_revision_id=parent.id ON CONFLICT DO NOTHING;
  INSERT INTO local_identity.production_shot_versions(preparation_revision_id,episode_id,shot_id,position,origin,baseline_text,snapshot)
   SELECT p_source,p_episode,v.shot_id,v.position,v.origin,v.baseline_text,v.snapshot FROM local_identity.production_shot_versions v WHERE v.preparation_revision_id=parent.id;
  RETURN p_source;
 END IF;
 FOR shot IN SELECT value FROM jsonb_array_elements(manifest->'shots') LOOP
  position:=position+1;
  SELECT s.* INTO recorded FROM local_identity.workspace_shot_inputs s WHERE s.preparation_id=p_source AND s.shot_id=shot->>'id' ORDER BY s.workspace_id LIMIT 1;
  INSERT INTO local_identity.production_shots(episode_id,shot_id) VALUES(p_episode,shot->>'id') ON CONFLICT DO NOTHING;
  INSERT INTO local_identity.production_shot_versions(preparation_revision_id,episode_id,shot_id,position,origin,baseline_text,snapshot)
   VALUES(p_source,p_episode,shot->>'id',position,CASE WHEN origin='script' THEN 'script' ELSE 'historical-import' END,coalesce(recorded.baseline_text,shot->>'scriptSegment'),coalesce(recorded.snapshot-'shotType',shot));
 END LOOP;
 FOR recorded IN SELECT DISTINCT ON(s.shot_id) s.* FROM local_identity.workspace_shot_inputs s WHERE s.preparation_id=p_source AND NOT EXISTS(SELECT 1 FROM local_identity.production_shot_versions v WHERE v.preparation_revision_id=p_source AND v.shot_id=s.shot_id) ORDER BY s.shot_id,s.workspace_id LOOP
  position:=position+1;
  INSERT INTO local_identity.production_shots(episode_id,shot_id) VALUES(p_episode,recorded.shot_id) ON CONFLICT DO NOTHING;
  INSERT INTO local_identity.production_shot_versions(preparation_revision_id,episode_id,shot_id,position,origin,baseline_text,snapshot)
   VALUES(p_source,p_episode,recorded.shot_id,position,CASE WHEN recorded.origin='local-added' THEN 'local' ELSE 'historical-import' END,recorded.baseline_text,recorded.snapshot-'shotType');
 END LOOP;
 RETURN p_source;
END $$;

REVOKE ALL ON FUNCTION local_identity.import_preparation_source(uuid,uuid,uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;

CREATE FUNCTION local_identity.adopt_production_preparation(p_episode uuid,p_script uuid,p_source uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF e.main_script_revision_id IS DISTINCT FROM p_script OR e.archived_at IS NOT NULL OR local_identity.is_historical_episode(e.id)
  OR e.stage NOT IN ('script_approved','storyboard_review','storyboard_approved','production_ready','render_ready','qc_review','qc_passed') THEN
  RAISE EXCEPTION 'Current editable preparation required' USING ERRCODE='40001';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.review_packages p WHERE p.id=p_source AND p.episode_id=p_episode AND p.stage='storyboard_review' AND p.invalidated_at IS NULL) THEN RAISE EXCEPTION 'Current original preparation required' USING ERRCODE='40001';END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.workspace_preparations b WHERE b.package_id=p_source AND b.episode_id=p_episode AND b.script_revision_id=p_script)
  AND NOT EXISTS(SELECT 1 FROM local_identity.production_preparation_revisions p WHERE p.id=p_source AND p.episode_id=p_episode AND p.script_revision_id=p_script AND p.source_reference_id=p_source AND p.source_format='storyboard/v1') THEN
  RAISE EXCEPTION 'Confirmed preparation import required' USING ERRCODE='42501';
 END IF;
 RETURN local_identity.import_preparation_source(p_episode,p_script,p_source);
END $$;
REVOKE ALL ON FUNCTION local_identity.adopt_production_preparation(uuid,uuid,uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.adopt_production_preparation(uuid,uuid,uuid) TO loop_app;

-- Nullable during the source-version transition only. All current writes will set this
-- reference; old columns remain immutable source coordinates until the reader cutover.
ALTER TABLE local_identity.production_workspaces ADD COLUMN preparation_revision_id uuid;
ALTER TABLE local_identity.production_workspaces ADD CONSTRAINT production_workspace_preparation
 FOREIGN KEY(episode_id,preparation_revision_id) REFERENCES local_identity.production_preparation_revisions(episode_id,id);
CREATE INDEX production_workspace_preparation ON local_identity.production_workspaces(preparation_revision_id);
ALTER TABLE local_identity.production_workspace_versions ADD COLUMN preparation_revision_id uuid;
ALTER TABLE local_identity.production_workspace_versions ADD CONSTRAINT production_workspace_version_preparation
 FOREIGN KEY(episode_id,script_revision_id,preparation_revision_id) REFERENCES local_identity.production_preparation_revisions(episode_id,script_revision_id,id);
CREATE INDEX production_workspace_version_preparation ON local_identity.production_workspace_versions(preparation_revision_id);

DO $$DECLARE reference record;
BEGIN
 FOR reference IN
  SELECT r.* FROM (
   SELECT episode_id,script_revision_id,package_id source_id FROM local_identity.workspace_preparations
   UNION SELECT episode_id,script_revision_id,storyboard_package_id FROM local_identity.production_workspaces
   UNION SELECT episode_id,script_revision_id,storyboard_package_id FROM local_identity.production_workspace_versions
  ) r LEFT JOIN public.review_packages p ON p.id=r.source_id ORDER BY r.episode_id,p.revision_number,r.source_id
 LOOP
  PERFORM local_identity.import_preparation_source(reference.episode_id,reference.script_revision_id,reference.source_id);
 END LOOP;
 UPDATE local_identity.production_workspaces w SET preparation_revision_id=p.id FROM local_identity.production_preparation_revisions p
  WHERE p.id=w.storyboard_package_id AND p.episode_id=w.episode_id AND p.script_revision_id=w.script_revision_id;
 UPDATE local_identity.production_workspace_versions w SET preparation_revision_id=p.id FROM local_identity.production_preparation_revisions p
  WHERE p.id=w.storyboard_package_id AND p.episode_id=w.episode_id AND p.script_revision_id=w.script_revision_id;
 IF EXISTS(SELECT 1 FROM local_identity.production_workspaces WHERE preparation_revision_id IS NULL)
  OR EXISTS(SELECT 1 FROM local_identity.production_workspace_versions WHERE preparation_revision_id IS NULL) THEN
  RAISE EXCEPTION 'Every original workspace version needs its proven preparation' USING ERRCODE='40001';
 END IF;
END $$;

-- Identical native bytes can confirm a different script/preparation revision.
ALTER TABLE local_identity.production_workspace_versions DROP CONSTRAINT production_workspace_versions_pkey;
ALTER TABLE local_identity.production_workspace_versions ADD PRIMARY KEY(workspace_id,project_sha256,script_revision_id,preparation_revision_id);

-- Preparation references are removed through the same protected purge before their targets.
CREATE OR REPLACE FUNCTION public.delete_episode(p_episode_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_episode public.episodes;
  membership_role public.member_role;
  deleted_at timestamptz := now();
  task_count bigint;
  artifact_count bigint;
  approval_count bigint;
  transition_count bigint;
  audit_event_count bigint;
  material_count bigint;
  review_package_count bigint;
  audio_track_count bigint;
  audio_annotation_count bigint;
  composition_revision_count bigint;
  review_annotation_count bigint;
  pre_render_member_count bigint;
  pre_render_decision_count bigint;
  dependency_count bigint;
  invalidation_count bigint;
  experiment_count bigint;
  metric_snapshot_count bigint;
  asset_lock_count bigint;
begin
  select episode.* into current_episode
  from public.episodes episode
  where episode.id = p_episode_id
  for update;
  if not found then
    raise exception 'Episode % does not exist', p_episode_id using errcode = 'P0002';
  end if;

  select role into membership_role
  from public.account_memberships
  where account_id = current_episode.account_id and user_id = p_actor_id;
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to delete an episode' using errcode = '42501';
  end if;
  if current_episode.archived_at is null then
    raise exception 'Episode must be archived before it can be permanently deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.tasks where episode_id = p_episode_id and status = 'running') then
    raise exception 'Episode has a running Worker task; wait for it to finish before deleting' using errcode = '55000';
  end if;
  if exists (select 1 from public.asset_locks where episode_id = p_episode_id and expires_at > now()) then
    raise exception 'Episode has an active asset lock; wait for it to expire before deleting' using errcode = '55000';
  end if;

  select count(*) into task_count from public.tasks where episode_id = p_episode_id;
  select count(*) into artifact_count from public.artifacts where episode_id = p_episode_id;
  select count(*) into approval_count from public.approvals where episode_id = p_episode_id;
  select count(*) into transition_count from public.state_transitions where episode_id = p_episode_id;
  select count(*) into audit_event_count from public.audit_events where episode_id = p_episode_id;
  select count(*) into material_count from public.production_material_revisions where episode_id = p_episode_id;
  select count(*) into review_package_count from public.review_packages where episode_id = p_episode_id;
  select count(*) into audio_track_count from public.audio_tracks where episode_id = p_episode_id;
  select count(*) into audio_annotation_count from public.audio_track_annotations where audio_track_id in (select id from public.audio_tracks where episode_id = p_episode_id);
  select count(*) into composition_revision_count from public.review_render_composition_revisions where episode_id = p_episode_id;
  select count(*) into review_annotation_count from public.review_annotations where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into pre_render_member_count from public.pre_render_review_members where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into pre_render_decision_count from public.pre_render_review_member_decisions where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into dependency_count from public.production_dependencies where episode_id = p_episode_id;
  select count(*) into invalidation_count from public.production_invalidations where episode_id = p_episode_id;
  if to_regclass('public.experiments') is null then experiment_count:=0; else execute 'select count(*) from public.experiments where episode_id=$1' into experiment_count using p_episode_id; end if;
  if to_regclass('public.metric_snapshots') is null then metric_snapshot_count:=0; else execute 'select count(*) from public.metric_snapshots where episode_id=$1' into metric_snapshot_count using p_episode_id; end if;
  select count(*) into asset_lock_count from public.asset_locks where episode_id = p_episode_id;


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
DELETE FROM local_identity.production_shot_versions WHERE episode_id=p_episode_id;
DELETE FROM local_identity.production_preparation_revisions WHERE episode_id=p_episode_id;
DELETE FROM local_identity.production_shots WHERE episode_id=p_episode_id;


DELETE FROM public.paid_generation_reservations
 WHERE task_id IN (SELECT id FROM public.tasks WHERE episode_id=p_episode_id);
  delete from public.shot_preparation_drafts where episode_id = p_episode_id;

  delete from public.pre_render_review_member_decisions
  where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  delete from public.pre_render_review_members
  where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  delete from public.audio_track_annotations
  where audio_track_id in (select id from public.audio_tracks where episode_id = p_episode_id);
  delete from public.audio_tracks where episode_id = p_episode_id;
  delete from public.review_render_composition_revisions where episode_id = p_episode_id;
  delete from public.approvals where episode_id = p_episode_id;
  delete from public.review_packages where episode_id = p_episode_id;

  update public.episodes
  set main_script_revision_id = null
  where id = p_episode_id;
  delete from public.episodes where id = p_episode_id;

  return jsonb_build_object(
    'episode_id', p_episode_id,
    'account_id', current_episode.account_id,
    'title', current_episode.title,
    'deleted_at', deleted_at,
    'counts', jsonb_build_object(
      'tasks', task_count,
      'artifacts', artifact_count,
      'approvals', approval_count,
      'state_transitions', transition_count,
      'audit_events', audit_event_count,
      'production_material_revisions', material_count,
      'review_packages', review_package_count,
      'audio_tracks', audio_track_count,
      'audio_track_annotations', audio_annotation_count,
      'review_render_composition_revisions', composition_revision_count,
      'review_annotations', review_annotation_count,
      'pre_render_review_members', pre_render_member_count,
      'pre_render_review_member_decisions', pre_render_decision_count,
      'production_dependencies', dependency_count,
      'production_invalidations', invalidation_count,
      'experiments', experiment_count,
      'metric_snapshots', metric_snapshot_count,
      'asset_locks', asset_lock_count
    )
  );
end;
$function$
;


CREATE FUNCTION local_identity.historical_preparation_shot_classification(p_preparation uuid,p_shot text) RETURNS text
 LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN p.origin='historical-import' THEN coalesce(
  (SELECT s->>'shot_type' FROM jsonb_array_elements(p.source_evidence->'shot_inputs') s WHERE s->>'shot_id'=p_shot LIMIT 1),
  (SELECT s->>'shotType' FROM jsonb_array_elements(coalesce(p.source_evidence#>'{package,context_snapshot,worker_result,storyboard,shots}',p.source_evidence#>'{package,context_snapshot,storyboard,shots}')) s WHERE s->>'id'=p_shot LIMIT 1)) END
 FROM local_identity.production_preparation_revisions p WHERE p.id=p_preparation
$$;
REVOKE ALL ON FUNCTION local_identity.historical_preparation_shot_classification(uuid,text) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.historical_preparation_shot_classification(uuid,text) TO loop_app;

CREATE FUNCTION local_identity.preparation_source_current(p_preparation uuid) RETURNS boolean
 LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM local_identity.production_preparation_revisions p WHERE p.id=p_preparation AND p.invalidated_at IS NULL
  AND (p.source_format='production-preparation/v1' OR EXISTS(SELECT 1 FROM public.review_packages original WHERE original.id=p.source_reference_id AND original.episode_id=p.episode_id AND original.invalidated_at IS NULL)))
$$;
REVOKE ALL ON FUNCTION local_identity.preparation_source_current(uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.preparation_source_current(uuid) TO loop_app;

CREATE FUNCTION local_identity.sync_production_workspace_shots(p_workspace uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces; p local_identity.production_preparation_revisions; shot record; position integer;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned workspace required' USING ERRCODE='42501';END IF;
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 SELECT * INTO p FROM local_identity.production_preparation_revisions WHERE id=coalesce(w.storyboard_package_id,w.preparation_revision_id) AND episode_id=w.episode_id AND script_revision_id=w.script_revision_id;
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
REVOKE ALL ON FUNCTION local_identity.sync_production_workspace_shots(uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.sync_production_workspace_shots(uuid) TO loop_app;

CREATE OR REPLACE FUNCTION local_identity.workspace_shot_context(p_episode uuid,p_review uuid,p_shot text) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s.snapshot||jsonb_strip_nulls(jsonb_build_object('id',s.shot_id,'scriptSegment',CASE WHEN s.origin='local' THEN coalesce(
  (SELECT d.tts_text FROM public.shot_preparation_drafts d WHERE d.episode_id=e.id AND d.review_package_id=p.id AND d.shot_id=s.shot_id),
  (SELECT b->>'text' FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=s.shot_id LIMIT 1),'') ELSE s.baseline_text END,
  'shotType',local_identity.historical_preparation_shot_classification(p.id,s.shot_id)))
 FROM local_identity.production_shot_versions s JOIN local_identity.production_workspaces w ON w.preparation_revision_id=s.preparation_revision_id AND w.episode_id=s.episode_id
 JOIN public.episodes e ON e.id=w.episode_id JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.script_revision_id=w.script_revision_id
 WHERE w.episode_id=p_episode AND p.id=p_review AND s.shot_id=p_shot AND e.main_script_revision_id=w.script_revision_id
  AND local_identity.preparation_source_current(p.id) AND e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_historical_episode(e.id) AND NOT local_identity.is_recycled_episode(e.id)
  AND EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot)
$$;

-- Canonical child versions inherit the frozen parent; never copy new rows into the retired input table.
CREATE OR REPLACE FUNCTION local_identity.resume_workspace_formatting_revision(p_workspace uuid, p_revision bigint, p_script uuid, p_project_sha text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces;e public.episodes;old public.review_packages;next_package uuid:=extensions.gen_random_uuid();next_revision integer;BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned workspace required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id FOR UPDATE;
 IF e.archived_at IS NOT NULL OR local_identity.is_historical_episode(e.id) OR e.stage<>'waiting_input' OR e.main_script_revision_id IS DISTINCT FROM p_script OR w.script_revision_id=p_script OR w.revision<>p_revision OR w.project_sha256<>p_project_sha THEN RAISE EXCEPTION 'Current pending script and workspace required' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=e.id AND status IN ('ready','running')) THEN RAISE EXCEPTION 'Finish current tasks before resuming editing';END IF;
 SELECT * INTO old FROM public.review_packages WHERE id=w.storyboard_package_id AND episode_id=e.id AND stage='storyboard_review';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id=p_script AND episode_id=e.id AND is_main_script) THEN RAISE EXCEPTION 'Verified source preparation required';END IF;
 SELECT coalesce(max(revision_number),0)+1 INTO next_revision FROM public.review_packages WHERE episode_id=e.id AND stage='storyboard_review';
 INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,context_snapshot) VALUES(next_package,e.id,'storyboard_review',next_revision,old.artifact_id,old.context_snapshot||jsonb_build_object('workspace_preparation',jsonb_build_object('scriptRevisionId',p_script,'script_revision_id',p_script,'origin','legacy-board','sourceReviewPackageId',old.id,'formattingOnly',true),'continued_project',jsonb_build_object('workspaceId',w.id,'sha256',w.project_sha256,'previousScriptRevisionId',w.script_revision_id)));
 INSERT INTO local_identity.workspace_preparations(package_id,episode_id,script_revision_id,origin,confirmed_by) VALUES(next_package,e.id,p_script,'legacy-board',local_identity.owner_id());
 UPDATE local_identity.production_workspaces SET script_revision_id=p_script,storyboard_package_id=next_package,revision=revision+1,updated_at=clock_timestamp() WHERE id=w.id;
 UPDATE public.episodes SET stage='storyboard_review',updated_at=clock_timestamp() WHERE id=e.id;
 UPDATE local_identity.script_productions SET enabled=false,authorized_at=NULL,last_status='排版修订已确认，沿用原工程；在线制作未授权',updated_at=clock_timestamp() WHERE episode_id=e.id;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,e.id,'workspace_formatting_revision_confirmed',jsonb_build_object('workspace_id',w.id,'source_package_id',old.id,'package_id',next_package,'previous_script_revision_id',w.script_revision_id,'script_revision_id',p_script,'project_sha256',w.project_sha256,'reason','确认脚本排版修订，沿用现有工程继续编辑'),local_identity.owner_id());
END $function$
;
