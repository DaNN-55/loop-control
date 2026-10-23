begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(9);
insert into accounts(id,slug,name,timezone)values('11700000-0000-4000-8000-000000000001','t11-source-test','T11','Asia/Shanghai');
insert into account_memberships(account_id,user_id,role)select '11700000-0000-4000-8000-000000000001',id,'owner' from auth.users order by id limit 1;
insert into account_blueprint_versions(id,account_id,version,policy,is_active)values('11700000-0000-4000-8000-000000000002','11700000-0000-4000-8000-000000000001',1,'{}',true);
insert into episodes(id,account_id,blueprint_version_id,title,is_test,stage)values('11700000-0000-4000-8000-000000000003','11700000-0000-4000-8000-000000000001','11700000-0000-4000-8000-000000000002','T11',true,'qc_passed');
insert into tasks(id,episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version,attempt,claimed_at,lease_token)values
('11700000-0000-4000-8000-000000000004','11700000-0000-4000-8000-000000000003','generate_review_render','completed','{"review_render":{"fixture":true}}',0,1,'openchatcut','openchatcut@0.2.14','review-render-v1',1,null,null),
('11700000-0000-4000-8000-000000000005','11700000-0000-4000-8000-000000000003','generate_final_render','running','{"final_render":{"source_review_package_id":"11700000-0000-4000-8000-000000000008","review_render":{"fixture":true}}}',0,1,'openchatcut','openchatcut@0.2.14','final-render-v1',1,now(),'11700000-0000-4000-8000-000000000099');
insert into task_runs(id,task_id,attempt,task_package,status,lease_token)values
('11700000-0000-4000-8000-000000000006','11700000-0000-4000-8000-000000000004',0,'{}','completed',null),
('11700000-0000-4000-8000-000000000016','11700000-0000-4000-8000-000000000005',0,'{}','running','11700000-0000-4000-8000-000000000099');
insert into artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size)values('11700000-0000-4000-8000-000000000007','11700000-0000-4000-8000-000000000003','11700000-0000-4000-8000-000000000004','render','episodes/t11/approved.mp4',repeat('a',64),1);
insert into review_packages(id,episode_id,task_id,task_run_id,artifact_id,stage,revision_number,context_snapshot)values('11700000-0000-4000-8000-000000000008','11700000-0000-4000-8000-000000000003','11700000-0000-4000-8000-000000000004','11700000-0000-4000-8000-000000000006','11700000-0000-4000-8000-000000000007','qc_review',1,'{}');
select is(final_render_reuse_source('11700000-0000-4000-8000-000000000005',0,'11700000-0000-4000-8000-000000000099'),null::jsonb,'unapproved source cannot be reused');
insert into approvals(episode_id,review_package_id,stage,decision,reason,actor_id)select '11700000-0000-4000-8000-000000000003','11700000-0000-4000-8000-000000000008','qc_passed','approved','synthetic SQL fixture',user_id from account_memberships where account_id='11700000-0000-4000-8000-000000000001';
select is(final_render_reuse_source('11700000-0000-4000-8000-000000000005',0,'11700000-0000-4000-8000-000000000099')#>>'{video,relativePath}','episodes/t11/approved.mp4','valid current attempt gets exact approved video');
insert into artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size)values('11700000-0000-4000-8000-000000000003','11700000-0000-4000-8000-000000000004','render','episodes/t11/not-approved.mp4',repeat('b',64),1);
select is(final_render_reuse_source('11700000-0000-4000-8000-000000000005',0,'11700000-0000-4000-8000-000000000099')#>>'{video,relativePath}','episodes/t11/approved.mp4','later unapproved video from same task is not selected');
select is(final_render_reuse_source('11700000-0000-4000-8000-000000000005',0,'11700000-0000-4000-8000-000000000098'),null::jsonb,'other attempt token rejected');
select is(final_render_reuse_source('11700000-0000-4000-8000-000000000005',1,'11700000-0000-4000-8000-000000000099'),null::jsonb,'wrong attempt rejected');
update tasks set input_snapshot=jsonb_set(input_snapshot,'{final_render,review_render}','{"fixture":false}') where id='11700000-0000-4000-8000-000000000005';
select is(final_render_reuse_source('11700000-0000-4000-8000-000000000005',0,'11700000-0000-4000-8000-000000000099')->>'inputsMatch','false','changed input preserves approved source but requires rerender');
update review_packages set invalidated_at=now(),invalidated_reason='T11 synthetic invalidation' where id='11700000-0000-4000-8000-000000000008';
select is(final_render_reuse_source('11700000-0000-4000-8000-000000000005',0,'11700000-0000-4000-8000-000000000099'),null::jsonb,'invalidated approval source rejected');
select ok(not has_function_privilege('anon','public.final_render_reuse_source(uuid,integer,uuid)','execute'),'anonymous cannot query reuse source');
select ok(not has_function_privilege('authenticated','public.final_render_reuse_source(uuid,integer,uuid)','execute'),'browser cannot nominate reuse source');
select * from finish();
rollback;
