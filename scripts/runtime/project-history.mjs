// Append only missing business records, preserving conflicting versions in history.
import{runtimeContext}from'./environment.mjs';
export function projectHistory(runtime=runtimeContext()){
 return runtime.sql(`BEGIN;SET LOCAL session_replication_role=replica;
 CREATE TEMP TABLE history_inserted(table_name text,row_key jsonb,payload_sha256 text)ON COMMIT DROP;
 -- Original Owner IDs remain stable; current login credentials are never restored.
 INSERT INTO local_identity.owners(id,email) SELECT DISTINCT v::uuid,v||'@historical.invalid' FROM(
  SELECT payload->>'id' v FROM local_identity.history_versions WHERE table_name='local_identity.owners'
  UNION SELECT p.value FROM local_identity.history_versions h CROSS JOIN LATERAL jsonb_each_text(h.payload) p WHERE h.table_name LIKE 'public.%' AND p.key IN('user_id','created_by','approved_by','actor_id')
 )x WHERE v ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' ON CONFLICT DO NOTHING;
 DO $$DECLARE r record;cols text;predicate text;n integer;state text;existing boolean;payload jsonb;detail text;BEGIN
 FOR r IN SELECT DISTINCT ON(h.table_name,h.row_key) h.* FROM local_identity.history_versions h WHERE h.table_name LIKE 'public.%'
 ORDER BY h.table_name,h.row_key,coalesce(h.payload->>'updated_at',h.payload->>'created_at','') DESC,length(h.payload::text) DESC,h.payload_sha256 LOOP
  IF to_regclass(r.table_name) IS NULL THEN CONTINUE;END IF;
  SELECT string_agg(format('t.%I=%L::%s',j.key,j.value,format_type(a.atttypid,a.atttypmod)),' AND ') INTO predicate FROM jsonb_each_text(r.row_key) j JOIN pg_attribute a ON a.attrelid=r.table_name::regclass AND a.attname=j.key AND a.attnum>0;
  EXECUTE format('SELECT exists(SELECT 1 FROM %s t WHERE %s)',r.table_name,predicate) INTO existing;
  IF existing THEN state:='current-preserved';
  ELSE BEGIN
   SELECT string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) INTO cols FROM pg_attribute a WHERE a.attrelid=r.table_name::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND r.payload ? a.attname;
   IF cols IS NULL THEN CONTINUE;END IF;payload:=r.payload;detail:=NULL;
   IF r.table_name='public.episodes' THEN
    INSERT INTO local_identity.historical_episodes VALUES((payload->>'id')::uuid) ON CONFLICT DO NOTHING;
    IF payload->>'main_script_revision_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.production_material_revisions m WHERE m.id::text=payload->>'main_script_revision_id') THEN payload:=jsonb_set(payload,'{main_script_revision_id}','null'::jsonb);detail:='原始脚本引用在全部来源中缺失，原值保留于历史版本。';END IF;
    IF payload->>'series_version_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.series_versions v WHERE v.id::text=payload->>'series_version_id') THEN payload:=jsonb_set(payload,'{series_version_id}','null'::jsonb);detail:=coalesce(detail,'')||'原始系列引用缺失，原值保留于历史版本。';END IF;
   END IF;
   -- Historical in-flight tasks are visible as blocked; original status stays in history.
   IF r.table_name='public.tasks' AND payload->>'status' IN('ready','running') THEN payload:=jsonb_set(payload,'{status}','"blocked"'::jsonb);payload:=jsonb_set(payload,'{claimed_at}','null'::jsonb);END IF;
   EXECUTE format('INSERT INTO %s(%s)SELECT %s FROM jsonb_populate_record(NULL::%s,$1) ON CONFLICT DO NOTHING',r.table_name,cols,cols,r.table_name)USING payload;
   GET DIAGNOSTICS n=ROW_COUNT;state:=CASE WHEN n=1 THEN 'inserted' ELSE 'secondary-key-conflict' END;
   IF n=1 THEN INSERT INTO history_inserted VALUES(r.table_name,r.row_key,r.payload_sha256);END IF;
  EXCEPTION WHEN OTHERS THEN state:='history-only:'||SQLSTATE;END;END IF;
  INSERT INTO local_identity.history_projection_results(table_name,row_key,payload_sha256,status,detail)VALUES(r.table_name,r.row_key,r.payload_sha256,state,detail)ON CONFLICT(table_name,row_key,payload_sha256)DO UPDATE SET status=excluded.status,detail=excluded.detail,applied_at=now() WHERE local_identity.history_projection_results.status LIKE 'history-only:%';
 END LOOP;
 END$$;
 -- Remove only newly inserted rows whose original parents are absent in every source.
 -- Those rows remain fully readable in history rather than breaking live FK integrity.
 DO $$DECLARE fk record;missing text;predicate text;r record;removed integer;total integer;BEGIN
 FOR round IN 1..100 LOOP total:=0;
 FOR fk IN SELECT c.conrelid::regclass child,c.confrelid::regclass parent,c.conkey,c.confkey FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname='public' LOOP
  SELECT string_agg(format('a.%I IS NOT NULL',attname),' AND ' ORDER BY i) INTO missing FROM unnest(fk.conkey)WITH ORDINALITY k(num,i)JOIN pg_attribute ON attrelid=fk.child AND attnum=k.num;
  SELECT string_agg(format('a.%I=b.%I',x.attname,y.attname),' AND ' ORDER BY k.i) INTO predicate FROM unnest(fk.conkey,fk.confkey)WITH ORDINALITY k(num,ref,i)JOIN pg_attribute x ON x.attrelid=fk.child AND x.attnum=k.num JOIN pg_attribute y ON y.attrelid=fk.parent AND y.attnum=k.ref;
  EXECUTE format('WITH gone AS(DELETE FROM %s a USING history_inserted i WHERE i.table_name=%L AND %s AND NOT exists(SELECT 1 FROM %s b WHERE %s) AND NOT exists(SELECT 1 FROM jsonb_each_text(i.row_key) k WHERE to_jsonb(a)->>k.key IS DISTINCT FROM k.value) RETURNING i.*),marked AS(UPDATE local_identity.history_projection_results p SET status=''history-only:missing-parent'' FROM gone g WHERE p.table_name=g.table_name AND p.row_key=g.row_key AND p.payload_sha256=g.payload_sha256)DELETE FROM history_inserted i USING gone g WHERE i.table_name=g.table_name AND i.row_key=g.row_key AND i.payload_sha256=g.payload_sha256',fk.child,'public.'||split_part(fk.child::text,'.',array_length(string_to_array(fk.child::text,'.'),1)),missing,fk.parent,predicate);
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
