create or replace function public.ensure_learning_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  demo_account_id uuid;
  demo_blueprint_id uuid;
  metrics_episode_id uuid;
  completed_episode_id uuid;
  saved_learning_report_id uuid;
  membership_role public.member_role;
  week_start timestamptz := date_trunc('week', now()) - interval '7 days';
begin
  if current_user_id is null then
    raise exception 'Owner login is required to prepare learning demo data' using errcode = '42501';
  end if;

  select id into demo_account_id from public.accounts where slug = 'demo-learning';
  if demo_account_id is null then
    insert into public.accounts (slug, name, timezone)
    values ('demo-learning', '演示·复盘账号', 'Asia/Shanghai')
    returning id into demo_account_id;
  end if;

  select role into membership_role
  from public.account_memberships
  where account_id = demo_account_id and user_id = current_user_id;
  if membership_role is not null and membership_role <> 'owner'::public.member_role then
    raise exception 'Owner membership is required to prepare learning demo data' using errcode = '42501';
  end if;
  insert into public.account_memberships (account_id, user_id, role)
  values (demo_account_id, current_user_id, 'owner'::public.member_role)
  on conflict (account_id, user_id) do nothing;

  select id into demo_blueprint_id
  from public.account_blueprint_versions
  where account_id = demo_account_id and version = 1;
  if demo_blueprint_id is null then
    insert into public.account_blueprint_versions (account_id, version, policy, is_active)
    values (
      demo_account_id,
      1,
      jsonb_build_object(
        'positioning', '用清晰的越南本地生活建议帮助新来者少走弯路',
        'asset_root', '/Volumes/Ebuget 1T/Media/accounts/demo-learning',
        'hard_constraints', jsonb_build_object('forbidden_content', jsonb_build_array('虚假承诺', '危险建议')),
        'defaults', jsonb_build_object('tone', '直接、友好、可执行', 'visual_style', '真实街景与简洁字幕'),
        'review_gates', jsonb_build_array('script_review', 'visual_review', 'storyboard_review', 'qc_review')
      ),
      true
    )
    returning id into demo_blueprint_id;
  end if;
  update public.accounts
  set current_blueprint_version_id = demo_blueprint_id
  where id = demo_account_id and current_blueprint_version_id is null;

  select id into metrics_episode_id
  from public.episodes
  where account_id = demo_account_id and title = '演示·复盘·待录入指标';
  if metrics_episode_id is null then
    insert into public.episodes (account_id, blueprint_version_id, title, stage)
    values (demo_account_id, demo_blueprint_id, '演示·复盘·待录入指标', 'metrics_collecting'::public.episode_stage)
    returning id into metrics_episode_id;
  end if;
  if not exists (select 1 from public.experiments where episode_id = metrics_episode_id) then
    insert into public.experiments (episode_id, hypothesis, primary_variable, primary_metric, guardrail_metrics)
    values (metrics_episode_id, '开头先给出可执行建议会提高播放量。', '开头是否先给出动作建议', '播放量', array['完播率', '互动率']);
  end if;
  if not exists (select 1 from public.metric_snapshots where episode_id = metrics_episode_id) then
    insert into public.metric_snapshots (episode_id, captured_at, metrics, captured_by)
    values (metrics_episode_id, week_start, jsonb_build_object('播放量', 18400, '完播率', 0.42, '互动率', 0.081), current_user_id);
  end if;

  select id into completed_episode_id
  from public.episodes
  where account_id = demo_account_id and title = '演示·复盘·已完成报告';
  if completed_episode_id is null then
    insert into public.episodes (account_id, blueprint_version_id, title, stage)
    values (demo_account_id, demo_blueprint_id, '演示·复盘·已完成报告', 'learning_recorded'::public.episode_stage)
    returning id into completed_episode_id;
  end if;
  if not exists (select 1 from public.experiments where episode_id = completed_episode_id) then
    insert into public.experiments (episode_id, hypothesis, primary_variable, primary_metric, guardrail_metrics)
    values (completed_episode_id, '开头先给出可执行建议会提高播放量。', '开头是否先给出动作建议', '播放量', array['完播率', '互动率']);
  end if;
  if not exists (select 1 from public.metric_snapshots where episode_id = completed_episode_id) then
    insert into public.metric_snapshots (episode_id, captured_at, metrics, captured_by)
    values (completed_episode_id, week_start, jsonb_build_object('播放量', 22100, '完播率', 0.49, '互动率', 0.096), current_user_id);
  end if;
  select id into saved_learning_report_id
  from public.learning_reports
  where episode_id = completed_episode_id
  order by created_at desc
  limit 1;
  if saved_learning_report_id is null then
    insert into public.learning_reports (episode_id, recommendation, summary, created_by)
    values (completed_episode_id, 'change', '播放量、完播率和互动率均高于基线，建议保留直接给出动作建议的开头结构。', current_user_id)
    returning id into saved_learning_report_id;
  end if;
  if not exists (
    select 1 from public.state_transitions
    where episode_id = completed_episode_id
      and from_stage = 'metrics_collecting'::public.episode_stage
      and to_stage = 'learning_recorded'::public.episode_stage
  ) then
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
    values (completed_episode_id, 'metrics_collecting'::public.episode_stage, 'learning_recorded'::public.episode_stage, '演示数据：Owner 已记录复盘报告', current_user_id);
  end if;
  if not exists (
    select 1 from public.blueprint_change_suggestions
    where blueprint_change_suggestions.learning_report_id = saved_learning_report_id
  ) then
    insert into public.blueprint_change_suggestions (learning_report_id, account_id, source_blueprint_version_id, proposed_policy, rationale, created_by)
    values (
      saved_learning_report_id,
      demo_account_id,
      demo_blueprint_id,
      jsonb_build_object('defaults', jsonb_build_object('opening_style', '先给结论，再解释原因')),
      '将复盘中验证有效的开头结构纳入账号默认创作偏好。',
      current_user_id
    );
  end if;

  return jsonb_build_object(
    'account_id', demo_account_id,
    'metrics_episode_id', metrics_episode_id,
    'completed_episode_id', completed_episode_id
  );
end;
$$;

revoke execute on function public.ensure_learning_demo_data() from public, anon;
grant execute on function public.ensure_learning_demo_data() to authenticated;
