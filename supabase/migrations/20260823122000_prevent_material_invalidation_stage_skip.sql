create or replace function public.invalidate_dependent_production_work(p_upstream_kind text, p_upstream_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dependency public.production_dependencies;
  source_task public.tasks;
  candidate_rank integer;
  episode_candidate record;
  target_stage public.episode_stage;
  approval public.approvals;
begin
  if p_upstream_kind not in ('material_revision', 'series_version', 'review_package') or btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Production invalidation input is invalid' using errcode = '22023';
  end if;
  for dependency in select * from public.production_dependencies where upstream_kind = p_upstream_kind and upstream_id = p_upstream_id loop
    insert into public.production_invalidations (episode_id,upstream_kind,upstream_id,target_kind,target_id,reason)
    values (dependency.episode_id,p_upstream_kind,p_upstream_id,dependency.downstream_kind,dependency.downstream_id,btrim(p_reason))
    on conflict do nothing;
    if dependency.downstream_kind = 'task' then
      update public.tasks set invalidated_at = now(), invalidated_reason = btrim(p_reason) where id = dependency.downstream_id and invalidated_at is null;
      select * into source_task from public.tasks where id = dependency.downstream_id;
      candidate_rank := case when source_task.task_type = 'prepare_visual_brief' then 1 when source_task.task_type = 'draft_storyboard' then 2 else 3 end;
    else
      update public.review_packages set invalidated_at = now(), invalidated_reason = btrim(p_reason) where id = dependency.downstream_id and invalidated_at is null;
      candidate_rank := 3;
      for approval in select * from public.approvals where review_package_id = dependency.downstream_id loop
        insert into public.production_invalidations (episode_id,upstream_kind,upstream_id,target_kind,target_id,reason)
        values (dependency.episode_id,p_upstream_kind,p_upstream_id,'approval',approval.id,btrim(p_reason))
        on conflict do nothing;
      end loop;
    end if;
  end loop;
  for episode_candidate in
    select episode.*, min(case when task.task_type = 'prepare_visual_brief' then 1 when task.task_type = 'draft_storyboard' then 2 else 3 end) as earliest_rank
    from public.episodes episode
    join public.production_dependencies candidate on candidate.episode_id = episode.id
    left join public.tasks task on candidate.downstream_kind = 'task' and task.id = candidate.downstream_id
    where candidate.upstream_kind = p_upstream_kind and candidate.upstream_id = p_upstream_id
    group by episode.id
  loop
    target_stage := case episode_candidate.earliest_rank when 1 then 'visual_draft'::public.episode_stage when 2 then 'storyboard_draft'::public.episode_stage else 'production_ready'::public.episode_stage end;
    if episode_candidate.stage > target_stage then
      update public.episodes set stage = target_stage, updated_at = now() where id = episode_candidate.id;
      insert into public.state_transitions (episode_id,from_stage,to_stage,reason,actor_id) values (episode_candidate.id,episode_candidate.stage,target_stage,btrim(p_reason),null);
      insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) values (episode_candidate.account_id,episode_candidate.id,'production_dependencies_invalidated',jsonb_build_object('upstream_kind',p_upstream_kind,'upstream_id',p_upstream_id,'to_stage',target_stage,'reason',btrim(p_reason)),null);
    end if;
  end loop;
end;
$$;

with repaired as (
  update public.episodes episode
  set stage = 'visual_review', updated_at = now()
  where episode.stage = 'production_ready'
    and exists (select 1 from public.review_packages package where package.episode_id = episode.id and package.stage = 'visual_review' and package.invalidated_at is null)
    and not exists (select 1 from public.approvals approval join public.review_packages package on package.id = approval.review_package_id where package.episode_id = episode.id and package.stage = 'visual_review' and approval.stage = 'visual_approved' and approval.decision = 'approved')
    and not exists (select 1 from public.review_packages package where package.episode_id = episode.id and package.stage = 'storyboard_review' and package.invalidated_at is null)
    and exists (select 1 from public.state_transitions transition where transition.episode_id = episode.id and transition.from_stage = 'visual_review' and transition.to_stage = 'production_ready' and transition.reason = 'A newer revision replaced an upstream production material.')
  returning episode.id
)
insert into public.state_transitions (episode_id,from_stage,to_stage,reason,actor_id)
select id, 'production_ready', 'visual_review', 'Repair: material invalidation must not advance an episode past the active visual review.', null
from repaired;
