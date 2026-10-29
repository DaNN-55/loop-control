// Exact Owner-authorized maintenance; no broad purge, secrets, or backup files.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runtimeContext} from '../../../scripts/runtime/environment.mjs';
const dir=new URL('./',import.meta.url),read=n=>JSON.parse(fs.readFileSync(new URL(n,dir)));
const proposal=read('../health-history-20261027/further-cleanup-proposal.json');
const preflight=read('preflight.json'),structure=read('current-structure.json');
const ids=Object.values(proposal.groups).flat().map(e=>e.id),accounts=proposal.deleteAccountSuggestions;
assert.equal(new Set(ids).size,222);assert.equal(new Set(accounts.map(a=>a.id)).size,31);
const owner=preflight.owner,keep=structure.episodes.filter(e=>!ids.includes(e.id));
const keepAccounts=structure.accounts.filter(a=>!accounts.some(d=>d.id===a.id));
assert.equal(keep.length,16);assert.equal(keepAccounts.length,12); // includes 6 other-owner fixtures, unchanged
const lit=s=>"'"+s.replaceAll("'","''")+"'",uuid=s=>{assert.match(s,/^[a-f0-9-]{36}$/);return lit(s)+'::uuid';};
const source=createHash('sha256').update('Owner cleanup 222/31 20261027:'+ids.slice().sort().join(',')).digest('hex');
const mode=process.argv[2];assert(['dry-run','commit'].includes(mode));
const sql=`BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='180s';
SELECT pg_advisory_xact_lock(hashtextextended('owner-cleanup-second-20261027',0));
CREATE TEMP TABLE selected_episode(id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO selected_episode VALUES ${ids.map(i=>'('+uuid(i)+')').join(',')};
CREATE TEMP TABLE selected_account(id uuid PRIMARY KEY,name text) ON COMMIT DROP;
INSERT INTO selected_account VALUES ${accounts.map(a=>'('+uuid(a.id)+','+lit(a.name)+')').join(',')};
DO $$ BEGIN
 IF (SELECT count(*) FROM public.episodes e JOIN selected_episode s USING(id))<>222 THEN RAISE EXCEPTION 'Episode scope changed';END IF;
 IF (SELECT count(*) FROM public.accounts a JOIN selected_account s ON a.id=s.id AND a.name=s.name)<>31 THEN RAISE EXCEPTION 'Account scope changed';END IF;
 IF EXISTS(SELECT 1 FROM public.episodes e JOIN selected_account s ON s.id=e.account_id WHERE NOT EXISTS(SELECT 1 FROM selected_episode x WHERE x.id=e.id)) THEN RAISE EXCEPTION 'Unexpected order in selected account';END IF;
 IF EXISTS(SELECT 1 FROM public.episodes e JOIN selected_episode s USING(id) WHERE NOT EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=${uuid(owner)} AND role='owner')) THEN RAISE EXCEPTION 'Owner boundary changed';END IF;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE status='running') OR EXISTS(SELECT 1 FROM public.asset_locks l JOIN selected_episode s ON s.id=l.episode_id WHERE expires_at>now()) THEN RAISE EXCEPTION 'Active work must remain undisturbed';END IF;
END $$;
CREATE TEMP TABLE doomed(rel oid,sha text,data jsonb,PRIMARY KEY(rel,sha)) ON COMMIT DROP;
INSERT INTO doomed SELECT 'public.episodes'::regclass,encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex'),to_jsonb(e) FROM public.episodes e JOIN selected_episode s USING(id);
INSERT INTO doomed SELECT 'public.accounts'::regclass,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),to_jsonb(a) FROM public.accounts a JOIN selected_account s USING(id);
INSERT INTO doomed SELECT 'local_identity.historical_episodes'::regclass,encode(sha256(convert_to(to_jsonb(h)::text,'UTF8')),'hex'),to_jsonb(h) FROM local_identity.historical_episodes h JOIN selected_episode s ON s.id=h.episode_id;
DO $$ DECLARE f record;changes bigint;added bigint;predicate text;BEGIN
 LOOP changes:=0;
 FOR f IN SELECT * FROM pg_constraint WHERE contype='f' AND connamespace IN ('public'::regnamespace,'local_identity'::regnamespace) LOOP
  SELECT string_agg(format('to_jsonb(c)->%L=p.data->%L',ca.attname,pa.attname),' AND ' ORDER BY k.n) INTO predicate FROM unnest(f.conkey,f.confkey) WITH ORDINALITY k(child,parent,n) JOIN pg_attribute ca ON ca.attrelid=f.conrelid AND ca.attnum=k.child JOIN pg_attribute pa ON pa.attrelid=f.confrelid AND pa.attnum=k.parent;
  EXECUTE format('INSERT INTO doomed SELECT %s,encode(sha256(convert_to(to_jsonb(c)::text,''UTF8'')),''hex''),to_jsonb(c) FROM %s c JOIN doomed p ON p.rel=%s AND %s ON CONFLICT DO NOTHING',f.conrelid,f.conrelid::regclass,f.confrelid,predicate);
  GET DIAGNOSTICS added=ROW_COUNT;changes:=changes+added;
 END LOOP;
 EXIT WHEN changes=0;
 END LOOP;
 IF EXISTS(SELECT 1 FROM doomed d WHERE d.rel='public.episodes'::regclass AND NOT EXISTS(SELECT 1 FROM selected_episode s WHERE s.id=(d.data->>'id')::uuid)) OR EXISTS(SELECT 1 FROM doomed d WHERE d.rel='public.accounts'::regclass AND NOT EXISTS(SELECT 1 FROM selected_account s WHERE s.id=(d.data->>'id')::uuid)) THEN RAISE EXCEPTION 'Deletion dependency crosses approved account/order boundary';END IF;
END $$;
-- Retain the exact current deleted versions in the existing history feature.
INSERT INTO local_identity.history_sources(id,owner_id,kind,label,metadata) VALUES(${lit(source)},${uuid(owner)},'maintenance-cleanup','2026-10-27 已批准的222条生产单与31个测试账号清理',jsonb_build_object('episodes',222,'accounts',31,'executionQueue',false)) ON CONFLICT DO NOTHING;
CREATE TEMP TABLE history_stage ON COMMIT DROP AS SELECT n.nspname||'.'||c.relname table_name,
 coalesce((SELECT jsonb_object_agg(a.attname,d.data->a.attname) FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=d.rel AND i.indisprimary),jsonb_build_object('sha256',d.sha)) row_key,d.sha payload_sha256,d.data payload FROM doomed d JOIN pg_class c ON c.oid=d.rel JOIN pg_namespace n ON n.oid=c.relnamespace;
INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) SELECT table_name,row_key,payload_sha256,${uuid(owner)},payload FROM history_stage ON CONFLICT DO NOTHING;
INSERT INTO local_identity.history_source_rows SELECT ${lit(source)},table_name,row_key,payload_sha256 FROM history_stage ON CONFLICT DO NOTHING;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM history_stage h WHERE NOT EXISTS(SELECT 1 FROM local_identity.history_versions v WHERE v.table_name=h.table_name AND v.row_key=h.row_key AND v.payload_sha256=h.payload_sha256 AND v.payload=h.payload)) THEN RAISE EXCEPTION 'Exact original history missing';END IF;END $$;
CREATE TEMP TABLE protected(rel oid PRIMARY KEY,rows bigint,sha text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.fingerprint(target oid,OUT rows bigint,OUT sha text) LANGUAGE plpgsql AS $$ BEGIN
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(h,'''' ORDER BY h),''''),''UTF8'')),''hex'') FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'') h FROM %s t WHERE NOT EXISTS(SELECT 1 FROM doomed d WHERE d.rel=%s AND d.sha=encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'') AND d.data=to_jsonb(t))) s',target::regclass,target) INTO rows,sha;
END $$;
DO $$ DECLARE t record;f record;BEGIN FOR t IN SELECT oid FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'local_identity'::regnamespace) AND relkind='r' LOOP SELECT * INTO f FROM pg_temp.fingerprint(t.oid);INSERT INTO protected VALUES(t.oid,f.rows,f.sha);END LOOP;END $$;
-- Five individually approved acceptance fixtures lack their test marker.
-- Set it only inside this transaction, then use the guarded domain deletion.
UPDATE public.episodes e SET is_test=true,archived_at=coalesce(archived_at,now()) FROM selected_episode s WHERE e.id=s.id;
DELETE FROM local_identity.input_episodes h USING selected_episode s WHERE h.episode_id=s.id;
DELETE FROM local_identity.historical_tasks h USING public.tasks t,selected_episode s WHERE h.task_id=t.id AND t.episode_id=s.id;
DELETE FROM local_identity.historical_audit_events h USING doomed d WHERE d.rel='public.audit_events'::regclass AND h.event_id=(d.data->>'id')::uuid;
CREATE TEMP TABLE receipts ON COMMIT DROP AS SELECT public.delete_episode(id,${uuid(owner)}) receipt FROM selected_episode ORDER BY id;
DELETE FROM local_identity.historical_episodes h USING selected_episode s WHERE h.episode_id=s.id;
SELECT set_config('loop.owner_id',${lit(owner)},true);
SET SESSION AUTHORIZATION loop_app;
SET LOCAL ROLE loop_owner;
DO $$ DECLARE a record;BEGIN FOR a IN SELECT id,name FROM selected_account ORDER BY id LOOP IF NOT public.delete_account(a.id,a.name) THEN RAISE EXCEPTION 'Account deletion failed';END IF;END LOOP;END $$;
RESET ROLE;
SET SESSION AUTHORIZATION DEFAULT;
DO $$ DECLARE t record;f record;BEGIN
 IF EXISTS(SELECT 1 FROM public.episodes e JOIN selected_episode s USING(id)) OR EXISTS(SELECT 1 FROM public.accounts a JOIN selected_account s USING(id)) THEN RAISE EXCEPTION 'Approved rows not deleted';END IF;
 IF (SELECT count(*) FROM public.episodes)<>16 OR (SELECT count(*) FROM public.accounts)<>12 THEN RAISE EXCEPTION 'Unexpected remaining global count';END IF;
 IF (SELECT count(*) FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE m.user_id=${uuid(owner)})<>10 OR (SELECT count(*) FROM public.account_memberships WHERE user_id=${uuid(owner)})<>6 THEN RAISE EXCEPTION 'Unexpected remaining Owner count';END IF;
 FOR t IN SELECT * FROM protected LOOP SELECT * INTO f FROM pg_temp.fingerprint(t.rel);IF f.rows<>t.rows OR f.sha<>t.sha THEN RAISE EXCEPTION 'Preserved table changed: %',t.rel::regclass;END IF;END LOOP;
END $$;
SELECT jsonb_build_object('mode',${lit(mode)},'deletedEpisodes',(SELECT count(*) FROM receipts),'deletedAccounts',31,'remainingOwnerEpisodes',10,'remainingOwnerAccounts',6,'otherOwnerEpisodesPreserved',6,'otherOwnerAccountsPreserved',6,'protectedRelations',(SELECT count(*) FROM protected),'historyRowsPreserved',(SELECT count(*) FROM history_stage),'historySource',${lit(source)},'deletedRelations',(SELECT jsonb_object_agg(rel::regclass::text,n) FROM (SELECT rel,count(*) n FROM doomed GROUP BY rel) s),'protected',(SELECT jsonb_object_agg(rel::regclass::text,jsonb_build_object('rows',rows,'sha256',sha)) FROM protected));
${mode==='commit'?'COMMIT':'ROLLBACK'};`;
// Temporary tables are inaccessible to loop_owner unless explicitly granted.
const finalSql=sql.replace('SET SESSION AUTHORIZATION loop_app;','GRANT SELECT ON selected_account TO loop_owner;\nSET SESSION AUTHORIZATION loop_app;');
fs.writeFileSync(new URL('operation.sql',dir),finalSql,{mode:0o600});
const c=runtimeContext();
try{const output=c.sql(finalSql).split('\n').filter(x=>x.startsWith('{')).at(-1);const result=JSON.parse(output);fs.writeFileSync(new URL(mode+'-result.json',dir),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log({...result,protected:undefined});}
catch(e){fs.writeFileSync(new URL(mode+'-failure.txt',dir),String(e.stderr??e.message),{mode:0o600});throw e;}
