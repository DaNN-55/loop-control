// Append only missing business records, preserving conflicting versions in history.
import{runtimeContext}from'./environment.mjs';
import{productionHistoryProjectionSql,productionHistoryTableSql}from'./production-history.mjs';
export function projectHistory(runtime=runtimeContext()){
 return runtime.sql(`BEGIN;SET LOCAL session_replication_role=replica;
 CREATE TEMP TABLE history_inserted(table_name text,row_key jsonb,payload_sha256 text,projected_key jsonb)ON COMMIT DROP;
 CREATE INDEX ON history_inserted(table_name);
 CREATE TEMP TABLE history_selected ON COMMIT DROP AS
 SELECT DISTINCT ON(h.table_name,h.row_key) h.* FROM local_identity.history_versions h WHERE h.table_name LIKE 'public.%'
 ORDER BY h.table_name,h.row_key,coalesce(h.payload->>'updated_at',h.payload->>'created_at','') DESC,length(h.payload::text) DESC,h.payload_sha256;
 CREATE INDEX ON history_selected(table_name,(row_key->>'id'));
 CREATE TEMP VIEW history_main_script_targets AS
SELECT h.row_key->>'id' episode_id,m.id script_id,h.owner_id,h.payload_sha256
     FROM history_selected h JOIN public.production_material_revisions m ON m.id::text=h.payload->>'main_script_revision_id'
     WHERE h.table_name='public.episodes' AND h.row_key->>'id'=h.payload->>'id' AND m.episode_id::text=h.payload->>'id' AND m.material_type='script'
      AND (EXISTS(SELECT 1 FROM public.account_memberships a WHERE a.account_id::text=h.payload->>'account_id' AND a.user_id=h.owner_id AND a.role='owner')
       OR EXISTS(SELECT 1 FROM history_selected a WHERE a.table_name='public.accounts' AND a.row_key->>'id'=h.payload->>'account_id' AND a.owner_id=h.owner_id))
      AND (EXISTS(SELECT 1 FROM history_selected s WHERE s.table_name='public.production_material_revisions' AND s.row_key->>'id'=m.id::text AND s.owner_id=h.owner_id AND s.payload->>'episode_id'=m.episode_id::text AND s.payload->>'sha256'=m.sha256)
       OR (NOT EXISTS(SELECT 1 FROM history_selected s WHERE s.table_name='public.production_material_revisions' AND s.row_key->>'id'=m.id::text)
        AND EXISTS(SELECT 1 FROM public.account_memberships a WHERE a.account_id::text=h.payload->>'account_id' AND a.user_id=h.owner_id AND a.role='owner')));
 -- Original Owner IDs remain stable; current login credentials are never restored.
 INSERT INTO local_identity.owners(id,email) SELECT DISTINCT v::uuid,v||'@historical.invalid' FROM(
  SELECT payload->>'id' v FROM local_identity.history_versions WHERE table_name='local_identity.owners'
  UNION SELECT p.value FROM local_identity.history_versions h CROSS JOIN LATERAL jsonb_each_text(h.payload) p WHERE h.table_name LIKE 'public.%' AND p.key IN('user_id','created_by','approved_by','actor_id')
 )x WHERE v ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' ON CONFLICT DO NOTHING;
 DO $$DECLARE r record;cols text;predicate text;n integer;state text;existing boolean;projected_payload jsonb;detail text;BEGIN
 -- Episodes refer to scripts and series versions which may arrive in this same batch.
 -- Keep the original version selection, but install those reference targets first.
 FOR r IN SELECT * FROM history_selected ORDER BY CASE WHEN table_name='public.episodes' THEN 1 ELSE 0 END,table_name,row_key LOOP
  IF to_regclass(r.table_name) IS NULL THEN CONTINUE;END IF;
  detail:=NULL;
  SELECT string_agg(format('t.%I=%L::%s',j.key,j.value,format_type(a.atttypid,a.atttypmod)),' AND ') INTO predicate FROM jsonb_each_text(r.row_key) j JOIN pg_attribute a ON a.attrelid=r.table_name::regclass AND a.attname=j.key AND a.attnum>0;
  EXECUTE format('SELECT exists(SELECT 1 FROM %s t WHERE %s)',r.table_name,predicate) INTO existing;
  IF existing THEN state:='current-preserved';
  ELSE BEGIN
   SELECT string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) INTO cols FROM pg_attribute a WHERE a.attrelid=r.table_name::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND r.payload ? a.attname;
   IF cols IS NULL THEN CONTINUE;END IF;projected_payload:=r.payload;detail:=NULL;
   IF r.table_name='public.episodes' THEN
    INSERT INTO local_identity.historical_episodes VALUES((projected_payload->>'id')::uuid) ON CONFLICT DO NOTHING;
    IF projected_payload->>'main_script_revision_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM history_main_script_targets t WHERE t.episode_id=projected_payload->>'id' AND t.script_id::text=projected_payload->>'main_script_revision_id' AND t.owner_id=r.owner_id AND t.payload_sha256=r.payload_sha256) THEN projected_payload:=jsonb_set(projected_payload,'{main_script_revision_id}','null'::jsonb);detail:='原始脚本引用缺失、归属不符或来源冲突，原值保留于历史版本。';END IF;
    IF projected_payload->>'series_version_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.series_versions v JOIN public.series s ON s.id=v.series_id WHERE v.id::text=projected_payload->>'series_version_id' AND s.account_id::text=projected_payload->>'account_id') THEN projected_payload:=jsonb_set(projected_payload,'{series_version_id}','null'::jsonb);detail:=coalesce(detail,'')||'原始系列引用缺失或不属于原账号，原值保留于历史版本。';END IF;
   END IF;
   -- Historical in-flight tasks are visible as blocked; original status stays in history.
   IF r.table_name='public.tasks' AND projected_payload->>'status' IN('ready','running') THEN projected_payload:=jsonb_set(projected_payload,'{status}','"blocked"'::jsonb);projected_payload:=jsonb_set(projected_payload,'{claimed_at}','null'::jsonb);END IF;
   EXECUTE format('INSERT INTO %s(%s)SELECT %s FROM jsonb_populate_record(NULL::%s,$1) ON CONFLICT DO NOTHING',r.table_name,cols,cols,r.table_name)USING projected_payload;
   GET DIAGNOSTICS n=ROW_COUNT;state:=CASE WHEN n=1 THEN 'inserted' ELSE 'secondary-key-conflict' END;
   IF n=1 THEN INSERT INTO history_inserted(table_name,row_key,payload_sha256)VALUES(r.table_name,r.row_key,r.payload_sha256);END IF;
  EXCEPTION WHEN OTHERS THEN state:='history-only:'||SQLSTATE;END;END IF;
  INSERT INTO local_identity.history_projection_results(table_name,row_key,payload_sha256,status,detail)VALUES(r.table_name,r.row_key,r.payload_sha256,state,detail)ON CONFLICT(table_name,row_key,payload_sha256)DO UPDATE SET status=excluded.status,detail=excluded.detail,applied_at=now() WHERE local_identity.history_projection_results.status LIKE 'history-only:%';
 END LOOP;
 END$$;
 -- Repair only a projector-proven missing link in an otherwise untouched historical row.
 -- A current link, an Owner edit or a conflicting source never authorizes replacement.
 WITH repaired AS(
  UPDATE public.episodes e SET main_script_revision_id=t.script_id
  FROM history_selected h JOIN history_main_script_targets t ON t.episode_id=h.row_key->>'id' AND t.owner_id=h.owner_id AND t.payload_sha256=h.payload_sha256
  JOIN local_identity.history_projection_results p ON p.table_name=h.table_name AND p.row_key=h.row_key AND p.payload_sha256=h.payload_sha256
  JOIN local_identity.historical_episodes old ON old.episode_id::text=h.row_key->>'id'
  WHERE h.table_name='public.episodes' AND e.id::text=h.row_key->>'id' AND e.main_script_revision_id IS NULL AND p.status='inserted'
   AND (p.detail LIKE '原始脚本引用在全部来源中缺失，原值保留于历史版本。%' OR p.detail LIKE '原始脚本引用缺失、归属不符或来源冲突，原值保留于历史版本。%')
   AND to_jsonb(e) @> (h.payload-'main_script_revision_id'-'series_version_id')
   AND (e.series_version_id::text IS NOT DISTINCT FROM h.payload->>'series_version_id'
    OR (e.series_version_id IS NULL AND (p.detail LIKE '%原始系列引用缺失，原值保留于历史版本。%' OR p.detail LIKE '%原始系列引用缺失或不属于原账号，原值保留于历史版本。%')))
  RETURNING p.table_name,p.row_key,p.payload_sha256
 ) UPDATE local_identity.history_projection_results p SET detail=replace(replace(p.detail,'原始脚本引用在全部来源中缺失，原值保留于历史版本。','已按原来源补齐主脚本引用，原始版本保持。'),'原始脚本引用缺失、归属不符或来源冲突，原值保留于历史版本。','已按原来源补齐主脚本引用，原始版本保持。'),applied_at=now()
 FROM repaired r WHERE p.table_name=r.table_name AND p.row_key=r.row_key AND p.payload_sha256=r.payload_sha256;
 ${productionHistoryProjectionSql}
 -- Remove only newly inserted rows whose original parents are absent in every source.
 -- Those rows remain fully readable in history rather than breaking live FK integrity.
 DO $$DECLARE fk record;missing text;predicate text;r record;removed integer;total integer;BEGIN
 FOR round IN 1..100 LOOP total:=0;
 FOR fk IN SELECT c.conrelid::regclass child,c.confrelid::regclass parent,c.conkey,c.confkey,n.nspname||'.'||t.relname child_name FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace JOIN pg_class t ON t.oid=c.conrelid WHERE c.contype='f' AND (n.nspname='public' OR n.nspname||'.'||t.relname IN (${productionHistoryTableSql})) LOOP
  SELECT string_agg(format('a.%I IS NOT NULL',attname),' AND ' ORDER BY i) INTO missing FROM unnest(fk.conkey)WITH ORDINALITY k(num,i)JOIN pg_attribute ON attrelid=fk.child AND attnum=k.num;
  SELECT string_agg(format('a.%I=b.%I',x.attname,y.attname),' AND ' ORDER BY k.i) INTO predicate FROM unnest(fk.conkey,fk.confkey)WITH ORDINALITY k(num,ref,i)JOIN pg_attribute x ON x.attrelid=fk.child AND x.attnum=k.num JOIN pg_attribute y ON y.attrelid=fk.parent AND y.attnum=k.ref;
  EXECUTE format('WITH gone AS(DELETE FROM %s a USING history_inserted i WHERE i.table_name=%L AND %s AND NOT exists(SELECT 1 FROM %s b WHERE %s) AND NOT exists(SELECT 1 FROM jsonb_each_text(coalesce(i.projected_key,i.row_key)) k WHERE to_jsonb(a)->>k.key IS DISTINCT FROM k.value) RETURNING i.*),marked AS(UPDATE local_identity.history_projection_results p SET status=''history-only:missing-parent'' FROM gone g WHERE p.table_name=g.table_name AND p.row_key=g.row_key AND p.payload_sha256=g.payload_sha256)DELETE FROM history_inserted i USING gone g WHERE i.table_name=g.table_name AND i.row_key=g.row_key AND i.payload_sha256=g.payload_sha256',fk.child,fk.child_name,missing,fk.parent,predicate);
  GET DIAGNOSTICS removed=ROW_COUNT;total:=total+removed;
 END LOOP;
 EXIT WHEN total=0;
 END LOOP;
 END$$;
 INSERT INTO local_identity.historical_tasks SELECT (row_key->>'id')::uuid FROM history_inserted WHERE table_name='public.tasks' ON CONFLICT DO NOTHING;
 INSERT INTO local_identity.historical_audit_events SELECT (row_key->>'id')::uuid FROM history_inserted WHERE table_name='public.audit_events' ON CONFLICT DO NOTHING;
 -- The single local Owner can inspect all newly recovered content accounts.
 INSERT INTO public.account_memberships(account_id,user_id,role)SELECT (row_key->>'id')::uuid,'644f8c5a-b668-48a3-8a25-94c4e502fa04'::uuid,'owner' FROM history_inserted WHERE table_name='public.accounts' ON CONFLICT DO NOTHING;
 DO $$DECLARE s record;maximum bigint;BEGIN FOR s IN SELECT n.nspname schema_name,t.relname table_name,a.attname column_name,pg_get_serial_sequence(format('%I.%I',n.nspname,t.relname),a.attname) seq FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped LOOP IF s.seq IS NOT NULL THEN EXECUTE format('SELECT max(%I)FROM %I.%I',s.column_name,s.schema_name,s.table_name)INTO maximum;IF maximum IS NOT NULL THEN PERFORM setval(s.seq,maximum,true);END IF;END IF;END LOOP;END$$;
 COMMIT;
 SELECT jsonb_build_object('results',(SELECT jsonb_object_agg(status,n)FROM(SELECT status,count(*) n FROM local_identity.history_projection_results GROUP BY status)x),'historicalTasks',(SELECT count(*)FROM local_identity.historical_tasks));`);
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(projectHistory());
