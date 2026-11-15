// Historical business facts only. Authentication, paid-call confirmations and runtime authority stay archived.
import{legacyProductionHistorySql}from'./legacy-production-history.mjs';
export const productionHistoryTables=Object.freeze([
 'input_episodes','production_preparation_revisions','production_shots','production_shot_versions',
 'production_workspaces','production_workspace_versions','workspace_preparations','workspace_shot_inputs',
 'workspace_caption_inputs','workspace_caption_evidence','workspace_narration_inputs','workspace_narrations',
 'workspace_narration_requests','workspace_narration_submissions','workspace_audio_preparations','workspace_audio_requests',
 'workspace_visual_candidates','workspace_visual_image_choices','workspace_visual_submissions','workspace_image_requests',
 'workspace_candidate_decisions','workspace_pexels_requests','workspace_exports','workspace_export_issues',
 'workspace_deliveries','workspace_legacy_recoveries',
].map(name=>'local_identity.'+name));
export const productionHistoryTableSql=productionHistoryTables.map(name=>"'"+name+"'").join(',');

export const productionHistoryProjectionSql=`
 CREATE TEMP TABLE production_history_selected ON COMMIT DROP AS
 SELECT DISTINCT ON(h.table_name,h.row_key) h.* FROM local_identity.history_versions h
 WHERE h.table_name IN (${productionHistoryTableSql})
 ORDER BY h.table_name,h.row_key,coalesce(h.payload->>'updated_at',h.payload->>'created_at','') DESC,length(h.payload::text) DESC,h.payload_sha256;
 CREATE INDEX ON production_history_selected(table_name,(payload->>'id'));
 CREATE OR REPLACE FUNCTION pg_temp.production_history_key(tab text,p jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $key$
 SELECT jsonb_object_agg(a.attname,p->a.attname) FROM pg_index ix
  JOIN LATERAL unnest(ix.indkey)WITH ORDINALITY key(num,i)ON true
  JOIN pg_attribute a ON a.attrelid=ix.indrelid AND a.attnum=key.num WHERE ix.indisprimary AND ix.indrelid=to_regclass(tab);
 $key$;
 CREATE OR REPLACE FUNCTION pg_temp.production_history_episode(p jsonb) RETURNS text LANGUAGE sql STABLE AS $episode$
 SELECT coalesce(p->>'episode_id',
  (SELECT w.episode_id::text FROM local_identity.production_workspaces w WHERE w.id=(p->>'workspace_id')::uuid),
  (SELECT h.payload->>'episode_id' FROM production_history_selected h WHERE h.table_name='local_identity.production_workspaces' AND h.payload->>'id'=p->>'workspace_id' LIMIT 1),
  (SELECT t.episode_id::text FROM public.tasks t WHERE t.id=(p->>'task_id')::uuid));
 $episode$;
 CREATE OR REPLACE FUNCTION pg_temp.production_history_reason(tab text,p jsonb,k jsonb,o uuid) RETURNS text LANGUAGE plpgsql AS $reason$
 DECLARE ep text;account uuid;identity jsonb;
 BEGIN
  identity:=pg_temp.production_history_key(tab,p);
  IF identity IS NULL OR identity IS DISTINCT FROM k AND NOT(tab='local_identity.production_workspace_versions'
   AND NOT(p ? 'preparation_revision_id') AND k=jsonb_build_object('workspace_id',p->'workspace_id','project_sha256',p->'project_sha256')) THEN RETURN 'invalid-key';END IF;
  IF tab IN('local_identity.production_workspaces','local_identity.production_workspace_versions') AND NOT(p ? 'preparation_revision_id')
   AND p->>'storyboard_package_id' IS NULL THEN RETURN 'missing-legacy-preparation';END IF;
  ep:=pg_temp.production_history_episode(p);
  SELECT e.account_id INTO account FROM public.episodes e WHERE e.id=ep::uuid;
  IF NOT FOUND THEN RETURN 'missing-episode';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=account AND m.user_id=o AND m.role='owner')
   AND NOT EXISTS(SELECT 1 FROM history_selected e JOIN history_selected a ON a.table_name='public.accounts' AND a.payload->>'id'=account::text AND a.owner_id=o
    JOIN local_identity.history_projection_results er ON er.table_name=e.table_name AND er.row_key=e.row_key AND er.payload_sha256=e.payload_sha256 AND er.status='inserted'
    JOIN local_identity.history_projection_results ar ON ar.table_name=a.table_name AND ar.row_key=a.row_key AND ar.payload_sha256=a.payload_sha256 AND ar.status='inserted'
    JOIN local_identity.historical_episodes original ON original.episode_id::text=ep
    WHERE e.table_name='public.episodes' AND e.payload->>'id'=ep AND e.payload->>'account_id'=account::text AND e.owner_id=o) THEN RETURN 'source-owner';END IF;
  IF EXISTS(SELECT 1 FROM history_selected e WHERE e.table_name='public.episodes' AND e.payload->>'id'=ep AND e.owner_id<>o) THEN RETURN 'source-owner';END IF;
  IF p ? 'owner_id' AND (p->>'owner_id')::uuid IS DISTINCT FROM o AND NOT(tab='local_identity.input_episodes'
   AND EXISTS(SELECT 1 FROM local_identity.historical_episodes h WHERE h.episode_id::text=ep)
   AND EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=account AND m.user_id=(p->>'owner_id')::uuid AND m.role='owner')) THEN RETURN 'source-owner';END IF;
  IF p ? 'account_id' AND (p->>'account_id')::uuid IS DISTINCT FROM account THEN RETURN 'source-account';END IF;
  IF tab='local_identity.production_preparation_revisions' AND
   (p->>'source_format' NOT IN ('production-preparation/v1','storyboard/v1') OR p#>>'{manifest,version}' IS DISTINCT FROM 'production-preparation/v1') THEN RETURN 'unsupported-preparation';END IF;
  IF tab='local_identity.production_workspaces' AND p->>'workflow_version' IS DISTINCT FROM 'four-step/v1' THEN RETURN 'unsupported-workspace';END IF;
  RETURN NULL;
 EXCEPTION WHEN invalid_text_representation THEN RETURN 'invalid-identity';
 END $reason$;
 DO $restore$ DECLARE r record;reason text;cols text;predicate text;present boolean;value jsonb;n integer;detail text;projected_key jsonb;
 BEGIN
  FOR r IN SELECT * FROM production_history_selected ORDER BY table_name,row_key LOOP
   reason:=pg_temp.production_history_reason(r.table_name,r.payload,r.row_key,r.owner_id);detail:=NULL;
   IF reason IS NULL THEN
    value:=r.payload;
    IF r.table_name IN('local_identity.production_workspaces','local_identity.production_workspace_versions') AND NOT(value ? 'preparation_revision_id') THEN
     value:=value||jsonb_build_object('preparation_revision_id',value->'storyboard_package_id');
    END IF;
    projected_key:=pg_temp.production_history_key(r.table_name,value);
    SELECT string_agg(format('t.%I=%L::%s',j.key,j.value,format_type(a.atttypid,a.atttypmod)),' AND ') INTO predicate
     FROM jsonb_each_text(projected_key) j JOIN pg_attribute a ON a.attrelid=r.table_name::regclass AND a.attname=j.key AND a.attnum>0;
    EXECUTE format('SELECT exists(SELECT 1 FROM %s t WHERE %s)',r.table_name,predicate) INTO present;
    IF present THEN reason:='current-preserved';
    ELSE BEGIN
     SELECT string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) INTO cols FROM pg_attribute a
      WHERE a.attrelid=r.table_name::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND value ? a.attname;
     IF r.table_name='local_identity.input_episodes' THEN
      SELECT jsonb_object_agg(key,CASE WHEN key='enabled' OR key LIKE '%_enabled' THEN 'false'::jsonb ELSE v END) INTO value FROM jsonb_each(value) AS item(key,v);
      detail:='历史执行开关关闭，原值保留于历史版本。';
     END IF;
     EXECUTE format('INSERT INTO %s(%s)SELECT %s FROM jsonb_populate_record(NULL::%s,$1)ON CONFLICT DO NOTHING',r.table_name,cols,cols,r.table_name)USING value;
     GET DIAGNOSTICS n=ROW_COUNT;reason:=CASE WHEN n=1 THEN 'inserted' ELSE 'secondary-key-conflict' END;
     IF n=1 THEN INSERT INTO history_inserted VALUES(r.table_name,r.row_key,r.payload_sha256,projected_key);END IF;
    EXCEPTION WHEN OTHERS THEN reason:='history-only:'||SQLSTATE;END;END IF;
   ELSE reason:='history-only:'||reason;
   END IF;
   INSERT INTO local_identity.history_projection_results(table_name,row_key,payload_sha256,status,detail)
    VALUES(r.table_name,r.row_key,r.payload_sha256,reason,detail)
    ON CONFLICT(table_name,row_key,payload_sha256)DO UPDATE SET status=excluded.status,detail=excluded.detail,applied_at=now()
     WHERE local_identity.history_projection_results.status LIKE 'history-only:%';
  END LOOP;
 END $restore$;
 -- Validate scope after all selected parents have arrived. Only this transaction's new rows can be removed.
 DO $scope$ DECLARE r record;fk record;p jsonb;ep text;predicate text;join_sql text;bad boolean;reason text;
 BEGIN
  FOR r IN SELECT h.*,i.projected_key FROM production_history_selected h JOIN history_inserted i USING(table_name,row_key,payload_sha256) LOOP
   SELECT string_agg(format('t.%I=%L::%s',j.key,j.value,format_type(a.atttypid,a.atttypmod)),' AND ') INTO predicate
    FROM jsonb_each_text(coalesce(r.projected_key,r.row_key)) j JOIN pg_attribute a ON a.attrelid=r.table_name::regclass AND a.attname=j.key AND a.attnum>0;
   EXECUTE format('SELECT to_jsonb(t) FROM %s t WHERE %s',r.table_name,predicate) INTO p;
   ep:=pg_temp.production_history_episode(p);reason:=NULL;
   FOR fk IN SELECT c.confrelid::regclass parent,c.conkey,c.confkey,n.nspname||'.'||t.relname parent_name FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.confrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE c.contype='f' AND c.conrelid=r.table_name::regclass AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.confrelid AND a.attname='episode_id' AND NOT a.attisdropped) LOOP
    SELECT string_agg(format('b.%I IS NOT DISTINCT FROM (jsonb_populate_record(NULL::%s,$1)).%I',y.attname,r.table_name,x.attname),' AND ' ORDER BY k.i) INTO join_sql
     FROM unnest(fk.conkey,fk.confkey)WITH ORDINALITY k(num,ref,i)
     JOIN pg_attribute x ON x.attrelid=r.table_name::regclass AND x.attnum=k.num JOIN pg_attribute y ON y.attrelid=fk.parent AND y.attnum=k.ref;
    EXECUTE format('SELECT exists(SELECT 1 FROM %s b WHERE %s AND b.episode_id::text IS DISTINCT FROM $2)',fk.parent,join_sql)INTO bad USING p,ep;
    IF bad THEN reason:='cross-episode-parent';EXIT;END IF;
    EXECUTE format('SELECT exists(SELECT 1 FROM %s b JOIN (SELECT table_name,row_key,owner_id FROM history_selected UNION ALL SELECT table_name,row_key,owner_id FROM production_history_selected) source ON source.table_name=$2 AND to_jsonb(b) @> source.row_key WHERE %s AND source.owner_id IS DISTINCT FROM $3::uuid)',fk.parent,join_sql)INTO bad USING p,fk.parent_name,r.owner_id;
    IF bad THEN reason:='source-owner';EXIT;END IF;
   END LOOP;
   -- Registered local audio carries its original parents in a versioned JSON
   -- receipt rather than foreign keys. Apply the same source-Owner boundary.
   IF reason IS NULL AND r.table_name='local_identity.workspace_audio_preparations'
    AND p#>>'{request_snapshot,version}'='registered-audio-input/v1' THEN
    IF EXISTS(SELECT 1 FROM (VALUES
     ('public.audio_tracks',p#>>'{request_snapshot,audioTrackId}'),
     ('public.artifacts',p#>>'{request_snapshot,sourceArtifactId}'),
     ('public.tasks',p#>>'{request_snapshot,sourceTaskId}')) parent(table_name,id)
     JOIN history_selected h ON h.table_name=parent.table_name AND h.row_key=jsonb_build_object('id',parent.id)
     WHERE parent.id IS NOT NULL AND h.owner_id IS DISTINCT FROM r.owner_id) THEN reason:='source-owner';
    ELSIF NOT EXISTS(SELECT 1 FROM public.audio_tracks a
     JOIN public.artifacts f ON f.id=a.source_artifact_id AND f.episode_id=a.episode_id
      AND f.relative_path=a.relative_path AND f.sha256=a.sha256 AND f.file_size=a.file_size
      AND f.producer_task_id IS NOT DISTINCT FROM a.source_task_id
     LEFT JOIN public.tasks t ON t.id=a.source_task_id AND t.episode_id=a.episode_id
     WHERE a.id::text=p#>>'{request_snapshot,audioTrackId}' AND a.episode_id::text=ep AND a.track_kind=p->>'kind'
      AND a.sha256=p#>>'{request_snapshot,sha256}' AND a.file_size::text=p#>>'{request_snapshot,fileSize}'
      AND a.source_artifact_id::text=p#>>'{request_snapshot,sourceArtifactId}'
      AND a.source_task_id::text IS NOT DISTINCT FROM p#>>'{request_snapshot,sourceTaskId}'
      AND (a.source_task_id IS NULL OR t.status='completed' AND t.invalidated_at IS NULL)) THEN reason:='registered-audio-source';
    END IF;
   END IF;
   IF r.table_name='local_identity.production_preparation_revisions' AND p->>'source_format'='storyboard/v1'
    AND NOT EXISTS(SELECT 1 FROM public.review_packages b WHERE b.id=(p->>'source_reference_id')::uuid AND b.episode_id::text=ep) THEN reason:='missing-source-package';END IF;
   IF reason IS NOT NULL THEN
    EXECUTE format('DELETE FROM %s t WHERE %s',r.table_name,predicate);
    UPDATE local_identity.history_projection_results SET status='history-only:'||reason,detail=CASE reason WHEN 'source-owner' THEN '所选父记录来自不同来源Owner，原值保留于历史版本。' WHEN 'registered-audio-source' THEN '原登记音轨与来源凭证不一致，原值保留于历史版本。' ELSE '原始业务关系不属于同一生产单，原值保留于历史版本。' END
     WHERE table_name=r.table_name AND row_key=r.row_key AND payload_sha256=r.payload_sha256;
    DELETE FROM history_inserted WHERE table_name=r.table_name AND row_key=r.row_key AND payload_sha256=r.payload_sha256;
   END IF;
  END LOOP;
 END $scope$;
 ${legacyProductionHistorySql}
 INSERT INTO local_identity.history_projection_results(table_name,row_key,payload_sha256,status,detail)
  SELECT h.table_name,h.row_key,h.payload_sha256,'history-only:excluded-local-table','仅保留原始历史；不恢复登录、调用确认或运行时授权。'
  FROM local_identity.history_versions h WHERE h.table_name LIKE 'local_identity.%' AND h.table_name NOT IN (${productionHistoryTableSql})
  ON CONFLICT DO NOTHING;
`;
