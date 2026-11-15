// Pre-188 projection is a data conversion, never a current preparation confirmation or a file-access grant.
export const legacyProductionHistorySql=`
 CREATE TEMP TABLE legacy_history_refs ON COMMIT DROP AS
 SELECT h.*,i.projected_key,(h.payload->>'episode_id')::uuid episode_id,
  (h.payload->>'script_revision_id')::uuid script_id,(h.payload->>'storyboard_package_id')::uuid source_id
 FROM production_history_selected h JOIN history_inserted i USING(table_name,row_key,payload_sha256)
 WHERE h.table_name IN('local_identity.production_workspaces','local_identity.production_workspace_versions')
  AND NOT(h.payload ? 'preparation_revision_id');
 CREATE TEMP TABLE legacy_history_existing(table_name text,row_key jsonb)ON COMMIT DROP;
 DO $before$ DECLARE tab text;
 BEGIN
  FOREACH tab IN ARRAY ARRAY['production_preparation_revisions','production_shots','production_shot_versions','workspace_caption_inputs','workspace_narration_inputs'] LOOP
   EXECUTE format('INSERT INTO legacy_history_existing SELECT %L,pg_temp.production_history_key(%L,to_jsonb(t)) FROM local_identity.%I t WHERE episode_id IN(SELECT episode_id FROM legacy_history_refs)','local_identity.'||tab,'local_identity.'||tab,tab);
  END LOOP;
 END $before$;
 CREATE OR REPLACE FUNCTION pg_temp.ensure_history_preparation(ep uuid,script uuid,source uuid,importer uuid,seen uuid[]) RETURNS uuid
 LANGUAGE plpgsql AS $prepare$
 DECLARE package public.review_packages;parent_id uuid;parent_script uuid;
 BEGIN
  IF source=ANY(seen) THEN RAISE EXCEPTION 'Historical preparation cycle' USING ERRCODE='22023';END IF;
  SELECT * INTO package FROM public.review_packages WHERE id=source AND episode_id=ep AND stage='storyboard_review';
  IF NOT FOUND THEN RAISE EXCEPTION 'Historical preparation package missing' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM history_selected h WHERE h.owner_id<>importer AND
    (h.table_name='public.review_packages' AND h.payload->>'id'=source::text
     OR h.table_name='public.production_material_revisions' AND h.payload->>'id'=script::text
     OR h.table_name='public.artifacts' AND h.payload->>'id'=package.artifact_id::text
     OR h.table_name='public.shot_preparation_drafts' AND h.payload->>'episode_id'=ep::text AND h.payload->>'review_package_id'=source::text
     OR h.table_name='public.audio_tracks' AND EXISTS(SELECT 1 FROM public.shot_preparation_drafts d
       WHERE d.episode_id=ep AND d.review_package_id=source AND d.current_audio_track_id::text=h.payload->>'id')
     OR h.table_name IN('public.artifacts','public.tasks') AND EXISTS(SELECT 1 FROM public.shot_preparation_drafts d
       JOIN public.audio_tracks a ON a.id=d.current_audio_track_id AND a.episode_id=ep WHERE d.episode_id=ep AND d.review_package_id=source
        AND h.payload->>'id'=CASE h.table_name WHEN 'public.artifacts' THEN a.source_artifact_id::text ELSE a.source_task_id::text END)))
   OR EXISTS(SELECT 1 FROM production_history_selected h WHERE h.owner_id<>importer AND
    (h.table_name='local_identity.production_preparation_revisions' AND h.payload->>'id'=source::text
     OR h.table_name='local_identity.workspace_shot_inputs' AND h.payload->>'preparation_id'=source::text
     OR h.table_name='local_identity.workspace_preparations' AND h.payload->>'package_id'=source::text)) THEN
   RAISE EXCEPTION 'Historical preparation source Owner mismatch' USING ERRCODE='42501';
  END IF;
  IF package.context_snapshot#>'{workspace_preparation,formattingOnly}'='true'::jsonb THEN
   parent_id:=(package.context_snapshot#>>'{workspace_preparation,sourceReviewPackageId}')::uuid;
   parent_script:=(package.context_snapshot#>>'{continued_project,previousScriptRevisionId}')::uuid;
   PERFORM pg_temp.ensure_history_preparation(ep,parent_script,parent_id,importer,array_append(seen,source));
  END IF;
  -- Reuse the same strict provenance and deterministic conversion as the forward 188 migration.
  RETURN local_identity.import_preparation_source(ep,script,source);
 END $prepare$;
 -- Legacy formatting revisions did not copy drafts. Use the nearest recorded ancestor per shot,
 -- keeping its original draft/package identity; do not invent child-package provenance.
 CREATE OR REPLACE FUNCTION pg_temp.history_preparation_drafts(ep uuid,preparation uuid)
 RETURNS SETOF public.shot_preparation_drafts LANGUAGE sql STABLE AS $drafts$
 WITH RECURSIVE sources AS(
  SELECT p.id,p.parent_preparation_revision_id,0 depth,ARRAY[p.id] seen FROM local_identity.production_preparation_revisions p WHERE p.id=preparation AND p.episode_id=ep
  UNION ALL SELECT p.id,p.parent_preparation_revision_id,s.depth+1,array_append(s.seen,p.id)
   FROM sources s JOIN local_identity.production_preparation_revisions p ON p.id=s.parent_preparation_revision_id AND p.episode_id=ep WHERE NOT p.id=ANY(s.seen)
 )SELECT DISTINCT ON(d.shot_id)d.* FROM sources s JOIN public.shot_preparation_drafts d ON d.review_package_id=s.id AND d.episode_id=ep ORDER BY d.shot_id,s.depth;
 $drafts$;
 DO $legacy$ DECLARE ref record;w record;origin record;predicate text;
 BEGIN
  FOR ref IN SELECT DISTINCT episode_id,script_id,source_id,owner_id FROM legacy_history_refs ORDER BY episode_id,source_id LOOP
   BEGIN
    PERFORM pg_temp.ensure_history_preparation(ref.episode_id,ref.script_id,ref.source_id,ref.owner_id,ARRAY[]::uuid[]);
    FOR w IN SELECT DISTINCT coalesce(h.payload->>'workspace_id',h.payload->>'id')::uuid id FROM legacy_history_refs h
     WHERE h.episode_id=ref.episode_id AND h.script_id=ref.script_id AND h.source_id=ref.source_id AND h.owner_id=ref.owner_id LOOP
     IF EXISTS(SELECT 1 FROM local_identity.production_workspaces current_workspace CROSS JOIN LATERAL jsonb_array_elements(current_workspace.bindings) b
      WHERE current_workspace.id=w.id AND current_workspace.preparation_revision_id=ref.source_id
       AND NOT EXISTS(SELECT 1 FROM local_identity.production_shot_versions s WHERE s.preparation_revision_id=ref.source_id AND s.episode_id=ref.episode_id AND s.shot_id=b->>'shotId')) THEN
      RAISE EXCEPTION 'Historical binding has no proven shot' USING ERRCODE='22023';
     END IF;
     INSERT INTO local_identity.workspace_caption_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,contract,imported_from_draft_id,imported_from_package_id,created_at,updated_at)
      SELECT w.id,ref.episode_id,ref.source_id,d.shot_id,d.caption_contract,d.id,d.review_package_id,d.created_at,d.updated_at
      FROM pg_temp.history_preparation_drafts(ref.episode_id,ref.source_id) d JOIN local_identity.production_shot_versions s ON s.preparation_revision_id=ref.source_id AND s.episode_id=ref.episode_id AND s.shot_id=d.shot_id
      ON CONFLICT DO NOTHING;
     INSERT INTO local_identity.workspace_narration_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,mode,narration_text,voice,speaking_rate,language_code,voice_override,audio_track_id,imported_from_draft_id,imported_from_package_id,created_at,updated_at)
      SELECT w.id,ref.episode_id,ref.source_id,d.shot_id,CASE d.audio_mode WHEN 'source' THEN 'manual' ELSE d.audio_mode END,
       d.tts_text,d.tts_voice,d.tts_speaking_rate,d.tts_language_code,coalesce(length(d.tts_override_voice),0)>0,d.current_audio_track_id,d.id,d.review_package_id,d.created_at,d.updated_at
      FROM pg_temp.history_preparation_drafts(ref.episode_id,ref.source_id) d JOIN local_identity.production_shot_versions s ON s.preparation_revision_id=ref.source_id AND s.episode_id=ref.episode_id AND s.shot_id=d.shot_id
      ON CONFLICT DO NOTHING;
    END LOOP;
    UPDATE local_identity.history_projection_results p SET detail='旧工作区按原审核包接入独立基准；原始版本、文件和身份保持。'
     FROM legacy_history_refs h WHERE h.episode_id=ref.episode_id AND h.source_id=ref.source_id AND h.script_id=ref.script_id AND p.table_name=h.table_name AND p.row_key=h.row_key AND p.payload_sha256=h.payload_sha256 AND p.status='inserted';
   EXCEPTION WHEN OTHERS THEN
    -- A failed conversion must not leave a workspace pointing at an existing but incompatible baseline.
    FOR origin IN SELECT * FROM legacy_history_refs h WHERE h.episode_id=ref.episode_id AND h.source_id=ref.source_id AND h.script_id=ref.script_id AND h.owner_id=ref.owner_id LOOP
     SELECT string_agg(format('t.%I=%L::%s',j.key,j.value,format_type(a.atttypid,a.atttypmod)),' AND ') INTO predicate
      FROM jsonb_each_text(origin.projected_key)j JOIN pg_attribute a ON a.attrelid=origin.table_name::regclass AND a.attname=j.key AND a.attnum>0;
     EXECUTE format('DELETE FROM %s t WHERE %s',origin.table_name,predicate);
     UPDATE local_identity.history_projection_results SET status='history-only:legacy-adaptation:'||SQLSTATE,detail=SQLERRM
      WHERE table_name=origin.table_name AND row_key=origin.row_key AND payload_sha256=origin.payload_sha256;
     DELETE FROM history_inserted WHERE table_name=origin.table_name AND row_key=origin.row_key AND payload_sha256=origin.payload_sha256;
    END LOOP;
   END;
  END LOOP;
 END $legacy$;
 -- Include only newly derived rows in the existing orphan cleanup; never remove pre-existing rows.
 DO $derived$ DECLARE tab text;
 BEGIN
  FOREACH tab IN ARRAY ARRAY['production_preparation_revisions','production_shots','production_shot_versions','workspace_caption_inputs','workspace_narration_inputs'] LOOP
   EXECUTE format('INSERT INTO history_inserted(table_name,row_key,payload_sha256,projected_key)
    SELECT %L,k.key,encode(extensions.digest(to_jsonb(t)::text,''sha256''),''hex''),k.key FROM local_identity.%I t CROSS JOIN LATERAL(SELECT pg_temp.production_history_key(%L,to_jsonb(t)) key)k
    WHERE t.episode_id IN(SELECT episode_id FROM legacy_history_refs)
     AND NOT EXISTS(SELECT 1 FROM legacy_history_existing b WHERE b.table_name=%L AND b.row_key=k.key)
     AND NOT EXISTS(SELECT 1 FROM history_inserted i WHERE i.table_name=%L AND coalesce(i.projected_key,i.row_key)=k.key)',
    'local_identity.'||tab,tab,'local_identity.'||tab,'local_identity.'||tab,'local_identity.'||tab);
  END LOOP;
 END $derived$;
`;
