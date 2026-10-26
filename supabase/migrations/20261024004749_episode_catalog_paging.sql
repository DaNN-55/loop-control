-- One snapshot per visible page. Global summaries are computed in PostgreSQL;
-- no list of historical Episode rows is downloaded to compute counts.
create function public.read_episode_catalog(
 p_view text default 'episodes', p_page integer default 1,
 p_account_id uuid default null, p_series_id text default 'all',
 p_visibility text default 'active', p_pending_page integer default 1,
 p_blocked_page integer default 1
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if p_view not in ('episodes','reviews','operations','accounts') or p_visibility not in ('active','archived','all') then
  raise exception 'Invalid catalog filter' using errcode='22023';
 end if;
 return (
 with owned as materialized (
  select e.* from public.episodes e where exists (
   select 1 from public.account_memberships m where m.account_id=e.account_id and m.user_id=(select auth.uid()) and m.role='owner')
 ), filtered as materialized (
  select e.* from owned e left join public.series_versions v on v.id=e.series_version_id
  left join public.series s on s.id=v.series_id
  where (p_account_id is null or e.account_id=p_account_id)
   and (p_series_id='all' or p_series_id='unassigned' and e.series_version_id is null
    or p_series_id='unavailable' and e.series_version_id is not null and s.id is null
    or s.id::text=p_series_id)
   and (p_visibility='all' or p_visibility='active' and e.archived_at is null or p_visibility='archived' and e.archived_at is not null)
   and (p_view not in ('reviews','operations') or e.archived_at is null)
   and (p_view<>'reviews' or e.stage in ('script_review','visual_review','storyboard_review','production_ready','qc_review'))
 ), bounds as (
  select count(*) total,least(greatest(coalesce(p_page,1),1),greatest(1,ceil(count(*)/20.0)::int)) page from filtered
 ), page_rows as materialized (
  select e.* from filtered e where p_view<>'accounts' order by e.updated_at desc,e.id limit 20 offset ((select page from bounds)-1)*20
 ), current_packages as materialized (
  select distinct on (e.id) r.* from filtered e join public.review_packages r on r.episode_id=e.id and r.stage=e.stage
  where p_view='operations' and r.invalidated_at is null order by e.id,r.revision_number desc,r.id
 ), pending as materialized (
  select r.* from current_packages r where r.stage<>'production_ready' or (
   coalesce(r.context_snapshot->>'approval_mode','')<>'qc_only' and (
    not exists(select 1 from public.pre_render_review_members m where m.review_package_id=r.id)
    or exists(select 1 from public.pre_render_review_members m where m.review_package_id=r.id and not exists(
     select 1 from public.pre_render_review_member_decisions d where d.review_package_id=r.id and d.member_key=m.member_key))))
 ), pending_bounds as (
  select count(*) total,least(greatest(coalesce(p_pending_page,1),1),greatest(1,ceil(count(*)/20.0)::int)) page from pending
 ), pending_rows as materialized (
  select e.*,r.revision_number from filtered e join pending r on r.episode_id=e.id
  order by e.updated_at desc,e.id limit 20 offset ((select page from pending_bounds)-1)*20
 ), scoped_tasks as materialized (
  select t.*,case when t.task_type='generate_review_render' then t.task_type::text
   when jsonb_typeof(t.input_snapshot#>'{shot_preparation,draft_id}')='string' or jsonb_typeof(t.input_snapshot#>'{shot_preparation,shot_id}')='string'
    then t.task_type||':shot:'||case when jsonb_typeof(t.input_snapshot#>'{shot_preparation,draft_id}')='string' then t.input_snapshot#>>'{shot_preparation,draft_id}' else t.input_snapshot#>>'{shot_preparation,shot_id}' end
   when jsonb_typeof(t.input_snapshot#>'{output,relative_path}')='string' then t.task_type||':output:'||(t.input_snapshot#>>'{output,relative_path}')
   else t.task_type||':task:'||t.id end scope
  from public.tasks t join filtered e on e.id=t.episode_id where p_view='operations' and t.invalidated_at is null
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
  where t.status in ('blocked','failed')
 ), blocked as materialized (
  select row_number() over(order by e.updated_at desc,e.id,b.task_id,b.blocker::text) position,
   jsonb_build_object('episode',to_jsonb(e),'blocker',b.blocker||jsonb_build_object('taskId',b.task_id,'taskType',b.task_type)) item
  from task_blockers b join filtered e on e.id=b.episode_id
 ), blocked_bounds as (
  select count(*) total,least(greatest(coalesce(p_blocked_page,1),1),greatest(1,ceil(count(*)/20.0)::int)) page from blocked
 ), worker_tasks as materialized (
  select t.*,case when t.task_type in ('generate_review_render','generate_final_render') then 'episode-render-stage:'||t.task_type
   when nullif(btrim(t.input_snapshot#>>'{shot_preparation,draft_id}'),'') is not null then 'shot-preparation:'||(t.input_snapshot#>>'{shot_preparation,draft_id}')
   when nullif(btrim(t.input_snapshot#>>'{shot_preparation,review_package_id}'),'') is not null and nullif(btrim(t.input_snapshot#>>'{shot_preparation,shot_id}'),'') is not null then 'shot-preparation:'||(t.input_snapshot#>>'{shot_preparation,review_package_id}')||':'||(t.input_snapshot#>>'{shot_preparation,shot_id}')
   when nullif(btrim(t.input_snapshot->>'storyboard_review_package_id'),'') is not null and nullif(btrim(t.input_snapshot#>>'{shot,id}'),'') is not null then 'storyboard-shot:'||(t.input_snapshot->>'storyboard_review_package_id')||':'||(t.input_snapshot#>>'{shot,id}')
   when nullif(btrim(t.input_snapshot#>>'{audio_track,source_review_package_id}'),'') is not null and nullif(btrim(t.input_snapshot#>>'{audio_track,cue_id}'),'') is not null then 'audio-cue:'||(t.input_snapshot#>>'{audio_track,source_review_package_id}')||':'||(t.input_snapshot#>>'{audio_track,cue_id}')
   when nullif(btrim(t.input_snapshot#>>'{output,relative_path}'),'') is not null then 'output:'||(t.input_snapshot#>>'{output,relative_path}') else 'task:'||t.id end operation
  from public.tasks t join owned e on e.id=t.episode_id where e.archived_at is null
 ), recovered as (
  select old.id from worker_tasks old join worker_tasks newer on newer.input_snapshot->>'recovered_from_task_id'=old.id::text
   and newer.episode_id=old.episode_id and newer.task_type=old.task_type and newer.status='completed'
 ), current_worker as (
  select distinct on (episode_id,task_type,operation) * from worker_tasks t where not exists(select 1 from recovered r where r.id=t.id)
  order by episode_id,task_type,operation,coalesce(completed_at,claimed_at,created_at) desc,id desc
 )
 select jsonb_build_object(
  'episodes',coalesce((select jsonb_agg(to_jsonb(e) order by updated_at desc,id) from page_rows e),'[]'),
  'total',(select total from bounds),'page',(select page from bounds),'pageSize',20,
  'episodeCount',(select count(*) from owned),
  'accountCounts',coalesce((select jsonb_object_agg(account_id,n) from(select account_id,count(*) n from owned group by account_id)s),'{}'),
  'reviewCount',(select count(*) from owned where archived_at is null and stage in ('script_review','visual_review','storyboard_review','production_ready','qc_review')),
  'stages',coalesce((select jsonb_object_agg(stage,n) from(select stage,count(*) n from filtered group by stage)s),'{}'),
  'artifactCounts',coalesce((select jsonb_object_agg(episode_id,n) from(select a.episode_id,count(*) n from public.artifacts a join page_rows e on e.id=a.episode_id group by a.episode_id)s),'{}'),
  'pending',jsonb_build_object('total',(select total from pending_bounds),'page',(select page from pending_bounds),
   'items',coalesce((select jsonb_agg(to_jsonb(e) order by updated_at desc,id) from pending_rows e),'[]')),
  'blocked',jsonb_build_object('total',(select total from blocked_bounds),'page',(select page from blocked_bounds),
   'items',coalesce((select jsonb_agg(item order by position) from blocked where position between ((select page from blocked_bounds)-1)*20+1 and (select page from blocked_bounds)*20),'[]')),
  'worker',jsonb_build_object('running',(select count(*) from current_worker where status='running'),
   'blocked',(select count(*) from current_worker where status='blocked'),'failed',(select count(*) from current_worker where status='failed'),
   'latest',(select jsonb_build_object('task_type',task_type,'at',coalesce(completed_at,claimed_at,created_at)) from worker_tasks order by coalesce(completed_at,claimed_at,created_at) desc,created_at desc,id limit 1),
   'latestCompleted',coalesce((select status='completed' from worker_tasks order by coalesce(completed_at,claimed_at,created_at) desc,created_at desc,id limit 1),false)),
  'operationRows',coalesce((select jsonb_agg(jsonb_build_object('episodeId',e.id,'reviewRevision',r.revision_number,'reviewPending',exists(select 1 from pending p where p.id=r.id),
   'blockerCount',(select count(*) from task_blockers b where b.episode_id=e.id))) from page_rows e left join current_packages r on r.episode_id=e.id),'[]')
 )
 );
end $$;
revoke all on function public.read_episode_catalog(text,integer,uuid,text,text,integer,integer) from public,anon;
grant execute on function public.read_episode_catalog(text,integer,uuid,text,text,integer,integer) to authenticated;
notify pgrst,'reload schema';
