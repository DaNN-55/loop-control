// @vitest-environment node
// Explicit disposable database only; never reads or writes the daily application's database.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {localCatalogSql} from './catalogQuery';
import type {CatalogQuery,EpisodeCatalog} from '../episodes/episodeCatalogTypes';

const database=process.env.LOOP_CATALOG_FILTERS_TEST_DATABASE;
assert(database&&/^loop_ui_catalog_test_[a-z0-9_]+$/.test(database),'Set a disposable LOOP_CATALOG_FILTERS_TEST_DATABASE');
assert(process.env.DOCKER_HOST?.startsWith('unix://'),'Explicit local Docker socket required');
const container='loop-control-local-postgres';
const owner=randomUUID(),foreignOwner=randomUUID(),account=randomUUID(),foreignAccount=randomUUID(),memberAccount=randomUUID();
const episode=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const packageId=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const taskId=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sqlString=(s:string)=>"'"+s.replaceAll("'","''")+"'";
let created=false;
function psql(sql:string,target=database!){return execFileSync('docker',['exec','-i',container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',target],{input:sql,encoding:'utf8',maxBuffer:4*1024*1024});}
beforeAll(()=>{
 psql(`CREATE DATABASE ${database} TEMPLATE template0 ENCODING 'UTF8';`,'postgres');created=true;
 psql(`
 CREATE SCHEMA local_identity;
 CREATE TABLE public.account_memberships(account_id uuid,user_id uuid,role text);
 CREATE TABLE public.series(id uuid);
 CREATE TABLE public.series_versions(id uuid,series_id uuid);
 CREATE TABLE public.episodes(id uuid PRIMARY KEY,account_id uuid,title text,stage text,updated_at timestamptz,archived_at timestamptz,series_version_id uuid);
 CREATE TABLE public.review_packages(id uuid PRIMARY KEY,episode_id uuid,stage text,revision_number int,invalidated_at timestamptz,context_snapshot jsonb);
 CREATE TABLE public.pre_render_review_members(review_package_id uuid,member_key text);
 CREATE TABLE public.pre_render_review_member_decisions(review_package_id uuid,member_key text);
 CREATE TABLE public.tasks(id uuid PRIMARY KEY,episode_id uuid,task_type text,status text,input_snapshot jsonb,last_result jsonb,created_at timestamptz,invalidated_at timestamptz,completed_at timestamptz,claimed_at timestamptz);
 CREATE TABLE public.artifacts(episode_id uuid);
 CREATE TABLE local_identity.production_workspaces(id uuid PRIMARY KEY,episode_id uuid,script_revision_id uuid,storyboard_package_id uuid,revision bigint,content_sha256 text,native_edit_revision bigint);
 CREATE TABLE local_identity.workspace_preparations(package_id uuid,episode_id uuid,script_revision_id uuid);
 CREATE TABLE local_identity.workspace_exports(id uuid PRIMARY KEY,workspace_id uuid,episode_id uuid,project_content_version bigint,content_sha256 text,status text,artifact jsonb,checks jsonb,confirmed_at timestamptz,created_at timestamptz);
 CREATE TABLE local_identity.workspace_export_issues(workspace_id uuid,resolved_at timestamptz);
 CREATE TABLE local_identity.workspace_deliveries(id uuid,workspace_id uuid,export_id uuid,task_id uuid,created_at timestamptz);

 CREATE TABLE local_identity.historical_episodes(id uuid);
 CREATE TABLE local_identity.historical_tasks(id uuid);
 CREATE FUNCTION local_identity.is_historical_episode(uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT EXISTS(SELECT 1 FROM local_identity.historical_episodes WHERE id=$1)';
 CREATE FUNCTION local_identity.is_historical_task(uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT EXISTS(SELECT 1 FROM local_identity.historical_tasks WHERE id=$1)';
 INSERT INTO public.account_memberships VALUES('${account}','${owner}','owner'),('${foreignAccount}','${foreignOwner}','owner'),('${memberAccount}','${owner}','worker');
 INSERT INTO public.episodes SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${account}',
  case when n=23 then 'Needle 100%_literal' else '作品 '||lpad(n::text,2,'0') end,
  case when n in(24,27,30) then 'script_review' when n in(25,26) then 'production_ready' when n=29 then 'production_completed' else 'waiting_input' end,
  '2026-01-01T00:00:00Z'::timestamptz+n*interval '1 minute',case when n=30 then '2026-01-02T00:00:00Z'::timestamptz end,null FROM generate_series(1,30)n;
 INSERT INTO public.episodes VALUES('${episode(31)}','${foreignAccount}','Foreign Needle','waiting_input','2026-01-01',null,null),('${episode(32)}','${memberAccount}','Member Needle','waiting_input','2026-01-01',null,null),('${episode(33)}','${account}','历史资料','production_ready','2026-01-01',null,null),('${episode(34)}','${account}','已恢复','storyboard_approved','2026-01-01',null,null),('${episode(35)}','${account}','新任务已覆盖旧失败','waiting_input','2026-01-01',null,null);
 INSERT INTO local_identity.historical_episodes VALUES('${episode(33)}');
 INSERT INTO public.review_packages SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,stage,1,null,case when n=25 then '{"approval_mode":"qc_only"}'::jsonb else '{}'::jsonb end FROM generate_series(24,30)n JOIN public.episodes e ON e.id=('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid WHERE n in(24,25,26,27,30);
 INSERT INTO public.review_packages VALUES('${packageId(33)}','${episode(33)}','production_ready',1,null,'{}');
 INSERT INTO public.pre_render_review_members VALUES('${packageId(26)}','one');
 INSERT INTO public.pre_render_review_member_decisions VALUES('${packageId(26)}','one');
 INSERT INTO public.tasks VALUES
 ('${taskId(27)}','${episode(27)}','generate_a_roll','failed','{}','{}','2026-01-01',null,null,null),
 ('${taskId(28)}','${episode(28)}','generate_a_roll','running','{}','{}','2026-01-01',null,null,null),
 ('${taskId(29)}','${episode(29)}','generate_a_roll','running','{}','{}','2026-01-01',null,null,null),
 ('${taskId(34)}','${episode(34)}','generate_a_roll','blocked','{}','{}','2026-01-01',null,null,null),
 ('${taskId(134)}','${episode(34)}','generate_a_roll','completed','{"recovered_from_task_id":"${taskId(34)}"}','{}','2026-01-02',null,'2026-01-02',null),
 ('${taskId(35)}','${episode(35)}','generate_a_roll','failed','{"output":{"relative_path":"same.mp4"}}','{}','2026-01-01',null,null,null),
 ('${taskId(135)}','${episode(35)}','generate_a_roll','completed','{"output":{"relative_path":"same.mp4"}}','{}','2026-01-02',null,'2026-01-02',null);
 ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;
 CREATE POLICY member_read ON public.episodes FOR SELECT TO loop_app USING(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=episodes.account_id AND m.user_id=current_setting('loop.owner_id',true)::uuid));
 GRANT USAGE ON SCHEMA public,local_identity TO loop_app;
 GRANT SELECT ON ALL TABLES IN SCHEMA public,local_identity TO loop_app;
 GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA local_identity TO loop_app;
 `);
 const blockers=Array.from({length:25},(_,i)=>({code:'fixture-'+i,detail:'Synthetic blocker'}));
 psql(`INSERT INTO public.tasks VALUES('${taskId(1)}','${episode(1)}','generate_a_roll','blocked','{}',${sqlString(JSON.stringify({blockers}))},'2026-01-01',null,null,null);
 INSERT INTO public.review_packages VALUES('${packageId(124)}','${episode(24)}','script_review',2,'2026-01-02','{}'); ALTER TABLE public.episodes ADD COLUMN main_script_revision_id uuid;`);
},20000);
afterAll(()=>{if(created)psql(`DROP DATABASE ${database};`,'postgres');},10000);
function catalog(query:Partial<CatalogQuery>={},asOwner=owner):EpisodeCatalog{
 const parameters=[asOwner,query.view??'episodes',query.page??1,query.accountId||null,query.seriesId??'all',query.visibility??'active',query.pendingPage??1,query.blockedPage??1,query.q??'',query.sort??'updated',query.status??'all'];
 const values=parameters.map(v=>v===null?'NULL':typeof v==='number'?String(v):sqlString(v)).join(',');
 const result=psql(`SET ROLE loop_app;BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SELECT set_config('loop.owner_id','${asOwner}',true);PREPARE catalog_filter(uuid,text,integer,uuid,text,text,integer,integer,text,text,text) AS ${localCatalogSql};EXECUTE catalog_filter(${values});ROLLBACK;`);
 return JSON.parse(result.trim().split('\n').at(-1)!);
}
it('searches all matching records before pagination, treats SQL wildcards literally, and searches UUID fragments',()=>{
 expect(catalog().episodes).toHaveLength(20);
 expect(catalog({q:'needle'}).episodes.map(e=>e.id)).toEqual([episode(23)]);
 expect(catalog({q:'100%_'}).episodes.map(e=>e.id)).toEqual([episode(23)]);
 expect(catalog({q:'000000000023'}).episodes.map(e=>e.id)).toEqual([episode(23)]);
 expect(catalog({q:'not present',page:999})).toMatchObject({episodes:[],total:0,page:1});
});
it('sorts across pages with a stable id tie break and bounds filtered page counts',()=>{
 expect(catalog().episodes[0].id).toBe(episode(29));
 const oldest=catalog({sort:'oldest'});expect(oldest.episodes.slice(0,3).map(e=>e.id)).toEqual([episode(33),episode(34),episode(35)]);
 expect(catalog({sort:'oldest',page:2}).episodes).toHaveLength(12);
 const titles=catalog({sort:'title'});expect(titles.episodes[0].id).toBe(episode(23));
 expect(catalog({q:'作品',page:999}).page).toBe(2);
});
it('uses actual pending decisions and prioritises blockers, review, done, running, draft',()=>{
 const all=catalog({page:2});
 const statuses=new Map([...catalog().operationRows,...all.operationRows].map(row=>[row.episodeId,row.actionStatus]));
 expect(statuses.get(episode(24))).toBe('review');
 expect(statuses.get(episode(25))).toBe('running'); // QC-only needs no member review.
 expect(statuses.get(episode(26))).toBe('running'); // All members already decided.
 expect(statuses.get(episode(27))).toBe('blocked'); // Failed without structured blockers still needs action.
 expect(statuses.get(episode(28))).toBe('running');
 expect(statuses.get(episode(29))).toBe('done'); // Final state wins over stale running task.
 expect(statuses.get(episode(34))).toBe('running'); // Explicit successful recovery wins over old failure.
 expect(statuses.get(episode(35))).toBe('draft'); // Latest task for same output replaces failure.
 expect(catalog({status:'review'}).episodes.map(e=>e.id)).toEqual([episode(27),episode(24)]);
 expect(catalog().statusCounts?.review).toBe(2);
 expect(catalog({view:'reviews'}).episodes.map(e=>e.id)).toEqual([episode(27),episode(24)]);
 expect(catalog({status:'blocked'}).episodes.map(e=>e.id)).toEqual([episode(27),episode(1)]);
 expect(catalog({status:'done'}).episodes.map(e=>e.id)).toEqual([episode(29)]);
 expect(catalog({status:'review'}).statusCounts).toEqual(catalog().statusCounts);
 expect(catalog({q:'needle'}).statusCounts).toMatchObject({all:1,review:0,blocked:0,done:0,running:0});
});
it('retains independent pending/blocker queues, historical fences and Owner-only membership selection',()=>{
 expect(catalog().pending).toEqual({total:0,page:1,items:[]});expect(catalog().blocked).toEqual({total:0,page:1,items:[]});
 const operations=catalog({view:'operations',status:'done'});
 expect(operations.blocked.total).toBe(25);expect(operations.blocked.items).toHaveLength(20);
 expect(catalog({view:'operations',blockedPage:2}).blocked).toMatchObject({total:25,page:2});expect(catalog({view:'operations',blockedPage:2}).blocked.items).toHaveLength(5);
 expect(operations.operationRows.find(row=>row.episodeId===episode(29))?.actionStatus).toBe('done');
 expect(catalog({status:'review'}).operationRows.find(row=>row.episodeId===episode(24))?.reviewRevision).toBe(1);
 expect(operations.pending.total).toBe(2);expect(operations.pending.items.map(e=>e.id)).toEqual([episode(27),episode(24)]);
 expect(operations.episodes.map(e=>e.id)).toEqual([episode(29)]);
 expect(operations.statusCounts?.all).toBe(31); // Historical episode excluded from operating views.
 expect(catalog().statusCounts?.all).toBe(32);
 expect(catalog({visibility:'archived'}).episodes.map(e=>e.id)).toEqual([episode(30)]);expect(catalog({visibility:'archived'}).statusCounts?.review).toBe(0);
 expect(catalog({accountId:foreignAccount}).episodes).toEqual([]);
 expect(catalog({accountId:memberAccount}).episodes).toEqual([]);
 expect(catalog({},foreignOwner).episodes.map(e=>e.id)).toEqual([episode(31)]);
});

it('projects workspace current export and delivery facts without blocking on unused failed candidates',()=>{
 psql(`INSERT INTO public.episodes(id,account_id,title,stage,updated_at,main_script_revision_id) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${account}','四步 '||n,CASE WHEN n=39 THEN 'production_completed' ELSE 'script_approved' END,'2026-01-03',('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(36,40)n;
 INSERT INTO public.review_packages SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'storyboard_review',1,null,'{}' FROM generate_series(36,40)n;
 INSERT INTO local_identity.production_workspaces SELECT ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,repeat('a',64),1 FROM generate_series(36,40)n;
 INSERT INTO public.tasks SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'generate_narration','failed','{}','{"blockers":[{"code":"UNUSED_CANDIDATE","detail":"Unused failed candidate"}]}','2026-01-03',null,'2026-01-03',null FROM generate_series(36,40)n;
 INSERT INTO local_identity.workspace_exports SELECT ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,repeat('a',64),'ready','{"sha256":"fixture"}','[{"passed":true}]',CASE WHEN n=38 THEN '2026-01-03'::timestamptz ELSE null END,'2026-01-03' FROM generate_series(37,38)n;
 INSERT INTO public.tasks VALUES('${taskId(138)}','${episode(38)}','prepare_publish_package','failed','{}','{"blockers":[{"code":"DELIVERY_FAILED","detail":"Retry exact delivery"}]}','2026-01-04',null,'2026-01-04',null);
 INSERT INTO local_identity.workspace_deliveries VALUES('${taskId(138)}','40000000-0000-4000-8000-000000000038','60000000-0000-4000-8000-000000000038','${taskId(138)}','2026-01-04');`);
 const page=catalog({q:'四步'}),rows=new Map(page.operationRows.map(row=>[row.episodeId,row]));
 expect(rows.get(episode(36))?.actionStatus).toBe('running');expect(rows.get(episode(37))).toMatchObject({actionStatus:'review',reviewPending:true});expect(rows.get(episode(38))?.actionStatus).toBe('blocked');expect(rows.get(episode(39))?.actionStatus).toBe('done');expect(rows.get(episode(40))?.actionStatus).toBe('running');
 expect(catalog({q:'四步',status:'review'}).episodes.map(e=>e.id)).toEqual([episode(37)]);expect(catalog({q:'四步',view:'operations'}).blocked.items.map(row=>row.blocker.code)).toEqual(['DELIVERY_FAILED']);
 psql(`UPDATE local_identity.production_workspaces SET revision=2,content_sha256=repeat('b',64) WHERE episode_id='${episode(37)}';`);expect(catalog({q:'四步',status:'review'}).episodes).toEqual([]);
 psql(`UPDATE public.episodes SET archived_at='2026-01-04' WHERE id='${episode(38)}';`);expect(catalog({q:'四步',visibility:'archived'}).operationRows[0]).toMatchObject({actionStatus:'draft',blockerCount:0,reviewPending:false});
});
