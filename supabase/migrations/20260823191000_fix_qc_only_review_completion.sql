create or replace function public.advance_qc_only_review_render()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pre_render_package public.review_packages; updated_episode public.episodes;
begin
  if new.task_type <> 'generate_review_render' or new.status <> 'ready' then return new; end if;
  select * into pre_render_package from public.review_packages package
  where package.id = (new.input_snapshot #>> '{review_render,pre_render_review_package_id}')::uuid
    and package.stage = 'production_ready' and package.invalidated_at is null
    and package.context_snapshot ->> 'approval_mode' = 'qc_only';
  if not found then return new; end if;
  update public.episodes set stage = 'render_ready', updated_at = now()
  where id = new.episode_id and stage = 'production_ready' returning * into updated_episode;
  if not found then return new; end if;
  insert into public.state_transitions (episode_id,from_stage,to_stage,reason,actor_id)
  values (updated_episode.id,'production_ready','render_ready','冻结媒体已自动进入 HyperFrames 审核渲染。',null);
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id)
  values (updated_episode.account_id,updated_episode.id,'review_render_auto_queued',jsonb_build_object('task_id',new.id,'pre_render_review_package_id',pre_render_package.id),null);
  return new;
end;
$$;

drop trigger if exists advance_qc_only_review_render_after_insert on public.tasks;
create trigger advance_qc_only_review_render_after_insert
after insert on public.tasks for each row execute function public.advance_qc_only_review_render();

create or replace function public.assert_current_qc_review_issue()
returns trigger language plpgsql security definer set search_path = '' as $$
declare selected_package public.review_packages; selected_episode public.episodes; selected_task public.tasks;
begin
  select * into selected_package from public.review_packages package
  where package.id = new.review_package_id and package.stage = 'qc_review' and package.invalidated_at is null;
  if not found then raise exception 'Current QC review package is required' using errcode = '22023'; end if;
  select * into selected_episode from public.episodes episode where episode.id = selected_package.episode_id and episode.stage = 'qc_review' for update;
  if not found or exists (select 1 from public.review_packages package where package.episode_id = selected_package.episode_id and package.stage = 'qc_review' and package.invalidated_at is null and package.revision_number > selected_package.revision_number) then raise exception 'QC review package is no longer current' using errcode = '22023'; end if;
  if new.status = 'revision_requested' then
    select task.* into selected_task from public.pre_render_review_members member join public.tasks task on task.id = member.source_task_id
    where member.review_package_id = (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid and member.member_key = new.member_key;
    if not found or selected_task.provider = 'manual_upload' or selected_task.input_snapshot ? 'manual_source' then raise exception 'This QC member must be replaced through its original uploaded material' using errcode = '22023'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assert_current_qc_review_issue_before_write on public.qc_review_issues;
create trigger assert_current_qc_review_issue_before_write
before insert or update of status on public.qc_review_issues for each row execute function public.assert_current_qc_review_issue();

revoke all on function public.advance_qc_only_review_render(), public.assert_current_qc_review_issue() from public, anon, authenticated;
