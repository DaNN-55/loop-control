do $$
declare
  source_task public.tasks;
  episode_row public.episodes;
  series_row public.series_versions;
  source_package public.review_packages;
  source_composition public.review_render_composition_revisions;
  new_composition public.review_render_composition_revisions;
  next_revision integer;
  project_path text;
  render_path text;
  new_snapshot jsonb;
begin
  for source_task in
    select task.*
    from public.tasks task
    where task.task_type = 'generate_review_render'
      and task.status = 'blocked'
      and task.invalidated_at is null
      and jsonb_typeof(task.input_snapshot -> 'series_baseline') = 'object'
      and not (task.input_snapshot -> 'series_baseline' ? 'version')
      and coalesce(task.input_snapshot -> 'series_baseline' ->> 'version_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (
        select 1
        from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker
        where blocker ->> 'code' = 'task_package_invalid'
      )
      and jsonb_typeof(task.input_snapshot -> 'review_render') = 'object'
      and jsonb_typeof(task.input_snapshot -> 'output') = 'object'
      and not exists (
        select 1
        from public.tasks recovered
        where recovered.episode_id = task.episode_id
          and recovered.task_type = 'generate_review_render'
          and recovered.input_snapshot ->> 'recovered_from_task_id' = task.id::text
      )
    order by task.created_at, task.id
  loop
    select episode.* into episode_row
    from public.episodes episode
    where episode.id = source_task.episode_id
    for update;
    if not found or episode_row.stage <> 'render_ready' then
      continue;
    end if;

    if episode_row.series_version_id is null
      or episode_row.series_version_id::text <> source_task.input_snapshot -> 'series_baseline' ->> 'version_id' then
      raise exception 'malformed review render task has an unexpected series version';
    end if;

    select version.* into series_row
    from public.series_versions version
    where version.id = episode_row.series_version_id
      and version.account_id = episode_row.account_id;
    if not found or series_row.version < 1 then
      raise exception 'malformed review render task has no valid series version';
    end if;

    if coalesce(source_task.input_snapshot #>> '{review_render,pre_render_review_package_id}', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(source_task.input_snapshot #>> '{review_render,composition_revision_id}', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'malformed review render task is missing its frozen package or composition';
    end if;

    select package.* into source_package
    from public.review_packages package
    where package.id = (source_task.input_snapshot #>> '{review_render,pre_render_review_package_id}')::uuid
      and package.episode_id = source_task.episode_id
      and package.stage = 'production_ready'
      and package.invalidated_at is null;
    if not found then
      raise exception 'malformed review render task has no current production package';
    end if;

    select composition.* into source_composition
    from public.review_render_composition_revisions composition
    where composition.id = (source_task.input_snapshot #>> '{review_render,composition_revision_id}')::uuid
      and composition.episode_id = source_task.episode_id
      and composition.pre_render_review_package_id = source_package.id;
    if not found then
      raise exception 'malformed review render task has no matching composition revision';
    end if;

    select coalesce(max(revision_number), 0) + 1 into next_revision
    from public.review_render_composition_revisions
    where pre_render_review_package_id = source_package.id;
    insert into public.review_render_composition_revisions (
      episode_id, pre_render_review_package_id, revision_number,
      caption_style, pacing, crop, transition, layout, reason, created_by, composition_config
    )
    values (
      source_task.episode_id,
      source_package.id,
      next_revision,
      source_composition.caption_style,
      source_composition.pacing,
      source_composition.crop,
      source_composition.transition,
      source_composition.layout,
      '修复冻结系列基准版本后重新排队审核渲染。',
      null,
      coalesce(source_composition.composition_config, '{}'::jsonb) || jsonb_build_object('reason', '修复冻结系列基准版本后重新排队审核渲染。')
    )
    returning * into new_composition;

    project_path := format('episodes/%s/review-render/v%s/index.html', source_task.episode_id, next_revision);
    render_path := format('episodes/%s/review-render/v%s/review-render.mp4', source_task.episode_id, next_revision);
    new_snapshot := source_task.input_snapshot
      || jsonb_build_object(
        'recovered_from_task_id', source_task.id,
        'series_baseline', jsonb_build_object(
          'version_id', episode_row.series_version_id,
          'version', series_row.version,
          'rules', coalesce(series_row.rules, '{}'::jsonb)
        ),
        'review_render', (source_task.input_snapshot -> 'review_render') || jsonb_build_object(
          'composition_revision_id', new_composition.id,
          'project_revision', next_revision,
          'project_relative_path', project_path,
          'adjustments', new_composition.composition_config || jsonb_build_object('reason', new_composition.reason)
        ),
        'output', (source_task.input_snapshot -> 'output') || jsonb_build_object('relative_path', render_path)
      );

    insert into public.tasks (
      episode_id, task_type, status, input_snapshot, budget_limit_cents,
      max_attempts, provider, model, prompt_version
    )
    values (
      source_task.episode_id,
      source_task.task_type,
      'ready',
      new_snapshot,
      source_task.budget_limit_cents,
      source_task.max_attempts,
      source_task.provider,
      source_task.model,
      source_task.prompt_version
    );
  end loop;
end;
$$;
