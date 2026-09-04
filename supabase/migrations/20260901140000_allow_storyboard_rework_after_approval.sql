create or replace function public.request_studio_storyboard_revision(p_review_package_id uuid, p_reason text)
returns public.episodes
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_qc_package public.review_packages;
  selected_pre_render_package public.review_packages;
  selected_storyboard_package public.review_packages;
  selected_episode public.episodes;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Studio structural revision reason is required' using errcode = '22023'; end if;
  select * into selected_qc_package from public.current_hyperframes_review_package(p_review_package_id, false);
  select * into selected_episode from public.episodes where id = selected_qc_package.episode_id;
  select package.* into selected_pre_render_package
  from public.review_packages package
  where package.id = (selected_qc_package.context_snapshot ->> 'pre_render_review_package_id')::uuid
    and package.episode_id = selected_episode.id
    and package.stage = 'production_ready';
  if not found then raise exception 'Frozen pre-render package is required' using errcode = '22023'; end if;
  select package.* into selected_storyboard_package
  from public.review_packages package
  where package.id = (selected_pre_render_package.context_snapshot ->> 'storyboard_review_package_id')::uuid
    and package.episode_id = selected_episode.id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null;
  if not found then raise exception 'Current storyboard review package is required' using errcode = '22023'; end if;
  update public.review_packages set invalidated_at = now(), invalidated_reason = 'Studio structural revision requested' where id = selected_qc_package.id;
  update public.episodes set stage = 'visual_approved', updated_at = now() where id = selected_episode.id returning * into selected_episode;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (selected_episode.id, 'qc_review', 'visual_approved', btrim(p_reason), auth.uid());
  perform public.orchestrate_storyboard_tasks_for_episode(selected_episode.id);
  select * into selected_episode from public.episodes where id = selected_episode.id;
  insert into public.approvals (episode_id, stage, decision, reason, actor_id) values (selected_episode.id, 'storyboard_review', 'changes_requested', btrim(p_reason), auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (selected_episode.account_id, selected_episode.id, 'studio_storyboard_revision_requested', jsonb_build_object('qc_review_package_id', selected_qc_package.id, 'storyboard_review_package_id', selected_storyboard_package.id), auth.uid());
  return selected_episode;
end;
$$;

revoke all on function public.request_studio_storyboard_revision(uuid, text) from public, anon, authenticated;
grant execute on function public.request_studio_storyboard_revision(uuid, text) to authenticated;
