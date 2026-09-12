alter table public.account_blueprint_versions disable trigger validate_blueprint_external_connections_before_write;

update public.account_blueprint_versions
set policy = (policy - 'publishing') || jsonb_build_object(
  'approval_gates',
  coalesce((select jsonb_agg(gate) from jsonb_array_elements_text(policy -> 'approval_gates') gate where gate <> 'publish'), '[]'::jsonb)
)
where jsonb_typeof(policy) = 'object' and jsonb_typeof(policy -> 'approval_gates') = 'array';

update public.account_blueprint_versions
set policy = policy - 'publishing'
where jsonb_typeof(policy) = 'object' and jsonb_typeof(policy -> 'approval_gates') is distinct from 'array';

alter table public.account_blueprint_versions enable trigger validate_blueprint_external_connections_before_write;

update public.episodes
set stage = 'production_completed', updated_at = now()
where stage in ('publish_ready', 'publishing_review', 'published', 'metrics_collecting', 'learning_recorded');

delete from public.approvals where stage in ('publish_ready', 'publishing_review', 'published', 'metrics_collecting', 'learning_recorded');
delete from public.state_transitions where from_stage in ('publish_ready', 'publishing_review', 'published', 'metrics_collecting', 'learning_recorded') or to_stage in ('publish_ready', 'publishing_review', 'published', 'metrics_collecting', 'learning_recorded');
delete from public.audit_events
where event_type in ('publication_record_created', 'experiment_defined', 'weekly_metrics_recorded', 'learning_report_recorded', 'blueprint_change_suggested', 'blueprint_change_approved', 'blueprint_change_rejected')
   or payload ->> 'gate' = 'publish';

drop function if exists public.record_manual_publication(uuid, text, text, text, text, timestamptz, text);
drop function if exists public.record_publication(uuid, text, text, text, text, timestamptz, public.publication_status, text, public.publication_source, text);
drop function if exists public.ensure_learning_demo_data();
drop function if exists public.define_experiment(uuid, text, text, text, text[]);
drop function if exists public.record_weekly_metric_snapshot(uuid, timestamptz, jsonb);
drop function if exists public.record_learning_report(uuid, text, text);
drop function if exists public.create_blueprint_change_suggestion(uuid, jsonb, text);
drop function if exists public.review_blueprint_change_suggestion(uuid, text, text);

drop table if exists public.blueprint_change_suggestions;
drop table if exists public.learning_reports;
drop table if exists public.metric_snapshots;
drop table if exists public.experiments;
drop table if exists public.publication_records;
drop type if exists public.publication_source;
drop type if exists public.publication_status;

alter table public.episodes drop constraint if exists episodes_active_stage_check;
alter table public.episodes add constraint episodes_active_stage_check check (
  stage not in ('publish_ready', 'publishing_review', 'published', 'metrics_collecting', 'learning_recorded')
);

create or replace function public.is_allowed_episode_transition(from_stage public.episode_stage, to_stage public.episode_stage)
returns boolean language sql immutable set search_path = '' as $$
  select (from_stage, to_stage) in (
    ('brief_draft', 'script_draft'), ('script_draft', 'script_review'),
    ('script_review', 'script_draft'), ('script_review', 'script_approved'),
    ('script_approved', 'visual_draft'), ('visual_draft', 'visual_review'),
    ('visual_review', 'visual_draft'), ('visual_review', 'visual_approved'),
    ('visual_approved', 'storyboard_draft'), ('storyboard_draft', 'storyboard_review'),
    ('storyboard_review', 'storyboard_draft'), ('storyboard_review', 'storyboard_approved'),
    ('storyboard_approved', 'production_ready'), ('production_ready', 'render_ready'),
    ('render_ready', 'qc_review'), ('qc_review', 'render_ready'),
    ('qc_review', 'qc_passed'), ('qc_passed', 'production_completed')
  );
$$;

