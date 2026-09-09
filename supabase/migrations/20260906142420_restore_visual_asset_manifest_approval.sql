create or replace function public.has_required_artifacts(p_episode_id uuid, p_to_stage public.episode_stage)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_to_stage
    when 'script_approved'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'script')
    when 'visual_approved'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type in ('visual_brief', 'visual_asset_manifest'))
    when 'storyboard_approved'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'storyboard')
    when 'production_ready'::public.episode_stage then exists (
      select 1 from public.review_packages package
      where package.episode_id = p_episode_id and package.stage = 'production_ready' and package.invalidated_at is null
        and (package.context_snapshot ->> 'confirmation_mode' is distinct from 'shot_preparation'
          or public.has_current_shot_preparation_snapshot(p_episode_id, (package.context_snapshot ->> 'storyboard_review_package_id')::uuid))
    )
    when 'render_ready'::public.episode_stage then exists (
      select 1 from public.review_packages package
      where package.episode_id = p_episode_id and package.stage = 'production_ready' and package.invalidated_at is null
        and (package.context_snapshot ->> 'confirmation_mode' is distinct from 'shot_preparation'
          or public.has_current_shot_preparation_snapshot(p_episode_id, (package.context_snapshot ->> 'storyboard_review_package_id')::uuid))
        and (package.context_snapshot ->> 'approval_mode' = 'qc_only' or not exists (
          select 1 from public.pre_render_review_members member
          where member.review_package_id = package.id and not exists (
            select 1 from public.pre_render_review_member_decisions decision
            where decision.review_package_id = member.review_package_id and decision.member_key = member.member_key and decision.decision = 'approved'
          )
        ))
    )
    when 'qc_passed'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'render')
    else true
  end;
$$;

revoke all on function public.has_required_artifacts(uuid, public.episode_stage) from public, anon, authenticated;
