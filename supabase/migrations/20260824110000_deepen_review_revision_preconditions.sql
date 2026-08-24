create function public.current_hyperframes_review_package(p_review_package_id uuid, p_allow_failed_review_render boolean default false)
returns public.review_packages
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_package public.review_packages;
  selected_episode public.episodes;
  membership_role public.member_role;
begin
  select package.* into selected_package
  from public.review_packages package
  where package.id = p_review_package_id
    and package.stage = 'qc_review'
    and package.invalidated_at is null
    and package.context_snapshot ->> 'review_kind' = 'hyperframes_review_render';
  if not found then raise exception 'Current HyperFrames review package is required' using errcode = '22023'; end if;

  select * into selected_episode from public.episodes where id = selected_package.episode_id for update;
  if selected_episode.stage <> 'qc_review'
    and not (
      p_allow_failed_review_render
      and selected_episode.stage = 'render_ready'
      and exists (
        select 1 from public.tasks task
        where task.episode_id = selected_episode.id
          and task.task_type = 'generate_review_render'
          and task.status = 'failed'
          and task.input_snapshot #>> '{review_render,pre_render_review_package_id}' = selected_package.context_snapshot ->> 'pre_render_review_package_id'
      )
    )
    or exists (
      select 1 from public.review_packages package
      where package.episode_id = selected_episode.id
        and package.stage = 'qc_review'
        and package.invalidated_at is null
        and package.revision_number > selected_package.revision_number
    ) then
    raise exception 'Review render package is no longer current' using errcode = '22023';
  end if;

  select role into membership_role
  from public.account_memberships
  where account_id = selected_episode.account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then raise exception 'Owner membership is required to request an audit revision' using errcode = '42501'; end if;

  return selected_package;
end;
$$;

revoke all on function public.current_hyperframes_review_package(uuid, boolean) from public, anon, authenticated;

create or replace function public.request_review_render_revision(p_review_package_id uuid, p_composition jsonb, p_reason text)
returns public.episodes
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_package public.review_packages;
  selected_episode public.episodes;
  next_revision integer;
  previous_stage public.episode_stage;
  width integer;
  height integer;
begin
  if btrim(coalesce(p_reason, '')) = ''
    or jsonb_typeof(p_composition) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_composition) key where key not in ('aspect_ratio', 'width', 'height', 'captions_enabled', 'caption_style', 'crop', 'pacing', 'transition', 'layout', 'narration_gain_db', 'bgm_gain_db', 'sfx_gain_db', 'studio_project'))
    or p_composition ->> 'aspect_ratio' not in ('9:16', '16:9', '1:1')
    or jsonb_typeof(p_composition -> 'width') <> 'number'
    or jsonb_typeof(p_composition -> 'height') <> 'number'
    or jsonb_typeof(p_composition -> 'captions_enabled') <> 'boolean'
    or p_composition ->> 'caption_style' not in ('cinematic', 'minimal')
    or p_composition ->> 'crop' not in ('cover', 'contain')
    or p_composition ->> 'pacing' not in ('gentle', 'standard', 'compact')
    or p_composition ->> 'transition' not in ('fade', 'cut')
    or p_composition ->> 'layout' not in ('lower_third', 'center')
    or jsonb_typeof(p_composition -> 'narration_gain_db') <> 'number'
    or jsonb_typeof(p_composition -> 'bgm_gain_db') <> 'number'
    or jsonb_typeof(p_composition -> 'sfx_gain_db') <> 'number'
    or (p_composition ? 'studio_project' and (
      jsonb_typeof(p_composition -> 'studio_project') <> 'object'
      or exists (select 1 from jsonb_object_keys(p_composition -> 'studio_project') key where key not in ('relative_path', 'sha256', 'file_size'))
      or jsonb_typeof(p_composition -> 'studio_project' -> 'relative_path') <> 'string'
      or jsonb_typeof(p_composition -> 'studio_project' -> 'sha256') <> 'string'
      or jsonb_typeof(p_composition -> 'studio_project' -> 'file_size') <> 'number'
    )) then
    raise exception 'Invalid review render composition adjustment' using errcode = '22023';
  end if;
  width := (p_composition ->> 'width')::integer;
  height := (p_composition ->> 'height')::integer;
  if width < 1 or height < 1 or (p_composition ->> 'aspect_ratio' = '9:16' and width * 16 <> height * 9) or (p_composition ->> 'aspect_ratio' = '16:9' and width * 9 <> height * 16) or (p_composition ->> 'aspect_ratio' = '1:1' and width <> height) then
    raise exception 'Invalid review render composition dimensions' using errcode = '22023';
  end if;
  select * into selected_package from public.current_hyperframes_review_package(p_review_package_id, true);
  select * into selected_episode from public.episodes where id = selected_package.episode_id;
  if p_composition ? 'studio_project' and (
    p_composition #>> '{studio_project,relative_path}' !~ format('^episodes/%s/studio-frozen/[0-9a-f-]{36}/index\\.html$', selected_episode.id::text)
    or p_composition #>> '{studio_project,sha256}' !~ '^[0-9a-f]{64}$'
    or (p_composition #>> '{studio_project,file_size}')::bigint < 1
  ) then raise exception 'Invalid frozen Studio project' using errcode = '22023'; end if;
  select coalesce(max(revision_number), 0) + 1 into next_revision from public.review_render_composition_revisions where pre_render_review_package_id = (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid;
  insert into public.review_render_composition_revisions (episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, created_by, composition_config)
  values (selected_episode.id, (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid, next_revision, p_composition ->> 'caption_style', p_composition ->> 'pacing', p_composition ->> 'crop', p_composition ->> 'transition', p_composition ->> 'layout', btrim(p_reason), auth.uid(), p_composition);
  previous_stage := selected_episode.stage;
  update public.episodes set stage = 'render_ready', updated_at = now() where id = selected_episode.id returning * into selected_episode;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (selected_episode.id, previous_stage, 'render_ready', btrim(p_reason), auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (selected_episode.account_id, selected_episode.id, 'review_render_composition_requested', jsonb_build_object('review_package_id', selected_package.id, 'revision_number', next_revision), auth.uid());
  return selected_episode;
end;
$$;

revoke all on function public.request_review_render_revision(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.request_review_render_revision(uuid, jsonb, text) to authenticated;

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
  insert into public.approvals (episode_id, review_package_id, stage, decision, reason, actor_id) values (selected_episode.id, selected_storyboard_package.id, 'storyboard_review', 'changes_requested', btrim(p_reason), auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (selected_episode.account_id, selected_episode.id, 'studio_storyboard_revision_requested', jsonb_build_object('qc_review_package_id', selected_qc_package.id, 'storyboard_review_package_id', selected_storyboard_package.id), auth.uid());
  return selected_episode;
end;
$$;

revoke all on function public.request_studio_storyboard_revision(uuid, text) from public, anon, authenticated;
grant execute on function public.request_studio_storyboard_revision(uuid, text) to authenticated;
