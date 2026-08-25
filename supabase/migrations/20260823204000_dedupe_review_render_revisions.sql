create or replace function public.orchestrate_review_render_tasks(p_episode_id uuid default null)
returns setof public.tasks language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  created_task public.tasks;
  members jsonb;
  inputs jsonb;
  composition public.review_render_composition_revisions;
  default_revision integer;
  config jsonb;
  project_path text;
  render_path text;
  default_config constant jsonb := '{"aspect_ratio":"9:16","width":1080,"height":1920,"captions_enabled":true,"caption_style":"cinematic","crop":"cover","pacing":"standard","transition":"fade","layout":"lower_third","narration_gain_db":0,"bgm_gain_db":-12,"sfx_gain_db":-6}'::jsonb;
begin
  for candidate in
    select episode.id as episode_id, episode.stage as episode_stage, package.id as pre_render_review_package_id, package.context_snapshot,
      coalesce(series_version.rules, '{}'::jsonb) as series_rules,
      coalesce(package.context_snapshot ->> 'approval_mode', '') = 'qc_only' as auto_qc
    from public.episodes episode
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    join lateral (
      select package.* from public.review_packages package
      where package.episode_id = episode.id and package.stage = 'production_ready' and package.invalidated_at is null
        and ((episode.stage = 'production_ready' and package.context_snapshot ->> 'approval_mode' = 'qc_only') or episode.stage = 'render_ready')
      order by package.revision_number desc limit 1
    ) package on true
    where episode.stage in ('production_ready', 'render_ready') and (p_episode_id is null or episode.id = p_episode_id)
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    select * into composition from public.review_render_composition_revisions
    where pre_render_review_package_id = candidate.pre_render_review_package_id
    order by revision_number desc limit 1;
    if candidate.episode_stage = 'production_ready' or not found then
      select coalesce(max(revision_number), 0) + 1 into default_revision
      from public.review_render_composition_revisions
      where pre_render_review_package_id = candidate.pre_render_review_package_id;
      config := coalesce(candidate.series_rules -> 'hyperframes_composition', default_config);
      insert into public.review_render_composition_revisions (episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, composition_config)
      values (candidate.episode_id, candidate.pre_render_review_package_id, default_revision, config ->> 'caption_style', config ->> 'pacing', config ->> 'crop', config ->> 'transition', config ->> 'layout', '系列默认合成配置。', config)
      on conflict (pre_render_review_package_id, revision_number) do nothing;
      select * into composition from public.review_render_composition_revisions
      where pre_render_review_package_id = candidate.pre_render_review_package_id
      order by revision_number desc limit 1;
    end if;
    if exists (select 1 from public.tasks task where task.episode_id = candidate.episode_id and task.task_type = 'generate_review_render' and task.input_snapshot #>> '{review_render,composition_revision_id}' = composition.id::text) then continue; end if;
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('member_key', member.member_key, 'member_kind', member.member_kind, 'audio_kind', member.evidence_snapshot #>> '{cue,kind}', 'relative_path', coalesce(member.evidence_snapshot #>> '{artifact,relative_path}', member.evidence_snapshot #>> '{audio_track,relative_path}'), 'sha256', coalesce(member.evidence_snapshot #>> '{artifact,sha256}', member.evidence_snapshot #>> '{audio_track,sha256}'), 'start_seconds', coalesce((member.evidence_snapshot #>> '{audio_track,start_seconds}')::numeric, 0), 'duration_seconds', coalesce((member.evidence_snapshot #>> '{audio_track,duration_seconds}')::numeric, (member.evidence_snapshot #>> '{shot,durationSeconds}')::numeric))) order by member.member_key), '[]'::jsonb), coalesce(jsonb_agg(jsonb_build_object('artifactType', case when member.artifact_id is null then 'audio_track' else member.evidence_snapshot #>> '{artifact,artifact_type}' end, 'relativePath', coalesce(member.evidence_snapshot #>> '{artifact,relative_path}', member.evidence_snapshot #>> '{audio_track,relative_path}'), 'sha256', coalesce(member.evidence_snapshot #>> '{artifact,sha256}', member.evidence_snapshot #>> '{audio_track,sha256}'), 'fileSize', coalesce((member.evidence_snapshot #>> '{artifact,file_size}')::bigint, (member.evidence_snapshot #>> '{audio_track,file_size}')::bigint)) order by member.member_key), '[]'::jsonb) into members, inputs
    from public.pre_render_review_members member left join public.pre_render_review_member_decisions decision on decision.review_package_id = member.review_package_id and decision.member_key = member.member_key and decision.decision = 'approved'
    where member.review_package_id = candidate.pre_render_review_package_id and (candidate.auto_qc or decision.member_key is not null);
    if jsonb_array_length(members) = 0 or jsonb_array_length(inputs) <> jsonb_array_length(members) then continue; end if;
    project_path := format('episodes/%s/review-render/v%s/index.html', candidate.episode_id, composition.revision_number);
    render_path := format('episodes/%s/review-render/v%s/review-render.mp4', candidate.episode_id, composition.revision_number);
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (candidate.episode_id, 'generate_review_render', 'ready', jsonb_build_object('capability', 'review_rendering', 'allowed_tools', jsonb_build_array('read', 'write'), 'review_render', jsonb_build_object('pre_render_review_package_id', candidate.pre_render_review_package_id, 'composition_revision_id', composition.id, 'project_revision', composition.revision_number, 'project_relative_path', project_path, 'storyboard', candidate.context_snapshot -> 'storyboard', 'members', members, 'adjustments', composition.composition_config || jsonb_build_object('reason', composition.reason)), 'input_artifacts', inputs, 'output', jsonb_build_object('required_artifact_types', jsonb_build_array('render', 'review_render_project', 'review_render_runtime', 'review_qc_report'), 'content_type', 'video/mp4', 'relative_path', render_path, 'review_stage', 'qc_review')), 0, 1, 'hyperframes', 'hyperframes@0.7.109', 'review-render-v3')
    returning * into created_task;
    return next created_task;
  end loop;
end;
$$;

revoke all on function public.orchestrate_review_render_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_review_render_tasks(uuid) to service_role;
