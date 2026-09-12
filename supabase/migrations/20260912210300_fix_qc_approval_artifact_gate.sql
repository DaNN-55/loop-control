create or replace function public.has_required_artifacts(p_episode_id uuid, p_to_stage public.episode_stage)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_to_stage
    when 'script_approved' then exists (
      select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'script'
    )
    when 'visual_approved' then exists (
      select 1 from public.artifacts where episode_id = p_episode_id and artifact_type in ('visual_brief', 'visual_asset_manifest')
    )
    when 'storyboard_approved' then exists (
      select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'storyboard'
    )
    when 'production_ready' then exists (
      select 1
      from public.review_packages package
      where package.episode_id = p_episode_id
        and package.stage = 'production_ready'
        and package.invalidated_at is null
        and (
          package.context_snapshot ->> 'confirmation_mode' is distinct from 'shot_preparation'
          or public.has_current_shot_preparation_snapshot(
            p_episode_id,
            (package.context_snapshot ->> 'storyboard_review_package_id')::uuid
          )
        )
    )
    when 'render_ready' then exists (
      select 1
      from public.review_packages package
      where package.episode_id = p_episode_id
        and package.stage = 'production_ready'
        and package.invalidated_at is null
        and (
          package.context_snapshot ->> 'confirmation_mode' is distinct from 'shot_preparation'
          or public.has_current_shot_preparation_snapshot(
            p_episode_id,
            (package.context_snapshot ->> 'storyboard_review_package_id')::uuid
          )
        )
        and (
          package.context_snapshot ->> 'approval_mode' = 'qc_only'
          or not exists (
            select 1
            from public.pre_render_review_members member
            where member.review_package_id = package.id
              and not exists (
                select 1
                from public.pre_render_review_member_decisions decision
                where decision.review_package_id = member.review_package_id
                  and decision.member_key = member.member_key
                  and decision.decision = 'approved'
              )
          )
        )
    )
    when 'qc_passed' then exists (
      select 1
      from public.review_packages package
      join public.tasks task on task.id = package.task_id
      where package.id = (
        select current_package.id
        from public.review_packages current_package
        where current_package.episode_id = p_episode_id
          and current_package.stage = 'qc_review'
          and current_package.invalidated_at is null
        order by current_package.revision_number desc, current_package.created_at desc
        limit 1
      )
        and task.episode_id = p_episode_id
        and task.task_type = 'generate_review_render'
        and task.status = 'completed'
        and (
          select count(distinct artifact.artifact_type) = 4
          from public.artifacts artifact
          where artifact.episode_id = p_episode_id
            and artifact.producer_task_id = task.id
            and artifact.artifact_type in (
              'render',
              'review_render_project',
              'review_render_runtime',
              'review_qc_report'
            )
        )
    )
    when 'production_completed' then (
      select count(distinct artifact_type) = 5
        and exists (
          select 1
          from public.tasks verification
          join public.artifacts publish_package
            on publish_package.episode_id = verification.episode_id
           and publish_package.artifact_type = 'publish_package'
          where verification.episode_id = p_episode_id
            and verification.task_type = 'verify_publish_package'
            and verification.status = 'completed'
            and verification.input_snapshot #>> '{publish_package,sha256}' = publish_package.sha256
            and (verification.input_snapshot #>> '{publish_package,file_size}')::bigint = publish_package.file_size
        )
      from public.artifacts
      where episode_id = p_episode_id
        and artifact_type in ('final_render', 'cover', 'metadata', 'final_qc_report', 'publish_package')
    )
    else true
  end;
$$;
