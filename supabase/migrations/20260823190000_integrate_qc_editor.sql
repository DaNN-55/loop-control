do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.create_pre_render_review_packages()'::regprocedure) into definition;
  if position('''review_kind'',''pre_render''' in definition) = 0 then
    raise exception 'Unable to mark automatic pre-render packages';
  end if;
  definition := replace(definition, '''review_kind'',''pre_render''', '''review_kind'',''pre_render'',''approval_mode'',''qc_only''');
  execute definition;

  select pg_get_functiondef('public.create_pre_render_review_packages_for_episode(uuid)'::regprocedure) into definition;
  if position('''review_kind'',''pre_render''' in definition) = 0 then
    raise exception 'Unable to mark scoped automatic pre-render packages';
  end if;
  definition := replace(definition, '''review_kind'',''pre_render''', '''review_kind'',''pre_render'',''approval_mode'',''qc_only''');
  execute definition;
end;
$$;

create table public.qc_review_issues (
  id uuid primary key default gen_random_uuid(),
  review_package_id uuid not null references public.review_packages(id) on delete cascade,
  member_key text,
  at_seconds numeric not null check (at_seconds >= 0),
  severity text not null check (severity in ('blocking', 'warning')),
  reason text not null check (char_length(btrim(reason)) > 0),
  status text not null default 'open' check (status in ('open', 'accepted', 'ignored', 'revision_requested')),
  created_by uuid not null references auth.users(id) on delete restrict,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index qc_review_issues_package_status_idx on public.qc_review_issues (review_package_id, status, created_at, id);
alter table public.qc_review_issues enable row level security;
create policy "members can read qc review issues" on public.qc_review_issues
for select to authenticated
using (
  exists (
    select 1
    from public.review_packages package
    join public.episodes episode on episode.id = package.episode_id
    where package.id = qc_review_issues.review_package_id
      and public.is_account_member(episode.account_id)
  )
);
revoke all on public.qc_review_issues from anon, authenticated;
grant select on public.qc_review_issues to authenticated;

create or replace function public.orchestrate_review_render_tasks(p_episode_id uuid default null)
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
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
begin
  for candidate in
    select episode.id as episode_id, package.id as pre_render_review_package_id, package.context_snapshot, blueprint.policy,
      coalesce(package.context_snapshot ->> 'approval_mode', '') = 'qc_only' as auto_qc
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join lateral (
      select package.*
      from public.review_packages package
      where package.episode_id = episode.id
        and package.stage = 'production_ready'
        and package.invalidated_at is null
        and (
          (episode.stage = 'production_ready' and package.context_snapshot ->> 'approval_mode' = 'qc_only')
          or episode.stage = 'render_ready'
        )
      order by package.revision_number desc
      limit 1
    ) package on true
    where episode.stage in ('production_ready', 'render_ready')
      and (p_episode_id is null or episode.id = p_episode_id)
    order by episode.updated_at, episode.id
    for update of episode skip locked
  loop
    select coalesce(max((task.input_snapshot #>> '{review_render,project_revision}')::integer), 0) + 1 into default_revision
    from public.tasks task
    where task.episode_id = candidate.episode_id
      and task.task_type = 'generate_review_render'
      and task.input_snapshot #>> '{review_render,pre_render_review_package_id}' = candidate.pre_render_review_package_id::text;

    config := coalesce(candidate.policy -> 'hyperframes_composition', '{"aspect_ratio":"9:16","width":1080,"height":1920,"captions_enabled":true,"caption_style":"cinematic","pacing":"standard","crop":"cover","transition":"fade","layout":"lower_third","narration_gain_db":0,"bgm_gain_db":-12,"sfx_gain_db":-6}'::jsonb);
    insert into public.review_render_composition_revisions (episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, composition_config)
    values (candidate.episode_id, candidate.pre_render_review_package_id, default_revision, config ->> 'caption_style', config ->> 'pacing', config ->> 'crop', config ->> 'transition', config ->> 'layout', '蓝图冻结合成配置。', config)
    on conflict (pre_render_review_package_id, revision_number) do nothing;
    select * into composition
    from public.review_render_composition_revisions
    where pre_render_review_package_id = candidate.pre_render_review_package_id
    order by revision_number desc
    limit 1;

    if exists (
      select 1 from public.tasks task
      where task.episode_id = candidate.episode_id
        and task.task_type = 'generate_review_render'
        and task.input_snapshot #>> '{review_render,composition_revision_id}' = composition.id::text
    ) then
      continue;
    end if;

    select
      coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'member_key', member.member_key,
        'member_kind', member.member_kind,
        'audio_kind', member.evidence_snapshot #>> '{cue,kind}',
        'relative_path', coalesce(member.evidence_snapshot #>> '{artifact,relative_path}', member.evidence_snapshot #>> '{audio_track,relative_path}'),
        'sha256', coalesce(member.evidence_snapshot #>> '{artifact,sha256}', member.evidence_snapshot #>> '{audio_track,sha256}'),
        'start_seconds', coalesce((member.evidence_snapshot #>> '{audio_track,start_seconds}')::numeric, 0),
        'duration_seconds', coalesce((member.evidence_snapshot #>> '{audio_track,duration_seconds}')::numeric, (member.evidence_snapshot #>> '{shot,durationSeconds}')::numeric)
      )) order by member.member_key), '[]'::jsonb),
      coalesce(jsonb_agg(jsonb_build_object(
        'artifactType', case when member.artifact_id is null then 'audio_track' else member.evidence_snapshot #>> '{artifact,artifact_type}' end,
        'relativePath', coalesce(member.evidence_snapshot #>> '{artifact,relative_path}', member.evidence_snapshot #>> '{audio_track,relative_path}'),
        'sha256', coalesce(member.evidence_snapshot #>> '{artifact,sha256}', member.evidence_snapshot #>> '{audio_track,sha256}'),
        'fileSize', coalesce((member.evidence_snapshot #>> '{artifact,file_size}')::bigint, (member.evidence_snapshot #>> '{audio_track,file_size}')::bigint)
      ) order by member.member_key), '[]'::jsonb)
    into members, inputs
    from public.pre_render_review_members member
    left join public.pre_render_review_member_decisions decision
      on decision.review_package_id = member.review_package_id
      and decision.member_key = member.member_key
      and decision.decision = 'approved'
    where member.review_package_id = candidate.pre_render_review_package_id
      and (candidate.auto_qc or decision.member_key is not null);

    if jsonb_array_length(members) = 0 or jsonb_array_length(inputs) <> jsonb_array_length(members) then
      continue;
    end if;

    project_path := format('episodes/%s/review-render/v%s/index.html', candidate.episode_id, composition.revision_number);
    render_path := format('episodes/%s/review-render/v%s/review-render.mp4', candidate.episode_id, composition.revision_number);
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (
      candidate.episode_id, 'generate_review_render', 'ready',
      jsonb_build_object(
        'capability', 'review_rendering',
        'allowed_tools', jsonb_build_array('read', 'write'),
        'review_render', jsonb_build_object(
          'pre_render_review_package_id', candidate.pre_render_review_package_id,
          'composition_revision_id', composition.id,
          'project_revision', composition.revision_number,
          'project_relative_path', project_path,
          'storyboard', candidate.context_snapshot -> 'storyboard',
          'members', members,
          'adjustments', composition.composition_config || jsonb_build_object('reason', composition.reason)
        ),
        'input_artifacts', inputs,
        'output', jsonb_build_object('required_artifact_types', jsonb_build_array('render', 'review_render_project', 'review_render_runtime', 'review_qc_report'), 'content_type', 'video/mp4', 'relative_path', render_path, 'review_stage', 'qc_review')
      ),
      0, 1, 'hyperframes', 'hyperframes@0.7.109', 'review-render-v3'
    ) returning * into created_task;
    return next created_task;
  end loop;
end;
$$;

create or replace function public.create_qc_review_issue(
  p_review_package_id uuid,
  p_member_key text,
  p_at_seconds numeric,
  p_severity text,
  p_reason text
)
returns public.qc_review_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_package public.review_packages;
  selected_episode public.episodes;
  created_issue public.qc_review_issues;
  total_seconds numeric;
begin
  if p_severity not in ('blocking', 'warning') or p_at_seconds < 0 or btrim(coalesce(p_reason, '')) = '' then
    raise exception 'QC issue input is invalid' using errcode = '22023';
  end if;
  select package.* into selected_package
  from public.review_packages package
  join public.episodes episode on episode.id = package.episode_id
  join public.account_memberships membership on membership.account_id = episode.account_id
  where package.id = p_review_package_id
    and package.stage = 'qc_review'
    and package.invalidated_at is null
    and package.context_snapshot ->> 'review_kind' = 'hyperframes_review_render'
    and episode.stage = 'qc_review'
    and membership.user_id = auth.uid()
    and membership.role = 'owner'
  for update of package;
  if not found then
    raise exception 'Current QC review package requires owner membership' using errcode = '42501';
  end if;
  select * into selected_episode from public.episodes episode where episode.id = selected_package.episode_id and episode.stage = 'qc_review' for update;
  if not found then
    raise exception 'Current QC review package requires owner membership' using errcode = '42501';
  end if;
  select coalesce(sum((shot ->> 'durationSeconds')::numeric), 0) into total_seconds
  from jsonb_array_elements(coalesce((select task.input_snapshot #> '{review_render,storyboard,shots}' from public.tasks task where task.id = selected_package.task_id), '[]'::jsonb)) shot;
  if p_at_seconds > total_seconds then
    raise exception 'QC issue time is outside the frozen render duration' using errcode = '22023';
  end if;
  if p_member_key is not null and not exists (
    select 1 from public.pre_render_review_members member
    where member.review_package_id = (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid
      and member.member_key = btrim(p_member_key)
  ) then
    raise exception 'QC issue member is not part of this frozen render' using errcode = '22023';
  end if;
  insert into public.qc_review_issues (review_package_id, member_key, at_seconds, severity, reason, created_by)
  values (selected_package.id, nullif(btrim(coalesce(p_member_key, '')), ''), p_at_seconds, p_severity, btrim(p_reason), auth.uid())
  returning * into created_issue;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (selected_episode.account_id, selected_episode.id, 'qc_review_issue_created', jsonb_build_object('qc_issue_id', created_issue.id, 'member_key', created_issue.member_key, 'at_seconds', created_issue.at_seconds, 'severity', created_issue.severity), auth.uid());
  return created_issue;
end;
$$;

create or replace function public.resolve_qc_review_issue(p_issue_id uuid, p_status text)
returns public.qc_review_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_issue public.qc_review_issues;
begin
  if p_status not in ('accepted', 'ignored') then
    raise exception 'QC issue resolution is invalid' using errcode = '22023';
  end if;
  select issue.* into selected_issue
  from public.qc_review_issues issue
  join public.review_packages package on package.id = issue.review_package_id
  join public.episodes episode on episode.id = package.episode_id
  join public.account_memberships membership on membership.account_id = episode.account_id
  where issue.id = p_issue_id
    and package.invalidated_at is null
    and episode.stage = 'qc_review'
    and membership.user_id = auth.uid()
    and membership.role = 'owner'
  for update of issue;
  if not found then
    raise exception 'Current QC issue requires owner membership' using errcode = '42501';
  end if;
  update public.qc_review_issues
  set status = p_status, resolved_by = auth.uid(), resolved_at = now()
  where id = selected_issue.id
  returning * into selected_issue;
  return selected_issue;
end;
$$;

create or replace function public.request_qc_member_revision(p_issue_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_issue public.qc_review_issues;
  selected_package public.review_packages;
  selected_episode public.episodes;
  selected_member public.pre_render_review_members;
  selected_task public.tasks;
  created_task public.tasks;
  original_path text;
  suffix text;
  next_path text;
begin
  select issue.* into selected_issue
  from public.qc_review_issues issue
  join public.review_packages package on package.id = issue.review_package_id
  join public.episodes episode on episode.id = package.episode_id
  join public.account_memberships membership on membership.account_id = episode.account_id
  where issue.id = p_issue_id
    and issue.status = 'open'
    and issue.member_key is not null
    and package.stage = 'qc_review'
    and package.invalidated_at is null
    and episode.stage = 'qc_review'
    and membership.user_id = auth.uid()
    and membership.role = 'owner'
  for update of issue;
  if not found then
    raise exception 'Open current QC member issue requires owner membership' using errcode = '42501';
  end if;
  select * into selected_package from public.review_packages package where package.id = selected_issue.review_package_id and package.stage = 'qc_review' and package.invalidated_at is null for update;
  if not found then
    raise exception 'Open current QC member issue requires owner membership' using errcode = '42501';
  end if;
  select * into selected_episode from public.episodes episode where episode.id = selected_package.episode_id and episode.stage = 'qc_review' for update;
  if not found then
    raise exception 'Open current QC member issue requires owner membership' using errcode = '42501';
  end if;
  select * into selected_member
  from public.pre_render_review_members member
  where member.review_package_id = (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid
    and member.member_key = selected_issue.member_key
  for update;
  if not found then
    raise exception 'QC member is not part of the frozen pre-render package' using errcode = '22023';
  end if;
  select * into selected_task from public.tasks where id = selected_member.source_task_id for update;
  if selected_task.task_type not in ('generate_a_roll', 'generate_b_roll', 'generate_narration', 'generate_soundtrack') then
    raise exception 'This QC member must be replaced through its original uploaded material' using errcode = '22023';
  end if;
  original_path := selected_task.input_snapshot #>> '{output,relative_path}';
  suffix := right(original_path, strpos(reverse(original_path), '.'));
  next_path := case when suffix = '' then format('%s-qc-v%s', original_path, selected_package.revision_number + 1) else left(original_path, length(original_path) - length(suffix)) || format('-qc-v%s%s', selected_package.revision_number + 1, suffix) end;
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (
    selected_task.episode_id, selected_task.task_type, 'ready',
    jsonb_set(jsonb_set(selected_task.input_snapshot || jsonb_build_object('pre_render_revision', selected_package.context_snapshot ->> 'pre_render_review_package_id', 'review_feedback', jsonb_build_object('qc_issue_id', selected_issue.id, 'review_package_id', selected_package.id, 'member_key', selected_member.member_key, 'reason', selected_issue.reason, 'at_seconds', selected_issue.at_seconds, 'actor_id', auth.uid())), '{output,relative_path}', to_jsonb(next_path), true), '{output,review_stage}', to_jsonb('production_ready'::text), true),
    selected_task.budget_limit_cents, selected_task.max_attempts, selected_task.provider, selected_task.model, selected_task.prompt_version
  ) returning * into created_task;
  update public.qc_review_issues set status = 'revision_requested', resolved_by = auth.uid(), resolved_at = now() where id = selected_issue.id;
  update public.review_packages set invalidated_at = now(), invalidated_reason = format('Owner requested QC revision for %s.', selected_member.member_key)
  where id in (selected_package.id, (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid);
  update public.episodes set stage = 'production_ready', updated_at = now() where id = selected_episode.id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (selected_episode.id, 'qc_review', 'production_ready', selected_issue.reason, auth.uid());
  insert into public.approvals (episode_id, stage, decision, reason, actor_id, review_package_id)
  values (selected_episode.id, 'qc_review', 'changes_requested', selected_issue.reason, auth.uid(), selected_package.id);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (selected_episode.account_id, selected_episode.id, 'qc_member_revision_task_created', jsonb_build_object('qc_issue_id', selected_issue.id, 'member_key', selected_member.member_key, 'task_id', created_task.id), auth.uid());
  return created_task;
end;
$$;

do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.transition_episode(uuid, public.episode_stage, text)'::regprocedure) into definition;
  if position('if not public.has_required_artifacts(p_episode_id, p_to_stage) then' in definition) = 0 then
    raise exception 'Unable to enforce QC issue gate';
  end if;
  definition := replace(
    definition,
    'if not public.has_required_artifacts(p_episode_id, p_to_stage) then',
    'if p_to_stage = ''qc_passed'' and exists (select 1 from public.qc_review_issues issue where issue.review_package_id = (select package.id from public.review_packages package where package.episode_id = p_episode_id and package.stage = ''qc_review'' and package.invalidated_at is null order by package.revision_number desc limit 1) and issue.severity = ''blocking'' and issue.status = ''open'') then raise exception ''Open blocking QC issues must be resolved before approval'' using errcode = ''22023''; end if; if not public.has_required_artifacts(p_episode_id, p_to_stage) then'
  );
  execute definition;
end;
$$;

revoke all on function public.create_qc_review_issue(uuid, text, numeric, text, text), public.resolve_qc_review_issue(uuid, text), public.request_qc_member_revision(uuid) from public, anon;
grant execute on function public.create_qc_review_issue(uuid, text, numeric, text, text), public.resolve_qc_review_issue(uuid, text), public.request_qc_member_revision(uuid) to authenticated;
revoke all on function public.orchestrate_review_render_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_review_render_tasks(uuid) to service_role;
