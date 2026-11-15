-- ADR-0068 / B1: independent immutable production baselines and stable shot identities.
-- This is the storage/registration step. Current route and historical adapters migrate next;
-- no existing review package, draft, task, audio track or project is rewritten here.
CREATE TABLE local_identity.production_preparation_revisions (
 id uuid PRIMARY KEY,
 episode_id uuid NOT NULL REFERENCES public.episodes(id),
 script_revision_id uuid NOT NULL,
 script_sha256 text NOT NULL CHECK(script_sha256 ~ '^[a-f0-9]{64}$'),
 revision_number integer NOT NULL CHECK(revision_number>0),
 origin text NOT NULL CHECK(origin IN ('script','historical-import','plan-import')),
 source_format text NOT NULL CHECK(source_format IN ('production-preparation/v1','storyboard/v1')),
 file_reference jsonb,
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object' AND manifest->>'version'='production-preparation/v1'),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 source_reference_id uuid,
 source_evidence jsonb,
 created_by uuid NOT NULL REFERENCES local_identity.owners(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 invalidated_at timestamptz,
 FOREIGN KEY(episode_id,script_revision_id) REFERENCES public.production_material_revisions(episode_id,id),
 UNIQUE(episode_id,id),
 UNIQUE(episode_id,revision_number)
);
CREATE INDEX production_preparation_script ON local_identity.production_preparation_revisions(script_revision_id);
CREATE INDEX production_preparation_owner ON local_identity.production_preparation_revisions(created_by);

CREATE TABLE local_identity.production_shots (
 episode_id uuid NOT NULL REFERENCES public.episodes(id),
 shot_id text NOT NULL CHECK(length(btrim(shot_id)) BETWEEN 1 AND 128),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(episode_id,shot_id)
);
CREATE TABLE local_identity.production_shot_versions (
 preparation_revision_id uuid NOT NULL,
 episode_id uuid NOT NULL,
 shot_id text NOT NULL,
 position integer NOT NULL CHECK(position>0),
 origin text NOT NULL CHECK(origin IN ('script','historical-import','local')),
 baseline_text text NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND NOT snapshot ? 'shotType'),
 PRIMARY KEY(preparation_revision_id,shot_id),
 UNIQUE(preparation_revision_id,position),
 FOREIGN KEY(episode_id,preparation_revision_id) REFERENCES local_identity.production_preparation_revisions(episode_id,id),
 FOREIGN KEY(episode_id,shot_id) REFERENCES local_identity.production_shots(episode_id,shot_id)
);
CREATE INDEX production_shot_versions_identity ON local_identity.production_shot_versions(episode_id,shot_id);

ALTER TABLE local_identity.production_preparation_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.production_shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.production_shot_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY preparation_revision_owner ON local_identity.production_preparation_revisions FOR SELECT TO loop_app
 USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=(SELECT local_identity.owner_id()) AND m.role='owner'));
CREATE POLICY production_shot_owner ON local_identity.production_shots FOR SELECT TO loop_app
 USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=(SELECT local_identity.owner_id()) AND m.role='owner'));
CREATE POLICY production_shot_version_owner ON local_identity.production_shot_versions FOR SELECT TO loop_app
 USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=(SELECT local_identity.owner_id()) AND m.role='owner'));
REVOKE ALL ON local_identity.production_preparation_revisions,local_identity.production_shots,local_identity.production_shot_versions FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT ON local_identity.production_preparation_revisions,local_identity.production_shots,local_identity.production_shot_versions TO loop_app;