create or replace function public.has_required_artifacts(p_episode_id uuid, p_to_stage public.episode_stage)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_to_stage
    when 'script_approved' then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'script')
    when 'visual_approved' then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type in ('visual_brief', 'visual_asset_manifest'))
    when 'storyboard_approved' then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'storyboard')
    when 'production_ready' then exists (
      select 1 from public.review_packages package where package.episode_id = p_episode_id and package.stage = 'production_ready' and package.invalidated_at is null
        and (package.context_snapshot ->> 'confirmation_mode' is distinct from 'shot_preparation' or public.has_current_shot_preparation_snapshot(p_episode_id, (package.context_snapshot ->> 'storyboard_review_package_id')::uuid))
    )
    when 'render_ready' then exists (
      select 1 from public.review_packages package where package.episode_id = p_episode_id and package.stage = 'production_ready' and package.invalidated_at is null
        and (package.context_snapshot ->> 'confirmation_mode' is distinct from 'shot_preparation' or public.has_current_shot_preparation_snapshot(p_episode_id, (package.context_snapshot ->> 'storyboard_review_package_id')::uuid))
        and (package.context_snapshot ->> 'approval_mode' = 'qc_only' or not exists (
          select 1 from public.pre_render_review_members member where member.review_package_id = package.id and not exists (
            select 1 from public.pre_render_review_member_decisions decision where decision.review_package_id = member.review_package_id and decision.member_key = member.member_key and decision.decision = 'approved'
          )
        ))
    )
    when 'qc_passed' then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'final_render')
    when 'production_completed' then (
      select count(distinct artifact_type) = 5 and exists (
        select 1 from public.tasks verification
        join public.artifacts publish_package on publish_package.episode_id = verification.episode_id and publish_package.artifact_type = 'publish_package'
        where verification.episode_id = p_episode_id and verification.task_type = 'verify_publish_package' and verification.status = 'completed'
          and verification.input_snapshot #>> '{publish_package,sha256}' = publish_package.sha256
          and (verification.input_snapshot #>> '{publish_package,file_size}')::bigint = publish_package.file_size
      ) from public.artifacts where episode_id = p_episode_id and artifact_type in ('final_render', 'cover', 'metadata', 'final_qc_report', 'publish_package')
    )
    else true
  end;
$$;

create or replace function public.record_publish_package_verification(p_episode_id uuid, p_sha256 text, p_file_size bigint)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare current_episode public.episodes; publish_package public.artifacts; verification_task public.tasks;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Only the local publish verification command may record a result' using errcode = '42501'; end if;
  select * into current_episode from public.episodes where id = p_episode_id for update;
  if not found then raise exception 'Episode % does not exist', p_episode_id using errcode = 'P0002'; end if;
  if current_episode.stage = 'production_completed' then
    select * into verification_task from public.tasks
    where episode_id = p_episode_id and task_type = 'verify_publish_package' and status = 'completed'
      and input_snapshot #>> '{publish_package,sha256}' = p_sha256
      and (input_snapshot #>> '{publish_package,file_size}')::bigint = p_file_size
    order by completed_at desc nulls last, created_at desc limit 1;
    if found then return verification_task; end if;
  end if;
  if current_episode.stage <> 'qc_passed' then raise exception 'Publish package verification requires qc_passed' using errcode = '22023'; end if;
  select * into publish_package from public.artifacts where episode_id = p_episode_id and artifact_type = 'publish_package';
  if not found or publish_package.sha256 <> p_sha256 or publish_package.file_size <> p_file_size then raise exception 'Publish package verification does not match the fixed package' using errcode = '22023'; end if;
  insert into public.tasks (episode_id, task_type, status, input_snapshot) values (p_episode_id, 'verify_publish_package', 'completed', jsonb_build_object('publish_package', jsonb_build_object('sha256', p_sha256, 'file_size', p_file_size))) returning * into verification_task;
  update public.episodes set stage = 'production_completed', updated_at = now() where id = p_episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (p_episode_id, 'qc_passed', 'production_completed', 'Publish package validation passed; production completed.', null);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, p_episode_id, 'publish_package_verified', jsonb_build_object('sha256', p_sha256, 'file_size', p_file_size, 'to_stage', 'production_completed'), auth.uid());
  return verification_task;
end;
$$;

create or replace function public.auto_advance_disabled_approval_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare gate_key text; review_stage public.episode_stage; approved_stage public.episode_stage; current_episode public.episodes; current_package public.review_packages; responsible_owner_id uuid; reason text;
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  select mapped.gate_key, mapped.review_stage, mapped.approved_stage into gate_key, review_stage, approved_stage
  from (values
    ('draft_script', 'script', 'script_review'::public.episode_stage, 'script_approved'::public.episode_stage),
    ('prepare_visual_brief', 'visual', 'visual_review'::public.episode_stage, 'visual_approved'::public.episode_stage),
    ('draft_storyboard', 'storyboard', 'storyboard_review'::public.episode_stage, 'storyboard_approved'::public.episode_stage),
    ('draft_storyboard_revision', 'storyboard', 'storyboard_review'::public.episode_stage, 'storyboard_approved'::public.episode_stage),
    ('generate_review_render', 'qc', 'qc_review'::public.episode_stage, 'qc_passed'::public.episode_stage)
  ) mapped(task_type, gate_key, review_stage, approved_stage) where mapped.task_type = new.task_type;
  if gate_key is null or public.approval_gate_enabled(new.episode_id, gate_key) then return new; end if;
  select * into current_episode from public.episodes where id = new.episode_id for update;
  if current_episode.stage <> review_stage or not public.has_required_artifacts(new.episode_id, approved_stage) then return new; end if;
  if gate_key = 'qc' and exists (select 1 from public.qc_review_issues issue join public.review_packages package on package.id = issue.review_package_id where package.episode_id = new.episode_id and package.stage = 'qc_review' and package.invalidated_at is null and issue.severity = 'blocking' and issue.status = 'open') then return new; end if;
  select * into current_package from public.review_packages package where package.episode_id = new.episode_id and package.task_id = new.id and package.stage = review_stage and package.invalidated_at is null order by package.revision_number desc limit 1;
  if not found then return new; end if;
  select membership.user_id into responsible_owner_id from public.account_memberships membership where membership.account_id = current_episode.account_id and membership.role = 'owner' order by membership.user_id::text limit 1;
  if responsible_owner_id is null then raise exception 'An account Owner is required to auto-advance a disabled approval gate' using errcode = '42501'; end if;
  reason := format('Validated %s artifact auto-advanced because the frozen blueprint disables this Owner approval gate.', gate_key);
  update public.episodes set stage = approved_stage, updated_at = now() where id = new.episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (new.episode_id, review_stage, approved_stage, reason, null);
  insert into public.approvals (episode_id, review_package_id, stage, decision, reason, actor_id) values (new.episode_id, current_package.id, approved_stage, 'approved', reason, responsible_owner_id);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, new.episode_id, 'approval_gate_auto_advanced', jsonb_build_object('gate', gate_key, 'review_package_id', current_package.id, 'task_id', new.id, 'to_stage', approved_stage), null);
  return new;
end;
$$;

revoke all on function public.record_publish_package_verification(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.record_publish_package_verification(uuid, text, bigint) to service_role;
