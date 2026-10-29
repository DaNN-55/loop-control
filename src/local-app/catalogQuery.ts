// Native parameterization of the C-stage catalog contract (ADR-0008).
// Executed inside the same Owner/RLS repeatable-read transaction as metadata.
export const localCatalogSql=` with owned as materialized (
  select e.* from public.episodes e where exists (
   select 1 from public.account_memberships m where m.account_id=e.account_id and m.user_id=$1::uuid and m.role='owner')
 ), scoped as materialized (
  select e.* from owned e left join public.series_versions v on v.id=e.series_version_id
  left join public.series s on s.id=v.series_id
  where ($4::uuid is null or e.account_id=$4::uuid)
   and ($5::text='all' or $5::text='unassigned' and e.series_version_id is null
    or $5::text='unavailable' and e.series_version_id is not null and s.id is null
    or s.id::text=$5::text)
   and ($6::text='all' or $6::text='active' and e.archived_at is null or $6::text='archived' and e.archived_at is not null)
   and ($2::text not in ('reviews','operations') or e.archived_at is null and not local_identity.is_historical_episode(e.id))
   and ($9::text='' or strpos(lower(e.title),lower($9::text))>0 or strpos(lower(e.id::text),lower($9::text))>0)
 ), workspace_facts as materialized (
  select w.*,x.id export_id,x.status export_status,x.confirmed_at,x.created_at export_created_at,
   coalesce(x.project_content_version=w.revision and x.content_sha256=w.content_sha256,false) export_current,
   coalesce(x.status='ready' and x.artifact is not null and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(x.checks)='array' then x.checks else '[]'::jsonb end) check_row where check_row->>'passed' is distinct from 'true'),false) export_ready,
   d.task_id delivery_task_id,d.status delivery_status,
   exists(select 1 from local_identity.workspace_export_issues i where i.workspace_id=w.id and i.resolved_at is null) open_issue,
   coalesce(e.main_script_revision_id=w.script_revision_id and p.invalidated_at is null,false) basis_current
  from owned e join local_identity.production_workspaces w on w.episode_id=e.id
  join public.review_packages p on p.id=w.storyboard_package_id
  left join lateral(select x.* from local_identity.workspace_exports x where x.workspace_id=w.id order by x.created_at desc,x.id desc limit 1)x on true
  left join lateral(select t.id task_id,t.status from local_identity.workspace_deliveries d join public.tasks t on t.id=d.task_id where d.workspace_id=w.id and d.export_id=x.id order by d.created_at desc,d.id desc limit 1)d on true
 ), current_packages as materialized (

  select distinct on (e.id) r.id,r.episode_id,r.stage::text stage,r.revision_number from scoped e join public.review_packages r on r.episode_id=e.id and r.stage=e.stage
  where $2::text<>'accounts' and e.archived_at is null and r.invalidated_at is null and not local_identity.is_historical_episode(e.id)
   and not exists(select 1 from workspace_facts w where w.episode_id=e.id)
   and not exists(select 1 from local_identity.workspace_preparations prep where prep.package_id=r.id)
  order by e.id,r.revision_number desc,r.id
 ), pending as materialized (
  select r.* from current_packages r where r.stage<>'production_ready'
  union all select w.export_id,w.episode_id,'workspace_export',w.revision::integer from workspace_facts w join scoped e on e.id=w.episode_id
   where $2::text<>'accounts' and e.archived_at is null and e.stage<>'production_completed' and not local_identity.is_historical_episode(e.id)
   and w.basis_current and w.export_current and w.export_ready and w.confirmed_at is null and not w.open_issue
 ), scoped_tasks as materialized (
  select t.*,case when t.task_type='generate_review_render' then t.task_type::text
   when jsonb_typeof(t.input_snapshot#>'{shot_preparation,draft_id}')='string' or jsonb_typeof(t.input_snapshot#>'{shot_preparation,shot_id}')='string'
    then t.task_type||':shot:'||case when jsonb_typeof(t.input_snapshot#>'{shot_preparation,draft_id}')='string' then t.input_snapshot#>>'{shot_preparation,draft_id}' else t.input_snapshot#>>'{shot_preparation,shot_id}' end
   when jsonb_typeof(t.input_snapshot#>'{output,relative_path}')='string' then t.task_type||':output:'||(t.input_snapshot#>>'{output,relative_path}')
   else t.task_type||':task:'||t.id end scope
  from public.tasks t join scoped e on e.id=t.episode_id where $2::text<>'accounts' and e.archived_at is null and t.invalidated_at is null and not local_identity.is_historical_task(t.id)
 ), latest_tasks as materialized (
  select distinct on (episode_id,scope) * from scoped_tasks order by episode_id,scope,created_at desc,id
 ), task_blockers as materialized (
  select t.id task_id,t.task_type,t.episode_id,b.value blocker from latest_tasks t
  cross join lateral (
   select coalesce(jsonb_agg(value),'[]') items from jsonb_array_elements(case when jsonb_typeof(t.last_result->'blockers')='array' then t.last_result->'blockers' else '[]' end)
   where jsonb_typeof(value->'code')='string' and value->>'code'<>'' and jsonb_typeof(value->'detail')='string' and value->>'detail'<>''
  ) explicit
  cross join lateral jsonb_array_elements(case when jsonb_array_length(explicit.items)>0 then explicit.items else
   coalesce((select jsonb_agg(value||jsonb_build_object('code',value->>'check','detail',value->>'reason'))
    from jsonb_array_elements(case when jsonb_typeof(t.last_result#>'{preflight,checks}')='array' then t.last_result#>'{preflight,checks}' else '[]' end)
    where value->>'status' is distinct from 'passed' and jsonb_typeof(value->'check')='string' and value->>'check'<>'' and jsonb_typeof(value->'reason')='string' and value->>'reason'<>''),'[]') end) b
  where t.status in ('blocked','failed') and not exists(select 1 from workspace_facts w where w.episode_id=t.episode_id and (w.delivery_task_id is distinct from t.id or not w.export_current))
  union all select w.delivery_task_id,'prepare_publish_package',w.episode_id,jsonb_build_object('code','WORKSPACE_DELIVERY_FAILED','detail','交付失败，请检查本次结果后重试。')
   from workspace_facts w join public.tasks t on t.id=w.delivery_task_id join scoped e on e.id=w.episode_id
   where e.archived_at is null and not local_identity.is_historical_episode(e.id) and e.stage<>'production_completed' and w.export_current and t.status in ('failed','blocked') and (jsonb_typeof(t.last_result->'blockers') is distinct from 'array' or jsonb_array_length(t.last_result->'blockers')=0)
  union all select w.export_id,'workspace_export',w.episode_id,jsonb_build_object('code','WORKSPACE_EXPORT_FAILED','detail','成片检查未通过，请打开检查与交付处理。')
   from workspace_facts w join scoped e on e.id=w.episode_id where e.archived_at is null and not local_identity.is_historical_episode(e.id) and e.stage<>'production_completed' and w.basis_current and w.export_current and (w.export_status='failed' or w.open_issue)
 ), episode_states as materialized (
  select e.id episode_id,case
   when w.id is not null and e.stage='production_completed' then 'done'
   when w.id is not null then case
    when e.archived_at is not null or local_identity.is_historical_episode(e.id) then 'draft'
    when w.export_current and (w.delivery_status in ('failed','blocked') or w.export_status='failed' or w.open_issue) then 'blocked'
    when exists(select 1 from pending p where p.episode_id=e.id) then 'review'
    else 'running' end
   when exists(select 1 from latest_tasks t where t.episode_id=e.id and t.status in ('blocked','failed') and not exists(
    select 1 from scoped_tasks newer where newer.episode_id=t.episode_id and newer.task_type=t.task_type and newer.status='completed' and newer.input_snapshot->>'recovered_from_task_id'=t.id::text)) then 'blocked'
   when exists(select 1 from pending p where p.episode_id=e.id) then 'review'
   when e.stage='production_completed' then 'done'
   when exists(select 1 from latest_tasks t where t.episode_id=e.id and t.status in ('ready','running'))
    or e.stage in ('script_approved','visual_approved','storyboard_approved','production_ready','render_ready','qc_passed') then 'running'
   else 'draft' end action_status,
   case when w.id is not null then case when w.export_current or e.stage='production_completed' then 'delivery' when w.native_edit_revision>0 then 'editing' else 'preparation' end
    when e.stage in ('waiting_input','brief_draft','script_draft','script_review') then 'script'
    when e.stage in ('script_approved','visual_draft','visual_review','visual_approved','storyboard_draft','storyboard_review','storyboard_approved') then 'preparation'
    when e.stage in ('production_ready','render_ready') then 'editing' else 'delivery' end workflow_step
  from scoped e left join workspace_facts w on w.episode_id=e.id
 ), filtered as materialized (
  select e.* from scoped e join episode_states state on state.episode_id=e.id
  where ($11::text='all' or $11::text='review' and exists(select 1 from pending p where p.episode_id=e.id) or $11::text<>'review' and state.action_status=$11::text)
   and ($2::text<>'reviews' or exists(select 1 from pending p where p.episode_id=e.id))
 ), bounds as (
  select count(*) total,least(greatest(coalesce($3::integer,1),1),greatest(1,ceil(count(*)/20.0)::int)) page from filtered
 ), page_rows as materialized (
  select e.* from filtered e where $2::text<>'accounts'
  order by case when $10::text='title' then lower(e.title) end asc,
   case when $10::text='oldest' then e.updated_at end asc,e.updated_at desc,e.id
  limit 20 offset ((select page from bounds)-1)*20
 ), pending_bounds as (
  select count(*) total,least(greatest(coalesce($7::integer,1),1),greatest(1,ceil(count(*)/20.0)::int)) page from pending
 ), pending_rows as materialized (
  select e.*,r.revision_number from scoped e join pending r on r.episode_id=e.id
  order by e.updated_at desc,e.id limit 20 offset ((select page from pending_bounds)-1)*20
 ), blocked as materialized (
  select row_number() over(order by e.updated_at desc,e.id,b.task_id,b.blocker::text) position,
   jsonb_build_object('episode',to_jsonb(e),'blocker',b.blocker||jsonb_build_object('taskId',b.task_id,'taskType',b.task_type)) item
  from task_blockers b join scoped e on e.id=b.episode_id
 ), blocked_bounds as (
  select count(*) total,least(greatest(coalesce($8::integer,1),1),greatest(1,ceil(count(*)/20.0)::int)) page from blocked
 ), worker_tasks as materialized (
  select t.*,case when t.task_type in ('generate_review_render','generate_final_render') then 'episode-render-stage:'||t.task_type
   when nullif(btrim(t.input_snapshot#>>'{shot_preparation,draft_id}'),'') is not null then 'shot-preparation:'||(t.input_snapshot#>>'{shot_preparation,draft_id}')
   when nullif(btrim(t.input_snapshot#>>'{shot_preparation,review_package_id}'),'') is not null and nullif(btrim(t.input_snapshot#>>'{shot_preparation,shot_id}'),'') is not null then 'shot-preparation:'||(t.input_snapshot#>>'{shot_preparation,review_package_id}')||':'||(t.input_snapshot#>>'{shot_preparation,shot_id}')
   when nullif(btrim(t.input_snapshot->>'storyboard_review_package_id'),'') is not null and nullif(btrim(t.input_snapshot#>>'{shot,id}'),'') is not null then 'storyboard-shot:'||(t.input_snapshot->>'storyboard_review_package_id')||':'||(t.input_snapshot#>>'{shot,id}')
   when nullif(btrim(t.input_snapshot#>>'{audio_track,source_review_package_id}'),'') is not null and nullif(btrim(t.input_snapshot#>>'{audio_track,cue_id}'),'') is not null then 'audio-cue:'||(t.input_snapshot#>>'{audio_track,source_review_package_id}')||':'||(t.input_snapshot#>>'{audio_track,cue_id}')
   when nullif(btrim(t.input_snapshot#>>'{output,relative_path}'),'') is not null then 'output:'||(t.input_snapshot#>>'{output,relative_path}') else 'task:'||t.id end operation
  from public.tasks t join owned e on e.id=t.episode_id where e.archived_at is null and not local_identity.is_historical_task(t.id)
 ), recovered as (
  select old.id from worker_tasks old join worker_tasks newer on newer.input_snapshot->>'recovered_from_task_id'=old.id::text
   and newer.episode_id=old.episode_id and newer.task_type=old.task_type and newer.status='completed'
 ), current_worker as (
  select distinct on (episode_id,task_type,operation) * from worker_tasks t where not exists(select 1 from recovered r where r.id=t.id)
  order by episode_id,task_type,operation,coalesce(completed_at,claimed_at,created_at) desc,id desc
 )
 select jsonb_build_object(
  'episodes',coalesce((select jsonb_agg(to_jsonb(e) order by case when $10::text='title' then lower(e.title) end asc,case when $10::text='oldest' then e.updated_at end asc,e.updated_at desc,e.id) from page_rows e),'[]'),
  'total',(select total from bounds),'page',(select page from bounds),'pageSize',20,
  'episodeCount',(select count(*) from owned),
  'accountCounts',coalesce((select jsonb_object_agg(account_id,n) from(select account_id,count(*) n from owned group by account_id)s),'{}'),
  'reviewCount',(select count(*) from owned e where archived_at is null and not local_identity.is_historical_episode(e.id) and ((not exists(select 1 from local_identity.production_workspaces w where w.episode_id=e.id) and stage in ('script_review','visual_review','storyboard_review','qc_review')) or exists(select 1 from workspace_facts w where w.episode_id=e.id and w.basis_current and w.export_current and w.export_ready and w.confirmed_at is null and not w.open_issue and e.stage<>'production_completed'))),
  'stages',coalesce((select jsonb_object_agg(stage,n) from(select stage,count(*) n from filtered group by stage)s),'{}'),
  'artifactCounts',coalesce((select jsonb_object_agg(episode_id,n) from(select a.episode_id,count(*) n from public.artifacts a join page_rows e on e.id=a.episode_id group by a.episode_id)s),'{}'),
  'pending',case when $2::text='operations' then jsonb_build_object('total',(select total from pending_bounds),'page',(select page from pending_bounds),
   'items',coalesce((select jsonb_agg(to_jsonb(e) order by updated_at desc,id) from pending_rows e),'[]')) else jsonb_build_object('total',0,'page',1,'items','[]'::jsonb) end,
  'blocked',case when $2::text='operations' then jsonb_build_object('total',(select total from blocked_bounds),'page',(select page from blocked_bounds),
   'items',coalesce((select jsonb_agg(item order by position) from blocked where position between ((select page from blocked_bounds)-1)*20+1 and (select page from blocked_bounds)*20),'[]')) else jsonb_build_object('total',0,'page',1,'items','[]'::jsonb) end,
  'worker',jsonb_build_object('running',(select count(*) from current_worker where status='running'),
   'blocked',(select count(*) from current_worker where status='blocked'),'failed',(select count(*) from current_worker where status='failed'),
   'latest',(select jsonb_build_object('task_type',task_type,'at',coalesce(completed_at,claimed_at,created_at)) from worker_tasks order by coalesce(completed_at,claimed_at,created_at) desc,created_at desc,id limit 1),
   'latestCompleted',coalesce((select status='completed' from worker_tasks order by coalesce(completed_at,claimed_at,created_at) desc,created_at desc,id limit 1),false)),
  'statusCounts',(select jsonb_build_object('all',count(*),'review',count(*) filter(where exists(select 1 from pending p where p.episode_id=state.episode_id)),'running',count(*) filter(where action_status='running'),'blocked',count(*) filter(where action_status='blocked'),'done',count(*) filter(where action_status='done')) from episode_states state),
  'operationRows',coalesce((select jsonb_agg(jsonb_build_object('episodeId',e.id,'reviewRevision',coalesce((select p.revision_number from pending p where p.episode_id=e.id),r.revision_number),'reviewPending',exists(select 1 from pending p where p.episode_id=e.id),'workflowStep',state.workflow_step,
   'blockerCount',(select count(*) from task_blockers b where b.episode_id=e.id),'actionStatus',state.action_status)) from page_rows e left join current_packages r on r.episode_id=e.id join episode_states state on state.episode_id=e.id),'[]')
 ) AS catalog`;