CREATE FUNCTION local_identity.register_production_preparation(p_episode uuid,p_script uuid,p_id uuid,p_file jsonb,p_manifest jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes; source public.production_material_revisions; existing local_identity.production_preparation_revisions;
 directory text; shot jsonb; next_revision integer;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF e.archived_at IS NOT NULL OR e.stage NOT IN ('script_approved','storyboard_review','storyboard_approved','production_ready','render_ready','qc_review')
  OR local_identity.is_historical_episode(e.id) OR e.main_script_revision_id IS DISTINCT FROM p_script THEN
  RAISE EXCEPTION 'Current confirmed script required' USING ERRCODE='40001';
 END IF;
 SELECT * INTO source FROM public.production_material_revisions WHERE id=p_script AND episode_id=e.id AND material_type='script';
 IF NOT FOUND OR NOT local_identity.script_material_is_approved(p_script) THEN RAISE EXCEPTION 'Owned confirmed script required' USING ERRCODE='42501';END IF;
 SELECT directory_relative_path INTO directory FROM local_identity.episode_storage_location(e.id);
 IF p_id IS NULL OR directory IS NULL OR jsonb_typeof(p_file) IS DISTINCT FROM 'object'
  OR p_file->>'relativePath' IS DISTINCT FROM directory||'/preparation/'||p_id::text||'.json'
  OR jsonb_typeof(p_file->'sha256') IS DISTINCT FROM 'string' OR p_file->>'sha256' !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(p_file->'fileSize') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'Verified preparation file required' USING ERRCODE='22023';
 END IF;
 IF (p_file->>'fileSize')::numeric NOT BETWEEN 1 AND 9223372036854775807 OR (p_file->>'fileSize') !~ '^[1-9][0-9]*$' THEN
  RAISE EXCEPTION 'Valid preparation file size required' USING ERRCODE='22023';
 END IF;
 IF jsonb_typeof(p_manifest) IS DISTINCT FROM 'object' OR p_manifest->>'version' IS DISTINCT FROM 'production-preparation/v1'
  OR jsonb_typeof(p_manifest->'shots') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Versioned production preparation required' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_manifest->'shots') NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Production shots required' USING ERRCODE='22023';END IF;
 FOR shot IN SELECT value FROM jsonb_array_elements(p_manifest->'shots') LOOP
  IF jsonb_typeof(shot) IS DISTINCT FROM 'object' OR jsonb_typeof(shot->'id') IS DISTINCT FROM 'string'
   OR length(btrim(shot->>'id')) NOT BETWEEN 1 AND 128 OR shot->>'id' IS DISTINCT FROM btrim(shot->>'id') OR shot ? 'shotType'
   OR jsonb_typeof(shot->'scriptSegment') IS DISTINCT FROM 'string'
   OR jsonb_typeof(shot->'durationSeconds') IS DISTINCT FROM 'number'
   OR coalesce(shot->>'targetSpec','') NOT IN ('9:16','16:9','1:1')
   OR coalesce(shot->>'visualSource','') NOT IN ('image','video','material','unassigned') THEN
   RAISE EXCEPTION 'Valid current production shot required' USING ERRCODE='22023';
  END IF;
  IF (shot->>'durationSeconds')::numeric NOT BETWEEN 0.1 AND 120 THEN RAISE EXCEPTION 'Valid shot duration required' USING ERRCODE='22023';END IF;
 END LOOP;
 IF (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(p_manifest->'shots')) THEN RAISE EXCEPTION 'Unique shot identities required' USING ERRCODE='22023';END IF;
 SELECT * INTO existing FROM local_identity.production_preparation_revisions WHERE id=p_id;
 IF FOUND THEN
  IF existing.episode_id IS DISTINCT FROM p_episode OR existing.script_revision_id IS DISTINCT FROM p_script
   OR existing.script_sha256 IS DISTINCT FROM source.sha256 OR existing.file_reference IS DISTINCT FROM p_file
   OR existing.manifest IS DISTINCT FROM p_manifest OR existing.origin<>'script' OR existing.created_by IS DISTINCT FROM local_identity.owner_id() THEN
   RAISE EXCEPTION 'Preparation identity already belongs to different frozen content' USING ERRCODE='40001';
  END IF;
  RETURN p_id;
 END IF;
 SELECT coalesce(max(revision_number),0)+1 INTO next_revision FROM local_identity.production_preparation_revisions WHERE episode_id=e.id;
 INSERT INTO local_identity.production_preparation_revisions(id,episode_id,script_revision_id,script_sha256,revision_number,origin,source_format,file_reference,manifest,content_sha256,created_by)
 VALUES(p_id,e.id,source.id,source.sha256,next_revision,'script','production-preparation/v1',p_file,p_manifest,encode(extensions.digest(p_manifest::text,'sha256'),'hex'),local_identity.owner_id());
 INSERT INTO local_identity.production_shots(episode_id,shot_id) SELECT e.id,value->>'id' FROM jsonb_array_elements(p_manifest->'shots') ON CONFLICT DO NOTHING;
 INSERT INTO local_identity.production_shot_versions(preparation_revision_id,episode_id,shot_id,position,origin,baseline_text,snapshot)
 SELECT p_id,e.id,value->>'id',ordinality::integer,'script',value->>'scriptSegment',value FROM jsonb_array_elements(p_manifest->'shots') WITH ORDINALITY;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id)
 VALUES(e.account_id,e.id,'production_preparation_confirmed',jsonb_build_object('preparation_revision_id',p_id,'script_revision_id',source.id,'sha256',p_file->>'sha256'),local_identity.owner_id());
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION local_identity.register_production_preparation(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.register_production_preparation(uuid,uuid,uuid,jsonb,jsonb) TO loop_app;
COMMENT ON FUNCTION local_identity.register_production_preparation(uuid,uuid,uuid,jsonb,jsonb) IS 'Private persistence boundary. The local controller verifies actual file bytes, SHA, size and manifest through productionPreparationStore before calling; PostgreSQL does not read host media.';

-- Extend only the existing protected purge; do not add cascade paths around its gates.
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
DELETE FROM local_identity.production_shot_versions WHERE episode_id=p_episode_id;
DELETE FROM local_identity.production_preparation_revisions WHERE episode_id=p_episode_id;
DELETE FROM local_identity.production_shots WHERE episode_id=p_episode_id;
DELETE FROM local_identity.workspace_shot_inputs
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_legacy_recoveries
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.production_workspace_versions
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.production_workspaces WHERE episode_id=p_episode_id;
DELETE FROM local_identity.workspace_preparations WHERE episode_id=p_episode_id;


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
