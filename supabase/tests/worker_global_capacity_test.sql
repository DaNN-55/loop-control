begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select set_config('request.jwt.claim.role','service_role',true);
select ok(not has_table_privilege('authenticated','public.worker_scheduler_settings','SELECT'),'Owner cannot read internal scheduler settings');
select ok(not has_table_privilege('authenticated','public.worker_scheduler_settings','UPDATE'),'Owner cannot raise host capacity');
select ok(has_table_privilege('service_role','public.worker_scheduler_settings','UPDATE'),'trusted service can configure host capacity');
select ok(not has_table_privilege('anon','public.worker_episode_turns','SELECT'),'anonymous cannot read internal rotation state');
select ok(not has_function_privilege('authenticated','public.claim_next_worker_task(uuid,integer)','EXECUTE'),'Owner cannot claim tasks directly');
select ok(not has_function_privilege('service_role','public.claim_next_worker_task_pre_lease(uuid,integer)','EXECUTE'),'unfenced claim remains private');
select ok(not has_function_privilege('anon','public.worker_resource_limits(jsonb,integer)','EXECUTE'),'internal resource facts are not a browser API');
select ok(not has_table_privilege('authenticated','public.worker_resource_ceilings','UPDATE'),'Owner cannot raise trusted connection or resource ceilings');
select ok(not has_table_privilege('service_role','public.worker_scheduler_settings','DELETE'),'service cannot delete the host capacity singleton');
select ok(not has_table_privilege('service_role','public.worker_episode_turns','UPDATE'),'direct service writes cannot reset durable fairness');
select ok(not has_function_privilege('authenticated','public.worker_retry_delay_ms()','EXECUTE'),'retry delay read is private to the scheduler');
-- Isolate the private retry read from any preserved fixture's future clock.
update public.tasks set available_at='-infinity' where available_at>clock_timestamp();
select is(public.worker_retry_delay_ms(),0,'an empty eligible retry set returns zero rather than a perpetual 1ms wait');
update worker_scheduler_settings set capacity=2 where singleton;
insert into accounts(id,slug,name,timezone) values('82000000-0000-4000-8000-000000000001','t07-capacity-contract','T07 capacity contract','Asia/Shanghai');
insert into account_blueprint_versions(id,account_id,version,policy,is_active) values('82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001',1,'{}',true);
insert into episodes(id,account_id,blueprint_version_id,title,is_test) values('82000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002','T07 DB contract',true);
insert into tasks(id,episode_id,task_type,status,provider,model,prompt_version,max_attempts,budget_limit_cents,input_snapshot)
select ('82000000-0000-4000-8001-00000000000'||i)::uuid,'82000000-0000-4000-8000-000000000003','draft_brief','ready',provider,'t07-controlled','t07-v1',32,0,jsonb_build_object('capability','brief_drafting','executor',jsonb_build_object('provider',provider,'adapter',adapter))
from (values(1,'google_tts','google_tts'),(2,'pexels','pexels_video'),(3,'volcengine_tts','volcengine_tts')) f(i,provider,adapter);
create temporary table reservations as select * from claim_next_worker_task('82000000-0000-4000-8001-000000000001',8);
insert into reservations select * from claim_next_worker_task('82000000-0000-4000-8001-000000000002',8);
select is((select count(*) from reservations),2::bigint,'distinct resources can use both host slots');
select is((select count(*) from claim_next_worker_task('82000000-0000-4000-8001-000000000003',8)),0::bigint,'caller limit eight cannot raise configured host limit two');
select is((select attempt from tasks where id='82000000-0000-4000-8001-000000000003'),0,'capacity wait preserves zero attempts');
update tasks set status='superseded',invalidated_at=clock_timestamp(),invalidated_reason='Controlled cancellation' where id='82000000-0000-4000-8001-000000000002';
select throws_ok(format('select refresh_worker_task_lease(%L,0,%L::uuid)','82000000-0000-4000-8001-000000000002',(select lease_token from reservations where task_id='82000000-0000-4000-8001-000000000002')),'42501','Worker lease is expired or belongs to another attempt','cancelled attempt is fenced');
select is((select count(*) from claim_next_worker_task('82000000-0000-4000-8001-000000000003',8)),1::bigint,'cancellation releases a host slot');
select (report_worker_result(task_id,attempt,jsonb_build_object('version','worker-result/v1','taskId',task_id,'status','failed','artifacts','[]'::jsonb,'validation',jsonb_build_object('passed',false,'checks','[]'::jsonb),'actualCostCents',0,'blockers','[]'::jsonb,'retry',jsonb_build_object('shouldRetry',true,'reason','Controlled retry'),'nextStep','Retry later'),lease_token)).status from reservations where task_id='82000000-0000-4000-8001-000000000001';
select is((select status::text from tasks where id='82000000-0000-4000-8001-000000000001'),'ready','retry stays durable and ready');
select ok((select available_at>clock_timestamp() and available_at<=clock_timestamp()+interval '1.1 seconds' from tasks where id='82000000-0000-4000-8001-000000000001'),'first retry has a one second bounded delay');
select is((select count(*) from claim_next_worker_task('82000000-0000-4000-8001-000000000001',8)),0::bigint,'retry cannot spin before available_at');
update tasks set available_at=clock_timestamp()-interval '1 second' where id='82000000-0000-4000-8001-000000000001';
create temporary table retried as select * from claim_next_worker_task('82000000-0000-4000-8001-000000000001',8);
select is((select attempt from retried),1,'next Worker attempt remains zero based');
select ok((select r.lease_token<>o.lease_token from retried r join reservations o using(task_id)),'retry rotates lease token');
select is((select count(*) from task_runs where task_id='82000000-0000-4000-8001-000000000001'),2::bigint,'retry preserves both attempt records');
-- Use a controlled later attempt to verify the exponential cap without sleeping.
update tasks set status='superseded',invalidated_at=clock_timestamp(),invalidated_reason='T07 cap fixture release' where id in ('82000000-0000-4000-8001-000000000001','82000000-0000-4000-8001-000000000003');
insert into tasks(id,episode_id,task_type,status,provider,model,prompt_version,max_attempts,budget_limit_cents,attempt,input_snapshot)
values('82000000-0000-4000-8001-000000000004','82000000-0000-4000-8000-000000000003','draft_brief','ready','codex','t07-controlled','t07-v1',32,0,6,'{"capability":"brief_drafting","executor":{"provider":"codex","adapter":"codex"}}');
create temporary table capped as select * from claim_next_worker_task('82000000-0000-4000-8001-000000000004',2);
select (report_worker_result(task_id,attempt,jsonb_build_object('version','worker-result/v1','taskId',task_id,'status','failed','artifacts','[]'::jsonb,'validation',jsonb_build_object('passed',false,'checks','[]'::jsonb),'actualCostCents',0,'blockers','[]'::jsonb,'retry',jsonb_build_object('shouldRetry',true,'reason','Controlled bounded retry'),'nextStep','Retry later'),lease_token)).status from capped;
select ok((select available_at between clock_timestamp()+interval '29 seconds' and clock_timestamp()+interval '30.1 seconds' from tasks where id='82000000-0000-4000-8001-000000000004'),'later exponential retries are capped at thirty seconds');
-- Recovery may have requeued preserved expired rows in this rollback transaction.
-- Isolate the capped retry when testing the earliest-delay scheduler read.
update public.tasks set available_at='-infinity' where id<>'82000000-0000-4000-8001-000000000004' and available_at>clock_timestamp();
select ok(public.worker_retry_delay_ms() between 29000 and 30000,'scheduler reads bounded retry delay from DB clock');
select * from finish();
rollback;
