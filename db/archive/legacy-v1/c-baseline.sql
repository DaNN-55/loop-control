--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: loop_internal; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA loop_internal;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: supabase_migrations; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA supabase_migrations;


--
-- Name: episode_stage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.episode_stage AS ENUM (
    'waiting_input',
    'brief_draft',
    'script_draft',
    'script_review',
    'script_approved',
    'visual_draft',
    'visual_review',
    'visual_approved',
    'storyboard_draft',
    'storyboard_review',
    'storyboard_approved',
    'production_ready',
    'render_ready',
    'qc_review',
    'qc_passed',
    'publish_ready',
    'publishing_review',
    'published',
    'metrics_collecting',
    'learning_recorded',
    'production_completed'
);


--
-- Name: member_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.member_role AS ENUM (
    'owner',
    'worker'
);


--
-- Name: task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_status AS ENUM (
    'ready',
    'completed',
    'blocked',
    'running',
    'failed',
    'superseded'
);


--
-- Name: bump_episode_read_revision(); Type: FUNCTION; Schema: loop_internal; Owner: -
--

CREATE FUNCTION loop_internal.bump_episode_read_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare source jsonb; eid uuid; seen text[]:='{}'; sources jsonb[]; item text; identity text;
begin
 if TG_OP='INSERT' then sources:=array[to_jsonb(NEW)];
 elsif TG_OP='DELETE' then sources:=array[to_jsonb(OLD)];
 else sources:=array[to_jsonb(OLD),to_jsonb(NEW)]; end if;
 foreach source in array sources loop
  eid:=null;
  case TG_ARGV[1]
   when 'direct' then eid:=(source->>'episode_id')::uuid;
   when 'review' then select episode_id into eid from public.review_packages where id=(source->>'review_package_id')::uuid;
   when 'audio' then select episode_id into eid from public.audio_tracks where id=(source->>'audio_track_id')::uuid;
   when 'task' then select episode_id into eid from public.tasks where id=(source->>'task_id')::uuid;
  end case;
  item:=coalesce(source->>'id',(source->>'review_package_id')||'/'||(source->>'member_key'));
  identity:=eid::text||'/'||item;
  if eid is null or identity=any(seen) or not exists(select 1 from public.episodes where id=eid) then continue;end if;
  seen:=array_append(seen,identity);
  -- Each business row has its own counter; tombstones survive deletion.
  -- No shared episode/section write lock that could invert Worker lock order.
  insert into public.episode_read_revisions(episode_id,section,item_id) values(eid,TG_ARGV[0],item)
   on conflict(episode_id,section,item_id) do update set revision=public.episode_read_revisions.revision+1;
 end loop;
 return null;
end $$;


--
-- Name: enqueue_notification_event(); Type: FUNCTION; Schema: loop_internal; Owner: -
--

CREATE FUNCTION loop_internal.enqueue_notification_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if new.event_type in ('stage_transition','pre_render_review_package_created','a_roll_task_blocked','b_roll_task_blocked','narration_task_blocked','soundtrack_task_blocked') then
  insert into public.notification_delivery_events(event_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_blueprint_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_blueprint_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    version integer NOT NULL,
    policy jsonb NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    is_snapshot boolean DEFAULT false NOT NULL,
    CONSTRAINT account_blueprint_versions_version_check CHECK ((version > 0))
);


--
-- Name: activate_blueprint_version(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_blueprint_version(p_account_id uuid, p_blueprint_version_id uuid) RETURNS public.account_blueprint_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  membership_role public.member_role;
  activated_blueprint public.account_blueprint_versions;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to activate a blueprint version' using errcode = '42501';
  end if;
  select * into activated_blueprint
  from public.account_blueprint_versions
  where account_id = p_account_id and id = p_blueprint_version_id
  for update;
  if not found then
    raise exception 'Blueprint version does not belong to this account' using errcode = '22023';
  end if;
  if activated_blueprint.archived_at is not null then
    raise exception 'Archived blueprint versions must be restored before activation' using errcode = '22023';
  end if;
  update public.account_blueprint_versions
  set is_active = false
  where account_id = p_account_id and is_active;
  update public.account_blueprint_versions
  set is_active = true
  where account_id = p_account_id and id = p_blueprint_version_id
  returning * into activated_blueprint;
  update public.accounts set current_blueprint_version_id = p_blueprint_version_id where id = p_account_id;
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (p_account_id, 'blueprint_version_activated', jsonb_build_object('blueprint_version_id', p_blueprint_version_id, 'version', activated_blueprint.version), auth.uid());
  return activated_blueprint;
end;
$$;


--
-- Name: episodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.episodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    blueprint_version_id uuid NOT NULL,
    title text NOT NULL,
    stage public.episode_stage DEFAULT 'waiting_input'::public.episode_stage NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    series_version_id uuid,
    main_script_revision_id uuid,
    archived_at timestamp with time zone,
    is_test boolean DEFAULT false NOT NULL,
    script_source text DEFAULT 'provided'::text NOT NULL,
    worker_preflight_at timestamp with time zone,
    audio_source_mode text DEFAULT 'tts'::text NOT NULL,
    tts_language_code text,
    tts_voice text,
    tts_speaking_rate numeric(5,2),
    CONSTRAINT episodes_active_stage_check CHECK ((stage <> ALL (ARRAY['publish_ready'::public.episode_stage, 'publishing_review'::public.episode_stage, 'published'::public.episode_stage, 'metrics_collecting'::public.episode_stage, 'learning_recorded'::public.episode_stage]))),
    CONSTRAINT episodes_audio_source_mode_check CHECK ((audio_source_mode = ANY (ARRAY['source'::text, 'tts'::text]))),
    CONSTRAINT episodes_script_source_check CHECK ((script_source = ANY (ARRAY['provided'::text, 'delegated'::text]))),
    CONSTRAINT episodes_tts_speaking_rate_positive CHECK (((tts_speaking_rate IS NULL) OR (tts_speaking_rate > (0)::numeric)))
);


--
-- Name: advance_production_ready_episodes(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.advance_production_ready_episodes(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare candidate record; advanced_episode public.episodes;
begin
  for candidate in
    select episode.id, episode.account_id, blueprint.policy as blueprint_policy, package.id as storyboard_review_package_id, package.context_snapshot as storyboard_context
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join lateral (
      select review_package.* from public.review_packages review_package
      join public.approvals approval on approval.review_package_id = review_package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
      where review_package.episode_id = episode.id and review_package.stage = 'storyboard_review' and review_package.invalidated_at is null
      order by review_package.revision_number desc limit 1
    ) package on true
    where episode.stage = 'storyboard_approved' and (p_episode_id is null or episode.id = p_episode_id)
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    if exists (select 1 from public.shot_preparation_drafts draft where draft.episode_id = candidate.id and draft.review_package_id = candidate.storyboard_review_package_id) then
      if not public.has_current_shot_preparation_snapshot(candidate.id, candidate.storyboard_review_package_id) then continue; end if;
      if not exists (select 1 from public.create_shot_preparation_review_package(candidate.id, candidate.storyboard_review_package_id)) then continue; end if;
      update public.episodes set stage = 'production_ready', updated_at = now() where id = candidate.id returning * into advanced_episode;
      insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'storyboard_approved', 'production_ready', '逐镜头准备片段、音频模式、字幕与警告决定均已确认。', null);
      insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'stage_transition', jsonb_build_object('from_stage', 'storyboard_approved', 'to_stage', 'production_ready', 'reason', '逐镜头确认完成。'), null);
      return next advanced_episode;
    end if;
    if jsonb_typeof(candidate.storyboard_context #> '{worker_result,storyboard,shots}') <> 'array' or jsonb_array_length(candidate.storyboard_context #> '{worker_result,storyboard,shots}') = 0 then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') shot
      where shot ->> 'shotType' not in ('a_roll', 'b_roll') or coalesce(btrim(shot ->> 'id'), '') = '' or not exists (
        select 1 from public.tasks task join public.artifacts artifact on artifact.producer_task_id = task.id and artifact.relative_path = task.input_snapshot #>> '{output,relative_path}' and artifact.artifact_type = any (array(select jsonb_array_elements_text(task.input_snapshot #> '{output,required_artifact_types}')))
        where task.episode_id = candidate.id and task.status = 'completed' and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text and task.input_snapshot #>> '{shot,id}' = shot ->> 'id' and task.task_type = case shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
      )
    ) then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') shot
      where not exists (
        select 1 from public.audio_tracks track where track.episode_id = candidate.id and track.track_kind = 'narration' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = shot ->> 'id'
      )
    ) and exists (
      select 1 from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where material.episode_id = candidate.id and material.material_type = 'video' and material.storage_path ~* '[.](mp4|mov|webm)$'
    ) and not exists (
      select 1 from public.audio_tracks track join public.production_material_revisions material on material.id = track.source_material_revision_id join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where track.episode_id = candidate.id and track.track_kind = 'derived'
    ) then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') shot
      where not exists (select 1 from public.audio_tracks track where track.episode_id = candidate.id and track.track_kind = 'narration' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = shot ->> 'id')
    ) and not exists (
      select 1 from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where material.episode_id = candidate.id and material.material_type = 'video' and material.storage_path ~* '[.](mp4|mov|webm)$'
    ) then continue; end if;
    if (candidate.blueprint_policy -> 'soundtrack') is not null and jsonb_typeof(candidate.blueprint_policy -> 'soundtrack') <> 'null' and exists (
      select 1 from jsonb_array_elements(coalesce(candidate.storyboard_context #> '{worker_result,storyboard,audioCues}', '[]'::jsonb)) cue
      where cue ->> 'kind' not in ('bgm', 'sfx') or coalesce(btrim(cue ->> 'id'), '') = '' or not exists (
        select 1 from public.audio_tracks track where track.episode_id = candidate.id and track.track_kind = cue ->> 'kind' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = cue ->> 'id'
      )
    ) then continue; end if;
    update public.episodes set stage = 'production_ready', updated_at = now() where id = candidate.id returning * into advanced_episode;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'storyboard_approved', 'production_ready', '所有已启用能力的冻结镜头与音频均已验证完成。', null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'stage_transition', jsonb_build_object('from_stage', 'storyboard_approved', 'to_stage', 'production_ready', 'reason', '所有已启用能力的冻结镜头与音频均已验证完成。'), null);
    return next advanced_episode;
  end loop;
end;
$_$;


--
-- Name: advance_qc_only_review_render(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.advance_qc_only_review_render() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  values (updated_episode.id,'production_ready','render_ready','冻结媒体已自动进入 OpenChatCut 审核渲染。',null);
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id)
  values (updated_episode.account_id,updated_episode.id,'review_render_auto_queued',jsonb_build_object('task_id',new.id,'pre_render_review_package_id',pre_render_package.id),null);
  return new;
end;
$$;


--
-- Name: apply_blueprint_to_episode(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_blueprint_to_episode(p_episode_id uuid, p_blueprint_version_id uuid, p_blocker_code text DEFAULT NULL::text, p_blocker_detail text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  selected_blueprint public.account_blueprint_versions;
  selected_series_rules jsonb;
  blocked_task public.tasks;
  created_task public.tasks;
  selected_config jsonb;
  executor jsonb;
  allowed_tools jsonb;
  next_snapshot jsonb;
  next_budget integer;
  next_max_attempts integer;
  next_provider text;
  next_model text;
  next_prompt_version text;
  configuration_key text;
  superseded_count integer := 0;
  recreated_count integer := 0;
begin
  select episode.*
  into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;

  if not found then
    raise exception 'Owner membership is required to apply a blueprint to an episode' using errcode = '42501';
  end if;

  select blueprint.*
  into selected_blueprint
  from public.account_blueprint_versions blueprint
  where blueprint.id = p_blueprint_version_id
    and blueprint.account_id = current_episode.account_id
    and blueprint.archived_at is null;

  if not found then
    raise exception 'Blueprint version does not belong to the episode account or is archived' using errcode = '22023';
  end if;

  select coalesce(series_version.rules, '{}'::jsonb)
  into selected_series_rules
  from public.series_versions series_version
  where series_version.id = current_episode.series_version_id
    and series_version.account_id = current_episode.account_id;

  update public.episodes
  set blueprint_version_id = p_blueprint_version_id,
      updated_at = now()
  where id = p_episode_id;

  for blocked_task in
    select task.*
    from public.tasks task
    where task.episode_id = p_episode_id
      and task.status = 'blocked'::public.task_status
      and not (task.input_snapshot ? 'superseded_by_blueprint_version_id')
      and exists (
        select 1
        from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker
        where (p_blocker_code is null or blocker ->> 'code' = p_blocker_code)
          and (p_blocker_detail is null or blocker ->> 'detail' = p_blocker_detail)
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) ~ '(executor|adapter|allowed|asset.?root|budget|voice|scheduling|权限|配置|预算|适配器|工具)'
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) !~ '(provider.?unavailable|credential|network|尚未注册)'
      )
    order by task.created_at, task.id
    for update of task
  loop
    selected_config := null;
    configuration_key := null;
    next_budget := blocked_task.budget_limit_cents;
    next_max_attempts := blocked_task.max_attempts;

    if blocked_task.task_type = 'prepare_visual_brief' then
      selected_config := selected_blueprint.policy #> '{executors,visual_planning}';
      allowed_tools := selected_blueprint.policy -> 'allowed_tools';
      next_budget := case when jsonb_typeof(selected_blueprint.policy #> '{budgets,visual_planning_cents}') = 'number' then (selected_blueprint.policy #>> '{budgets,visual_planning_cents}')::integer else 0 end;
      next_max_attempts := 2;
    elsif blocked_task.task_type = 'draft_storyboard' then
      selected_config := selected_blueprint.policy #> '{executors,storyboard_planning}';
      allowed_tools := selected_blueprint.policy -> 'allowed_tools';
      next_budget := case when jsonb_typeof(selected_blueprint.policy #> '{budgets,storyboard_planning_cents}') = 'number' then (selected_blueprint.policy #>> '{budgets,storyboard_planning_cents}')::integer else 0 end;
      next_max_attempts := 2;
    elsif blocked_task.task_type = 'draft_script' then
      selected_config := selected_blueprint.policy #> '{executors,script_writing}';
      allowed_tools := selected_blueprint.policy -> 'allowed_tools';
      next_budget := case when jsonb_typeof(selected_blueprint.policy #> '{budgets,script_writing_cents}') = 'number' then (selected_blueprint.policy #>> '{budgets,script_writing_cents}')::integer else 0 end;
      next_max_attempts := 2;
    elsif blocked_task.task_type in ('generate_a_roll', 'generate_b_roll', 'generate_narration', 'generate_soundtrack') then
      configuration_key := case blocked_task.task_type
        when 'generate_a_roll' then 'a_roll'
        when 'generate_b_roll' then 'b_roll'
        when 'generate_narration' then 'narration'
        else 'soundtrack'
      end;
      selected_config := coalesce(selected_series_rules -> configuration_key, selected_blueprint.policy -> configuration_key);
      if selected_series_rules ? configuration_key then
        raise exception '当前生产单的系列规则覆盖了账号蓝图中的 % 配置，请先修正系列规则后再应用蓝图', configuration_key using errcode = '22023';
      end if;
      allowed_tools := coalesce(selected_config -> 'allowed_tools', selected_blueprint.policy -> 'allowed_tools');
      next_budget := case
        when blocked_task.task_type = 'generate_b_roll' and jsonb_typeof(selected_config -> 'per_shot_budget_cents') = 'number' then (selected_config ->> 'per_shot_budget_cents')::integer
        when jsonb_typeof(selected_config -> 'budget_cents') = 'number' then (selected_config ->> 'budget_cents')::integer
        else blocked_task.budget_limit_cents
      end;
      next_max_attempts := case when jsonb_typeof(selected_config -> 'max_attempts') = 'number' then (selected_config ->> 'max_attempts')::integer else blocked_task.max_attempts end;
    else
      continue;
    end if;

    executor := coalesce(selected_config -> 'executor', selected_config, '{}'::jsonb);
    next_provider := coalesce(executor ->> 'provider', blocked_task.provider, 'unconfigured');
    next_model := coalesce(executor ->> 'model', blocked_task.model, 'unconfigured');
    next_prompt_version := coalesce(executor ->> 'prompt_version', blocked_task.prompt_version, 'unconfigured');
    next_snapshot := blocked_task.input_snapshot;
    next_snapshot := jsonb_set(next_snapshot, '{executor}', executor, true);
    next_snapshot := jsonb_set(next_snapshot, '{allowed_tools}', coalesce(allowed_tools, '[]'::jsonb), true);
    next_snapshot := jsonb_set(next_snapshot, '{budget}', coalesce(next_snapshot -> 'budget', '{}'::jsonb) || jsonb_build_object('limit_cents', next_budget, 'max_attempts', next_max_attempts), true);
    if configuration_key = 'b_roll' then
      next_snapshot := jsonb_set(next_snapshot, '{scheduling}', coalesce(next_snapshot -> 'scheduling', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'max_concurrency', selected_config -> 'max_concurrency',
        'provider_max_concurrency', selected_config -> 'provider_max_concurrency'
      )), true);
      next_snapshot := jsonb_set(next_snapshot, '{budget}', coalesce(next_snapshot -> 'budget', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'total_limit_cents', selected_config -> 'total_budget_cents'
      )), true);
    end if;
    next_snapshot := jsonb_set(next_snapshot, '{blueprint_version_id}', to_jsonb(p_blueprint_version_id::text), true);
    next_snapshot := jsonb_set(next_snapshot, '{configuration_repair}', jsonb_build_object('source_task_id', blocked_task.id, 'source_blueprint_version_id', current_episode.blueprint_version_id, 'target_blueprint_version_id', p_blueprint_version_id), true);
    if configuration_key is not null then
      next_snapshot := jsonb_set(next_snapshot, '{configuration_hash}', to_jsonb(md5(coalesce(selected_config::text, 'null'))), true);
    end if;
    if blocked_task.task_type = 'generate_narration' and jsonb_typeof(selected_config -> 'voice') = 'object' then
      next_snapshot := jsonb_set(next_snapshot, '{media,narration,voice}', selected_config -> 'voice', true);
    end if;

    update public.tasks
    set status = 'superseded'::public.task_status,
        budget_limit_cents = 0,
        claimed_at = null,
        completed_at = coalesce(completed_at, now()),
        input_snapshot = (input_snapshot - 'configuration_hash') || jsonb_build_object(
          'superseded_configuration_hash', input_snapshot -> 'configuration_hash',
          'superseded_by_blueprint_version_id', p_blueprint_version_id,
          'superseded_at', now(),
          'superseded_from_blueprint_version_id', current_episode.blueprint_version_id
        ),
        last_result = coalesce(last_result, '{}'::jsonb) || jsonb_build_object(
          'status', 'superseded',
          'superseded_by_blueprint_version_id', p_blueprint_version_id,
          'nextStep', '配置已修订，系统已为当前生产单重新排队。'
        )
    where id = blocked_task.id;
    superseded_count := superseded_count + 1;

    insert into public.tasks (
      episode_id, task_type, status, input_snapshot, budget_limit_cents,
      max_attempts, provider, model, prompt_version
    ) values (
      p_episode_id,
      blocked_task.task_type,
      'ready'::public.task_status,
      next_snapshot,
      greatest(next_budget, 0),
      greatest(next_max_attempts, 1),
      next_provider,
      next_model,
      next_prompt_version
    ) on conflict do nothing
    returning * into created_task;
    if found then
      recreated_count := recreated_count + 1;
    end if;
  end loop;

  if superseded_count = 0 then
    raise exception '当前生产单没有可通过蓝图修复的阻塞任务' using errcode = '22023';
  end if;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    p_episode_id,
    'blueprint_applied_to_episode',
    jsonb_build_object(
      'from_blueprint_version_id', current_episode.blueprint_version_id,
      'to_blueprint_version_id', p_blueprint_version_id,
      'blocker_code', p_blocker_code,
      'superseded_task_count', superseded_count,
      'recreated_task_count', recreated_count
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'episode_id', p_episode_id,
    'blueprint_version_id', p_blueprint_version_id,
    'superseded_task_count', superseded_count,
    'recreated_task_count', recreated_count
  );
end;
$$;


--
-- Name: apply_episode_configuration_repair(uuid, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_episode_configuration_repair(p_episode_id uuid, p_policy jsonb, p_blocker_code text DEFAULT NULL::text, p_blocker_detail text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  selected_series_rules jsonb;
  blocked_task public.tasks;
  created_task public.tasks;
  selected_config jsonb;
  executor jsonb;
  allowed_tools jsonb;
  next_snapshot jsonb;
  next_budget integer;
  next_max_attempts integer;
  next_provider text;
  next_model text;
  next_prompt_version text;
  configuration_key text;
  repair_policy_hash text := md5(p_policy::text);
  superseded_count integer := 0;
  recreated_count integer := 0;
begin
  if jsonb_typeof(p_policy) <> 'object' then
    raise exception 'Episode repair policy must be a JSON object' using errcode = '22023';
  end if;

  select episode.*
  into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;

  if not found then
    raise exception 'Owner membership is required to repair an episode' using errcode = '42501';
  end if;

  select coalesce(series_version.rules, '{}'::jsonb)
  into selected_series_rules
  from public.series_versions series_version
  where series_version.id = current_episode.series_version_id
    and series_version.account_id = current_episode.account_id;

  for blocked_task in
    select task.*
    from public.tasks task
    where task.episode_id = p_episode_id
      and task.status = 'blocked'::public.task_status
      and not (task.input_snapshot ? 'superseded_by_episode_repair_policy_hash')
      and exists (
        select 1
        from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker
        where (p_blocker_code is null or blocker ->> 'code' = p_blocker_code)
          and (p_blocker_detail is null or blocker ->> 'detail' = p_blocker_detail)
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) ~ '(executor|adapter|allowed|asset.?root|budget|voice|scheduling|权限|配置|预算|适配器|工具)'
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) !~ '(provider.?unavailable|credential|network|尚未注册)'
      )
    order by task.created_at, task.id
    for update of task
  loop
    selected_config := null;
    configuration_key := null;
    next_budget := blocked_task.budget_limit_cents;
    next_max_attempts := blocked_task.max_attempts;

    if blocked_task.task_type = 'prepare_visual_brief' then
      selected_config := p_policy #> '{executors,visual_planning}';
      allowed_tools := p_policy -> 'allowed_tools';
      next_budget := case when jsonb_typeof(p_policy #> '{budgets,visual_planning_cents}') = 'number' then (p_policy #>> '{budgets,visual_planning_cents}')::integer else 0 end;
      next_max_attempts := 2;
    elsif blocked_task.task_type = 'draft_storyboard' then
      selected_config := p_policy #> '{executors,storyboard_planning}';
      allowed_tools := p_policy -> 'allowed_tools';
      next_budget := case when jsonb_typeof(p_policy #> '{budgets,storyboard_planning_cents}') = 'number' then (p_policy #>> '{budgets,storyboard_planning_cents}')::integer else 0 end;
      next_max_attempts := 2;
    elsif blocked_task.task_type = 'draft_script' then
      selected_config := p_policy #> '{executors,script_writing}';
      allowed_tools := p_policy -> 'allowed_tools';
      next_budget := case when jsonb_typeof(p_policy #> '{budgets,script_writing_cents}') = 'number' then (p_policy #>> '{budgets,script_writing_cents}')::integer else 0 end;
      next_max_attempts := 2;
    elsif blocked_task.task_type in ('generate_a_roll', 'generate_b_roll', 'generate_narration', 'generate_soundtrack') then
      configuration_key := case blocked_task.task_type
        when 'generate_a_roll' then 'a_roll'
        when 'generate_b_roll' then 'b_roll'
        when 'generate_narration' then 'narration'
        else 'soundtrack'
      end;
      if selected_series_rules ? configuration_key then
        raise exception '当前生产单的系列规则覆盖了账号配置中的 %，请先修正系列规则', configuration_key using errcode = '22023';
      end if;
      selected_config := p_policy -> configuration_key;
      allowed_tools := coalesce(selected_config -> 'allowed_tools', p_policy -> 'allowed_tools');
      next_budget := case
        when blocked_task.task_type = 'generate_b_roll' and jsonb_typeof(selected_config -> 'per_shot_budget_cents') = 'number' then (selected_config ->> 'per_shot_budget_cents')::integer
        when jsonb_typeof(selected_config -> 'budget_cents') = 'number' then (selected_config ->> 'budget_cents')::integer
        else blocked_task.budget_limit_cents
      end;
      next_max_attempts := case when jsonb_typeof(selected_config -> 'max_attempts') = 'number' then (selected_config ->> 'max_attempts')::integer else blocked_task.max_attempts end;
    else
      continue;
    end if;

    executor := coalesce(selected_config -> 'executor', selected_config, '{}'::jsonb);
    next_provider := coalesce(executor ->> 'provider', blocked_task.provider, 'unconfigured');
    next_model := coalesce(executor ->> 'model', blocked_task.model, 'unconfigured');
    next_prompt_version := coalesce(executor ->> 'prompt_version', blocked_task.prompt_version, 'unconfigured');
    next_snapshot := blocked_task.input_snapshot;
    next_snapshot := jsonb_set(next_snapshot, '{executor}', executor, true);
    next_snapshot := jsonb_set(next_snapshot, '{allowed_tools}', coalesce(allowed_tools, '[]'::jsonb), true);
    next_snapshot := jsonb_set(next_snapshot, '{budget}', coalesce(next_snapshot -> 'budget', '{}'::jsonb) || jsonb_build_object('limit_cents', next_budget, 'max_attempts', next_max_attempts), true);
    if configuration_key = 'b_roll' then
      next_snapshot := jsonb_set(next_snapshot, '{scheduling}', coalesce(next_snapshot -> 'scheduling', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('max_concurrency', selected_config -> 'max_concurrency', 'provider_max_concurrency', selected_config -> 'provider_max_concurrency')), true);
      next_snapshot := jsonb_set(next_snapshot, '{budget}', coalesce(next_snapshot -> 'budget', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('total_limit_cents', selected_config -> 'total_budget_cents')), true);
    end if;
    next_snapshot := jsonb_set(next_snapshot, '{configuration_repair}', jsonb_build_object('source_task_id', blocked_task.id, 'source_blueprint_version_id', current_episode.blueprint_version_id, 'episode_repair_policy_hash', repair_policy_hash), true);
    if configuration_key is not null then
      next_snapshot := jsonb_set(next_snapshot, '{configuration_hash}', to_jsonb(md5(coalesce(selected_config::text, 'null'))), true);
    end if;
    if blocked_task.task_type = 'generate_narration' and jsonb_typeof(selected_config -> 'voice') = 'object' then
      next_snapshot := jsonb_set(next_snapshot, '{media,narration,voice}', selected_config -> 'voice', true);
    end if;

    update public.tasks
    set status = 'superseded'::public.task_status,
        budget_limit_cents = 0,
        claimed_at = null,
        completed_at = coalesce(completed_at, now()),
        input_snapshot = (input_snapshot - 'configuration_hash') || jsonb_build_object('superseded_configuration_hash', input_snapshot -> 'configuration_hash', 'superseded_by_episode_repair_policy_hash', repair_policy_hash, 'superseded_at', now(), 'source_blueprint_version_id', current_episode.blueprint_version_id),
        last_result = coalesce(last_result, '{}'::jsonb) || jsonb_build_object('status', 'superseded', 'superseded_by_episode_repair_policy_hash', repair_policy_hash, 'nextStep', '配置已直接修订，系统已为当前生产单重新排队。')
    where id = blocked_task.id;
    superseded_count := superseded_count + 1;

    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (p_episode_id, blocked_task.task_type, 'ready'::public.task_status, next_snapshot, greatest(next_budget, 0), greatest(next_max_attempts, 1), next_provider, next_model, next_prompt_version)
    on conflict do nothing
    returning * into created_task;
    if found then
      recreated_count := recreated_count + 1;
    end if;
  end loop;

  if superseded_count = 0 then
    raise exception '当前生产单没有可通过配置修复的阻塞任务' using errcode = '22023';
  end if;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'episode_configuration_repaired', jsonb_build_object('source_blueprint_version_id', current_episode.blueprint_version_id, 'repair_policy_hash', repair_policy_hash, 'blocker_code', p_blocker_code, 'superseded_task_count', superseded_count, 'recreated_task_count', recreated_count), auth.uid());

  return jsonb_build_object('episode_id', p_episode_id, 'source_blueprint_version_id', current_episode.blueprint_version_id, 'repair_policy_hash', repair_policy_hash, 'superseded_task_count', superseded_count, 'recreated_task_count', recreated_count);
end;
$$;


--
-- Name: apply_episode_configuration_repair_v2(uuid, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_episode_configuration_repair_v2(p_episode_id uuid, p_policy jsonb, p_blocker_code text DEFAULT NULL::text, p_blocker_detail text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  current_episode public.episodes;
  blocked_task public.tasks;
  planning_task public.tasks;
  selected_config jsonb;
  executor jsonb;
  allowed_tools jsonb;
  configuration_key text;
  planning_harness public.prompt_versions;
  next_snapshot jsonb;
  next_budget integer;
  next_max_attempts integer;
  created_task public.tasks;
begin
  if jsonb_typeof(p_policy) <> 'object' then
    raise exception 'Episode repair policy must be a JSON object' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id;
  if not found then
    raise exception 'Owner membership is required to repair an episode' using errcode = '42501';
  end if;

  for blocked_task in
    select task.*
    from public.tasks task
    where task.episode_id = p_episode_id
      and task.status = 'blocked'::public.task_status
      and not (task.input_snapshot ? 'superseded_by_episode_repair_policy_hash')
      and exists (
        select 1 from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker
        where (p_blocker_code is null or blocker ->> 'code' = p_blocker_code)
          and (p_blocker_detail is null or blocker ->> 'detail' = p_blocker_detail)
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) ~ '(executor|adapter|allowed|asset.?root|budget|voice|scheduling|权限|配置|预算|适配器|工具)'
          and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) !~ '(provider.?unavailable|credential|network|尚未注册)'
      )
  loop
    configuration_key := null;
    if blocked_task.task_type in ('prepare_visual_brief', 'draft_storyboard') then
      if planning_task.id is not null then
        raise exception '请一次修复一个分镜规划阻塞项' using errcode = '22023';
      end if;
      selected_config := p_policy #> '{executors,storyboard_planning}';
      planning_task := blocked_task;
    elsif blocked_task.task_type = 'draft_script' then
      selected_config := p_policy #> '{executors,script_writing}';
    elsif blocked_task.task_type in ('generate_a_roll', 'generate_b_roll', 'generate_narration', 'generate_soundtrack') then
      configuration_key := case blocked_task.task_type when 'generate_a_roll' then 'a_roll' when 'generate_b_roll' then 'b_roll' when 'generate_narration' then 'narration' else 'soundtrack' end;
      selected_config := p_policy -> configuration_key;
    else
      continue;
    end if;

    if jsonb_typeof(selected_config) <> 'object' then
      raise exception '当前生产单缺少 % 的修复配置', coalesce(configuration_key, blocked_task.task_type::text) using errcode = '22023';
    end if;
    executor := coalesce(selected_config -> 'executor', selected_config);
    if jsonb_typeof(executor) <> 'object' or coalesce(executor ->> 'provider', '') = '' or coalesce(executor ->> 'model', '') = '' or coalesce(executor ->> 'prompt_version', '') = '' then
      raise exception '当前生产单的 % 修复配置缺少 Provider、模型或 Prompt 版本', coalesce(configuration_key, blocked_task.task_type::text) using errcode = '22023';
    end if;
    if blocked_task.task_type in ('prepare_visual_brief', 'draft_storyboard') then
      if executor ->> 'adapter' <> 'codex' or coalesce(executor ->> 'harness_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception '分镜规划修复配置必须选择已登记的 Codex Adapter 和 Harness' using errcode = '22023';
      end if;
      select harness.* into planning_harness
      from public.prompt_versions harness
      where harness.id = (executor ->> 'harness_id')::uuid
        and harness.account_id = current_episode.account_id
        and harness.capability = 'storyboard_planning'
        and harness.is_active;
      if not found or coalesce(btrim(planning_harness.instructions), '') = '' then
        raise exception '分镜规划修复配置必须选择已启用的 Harness' using errcode = '22023';
      end if;
    elsif configuration_key is not null and coalesce(executor ->> 'adapter', '') = '' then
      raise exception '当前生产单的 % 修复配置缺少 Adapter', configuration_key using errcode = '22023';
    end if;
    allowed_tools := coalesce(selected_config -> 'allowed_tools', p_policy -> 'allowed_tools');
    if jsonb_typeof(allowed_tools) <> 'array' or jsonb_array_length(allowed_tools) = 0 then
      raise exception '当前生产单的修复配置至少需要一个允许工具' using errcode = '22023';
    end if;
  end loop;

  if planning_task.id is null then
    return public.apply_episode_configuration_repair(p_episode_id, p_policy, p_blocker_code, p_blocker_detail);
  end if;

  if exists (
    select 1 from public.tasks task
    where task.episode_id = p_episode_id and task.status = 'blocked'::public.task_status and task.id <> planning_task.id
      and exists (select 1 from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker where (p_blocker_code is null or blocker ->> 'code' = p_blocker_code) and (p_blocker_detail is null or blocker ->> 'detail' = p_blocker_detail))
  ) then
    raise exception '请一次修复一个生产单阻塞项' using errcode = '22023';
  end if;

  select task.* into planning_task from public.tasks task where task.id = planning_task.id and task.status = 'blocked'::public.task_status for update;
  next_budget := case when jsonb_typeof(p_policy #> '{budgets,storyboard_planning_cents}') = 'number' then (p_policy #>> '{budgets,storyboard_planning_cents}')::integer else 0 end;
  next_max_attempts := 2;
  next_snapshot := jsonb_set(planning_task.input_snapshot - 'prompt_context', '{executor}', executor, true);
  next_snapshot := jsonb_set(next_snapshot, '{harness}', jsonb_build_object('id', planning_harness.id, 'version', planning_harness.version, 'content', planning_harness.instructions, 'content_hash', planning_harness.content_hash, 'adapter', 'codex', 'model', executor ->> 'model', 'prompt_version', planning_harness.slug), true);
  next_snapshot := jsonb_set(next_snapshot, '{allowed_tools}', allowed_tools, true);
  next_snapshot := jsonb_set(next_snapshot, '{budget}', coalesce(next_snapshot -> 'budget', '{}'::jsonb) || jsonb_build_object('limit_cents', next_budget, 'max_attempts', next_max_attempts), true);
  next_snapshot := jsonb_set(next_snapshot, '{configuration_repair}', jsonb_build_object('source_task_id', planning_task.id, 'source_blueprint_version_id', current_episode.blueprint_version_id, 'episode_repair_policy_hash', md5(p_policy::text)), true);
  next_snapshot := next_snapshot || jsonb_build_object('prompt_context', public.build_prompt_context(p_episode_id, next_snapshot));

  update public.tasks
  set status = 'superseded'::public.task_status, budget_limit_cents = 0, claimed_at = null, completed_at = coalesce(completed_at, now()),
      input_snapshot = input_snapshot || jsonb_build_object('superseded_by_episode_repair_policy_hash', md5(p_policy::text), 'superseded_at', now(), 'source_blueprint_version_id', current_episode.blueprint_version_id),
      last_result = coalesce(last_result, '{}'::jsonb) || jsonb_build_object('status', 'superseded', 'nextStep', '配置已直接修订，系统已为当前生产单重新排队。')
  where id = planning_task.id;

  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, planning_task.task_type, 'ready'::public.task_status, next_snapshot, greatest(next_budget, 0), next_max_attempts, executor ->> 'provider', executor ->> 'model', planning_harness.slug)
  on conflict do nothing
  returning * into created_task;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'episode_configuration_repaired', jsonb_build_object('source_blueprint_version_id', current_episode.blueprint_version_id, 'repair_policy_hash', md5(p_policy::text), 'blocker_code', p_blocker_code, 'superseded_task_count', 1, 'recreated_task_count', case when created_task.id is null then 0 else 1 end), auth.uid());
  return jsonb_build_object('episode_id', p_episode_id, 'source_blueprint_version_id', current_episode.blueprint_version_id, 'repair_policy_hash', md5(p_policy::text), 'superseded_task_count', 1, 'recreated_task_count', case when created_task.id is null then 0 else 1 end);
end;
$_$;


--
-- Name: apply_external_connection_repair(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_external_connection_repair(p_episode_id uuid, p_connection_version_id uuid, p_blocker_code text DEFAULT NULL::text, p_blocker_detail text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare current_episode public.episodes; target_version public.external_connection_versions; blocked_task public.tasks; source_ref text; source_version public.external_connection_versions; expected_provider text; expected_adapter text; next_snapshot jsonb; superseded_count integer := 0; recreated_count integer := 0;
begin
  select episode.* into current_episode from public.episodes episode join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner' where episode.id = p_episode_id for update of episode;
  if not found then raise exception 'Owner membership is required to repair an episode connection' using errcode = '42501'; end if;
  select version.* into target_version from public.external_connection_versions version join public.external_connections connection on connection.id = version.connection_id where version.id = p_connection_version_id and connection.created_by = auth.uid() and public.connection_version_is_verified(version.id);
  if not found then raise exception 'Episode repair requires an Owner’s current verified, non-revoked connection version' using errcode = '22023'; end if;

  for blocked_task in select task.* from public.tasks task where task.episode_id = p_episode_id and task.status in ('blocked'::public.task_status, 'failed'::public.task_status) and task.task_type in ('prepare_visual_brief', 'generate_b_roll', 'generate_narration', 'generate_soundtrack') and exists (select 1 from jsonb_array_elements(coalesce(task.last_result -> 'blockers', '[]'::jsonb)) blocker where (p_blocker_code is null or blocker ->> 'code' = p_blocker_code) and (p_blocker_detail is null or blocker ->> 'detail' = p_blocker_detail) and lower(coalesce(blocker ->> 'code', '') || ' ' || coalesce(blocker ->> 'detail', '')) ~ '(credential|connection|network|凭据|连接|认证)') order by task.created_at, task.id for update
  loop
    source_ref := coalesce(blocked_task.input_snapshot ->> 'credential_ref', blocked_task.input_snapshot #>> '{visual_assets,image_generation,credential_ref}');
    if source_ref is null or source_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then continue; end if;
    expected_provider := case blocked_task.task_type when 'prepare_visual_brief' then 'openai' when 'generate_b_roll' then 'pexels' when 'generate_narration' then blocked_task.provider when 'generate_soundtrack' then 'freesound' else null end;
    expected_adapter := case blocked_task.task_type when 'prepare_visual_brief' then 'openai_images' when 'generate_b_roll' then 'pexels_video' when 'generate_narration' then blocked_task.input_snapshot #>> '{executor,adapter}' when 'generate_soundtrack' then 'freesound_preview' else null end;
    select version.* into source_version from public.external_connection_versions version where version.id = source_ref::uuid;
    if not found or source_version.connection_id <> target_version.connection_id or source_version.id = target_version.id or target_version.provider <> expected_provider or target_version.adapter <> expected_adapter or source_version.provider <> expected_provider or source_version.adapter <> expected_adapter then continue; end if;
    next_snapshot := blocked_task.input_snapshot;
    if blocked_task.task_type = 'prepare_visual_brief' then next_snapshot := jsonb_set(next_snapshot, '{visual_assets,image_generation,credential_ref}', to_jsonb(target_version.id::text), true); else next_snapshot := jsonb_set(next_snapshot, '{credential_ref}', to_jsonb(target_version.id::text), true); end if;
    update public.tasks set status = 'superseded'::public.task_status, budget_limit_cents = 0, claimed_at = null, completed_at = coalesce(completed_at, now()), input_snapshot = input_snapshot || jsonb_build_object('superseded_by_connection_version_id', target_version.id, 'superseded_at', now()), last_result = coalesce(last_result, '{}'::jsonb) || jsonb_build_object('status', 'superseded', 'superseded_by_connection_version_id', target_version.id) where id = blocked_task.id;
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version) values (p_episode_id, blocked_task.task_type, 'ready'::public.task_status, next_snapshot, blocked_task.budget_limit_cents, greatest(blocked_task.max_attempts, 1), blocked_task.provider, blocked_task.model, blocked_task.prompt_version);
    superseded_count := superseded_count + 1; recreated_count := recreated_count + 1;
  end loop;
  if superseded_count = 0 then raise exception '当前生产单没有可通过连接版本修复的受阻任务' using errcode = '22023'; end if;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, p_episode_id, 'external_connection_repaired', jsonb_build_object('connection_version_id', target_version.id, 'superseded_task_count', superseded_count, 'recreated_task_count', recreated_count, 'blocker_code', p_blocker_code), auth.uid());
  return jsonb_build_object('episode_id', p_episode_id, 'connection_version_id', target_version.id, 'superseded_task_count', superseded_count, 'recreated_task_count', recreated_count);
end;
$_$;


--
-- Name: approval_gate_enabled(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approval_gate_enabled(p_episode_id uuid, p_gate text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(
    case
      when jsonb_typeof(blueprint.policy -> 'approval_gates') = 'array'
        then (blueprint.policy -> 'approval_gates') ? p_gate
      else true
    end,
    true
  )
  from public.episodes episode
  join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
  where episode.id = p_episode_id;
$$;


--
-- Name: assert_current_qc_review_issue(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_current_qc_review_issue() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: assert_current_storyboard_shot(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_current_storyboard_shot(p_episode_id uuid, p_review_package_id uuid, p_shot_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  selected_package public.review_packages;
  selected_shot jsonb;
begin
  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id
    and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the approved storyboard' using errcode = '22023'; end if;
end;
$$;


--
-- Name: assert_worker_lease(uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_worker_lease(p_task_id uuid, p_attempt integer, p_lease_token uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare selected public.tasks;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Worker service role is required' using errcode='42501'; end if;
  select * into selected from public.tasks where id=p_task_id for update;
  if not found or selected.status <> 'running' or selected.attempt <> p_attempt+1
    or p_lease_token is null or selected.lease_token is distinct from p_lease_token
    or selected.claimed_at is null or selected.claimed_at <= clock_timestamp()-interval '30 minutes'
    or not exists(select 1 from public.task_runs where task_id=p_task_id and attempt=p_attempt and status='running' and lease_token=p_lease_token)
    then raise exception 'Worker lease is expired or belongs to another attempt' using errcode='42501'; end if;
end $$;


--
-- Name: attach_prompt_context_to_worker_task_run(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attach_prompt_context_to_worker_task_run() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  selected_episode public.episodes;
  blueprint_policy jsonb;
  selected_series_version public.series_versions;
  context jsonb;
begin
  if new.task_package is null or jsonb_typeof(new.task_package) <> 'object' then return new; end if;
  if coalesce(new.task_package #>> '{episode,id}', new.task_package ->> 'episode_id', '') = '' then return new; end if;
  select episode.* into selected_episode from public.episodes episode where episode.id = coalesce(new.task_package #>> '{episode,id}', new.task_package ->> 'episode_id')::uuid;
  if not found then return new; end if;
  select policy into blueprint_policy from public.account_blueprint_versions where id = selected_episode.blueprint_version_id;
  select series_version.* into selected_series_version from public.series_versions series_version where series_version.id = selected_episode.series_version_id and series_version.account_id = selected_episode.account_id;

  context := jsonb_strip_nulls(jsonb_build_object(
    'version', 'prompt-context/v1',
    'blueprint_version_id', selected_episode.blueprint_version_id,
    'series_version_id', selected_series_version.id,
    'account_hard_constraints', jsonb_strip_nulls(jsonb_build_object(
      'approval_gates', blueprint_policy -> 'approval_gates',
      'allowed_tools', blueprint_policy -> 'allowed_tools',
      'asset_root', blueprint_policy -> 'asset_root',
      'restrictions', blueprint_policy -> 'restrictions',
      'publishing', blueprint_policy -> 'publishing'
    )),
    'account_defaults', jsonb_strip_nulls(jsonb_build_object(
      'positioning', blueprint_policy -> 'positioning',
      'audience', blueprint_policy -> 'audience',
      'tone', blueprint_policy -> 'tone',
      'brand_voice', blueprint_policy -> 'brand_voice',
      'visual_style', blueprint_policy -> 'visual_style',
      'subtitle_style', blueprint_policy -> 'subtitle_style',
      'language', blueprint_policy -> 'language',
      'creative_rules', blueprint_policy -> 'creative_rules'
    )),
    'series_baseline', case when selected_series_version.id is null then null else jsonb_build_object('version_id', selected_series_version.id, 'version', selected_series_version.version, 'rules', selected_series_version.rules) end,
    'episode_input', jsonb_strip_nulls(jsonb_build_object(
      'commission', new.task_package -> 'commission',
      'script_revision', new.task_package -> 'script_revision',
      'input_artifacts', new.task_package -> 'input_artifacts',
      'shot', new.task_package -> 'shot',
      'media', new.task_package -> 'media'
    )),
    'review_feedback', new.task_package -> 'review_feedback'
  ));
  new.task_package := jsonb_set(new.task_package, '{prompt_context}', context || jsonb_build_object('hash', md5(context::text)), true);
  return new;
end;
$$;


--
-- Name: auto_advance_disabled_approval_gate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_advance_disabled_approval_gate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: block_exhausted_a_roll_task(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_exhausted_a_roll_task() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  blocker_detail text;
begin
  if new.task_type <> 'generate_a_roll'
    or new.status <> 'failed'
    or new.attempt < new.max_attempts then
    return new;
  end if;

  blocker_detail := coalesce(nullif(btrim(new.last_result #>> '{retry,reason}'), ''), 'A-roll Worker 在所有冻结尝试中均失败。');
  update public.tasks
  set status = 'blocked',
      last_result = coalesce(new.last_result, '{}'::jsonb) || jsonb_build_object(
        'status', 'blocked',
        'blockers', jsonb_build_array(jsonb_build_object('code', 'a_roll_retries_exhausted', 'detail', blocker_detail)),
        'retry', jsonb_build_object('shouldRetry', false, 'reason', blocker_detail),
        'nextStep', '由 Owner 检查冻结执行器或配置后创建新的任务。'
      )
  where id = new.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  select episode.account_id, episode.id, 'a_roll_task_blocked', jsonb_build_object('task_id', new.id, 'shot_id', new.input_snapshot #>> '{shot,id}', 'code', 'a_roll_retries_exhausted', 'detail', blocker_detail), null
  from public.episodes episode where episode.id = new.episode_id;
  return new;
end;
$$;


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    timezone text NOT NULL,
    current_blueprint_version_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT accounts_slug_check CHECK ((slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text))
);


--
-- Name: bootstrap_platform(text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bootstrap_platform(p_account_name text, p_account_slug text, p_timezone text, p_policy jsonb) RETURNS public.accounts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  created_account public.accounts;
  created_blueprint public.account_blueprint_versions;
begin
  if auth.uid() is null then
    raise exception 'An authenticated user is required to bootstrap the platform' using errcode = '42501';
  end if;
  if char_length(trim(p_account_name)) = 0 or char_length(trim(p_account_slug)) = 0 then
    raise exception 'Account name and slug are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_policy) <> 'object' then
    raise exception 'Blueprint policy must be a JSON object' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('loop-control-platform-bootstrap', 0));
  if exists (select 1 from public.account_memberships) then
    raise exception 'The platform has already been bootstrapped' using errcode = '42501';
  end if;
  insert into public.accounts (name, slug, timezone)
  values (trim(p_account_name), trim(p_account_slug), p_timezone)
  returning * into created_account;
  insert into public.account_blueprint_versions (account_id, version, policy, is_active)
  values (created_account.id, 1, p_policy, true)
  returning * into created_blueprint;
  update public.accounts set current_blueprint_version_id = created_blueprint.id where id = created_account.id returning * into created_account;
  insert into public.account_memberships (account_id, user_id, role) values (created_account.id, auth.uid(), 'owner');
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (created_account.id, 'platform_bootstrapped', jsonb_build_object('blueprint_version_id', created_blueprint.id), auth.uid());
  return created_account;
end;
$$;


--
-- Name: build_prompt_context(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_prompt_context(p_episode_id uuid, p_input_snapshot jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  selected_episode public.episodes;
  blueprint_policy jsonb;
  selected_series_version public.series_versions;
  context jsonb;
begin
  select episode.* into selected_episode from public.episodes episode where episode.id = p_episode_id;
  if not found then raise exception 'Prompt context Episode does not exist' using errcode = 'P0002'; end if;
  select policy into blueprint_policy from public.account_blueprint_versions where id = selected_episode.blueprint_version_id;
  select series_version.* into selected_series_version from public.series_versions series_version where series_version.id = selected_episode.series_version_id and series_version.account_id = selected_episode.account_id;
  context := jsonb_strip_nulls(jsonb_build_object(
    'version', 'prompt-context/v1',
    'blueprint_version_id', selected_episode.blueprint_version_id,
    'series_version_id', selected_series_version.id,
    'account_hard_constraints', jsonb_strip_nulls(jsonb_build_object('approval_gates', blueprint_policy -> 'approval_gates', 'allowed_tools', blueprint_policy -> 'allowed_tools', 'asset_root', blueprint_policy -> 'asset_root', 'restrictions', blueprint_policy -> 'restrictions', 'publishing', blueprint_policy -> 'publishing')),
    'account_defaults', jsonb_strip_nulls(jsonb_build_object('positioning', blueprint_policy -> 'positioning', 'audience', blueprint_policy -> 'audience', 'tone', blueprint_policy -> 'tone', 'brand_voice', blueprint_policy -> 'brand_voice', 'visual_style', blueprint_policy -> 'visual_style', 'subtitle_style', blueprint_policy -> 'subtitle_style', 'language', blueprint_policy -> 'language', 'creative_rules', blueprint_policy -> 'creative_rules')),
    'series_baseline', case when selected_series_version.id is null then null else jsonb_build_object('version_id', selected_series_version.id, 'version', selected_series_version.version, 'rules', selected_series_version.rules) end,
    'episode_input', jsonb_strip_nulls(jsonb_build_object('commission', p_input_snapshot -> 'commission', 'script_revision', p_input_snapshot -> 'script_revision', 'input_artifacts', p_input_snapshot -> 'input_artifacts', 'shot', p_input_snapshot -> 'shot', 'media', p_input_snapshot -> 'media')),
    'review_feedback', p_input_snapshot -> 'review_feedback'
  ));
  return context || jsonb_build_object('hash', md5(context::text));
end;
$$;


--
-- Name: is_valid_acoustic_alignment(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_valid_acoustic_alignment(p_alignment jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare cue jsonb; issue jsonb; issues jsonb := coalesce(p_alignment -> 'reviewIssues', '[]'::jsonb);
begin
  if coalesce(jsonb_typeof(p_alignment), 'null') <> 'object'
    or p_alignment ->> 'version' <> 'acoustic-alignment/v1'
    or p_alignment ->> 'status' not in ('waiting','aligning','completed','needs_review','stale','failed')
    or p_alignment ->> 'method' not in ('none','tts_native','external_text_audio','local_whisperx','manual')
    or p_alignment ->> 'granularity' not in ('none','character','word','phrase')
    or coalesce(p_alignment ->> 'inputVersion','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_alignment ->> 'textFingerprint','') !~ '^[0-9a-f]{64}$'
    or coalesce(jsonb_typeof(p_alignment -> 'wordCount'),'null') <> 'number'
    or coalesce(jsonb_typeof(p_alignment -> 'cues'),'null') <> 'array'
    or jsonb_typeof(issues) <> 'array'
    or coalesce(jsonb_typeof(p_alignment -> 'attempts'),'null') <> 'array' then return false;
  end if;
  if p_alignment ->> 'status' in ('completed','needs_review') and (p_alignment ->> 'method' = 'none' or p_alignment ->> 'granularity' = 'none') then return false; end if;
  if p_alignment ->> 'status' = 'completed' and (jsonb_array_length(p_alignment -> 'cues') = 0 or jsonb_array_length(issues) > 0) then return false; end if;
  if p_alignment ->> 'status' = 'needs_review' and jsonb_array_length(issues) = 0 then return false; end if;
  if p_alignment ->> 'status' = 'failed' and jsonb_array_length(p_alignment -> 'cues') > 0 then return false; end if;
  if jsonb_array_length(p_alignment -> 'cues') <> (p_alignment ->> 'wordCount')::integer then return false; end if;
  for cue in select value from jsonb_array_elements(p_alignment -> 'cues') loop
    if coalesce(cue ->> 'id','') = '' or coalesce(cue ->> 'text','') = '' or coalesce(jsonb_typeof(cue -> 'startMs'),'null') <> 'number' or coalesce(jsonb_typeof(cue -> 'endMs'),'null') <> 'number' or (cue ->> 'startMs')::numeric < 0 or (cue ->> 'endMs')::numeric <= (cue ->> 'startMs')::numeric then return false; end if;
  end loop;
  for issue in select value from jsonb_array_elements(issues) loop
    if issue ->> 'kind' not in ('low_confidence','unmatched_text') or coalesce(issue ->> 'id','') = '' or jsonb_typeof(issue -> 'cueIds') <> 'array' then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$_$;


--
-- Name: is_valid_shot_audio_mix(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_valid_shot_audio_mix(p_mix jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  main_voice jsonb := p_mix -> 'main_voice';
  bgm jsonb := p_mix -> 'bgm';
  sfx jsonb := p_mix -> 'sfx';
begin
  if coalesce(jsonb_typeof(p_mix), 'null') <> 'object'
    or p_mix ->> 'version' <> 'shot-audio-mix/v1'
    or coalesce(jsonb_typeof(main_voice), 'null') <> 'object'
    or main_voice ->> 'mode' not in ('tts', 'source', 'none')
    or main_voice ->> 'role' is distinct from (case when main_voice ->> 'mode' = 'none' then 'none' else 'anchor' end)
    or coalesce(jsonb_typeof(main_voice -> 'gain_db'), 'null') <> 'number'
    or (main_voice ->> 'mode' = 'none' and jsonb_typeof(main_voice -> 'track_id') <> 'null') then return false;
  end if;
  if jsonb_typeof(bgm) <> 'null' and (
    coalesce(bgm ->> 'selection_id', '') = '' or bgm ->> 'role' <> 'follower'
    or bgm ->> 'ducking_level' not in ('off', 'light', 'medium', 'strong')
    or (bgm ->> 'duck_depth_db')::numeric is distinct from (case bgm ->> 'ducking_level' when 'light' then -6 when 'medium' then -10 when 'strong' then -14 else 0 end)
  ) then return false; end if;
  if jsonb_typeof(sfx) <> 'null' and (
    coalesce(sfx ->> 'selection_id', '') = '' or sfx ->> 'role' <> 'independent'
    or coalesce((sfx ->> 'automatic_ducking')::boolean, true)
  ) then return false; end if;
  return true;
exception when others then return false;
end;
$$;


--
-- Name: is_valid_shot_caption_contract(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_valid_shot_caption_contract(p_contract jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  cue jsonb;
  spatial jsonb;
  inset_key text;
begin
  if coalesce(jsonb_typeof(p_contract), 'null') <> 'object'
    or p_contract ->> 'version' <> 'shot-captions/v1'
    or coalesce(jsonb_typeof(p_contract -> 'enabled'), 'null') <> 'boolean'
    or p_contract ->> 'content_mode' not in ('follow_tts', 'independent')
    or coalesce(jsonb_typeof(p_contract -> 'text'), 'null') <> 'string'
    or ((p_contract ->> 'enabled')::boolean and coalesce(btrim(p_contract ->> 'text'), '') = '')
    or coalesce(jsonb_typeof(p_contract -> 'cues'), 'null') <> 'array'
    or coalesce(jsonb_typeof(p_contract -> 'spatial'), 'null') <> 'object' then return false;
  end if;
  spatial := p_contract -> 'spatial';
  if spatial ->> 'anchor' not in ('top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right')
    or coalesce(jsonb_typeof(spatial -> 'max_lines'), 'null') <> 'number'
    or (spatial ->> 'max_lines')::numeric <> trunc((spatial ->> 'max_lines')::numeric)
    or (spatial ->> 'max_lines')::integer not between 1 and 2
    or coalesce(jsonb_typeof(spatial -> 'max_characters_per_line'), 'null') <> 'number'
    or (spatial ->> 'max_characters_per_line')::numeric <> trunc((spatial ->> 'max_characters_per_line')::numeric)
    or (spatial ->> 'max_characters_per_line')::integer not between 1 and 24 then return false;
  end if;
  if spatial ->> 'version' = 'shot-caption-space/v1' then
    if spatial ->> 'safe_area' not in ('title-safe', 'action-safe') then return false; end if;
  elsif spatial ->> 'version' = 'shot-caption-space/v2' then
    if spatial ->> 'safe_area' not in ('title-safe', 'action-safe', 'custom')
      or spatial ->> 'aspect_ratio' not in ('9:16', '16:9', '1:1')
      or coalesce(jsonb_typeof(spatial -> 'insets'), 'null') <> 'object' then return false;
    end if;
    foreach inset_key in array array['top', 'right', 'bottom', 'left'] loop
      if coalesce(jsonb_typeof(spatial -> 'insets' -> inset_key), 'null') <> 'number'
        or (spatial #>> array['insets', inset_key])::numeric not between 0 and 0.4 then return false;
      end if;
    end loop;
    if (spatial #>> '{insets,left}')::numeric + (spatial #>> '{insets,right}')::numeric >= 1
      or (spatial #>> '{insets,top}')::numeric + (spatial #>> '{insets,bottom}')::numeric >= 1 then return false;
    end if;
  else
    return false;
  end if;
  for cue in select value from jsonb_array_elements(p_contract -> 'cues') loop
    if coalesce(jsonb_typeof(cue), 'null') <> 'object'
      or coalesce(cue ->> 'id', '') = ''
      or coalesce(jsonb_typeof(cue -> 'text'), 'null') <> 'string'
      or coalesce(jsonb_typeof(cue -> 'start_ms'), 'null') <> 'number'
      or coalesce(jsonb_typeof(cue -> 'end_ms'), 'null') <> 'number'
      or (cue ->> 'start_ms')::numeric < 0
      or (cue ->> 'end_ms')::numeric <= (cue ->> 'start_ms')::numeric then return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;


--
-- Name: is_valid_shot_composition(jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_valid_shot_composition(p_composition jsonb, p_clip_segment_count integer) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  expected_slots text[];
  slot jsonb;
  slot_index integer := 0;
begin
  if coalesce(jsonb_typeof(p_composition), 'null') <> 'object'
    or coalesce(p_composition ->> 'version', '') <> 'shot-composition/v1'
    or coalesce(jsonb_typeof(p_composition -> 'slots'), 'null') <> 'array' then return false;
  end if;
  expected_slots := case p_composition ->> 'layout'
    when 'full' then array['full']
    when '2up-horizontal' then array['left', 'right']
    when '2up-vertical' then array['top', 'bottom']
    when 'pip' then array['main', 'inset']
    when 'grid-4' then array['top-left', 'top-right', 'bottom-left', 'bottom-right']
    else null
  end;
  if expected_slots is null or jsonb_array_length(p_composition -> 'slots') <> cardinality(expected_slots) then return false; end if;
  for slot in select value from jsonb_array_elements(p_composition -> 'slots') loop
    slot_index := slot_index + 1;
    if coalesce(jsonb_typeof(slot), 'null') <> 'object'
      or coalesce(slot ->> 'id', '') <> expected_slots[slot_index]
      or coalesce(slot ->> 'fit', '') not in ('cover', 'contain')
      or coalesce(jsonb_typeof(slot -> 'clipSegmentIndex'), 'null') <> 'number'
      or (slot ->> 'clipSegmentIndex')::numeric <> trunc((slot ->> 'clipSegmentIndex')::numeric)
      or (slot ->> 'clipSegmentIndex')::integer < 0
      or (slot ->> 'clipSegmentIndex')::integer >= greatest(p_clip_segment_count, 1)
      or coalesce(jsonb_typeof(slot -> 'focalPoint'), 'null') <> 'object'
      or coalesce(jsonb_typeof(slot #> '{focalPoint,x}'), 'null') <> 'number'
      or coalesce(jsonb_typeof(slot #> '{focalPoint,y}'), 'null') <> 'number'
      or (slot #>> '{focalPoint,x}')::numeric not between 0 and 1
      or (slot #>> '{focalPoint,y}')::numeric not between 0 and 1 then return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;


--
-- Name: shot_preparation_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shot_preparation_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    review_package_id uuid NOT NULL,
    shot_id text NOT NULL,
    audio_mode text DEFAULT 'tts'::text NOT NULL,
    video_status text DEFAULT 'pending'::text NOT NULL,
    audio_status text DEFAULT 'pending'::text NOT NULL,
    confirmation_status text DEFAULT 'pending'::text NOT NULL,
    subtitle_text text NOT NULL,
    subtitles_enabled boolean DEFAULT true NOT NULL,
    tts_voice text,
    tts_speaking_rate numeric(5,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tts_text text,
    tts_language_code text,
    current_audio_track_id uuid,
    current_tts_task_id uuid,
    pending_tts_task_id uuid,
    tts_actual_duration_seconds numeric,
    tts_error text,
    selected_material_revision_id uuid,
    clip_start_seconds numeric(12,3),
    clip_end_seconds numeric(12,3),
    current_video_artifact_id uuid,
    current_video_task_id uuid,
    pending_video_task_id uuid,
    video_error text,
    source_audio_duration_seconds numeric,
    source_audio_error text,
    pending_source_audio_task_id uuid,
    video_duration_seconds numeric,
    warning_decision text DEFAULT 'not_required'::text NOT NULL,
    warning_reason text,
    warning_accepted_at timestamp with time zone,
    warning_accepted_by uuid,
    confirmation_reason text,
    confirmed_at timestamp with time zone,
    confirmed_by uuid,
    skipped_at timestamp with time zone,
    skipped_by uuid,
    input_fingerprint text,
    clip_segments jsonb DEFAULT '[]'::jsonb NOT NULL,
    frozen_at timestamp with time zone,
    frozen_by uuid,
    tts_override_voice text,
    tts_override_speaking_rate numeric(5,2),
    tts_text_confirmation_fingerprint text,
    tts_text_confirmed_at timestamp with time zone,
    tts_text_confirmed_by uuid,
    composition jsonb DEFAULT '{"slots": [{"id": "full", "fit": "cover", "focalPoint": {"x": 0.5, "y": 0.5}, "clipSegmentIndex": 0}], "layout": "full", "version": "shot-composition/v1"}'::jsonb NOT NULL,
    caption_contract jsonb NOT NULL,
    preparation_contract jsonb NOT NULL,
    preparation_input_fingerprint text NOT NULL,
    acoustic_alignment jsonb,
    pending_alignment_task_id uuid,
    bgm_ducking_level text DEFAULT 'off'::text NOT NULL,
    transition_mode text DEFAULT 'cut'::text NOT NULL,
    preview_status text DEFAULT 'pending'::text NOT NULL,
    current_preview_artifact_id uuid,
    current_preview_project_artifact_id uuid,
    current_preview_task_id uuid,
    current_preview_input_fingerprint text,
    pending_preview_task_id uuid,
    preview_error text,
    preparation_contract_status text DEFAULT 'current'::text NOT NULL,
    source_video_duration_seconds numeric,
    CONSTRAINT shot_preparation_drafts_acoustic_alignment_check CHECK (((acoustic_alignment IS NULL) OR public.is_valid_acoustic_alignment(acoustic_alignment))),
    CONSTRAINT shot_preparation_drafts_audio_mix_contract_check CHECK (public.is_valid_shot_audio_mix((preparation_contract -> 'audio_mix'::text))),
    CONSTRAINT shot_preparation_drafts_audio_mode_check CHECK ((audio_mode = ANY (ARRAY['tts'::text, 'source'::text, 'none'::text]))),
    CONSTRAINT shot_preparation_drafts_audio_status_check CHECK ((audio_status = ANY (ARRAY['pending'::text, 'running'::text, 'ready'::text, 'failed'::text]))),
    CONSTRAINT shot_preparation_drafts_bgm_ducking_level_check CHECK ((bgm_ducking_level = ANY (ARRAY['off'::text, 'light'::text, 'medium'::text, 'strong'::text]))),
    CONSTRAINT shot_preparation_drafts_caption_contract_check CHECK (public.is_valid_shot_caption_contract(caption_contract)),
    CONSTRAINT shot_preparation_drafts_clip_segments_check CHECK ((jsonb_typeof(clip_segments) = 'array'::text)),
    CONSTRAINT shot_preparation_drafts_composition_check CHECK (public.is_valid_shot_composition(composition, 2147483647)),
    CONSTRAINT shot_preparation_drafts_confirmation_status_check CHECK ((confirmation_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'skipped'::text]))),
    CONSTRAINT shot_preparation_drafts_preparation_contract_status_check CHECK ((preparation_contract_status = ANY (ARRAY['current'::text, 'needs_upgrade'::text]))),
    CONSTRAINT shot_preparation_drafts_preparation_input_fingerprint_check CHECK (((preparation_input_fingerprint ~ '^[0-9a-f]{32}$'::text) AND ((preparation_contract ->> 'input_fingerprint'::text) = preparation_input_fingerprint))),
    CONSTRAINT shot_preparation_drafts_preview_fingerprint_check CHECK (((current_preview_input_fingerprint IS NULL) OR (current_preview_input_fingerprint ~ '^[0-9a-f]{32}$'::text))),
    CONSTRAINT shot_preparation_drafts_preview_status_check CHECK ((preview_status = ANY (ARRAY['pending'::text, 'running'::text, 'ready'::text, 'failed'::text]))),
    CONSTRAINT shot_preparation_drafts_shot_id_check CHECK ((char_length(btrim(shot_id)) > 0)),
    CONSTRAINT shot_preparation_drafts_source_video_duration_check CHECK (((source_video_duration_seconds IS NULL) OR ((source_video_duration_seconds > (0)::numeric) AND (source_video_duration_seconds <= (86400)::numeric)))),
    CONSTRAINT shot_preparation_drafts_subtitle_text_check CHECK (((NOT subtitles_enabled) OR (char_length(btrim(subtitle_text)) > 0))),
    CONSTRAINT shot_preparation_drafts_transition_mode_check CHECK ((transition_mode = ANY (ARRAY['cut'::text, 'fade'::text, 'studio'::text]))),
    CONSTRAINT shot_preparation_drafts_video_status_check CHECK ((video_status = ANY (ARRAY['pending'::text, 'running'::text, 'ready'::text, 'failed'::text]))),
    CONSTRAINT shot_preparation_drafts_warning_decision_check CHECK ((warning_decision = ANY (ARRAY['not_required'::text, 'accepted'::text])))
);


--
-- Name: COLUMN shot_preparation_drafts.preparation_contract_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.shot_preparation_drafts.preparation_contract_status IS 'current means the Owner saved the complete v1 shot contract after the cutover; needs_upgrade keeps pre-cutover rows readable without treating compatibility defaults as new acceptance evidence.';


--
-- Name: COLUMN shot_preparation_drafts.source_video_duration_seconds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.shot_preparation_drafts.source_video_duration_seconds IS 'Duration of the approved source video. This bounds source ranges and is distinct from video_duration_seconds, the composed shot playback duration.';


--
-- Name: build_shot_audio_mix(public.shot_preparation_drafts); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_shot_audio_mix(p_draft public.shot_preparation_drafts) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  bgm public.storyboard_audio_selections;
  sfx public.storyboard_audio_selections;
  effective_ducking text;
  duck_depth numeric;
begin
  select selection.* into bgm
  from public.storyboard_audio_selections selection
  where selection.episode_id = p_draft.episode_id
    and selection.review_package_id = p_draft.review_package_id
    and selection.target_kind = 'episode'
    and selection.target_id = p_draft.episode_id::text
    and selection.audio_kind = 'bgm'
    and (selection.cue_id is not null or selection.material_revision_id is not null);

  select selection.* into sfx
  from public.storyboard_audio_selections selection
  where selection.episode_id = p_draft.episode_id
    and selection.review_package_id = p_draft.review_package_id
    and selection.target_kind = 'shot'
    and selection.target_id = p_draft.shot_id
    and selection.audio_kind = 'sfx'
    and (selection.cue_id is not null or selection.material_revision_id is not null);

  effective_ducking := case when bgm.id is null or p_draft.audio_mode = 'none' then 'off' else p_draft.bgm_ducking_level end;
  duck_depth := case effective_ducking when 'light' then -6 when 'medium' then -10 when 'strong' then -14 else 0 end;

  return jsonb_build_object(
    'version', 'shot-audio-mix/v1',
    'main_voice', jsonb_build_object(
      'mode', p_draft.audio_mode,
      'track_id', case when p_draft.audio_mode = 'none' then null else p_draft.current_audio_track_id end,
      'gain_db', 0,
      'role', case when p_draft.audio_mode = 'none' then 'none' else 'anchor' end
    ),
    'bgm', case when bgm.id is null then null else jsonb_build_object(
      'selection_id', bgm.id,
      'cue_id', bgm.cue_id,
      'material_revision_id', bgm.material_revision_id,
      'gain_db', -12,
      'role', 'follower',
      'ducking_level', effective_ducking,
      'duck_depth_db', duck_depth
    ) end,
    'sfx', case when sfx.id is null then null else jsonb_build_object(
      'selection_id', sfx.id,
      'cue_id', sfx.cue_id,
      'material_revision_id', sfx.material_revision_id,
      'gain_db', -6,
      'role', 'independent',
      'automatic_ducking', false
    ) end
  );
end;
$$;


--
-- Name: build_shot_preparation_contract(public.shot_preparation_drafts); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_shot_preparation_contract(p_draft public.shot_preparation_drafts) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  base jsonb;
begin
  base := jsonb_build_object(
    'version', 'shot-preparation/v1',
    'storyboard_fingerprint', p_draft.input_fingerprint,
    'source_material_revision_id', p_draft.selected_material_revision_id,
    'clip_segments', p_draft.clip_segments,
    'composition', p_draft.composition,
    'transition_mode', p_draft.transition_mode,
    'audio_mode', p_draft.audio_mode,
    'audio_track_id', case when p_draft.audio_mode = 'none' then null else p_draft.current_audio_track_id end,
    'tts_text', p_draft.tts_text,
    'tts_voice', p_draft.tts_voice,
    'tts_speaking_rate', p_draft.tts_speaking_rate,
    'audio_mix', public.build_shot_audio_mix(p_draft),
    'captions', p_draft.caption_contract,
    'acoustic_alignment', p_draft.acoustic_alignment
  );
  return base || jsonb_build_object('input_fingerprint', md5(base::text));
end;
$$;


--
-- Name: canonical_storyboard_structure_revision_operation(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_storyboard_structure_revision_operation(p_operation jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
begin
  case p_operation ->> 'kind'
    when 'add_after' then
      return p_operation || jsonb_build_object('shot', coalesce(p_operation -> 'shot', '{}'::jsonb) - 'id' - 'inputBasis');
    when 'split' then
      return p_operation || jsonb_build_object('parts', coalesce((
        select jsonb_agg(value - 'id' order by ordinality)
        from jsonb_array_elements(coalesce(p_operation -> 'parts', '[]'::jsonb)) with ordinality as part(value, ordinality)
      ), '[]'::jsonb));
    when 'merge' then
      return p_operation - 'newShotId';
    else
      return p_operation;
  end case;
end;
$$;


--
-- Name: claim_next_worker_task(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_next_worker_task(p_task_id uuid DEFAULT NULL::uuid, p_worker_capacity integer DEFAULT 1) RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb, lease_token uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare claimed record; token uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Worker service role is required' using errcode='42501'; end if;
  -- The private claimant invokes independent recovery before selecting ready rows.
  for claimed in select * from public.claim_next_worker_task_pre_lease(p_task_id,p_worker_capacity) loop
    token := gen_random_uuid();
    update public.tasks set lease_token=token where id=claimed.task_id;
    update public.task_runs set lease_token=token,task_package=task_package || jsonb_build_object('lease_token',token)
      where task_runs.task_id=claimed.task_id and task_runs.attempt=claimed.attempt;
    return query select claimed.task_id,claimed.task_type,claimed.attempt,claimed.budget_limit_cents,claimed.max_attempts,claimed.provider,claimed.model,claimed.prompt_version,claimed.episode_id,claimed.account_id,claimed.blueprint_version_id,claimed.title,claimed.allowed_asset_root,claimed.input_snapshot,token;
  end loop;
end $$;


--
-- Name: claim_next_worker_task_legacy(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_next_worker_task_legacy(p_task_id uuid DEFAULT NULL::uuid) RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare selected_task public.tasks;
begin
  select * into selected_task from public.tasks task where task.status = 'ready' and task.provider in ('codex','google_tts','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','cloudflare','whisperx') and task.attempt < task.max_attempts and (p_task_id is null or task.id = p_task_id) order by task.created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.tasks task set status = 'running', claimed_at = now(), attempt = task.attempt + 1 where task.id = selected_task.id;
  insert into public.task_runs (task_id,attempt,task_package)
  select selected_task.id, selected_task.attempt, jsonb_build_object('version','worker-task/v1','task_id',selected_task.id,'task_type',selected_task.task_type,'attempt',selected_task.attempt,'budget_limit_cents',selected_task.budget_limit_cents,'max_attempts',selected_task.max_attempts,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'episode_id',episode.id,'account_id',account.id,'blueprint_version_id',episode.blueprint_version_id,'allowed_asset_root',coalesce(blueprint.policy ->> 'asset_root',''),'input_snapshot',selected_task.input_snapshot || jsonb_build_object('prompt_context', coalesce(selected_task.input_snapshot -> 'prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot))))
  from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
  return query select selected_task.id,selected_task.task_type,selected_task.attempt,selected_task.budget_limit_cents,selected_task.max_attempts,selected_task.provider,selected_task.model,selected_task.prompt_version,episode.id,account.id,episode.blueprint_version_id,episode.title,coalesce(blueprint.policy ->> 'asset_root',''),selected_task.input_snapshot || jsonb_build_object('prompt_context', coalesce(selected_task.input_snapshot -> 'prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot))) from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
end;
$$;


--
-- Name: claim_next_worker_task_pre_lease(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_next_worker_task_pre_lease(p_task_id uuid DEFAULT NULL::uuid, p_worker_capacity integer DEFAULT 1) RETURNS TABLE(task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  candidate public.tasks;
  runtime jsonb;
  running_count integer;
  resource jsonb; next_turn bigint;
begin
  if p_worker_capacity is null or p_worker_capacity <= 0 then
    raise exception 'Worker capacity must be a positive integer' using errcode = '22023';
  end if;

  -- One durable host limit, shared by every HTTP/CLI process. Caller capacity
  -- may lower this invocation's limit but cannot raise the configured ceiling.
  perform pg_advisory_xact_lock(hashtextextended('loop-worker-global-capacity',0));
  perform public.recover_expired_worker_tasks();
  select least(p_worker_capacity, capacity) into p_worker_capacity
    from public.worker_scheduler_settings where singleton for update;
  if not found then raise exception 'Worker scheduler capacity is not configured' using errcode='55000'; end if;
  if (select count(*) from public.tasks where status='running'
      and claimed_at > clock_timestamp()-interval '30 minutes') >= p_worker_capacity then return; end if;

  for candidate in
    select task.*
    from public.tasks task left join public.worker_episode_turns turns on turns.episode_id=task.episode_id
    where task.status = 'ready' and task.invalidated_at is null and task.available_at <= clock_timestamp()
      and task.provider in ('codex','google_tts','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','cloudflare','whisperx')
      and task.attempt < task.max_attempts
      and (p_task_id is null or task.id = p_task_id)
    order by (select count(*) from public.tasks busy where busy.episode_id=task.episode_id and busy.status='running' and busy.claimed_at>clock_timestamp()-interval '30 minutes'), coalesce(turns.last_turn,0), task.created_at, task.id
    for update of task skip locked
  loop
    runtime := public.worker_runtime_constraints(candidate.input_snapshot, p_worker_capacity);
    runtime := runtime || jsonb_build_object('resource_limits',public.worker_resource_limits(candidate.input_snapshot,p_worker_capacity),
      'effective_concurrency',least((runtime->>'effective_concurrency')::integer,
        (select min((r->>'limit')::integer) from jsonb_array_elements(public.worker_resource_limits(candidate.input_snapshot,p_worker_capacity)) r)));
    -- All claimants take global -> recovery -> sorted resource locks. No lock
    -- is held across execution. Skip a saturated resource and try other Episodes.
    running_count:=0;
    for resource in select value from jsonb_array_elements(public.worker_resource_limits(candidate.input_snapshot,p_worker_capacity)) order by value->>'key'
    loop
      perform pg_advisory_xact_lock(hashtextextended(resource->>'key',0));
      select count(*) into running_count from public.tasks task
      where task.status='running' and task.claimed_at>clock_timestamp()-interval '30 minutes'
        and exists(select 1 from jsonb_array_elements(public.worker_resource_limits(task.input_snapshot,p_worker_capacity)) r where r->>'key'=resource->>'key');
      if running_count >= (resource->>'limit')::integer then exit; end if;
    end loop;
    if running_count >= (resource->>'limit')::integer then continue; end if;

    update public.tasks task
    set input_snapshot = candidate.input_snapshot || jsonb_build_object(
      'runtime_constraints', runtime,
      'allowed_tools', public.worker_required_tools(candidate.input_snapshot ->> 'capability')
    )
    where task.id = candidate.id;
    return query select * from public.claim_next_worker_task_legacy(candidate.id);
    update public.worker_scheduler_settings set turn=turn+1 where singleton returning turn into next_turn;
    insert into public.worker_episode_turns(episode_id,last_turn) values(candidate.episode_id,next_turn)
      on conflict on constraint worker_episode_turns_pkey do update set last_turn=excluded.last_turn;
    return;
  end loop;
end;
$$;


--
-- Name: claim_notification_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_notification_event() RETURNS TABLE(id uuid, created_at timestamp with time zone, event_type text, payload jsonb, delivery_token uuid)
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 if not (select initialized from public.notification_delivery_state where singleton) then raise exception 'Notification delivery is not initialized'; end if;
 return query with candidate as (
  select d.event_id from public.notification_delivery_events d where d.outcome='pending' order by d.event_id for update skip locked limit 1
 ), reserved as (
  update public.notification_delivery_events d set outcome='reserved',delivery_token=gen_random_uuid(),reserved_at=clock_timestamp()
  from candidate c where d.event_id=c.event_id returning d.event_id,d.delivery_token
 ) select a.id,a.created_at,a.event_type,a.payload,r.delivery_token from reserved r join public.audit_events a on a.id=r.event_id;
end $$;


--
-- Name: clip_segment_union_duration(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clip_segment_union_duration(p_clip_segments jsonb) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  segment jsonb;
  segment_start numeric;
  segment_end numeric;
  current_start numeric;
  current_end numeric;
  total_duration numeric := 0;
begin
  if p_clip_segments is null or jsonb_typeof(p_clip_segments) <> 'array' then
    return 0;
  end if;

  for segment in
    select value
    from jsonb_array_elements(p_clip_segments)
    where jsonb_typeof(value) = 'object'
    order by
      case when jsonb_typeof(value -> 'start_seconds') = 'number' then (value ->> 'start_seconds')::numeric end,
      case when jsonb_typeof(value -> 'end_seconds') = 'number' then (value ->> 'end_seconds')::numeric end
  loop
    if jsonb_typeof(segment -> 'start_seconds') <> 'number'
      or jsonb_typeof(segment -> 'end_seconds') <> 'number'
    then
      continue;
    end if;
    segment_start := (segment ->> 'start_seconds')::numeric;
    segment_end := (segment ->> 'end_seconds')::numeric;
    if segment_end <= segment_start then
      continue;
    end if;

    if current_start is null then
      current_start := segment_start;
      current_end := segment_end;
    elsif segment_start <= current_end then
      current_end := greatest(current_end, segment_end);
    else
      total_duration := total_duration + current_end - current_start;
      current_start := segment_start;
      current_end := segment_end;
    end if;
  end loop;

  if current_start is not null then
    total_duration := total_duration + current_end - current_start;
  end if;
  return total_duration;
end;
$$;


--
-- Name: FUNCTION clip_segment_union_duration(p_clip_segments jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.clip_segment_union_duration(p_clip_segments jsonb) IS 'Returns the union duration of source clip intervals so overlapping ranges are counted once.';


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    task_type text NOT NULL,
    status public.task_status DEFAULT 'ready'::public.task_status NOT NULL,
    input_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    budget_limit_cents integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    provider text DEFAULT 'codex'::text NOT NULL,
    model text DEFAULT 'gpt-5.6-terra'::text NOT NULL,
    prompt_version text DEFAULT 'brief-v1'::text NOT NULL,
    claimed_at timestamp with time zone,
    completed_at timestamp with time zone,
    actual_cost_cents integer,
    last_result jsonb,
    invalidated_at timestamp with time zone,
    invalidated_reason text,
    lease_token uuid,
    available_at timestamp with time zone DEFAULT '-infinity'::timestamp with time zone NOT NULL,
    CONSTRAINT tasks_actual_cost_cents_nonnegative CHECK (((actual_cost_cents IS NULL) OR (actual_cost_cents >= 0))),
    CONSTRAINT tasks_attempt_check CHECK ((attempt >= 0)),
    CONSTRAINT tasks_budget_limit_cents_check CHECK (((budget_limit_cents IS NULL) OR (budget_limit_cents >= 0))),
    CONSTRAINT tasks_invalidation_reason_check CHECK ((((invalidated_at IS NULL) AND (invalidated_reason IS NULL)) OR ((invalidated_at IS NOT NULL) AND (btrim(COALESCE(invalidated_reason, ''::text)) <> ''::text)))),
    CONSTRAINT tasks_max_attempts_check CHECK ((max_attempts > 0)),
    CONSTRAINT tasks_task_type_check CHECK ((task_type = ANY (ARRAY['draft_brief'::text, 'draft_script'::text, 'prepare_visual_brief'::text, 'draft_storyboard'::text, 'draft_storyboard_revision'::text, 'generate_a_roll'::text, 'generate_b_roll'::text, 'generate_narration'::text, 'align_shot_captions'::text, 'extract_embedded_audio'::text, 'generate_soundtrack'::text, 'generate_review_render'::text, 'generate_shot_sync_preview'::text, 'generate_final_render'::text, 'prepare_publish_package'::text, 'verify_publish_package'::text, 'register_publish_input'::text])))
);


--
-- Name: commission_script(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.commission_script(p_episode_id uuid, p_creative_direction text, p_core_content text) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  current_episode public.episodes;
  blueprint_policy jsonb;
  selected_harness public.prompt_versions;
  allowed_tools jsonb;
  budget_limit integer;
  adapter text;
  harness_id_text text;
  executor_model text;
  task_snapshot jsonb;
  created_task public.tasks;
begin
  if coalesce(btrim(p_creative_direction), '') = '' or coalesce(btrim(p_core_content), '') = '' then
    raise exception 'Creative direction and core content are required' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then
    raise exception 'Owner membership is required to commission a script' using errcode = '42501';
  end if;
  if current_episode.stage <> 'waiting_input' or current_episode.main_script_revision_id is not null then
    raise exception 'Only an episode waiting for its main script can commission script writing' using errcode = '22023';
  end if;
  if exists (select 1 from public.tasks where episode_id = p_episode_id and task_type = 'draft_script') then
    raise exception 'A script commission already exists for this episode' using errcode = '22023';
  end if;

  select policy into blueprint_policy from public.account_blueprint_versions where id = current_episode.blueprint_version_id;
  if jsonb_typeof(blueprint_policy -> 'allowed_tools') <> 'array'
    or jsonb_array_length(blueprint_policy -> 'allowed_tools') = 0
    or exists (
      select 1 from jsonb_array_elements(blueprint_policy -> 'allowed_tools') tool
      where jsonb_typeof(tool) <> 'string' or coalesce(btrim(tool #>> '{}'), '') = ''
    ) then
    raise exception 'Blueprint % has invalid allowed_tools', current_episode.blueprint_version_id using errcode = '22023';
  end if;
  if jsonb_typeof(blueprint_policy #> '{budgets,script_writing_cents}') <> 'number'
    or blueprint_policy #>> '{budgets,script_writing_cents}' !~ '^[0-9]+$' then
    raise exception 'Blueprint % has invalid script writing budget', current_episode.blueprint_version_id using errcode = '22023';
  end if;

  adapter := nullif(btrim(blueprint_policy #>> '{executors,script_writing,adapter}'), '');
  if adapter is null and blueprint_policy #>> '{executors,script_writing,provider}' = 'codex' then adapter := 'codex'; end if;
  executor_model := nullif(btrim(blueprint_policy #>> '{executors,script_writing,model}'), '');
  if adapter <> 'codex' or executor_model is null then
    raise exception 'Blueprint % must select a registered Codex script Harness and model', current_episode.blueprint_version_id using errcode = '22023';
  end if;

  harness_id_text := nullif(btrim(blueprint_policy #>> '{executors,script_writing,harness_id}'), '');
  if harness_id_text is not null then
    if harness_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Blueprint % has an invalid script Harness id', current_episode.blueprint_version_id using errcode = '22023';
    end if;
    select harness.* into selected_harness
    from public.prompt_versions harness
    where harness.id = harness_id_text::uuid
      and harness.account_id = current_episode.account_id
      and harness.capability = 'script_writing'
      and harness.is_active;
  elsif blueprint_policy #>> '{executors,script_writing,provider}' = 'codex'
    and coalesce(btrim(blueprint_policy #>> '{executors,script_writing,prompt_version}'), '') <> '' then
    select harness.* into selected_harness
    from public.prompt_versions harness
    where harness.account_id = current_episode.account_id
      and harness.capability = 'script_writing'
      and harness.slug = blueprint_policy #>> '{executors,script_writing,prompt_version}'
      and harness.is_active;
  end if;
  if not found then
    raise exception 'Blueprint % must select an active script Harness from its account', current_episode.blueprint_version_id using errcode = '22023';
  end if;
  if coalesce(btrim(selected_harness.instructions), '') = '' then
    raise exception 'Selected script Harness content is empty' using errcode = '22023';
  end if;

  allowed_tools := blueprint_policy -> 'allowed_tools';
  budget_limit := (blueprint_policy #>> '{budgets,script_writing_cents}')::integer;
  task_snapshot := jsonb_build_object(
    'capability', 'script_writing',
    'commission', jsonb_build_object(
      'creative_direction', btrim(p_creative_direction),
      'core_content', btrim(p_core_content)
    ),
    'harness', jsonb_build_object(
      'id', selected_harness.id,
      'version', selected_harness.version,
      'content', selected_harness.instructions,
      'content_hash', selected_harness.content_hash,
      'adapter', 'codex',
      'model', executor_model,
      'prompt_version', selected_harness.slug
    ),
    'executor', jsonb_build_object(
      'provider', 'codex',
      'adapter', 'codex',
      'model', executor_model,
      'prompt_version', selected_harness.slug
    ),
    'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', 2),
    'allowed_tools', allowed_tools,
    'output', jsonb_build_object(
      'required_artifact_types', jsonb_build_array('script'),
      'content_type', 'text/markdown',
      'relative_path', format('episodes/%s/generated-script-v1.md', current_episode.id),
      'review_stage', 'script_review'
    ),
    'input_artifacts', '[]'::jsonb
  );
  task_snapshot := task_snapshot || jsonb_build_object(
    'prompt_context', public.build_prompt_context(current_episode.id, task_snapshot)
  );

  update public.episodes
  set script_source = 'delegated', updated_at = now()
  where id = current_episode.id;

  insert into public.tasks (
    episode_id, task_type, status, input_snapshot, budget_limit_cents,
    max_attempts, provider, model, prompt_version
  ) values (
    current_episode.id,
    'draft_script',
    'ready',
    task_snapshot,
    budget_limit,
    2,
    'codex',
    executor_model,
    selected_harness.slug
  ) returning * into created_task;

  update public.episodes set stage = 'script_draft', updated_at = now() where id = current_episode.id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (current_episode.id, 'waiting_input', 'script_draft', 'Owner froze creative direction, episode prompt, and Harness for script writing.', auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    current_episode.id,
    'script_commissioned',
    jsonb_build_object(
      'task_id', created_task.id,
      'creative_direction', btrim(p_creative_direction),
      'core_content', btrim(p_core_content),
      'harness_id', selected_harness.id,
      'harness_version', selected_harness.version,
      'harness_content_hash', selected_harness.content_hash
    ),
    auth.uid()
  );
  return created_task;
end;
$_$;


--
-- Name: confirm_frozen_shot_when_ready(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_frozen_shot_when_ready() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare current_episode public.episodes; selected_shot jsonb; delta numeric;
begin
  if new.frozen_at is null or new.confirmation_status = 'confirmed' or new.video_status <> 'ready'
    or (new.audio_mode <> 'none' and new.audio_status <> 'ready') then return new; end if;
  if not exists (select 1 from public.tasks task join public.artifacts artifact on artifact.producer_task_id = task.id
    where task.id = new.current_video_task_id and artifact.id = new.current_video_artifact_id and task.status = 'completed' and task.invalidated_at is null) then return new; end if;
  if new.audio_mode <> 'none' and not exists (select 1 from public.audio_tracks track join public.tasks task on task.id = track.source_task_id
    where track.id = new.current_audio_track_id and task.status = 'completed' and task.invalidated_at is null) then return new; end if;
  select episode.* into current_episode from public.episodes episode where episode.id = new.episode_id;
  select shot.value into selected_shot from public.review_packages package,
    lateral jsonb_array_elements(coalesce(package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
    where package.id = new.review_package_id and shot.value ->> 'id' = new.shot_id;
  delta := new.video_duration_seconds - (selected_shot ->> 'durationSeconds')::numeric;
  update public.shot_preparation_drafts set confirmation_status = 'confirmed', confirmation_reason = 'Owner froze all shot drafts for generation.',
    confirmed_at = now(), confirmed_by = new.frozen_by,
    warning_decision = case when abs(delta) > 0.05 then 'accepted' else 'not_required' end,
    warning_reason = case when abs(delta) > 0.05 then 'Actual clip duration accepted instead of storyboard suggestion.' else null end,
    warning_accepted_at = case when abs(delta) > 0.05 then now() else null end,
    warning_accepted_by = case when abs(delta) > 0.05 then new.frozen_by else null end,
    updated_at = now() where id = new.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, new.episode_id, 'frozen_shot_preparation_completed', jsonb_build_object('review_package_id', new.review_package_id, 'shot_id', new.shot_id, 'duration_seconds', new.video_duration_seconds), new.frozen_by);
  return new;
end;
$$;


--
-- Name: confirm_shot_preparation(uuid, uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_shot_preparation(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_reason text, p_warning_accepted boolean DEFAULT false) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  draft public.shot_preparation_drafts;
  selected_shot jsonb;
  video_task public.tasks;
  video_artifact public.artifacts;
  audio_task public.tasks;
  current_track public.audio_tracks;
  video_duration numeric;
  audio_duration numeric;
  video_delta numeric;
  audio_delta numeric;
  has_warning boolean;
  decision text;
  duration_settings jsonb;
  duration_decision jsonb;
  saved_draft public.shot_preparation_drafts;
begin
  if coalesce(btrim(p_shot_id), '') = '' or coalesce(btrim(p_reason), '') = '' then
    raise exception 'Shot confirmation reason and shot id are required' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
  if not found then raise exception 'Owner membership is required to confirm a shot' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Shots can only be confirmed in the shot workbench' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the approved storyboard' using errcode = '22023'; end if;

  select * into draft from public.shot_preparation_drafts
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id)
  for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.confirmation_status = 'confirmed' then return draft; end if;
  if draft.subtitle_text is null or btrim(draft.subtitle_text) = '' then raise exception 'Subtitle decision is required' using errcode = '22023'; end if;

  select task.* into video_task
  from public.tasks task
  where task.id = draft.current_video_task_id and task.episode_id = p_episode_id and task.status = 'completed' and task.invalidated_at is null;
  select artifact.* into video_artifact
  from public.artifacts artifact
  where artifact.id = draft.current_video_artifact_id and artifact.producer_task_id = draft.current_video_task_id and artifact.sha256 is not null and artifact.file_size > 0;
  if not found or video_task.id is null or draft.video_status <> 'ready' then raise exception 'A current validated prepared video is required' using errcode = '22023'; end if;
  video_duration := coalesce(draft.video_duration_seconds, draft.clip_end_seconds - draft.clip_start_seconds);
  if video_duration is null or video_duration <= 0 then raise exception 'Prepared video duration is required' using errcode = '22023'; end if;

  if draft.audio_mode = 'none' then
    audio_duration := null;
  elsif draft.audio_mode = 'source' then
    audio_duration := video_duration;
  else
    select track.* into current_track
    from public.audio_tracks track
    where track.id = draft.current_audio_track_id and track.episode_id = p_episode_id and track.cue_id = draft.shot_id and track.source_review_package_id = p_review_package_id
      and ((draft.audio_mode = 'tts' and track.track_kind = 'narration') or (draft.audio_mode = 'source' and track.track_kind = 'source'));
    if not found or draft.audio_status <> 'ready' then raise exception 'The current selected audio track is required' using errcode = '22023'; end if;
    select task.* into audio_task from public.tasks task where task.id = current_track.source_task_id and task.status = 'completed' and task.invalidated_at is null;
    if not found or (draft.audio_mode = 'tts' and audio_task.task_type <> 'generate_narration') or (draft.audio_mode = 'source' and (audio_task.task_type <> 'extract_embedded_audio' or audio_task.input_snapshot #>> '{source_video_artifact,id}' <> draft.current_video_artifact_id::text)) then
      raise exception 'The current audio task is not valid for this shot' using errcode = '22023';
    end if;
    if draft.audio_mode = 'tts' and audio_task.input_snapshot #>> '{media,narration,text}' <> draft.tts_text then raise exception 'The current TTS text is stale' using errcode = '22023'; end if;
    audio_duration := current_track.duration_seconds;
  end if;

  duration_settings := public.shot_duration_settings(p_episode_id);
  duration_decision := public.shot_duration_decision(draft.audio_mode, audio_duration, video_duration, (selected_shot ->> 'durationSeconds')::numeric, (duration_settings ->> 'frame_rate')::numeric, (duration_settings ->> 'allowed_frames')::integer, video_duration);
  video_delta := (duration_decision ->> 'plan_delta_seconds')::numeric;
  audio_delta := (duration_decision ->> 'audio_video_delta_seconds')::numeric;
  has_warning := (duration_decision ->> 'status') = 'needs_attention';
  if has_warning and not coalesce(p_warning_accepted, false) then raise exception 'Duration mismatch must be explicitly accepted before confirmation' using errcode = '22023'; end if;
  decision := case when has_warning then 'accepted' else 'not_required' end;

  update public.shot_preparation_drafts
  set confirmation_status = 'confirmed', warning_decision = decision, warning_reason = case when has_warning then btrim(p_reason) else null end,
      warning_accepted_at = case when has_warning then now() else null end, warning_accepted_by = case when has_warning then auth.uid() else null end,
      confirmation_reason = btrim(p_reason), confirmed_at = now(), confirmed_by = auth.uid(), skipped_at = null, skipped_by = null, updated_at = now()
  where id = draft.id returning * into saved_draft;

  if has_warning then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, current_episode.id, 'shot_duration_warning_accepted', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', draft.shot_id, 'video_delta_seconds', video_delta, 'audio_delta_seconds', audio_delta, 'duration_decision', duration_decision, 'reason', btrim(p_reason)), auth.uid());
  end if;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, current_episode.id, 'shot_preparation_confirmed', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', draft.shot_id, 'video_artifact_id', draft.current_video_artifact_id, 'video_task_id', draft.current_video_task_id, 'audio_mode', draft.audio_mode, 'audio_track_id', draft.current_audio_track_id, 'subtitle_text', draft.subtitle_text, 'subtitles_enabled', draft.subtitles_enabled, 'warning_decision', decision, 'duration_decision', duration_decision, 'reason', btrim(p_reason)), auth.uid());
  return saved_draft;
end;
$$;


--
-- Name: confirm_shot_sync_preview(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_shot_sync_preview(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_confirmation_reason text, p_deviation_resolution text) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  selected_shot jsonb;
  draft public.shot_preparation_drafts;
  preview_task public.tasks;
  duration_settings jsonb;
  duration_seconds numeric;
  duration_decision jsonb;
  has_deviation boolean;
  saved_draft public.shot_preparation_drafts;
begin
  if coalesce(btrim(p_shot_id), '') = '' then
    raise exception 'Shot id is required' using errcode = '22023';
  end if;
  if coalesce(p_deviation_resolution, '') not in ('none', 'confirmation_reason', 'episode_exception') then
    raise exception 'Shot deviation resolution is invalid' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id;
  if not found or current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then
    raise exception 'Owner shot workbench access is required' using errcode = '42501';
  end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval
    on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'The current approved storyboard package is required' using errcode = '22023'; end if;

  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot is not in the immutable approved storyboard' using errcode = '22023'; end if;

  select target.* into draft from public.shot_preparation_drafts target
  where target.episode_id = p_episode_id and target.review_package_id = p_review_package_id
    and target.shot_id = btrim(p_shot_id) for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;

  if draft.preparation_contract_status <> 'current' or draft.preparation_contract is null
    or draft.preparation_input_fingerprint is distinct from draft.preparation_contract ->> 'input_fingerprint'
    or draft.input_fingerprint is distinct from md5(selected_shot::text)
    or draft.selected_material_revision_id is null
    or coalesce(jsonb_typeof(draft.clip_segments), '') <> 'array'
    or jsonb_array_length(draft.clip_segments) = 0
    or draft.video_duration_seconds is null or draft.video_duration_seconds <= 0 or draft.source_video_duration_seconds is null or draft.source_video_duration_seconds <= 0
    or not public.is_valid_shot_composition(draft.composition, jsonb_array_length(draft.clip_segments))
    or not public.is_valid_shot_caption_contract(draft.caption_contract)
  then raise exception 'Media, layout, and caption contracts must be current and valid' using errcode = '22023'; end if;

  if not exists (
    select 1 from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.id = draft.selected_material_revision_id and material.episode_id = p_episode_id
      and material.material_type = 'video' and material.sha256 ~ '^[0-9a-f]{64}$' and material.file_size > 0
  ) then raise exception 'The current approved video material is required' using errcode = '22023'; end if;

  if exists (
    select 1 from jsonb_array_elements(draft.clip_segments) segment
    where jsonb_typeof(segment) <> 'object'
      or jsonb_typeof(segment -> 'start_seconds') <> 'number'
      or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'start_seconds')::numeric < 0
      or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
      or (segment ->> 'end_seconds')::numeric > draft.source_video_duration_seconds
  ) then raise exception 'Every media range must be valid for the approved source' using errcode = '22023'; end if;

  if draft.subtitles_enabled and (
    draft.caption_contract ->> 'text' is distinct from draft.subtitle_text
    or coalesce(jsonb_array_length(draft.caption_contract -> 'cues'), 0) = 0
    or draft.acoustic_alignment ->> 'status' <> 'completed'
    or coalesce(jsonb_array_length(draft.acoustic_alignment -> 'cues'), 0) <> jsonb_array_length(draft.caption_contract -> 'cues')
    or exists (
      select 1
      from jsonb_array_elements(coalesce(draft.acoustic_alignment -> 'cues', '[]'::jsonb)) with ordinality as aligned(cue, ordinal)
      join jsonb_array_elements(draft.caption_contract -> 'cues') with ordinality as caption(cue, ordinal) using (ordinal)
      where aligned.cue ->> 'id' is distinct from caption.cue ->> 'id'
        or aligned.cue ->> 'text' is distinct from caption.cue ->> 'text'
        or (aligned.cue ->> 'startMs')::numeric is distinct from (caption.cue ->> 'start_ms')::numeric
        or (aligned.cue ->> 'endMs')::numeric is distinct from (caption.cue ->> 'end_ms')::numeric
    )
  ) then raise exception 'Enabled captions require current content, manual timing, safe-area layout, and completed alignment' using errcode = '22023'; end if;

  if draft.audio_mode = 'tts' and not exists (
    select 1 from public.audio_tracks track
    join public.tasks task on task.id = track.source_task_id
    where track.id = draft.current_audio_track_id and track.episode_id = p_episode_id
      and track.source_review_package_id = p_review_package_id and track.cue_id = draft.shot_id
      and task.status = 'completed' and task.invalidated_at is null
      and ((draft.audio_mode = 'tts' and track.track_kind = 'narration' and task.task_type = 'generate_narration')
        or (draft.audio_mode = 'source' and track.track_kind = 'source' and task.task_type = 'extract_embedded_audio'))
  ) then raise exception 'The current readable audio version is required' using errcode = '22023'; end if;
  if draft.audio_mode = 'tts' and draft.audio_status <> 'ready' then
    raise exception 'The current audio version is not ready' using errcode = '22023';
  end if;

  duration_seconds := public.shot_composition_playback_duration(draft.clip_segments, draft.composition);
  duration_settings := public.shot_duration_settings(p_episode_id);
  duration_decision := public.shot_duration_decision(
    draft.audio_mode,
    case when draft.audio_mode = 'tts' then draft.tts_actual_duration_seconds when draft.audio_mode = 'source' then duration_seconds else null end,
    duration_seconds,
    (selected_shot ->> 'durationSeconds')::numeric,
    (duration_settings ->> 'frame_rate')::numeric,
    (duration_settings ->> 'allowed_frames')::integer,
    duration_seconds
  );
  has_deviation := duration_decision ->> 'status' = 'needs_attention';
  if has_deviation and p_deviation_resolution = 'none' then
    raise exception 'A non-structural deviation needs an Episode exception or shot-only acceptance' using errcode = '22023';
  end if;
  if not has_deviation and p_deviation_resolution <> 'none' then
    raise exception 'A deviation resolution cannot be recorded when the current shot has no deviation' using errcode = '22023';
  end if;

  select task.* into preview_task from public.tasks task where task.id = draft.current_preview_task_id;
  if draft.pending_preview_task_id is not null or draft.preview_status <> 'ready'
    or draft.current_preview_input_fingerprint is distinct from draft.preparation_input_fingerprint
    or draft.current_preview_artifact_id is null or draft.current_preview_project_artifact_id is null
    or preview_task.id is null or preview_task.task_type <> 'generate_shot_sync_preview'
    or preview_task.provider <> 'openchatcut' or preview_task.status <> 'completed' or preview_task.invalidated_at is not null
    or preview_task.input_snapshot ->> 'preview_input_fingerprint' is distinct from draft.preparation_input_fingerprint
    or coalesce((preview_task.last_result #>> '{validation,passed}')::boolean, false) is not true
  then raise exception 'Only the current verified OpenChatCut sync preview can be confirmed' using errcode = '22023'; end if;

  if not exists (select 1 from public.artifacts artifact where artifact.id = draft.current_preview_artifact_id and artifact.producer_task_id = preview_task.id and artifact.artifact_type = 'shot_preview_proxy' and artifact.sha256 is not null and artifact.file_size > 0)
    or not exists (select 1 from public.artifacts artifact where artifact.id = draft.current_preview_project_artifact_id and artifact.producer_task_id = preview_task.id and artifact.artifact_type = 'shot_editable_project' and artifact.sha256 is not null and artifact.file_size > 0)
    or not exists (select 1 from public.artifacts artifact where artifact.producer_task_id = preview_task.id and artifact.artifact_type = 'shot_preview_runtime' and artifact.sha256 is not null and artifact.file_size > 0)
    or not exists (select 1 from public.artifacts artifact where artifact.producer_task_id = preview_task.id and artifact.artifact_type = 'shot_preview_qc_report' and artifact.sha256 is not null and artifact.file_size > 0)
  then raise exception 'The OpenChatCut proxy, editable project, runtime, and QC evidence must all exist' using errcode = '22023'; end if;

  if exists (
    select required.name from unnest(array['openchatcut_project', 'openchatcut_render', 'openchatcut_qc']) required(name)
    where not exists (
      select 1 from jsonb_array_elements(coalesce(preview_task.last_result #> '{validation,checks}', '[]'::jsonb)) check_item
      where check_item ->> 'name' = required.name and coalesce((check_item ->> 'passed')::boolean, false)
    )
  ) then raise exception 'OpenChatCut compatibility checks are incomplete' using errcode = '22023'; end if;

  update public.shot_preparation_drafts target
  set confirmation_status = 'confirmed',
      confirmation_reason = case when has_deviation and p_deviation_resolution = 'episode_exception' then 'Owner recorded this duration deviation as an Episode exception.' when has_deviation then 'Owner accepted this duration deviation for the current shot.' else 'Owner confirmed every current shot acceptance gate.' end,
      warning_decision = case when has_deviation then 'accepted' else 'not_required' end,
      warning_reason = case when has_deviation and p_deviation_resolution = 'episode_exception' then 'Episode exception' when has_deviation then 'Current shot accepted' else null end,
      warning_accepted_at = case when has_deviation then now() else null end,
      warning_accepted_by = case when has_deviation then auth.uid() else null end,
      confirmed_at = now(), confirmed_by = auth.uid(), skipped_at = null, skipped_by = null, updated_at = now()
  where target.id = draft.id returning * into saved_draft;

  if has_deviation then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, p_episode_id,
      case when p_deviation_resolution = 'episode_exception' then 'shot_episode_exception_recorded' else 'shot_confirmation_reason_recorded' end,
      jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', draft.shot_id, 'resolution', p_deviation_resolution, 'reason', case when p_deviation_resolution = 'episode_exception' then 'Episode exception' else 'Current shot accepted' end, 'duration_decision', duration_decision), auth.uid());
  end if;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_sync_preview_confirmed', jsonb_build_object(
    'review_package_id', p_review_package_id, 'shot_id', draft.shot_id,
    'task_id', draft.current_preview_task_id, 'input_fingerprint', draft.current_preview_input_fingerprint,
    'confirmation_reason', saved_draft.confirmation_reason, 'deviation_resolution', p_deviation_resolution,
    'acceptance_gates', jsonb_build_array('media', 'layout', 'captions', 'alignment', 'deviation', 'preview_fingerprint', 'openchatcut_project')
  ), auth.uid());
  return saved_draft;
end;
$_$;


--
-- Name: FUNCTION confirm_shot_sync_preview(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_confirmation_reason text, p_deviation_resolution text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.confirm_shot_sync_preview(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_confirmation_reason text, p_deviation_resolution text) IS 'Confirms a verified shot preview. Duration deviations require a structured scope choice; free-text justification is intentionally optional.';


--
-- Name: connection_version_is_verified(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.connection_version_is_verified(p_version_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.external_connection_versions version
    join public.external_connections connection on connection.id = version.connection_id
    where version.id = p_version_id
      and version.revoked_at is null
      and connection.current_version_id = version.id
      and (select verification.status
           from public.external_connection_verifications verification
           where verification.connection_version_id = version.id
           order by verification.created_at desc, verification.id desc
           limit 1) = 'verified'
  );
$$;


--
-- Name: copy_clip_segments_to_revised_shot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.copy_clip_segments_to_revised_shot() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare previous public.shot_preparation_drafts;
begin
  if jsonb_array_length(new.clip_segments) > 0 then return new; end if;
  select draft.* into previous from public.shot_preparation_drafts draft
  where draft.episode_id = new.episode_id and draft.shot_id = new.shot_id and draft.input_fingerprint = new.input_fingerprint and draft.id <> new.id
  order by draft.updated_at desc limit 1;
  if found then update public.shot_preparation_drafts set clip_segments = previous.clip_segments, video_duration_seconds = previous.video_duration_seconds where id = new.id; end if;
  return new;
end;
$$;


--
-- Name: copy_shot_audio_mix_to_revised_draft(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.copy_shot_audio_mix_to_revised_draft() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare previous public.shot_preparation_drafts;
begin
  select draft.* into previous from public.shot_preparation_drafts draft
  where draft.episode_id = new.episode_id and draft.shot_id = new.shot_id and draft.review_package_id <> new.review_package_id
  order by (draft.input_fingerprint = new.input_fingerprint) desc, draft.updated_at desc, draft.id desc limit 1;
  if found then update public.shot_preparation_drafts set bgm_ducking_level = previous.bgm_ducking_level where id = new.id; end if;
  return new;
end;
$$;


--
-- Name: copy_shot_composition_to_revised_draft(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.copy_shot_composition_to_revised_draft() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  previous public.shot_preparation_drafts;
begin
  select draft.* into previous
  from public.shot_preparation_drafts draft
  where draft.episode_id = new.episode_id
    and draft.shot_id = new.shot_id
    and draft.review_package_id <> new.review_package_id
  order by (draft.input_fingerprint = new.input_fingerprint) desc, draft.updated_at desc, draft.id desc
  limit 1;
  if found then
    update public.shot_preparation_drafts
    set composition = previous.composition,
        source_video_duration_seconds = previous.source_video_duration_seconds
    where id = new.id;
  end if;
  return new;
end;
$$;


--
-- Name: create_account(text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_account(p_account_name text, p_account_slug text, p_timezone text, p_policy jsonb) RETURNS public.accounts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  created_account public.accounts;
  created_blueprint public.account_blueprint_versions;
begin
  if not exists (
    select 1 from public.account_memberships
    where user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'An existing owner membership is required to create an account' using errcode = '42501';
  end if;
  if char_length(trim(p_account_name)) = 0 or char_length(trim(p_account_slug)) = 0 then
    raise exception 'Account name and slug are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_policy) <> 'object' then
    raise exception 'Blueprint policy must be a JSON object' using errcode = '22023';
  end if;

  insert into public.accounts (name, slug, timezone)
  values (trim(p_account_name), trim(p_account_slug), p_timezone)
  returning * into created_account;
  insert into public.account_blueprint_versions (account_id, version, policy, is_active)
  values (created_account.id, 1, p_policy, true)
  returning * into created_blueprint;
  update public.accounts
  set current_blueprint_version_id = created_blueprint.id
  where id = created_account.id
  returning * into created_account;
  insert into public.account_memberships (account_id, user_id, role)
  values (created_account.id, auth.uid(), 'owner');
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (created_account.id, 'account_created', jsonb_build_object('blueprint_version_id', created_blueprint.id), auth.uid());
  return created_account;
end;
$$;


--
-- Name: audio_track_annotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audio_track_annotations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audio_track_id uuid NOT NULL,
    author_id uuid NOT NULL,
    at_seconds numeric(12,3) NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audio_track_annotations_at_seconds_check CHECK ((at_seconds >= (0)::numeric)),
    CONSTRAINT audio_track_annotations_reason_check CHECK ((btrim(reason) <> ''::text))
);


--
-- Name: create_audio_track_annotation(uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_audio_track_annotation(p_audio_track_id uuid, p_at_seconds numeric, p_reason text) RETURNS public.audio_track_annotations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare track public.audio_tracks; membership_role public.member_role; created_annotation public.audio_track_annotations;
begin
  if p_at_seconds < 0 or p_at_seconds > 86400 or btrim(coalesce(p_reason,'')) = '' then raise exception 'Audio annotation is invalid' using errcode = '22023'; end if;
  select * into track from public.audio_tracks where id = p_audio_track_id; if not found then raise exception 'Audio track does not exist' using errcode = 'P0002'; end if;
  if p_at_seconds < track.start_seconds or p_at_seconds > track.start_seconds + track.duration_seconds then raise exception 'Audio annotation must be within the audio track range' using errcode = '22023'; end if;
  select membership.role into membership_role from public.account_memberships membership join public.episodes episode on episode.account_id = membership.account_id where episode.id = track.episode_id and membership.user_id = auth.uid();
  if membership_role is distinct from 'owner' then raise exception 'Owner membership is required to annotate an audio track' using errcode = '42501'; end if;
  insert into public.audio_track_annotations (audio_track_id,author_id,at_seconds,reason) values (track.id,auth.uid(),p_at_seconds,btrim(p_reason)) returning * into created_annotation; return created_annotation;
end;
$$;


--
-- Name: create_blueprint_version(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_blueprint_version(p_account_id uuid, p_policy jsonb) RETURNS public.account_blueprint_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  membership_role public.member_role;
  created_blueprint public.account_blueprint_versions;
  next_version integer;
begin
  if jsonb_typeof(p_policy) <> 'object' then
    raise exception 'Blueprint policy must be a JSON object' using errcode = '22023';
  end if;
  select role into membership_role from public.account_memberships where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to create a blueprint version' using errcode = '42501';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.account_blueprint_versions where account_id = p_account_id;
  insert into public.account_blueprint_versions (account_id, version, policy)
  values (p_account_id, next_version, p_policy)
  returning * into created_blueprint;
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (p_account_id, 'blueprint_version_created', jsonb_build_object('blueprint_version_id', created_blueprint.id, 'version', next_version), auth.uid());
  return created_blueprint;
end;
$$;


--
-- Name: create_episode(uuid, uuid, uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_episode(p_account_id uuid, p_blueprint_version_id uuid, p_series_version_id uuid, p_title text, p_is_test boolean DEFAULT false) RETURNS public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  created_episode public.episodes;
  membership_role public.member_role;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to create an episode' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.accounts account
    join public.account_blueprint_versions blueprint
      on blueprint.account_id = account.id
     and blueprint.id = account.current_blueprint_version_id
     and blueprint.is_active
    where account.id = p_account_id and blueprint.id = p_blueprint_version_id
  ) then
    raise exception 'Episode blueprint must be the account active blueprint' using errcode = '22023';
  end if;
  if p_series_version_id is not null and not exists (
    select 1 from public.series_versions
    where account_id = p_account_id and id = p_series_version_id
  ) then
    raise exception 'Series version must belong to the episode account' using errcode = '22023';
  end if;

  insert into public.episodes (account_id, blueprint_version_id, series_version_id, title, stage, is_test)
  values (p_account_id, p_blueprint_version_id, p_series_version_id, coalesce(p_title, ''), 'waiting_input', p_is_test)
  returning * into created_episode;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    p_account_id,
    created_episode.id,
    'episode_created',
    jsonb_build_object('blueprint_version_id', p_blueprint_version_id, 'series_version_id', p_series_version_id, 'is_test', p_is_test),
    auth.uid()
  );
  return created_episode;
end;
$$;


--
-- Name: external_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    adapter text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'unverified'::text NOT NULL,
    last_verification_detail text,
    last_verified_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    current_version_id uuid NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    endpoint text DEFAULT 'https://api.pexels.com'::text NOT NULL,
    CONSTRAINT external_connections_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 100))),
    CONSTRAINT external_connections_provider_adapter_check CHECK ((((provider = 'pexels'::text) AND (adapter = 'pexels_video'::text)) OR ((provider = 'freesound'::text) AND (adapter = 'freesound_preview'::text)) OR ((provider = 'openai'::text) AND (adapter = 'openai_images'::text)) OR ((provider = 'cloudflare'::text) AND (adapter = 'workers_ai_images'::text)) OR ((provider = 'google_tts'::text) AND (adapter = 'google_tts'::text)) OR ((provider = 'volcengine_tts'::text) AND (adapter = 'volcengine_tts'::text)))),
    CONSTRAINT external_connections_status_check CHECK ((status = ANY (ARRAY['unverified'::text, 'verified'::text, 'invalid'::text, 'retryable'::text])))
);


--
-- Name: create_external_connection(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_external_connection(p_provider text, p_adapter text, p_name text, p_secret text) RETURNS public.external_connections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  created_connection public.external_connections;
  connection_id uuid := gen_random_uuid();
  version_id uuid := gen_random_uuid();
  endpoint text := public.official_external_connection_endpoint(trim(p_provider), trim(p_adapter));
begin
  if auth.uid() is null then raise exception 'Owner login is required' using errcode = '42501'; end if;
  if endpoint is null then raise exception 'Only registered external connections are supported' using errcode = '22023'; end if;
  if not exists (select 1 from public.account_memberships where user_id = auth.uid() and role = 'owner') then raise exception 'Owner membership is required' using errcode = '42501'; end if;
  if char_length(trim(p_name)) not between 1 and 100 or char_length(trim(p_secret)) not between 1 and 4096 then raise exception 'Connection name and secret are required' using errcode = '22023'; end if;

  insert into public.external_connections (id, provider, adapter, name, created_by, current_version_id, endpoint)
  values (connection_id, trim(p_provider), trim(p_adapter), trim(p_name), auth.uid(), version_id, endpoint)
  returning * into created_connection;
  insert into public.external_connection_versions (id, connection_id, version, provider, adapter, endpoint, vault_secret_id)
  values (version_id, connection_id, 1, trim(p_provider), trim(p_adapter), endpoint, vault.create_secret(trim(p_secret)));
  return created_connection;
end;
$$;


--
-- Name: review_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    task_id uuid,
    task_run_id uuid,
    artifact_id uuid,
    stage public.episode_stage NOT NULL,
    revision_number integer NOT NULL,
    context_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    invalidated_at timestamp with time zone,
    invalidated_reason text,
    CONSTRAINT review_packages_context_snapshot_check CHECK ((jsonb_typeof(context_snapshot) = 'object'::text)),
    CONSTRAINT review_packages_invalidation_reason_check CHECK ((((invalidated_at IS NULL) AND (invalidated_reason IS NULL)) OR ((invalidated_at IS NOT NULL) AND (btrim(COALESCE(invalidated_reason, ''::text)) <> ''::text)))),
    CONSTRAINT review_packages_revision_number_check CHECK ((revision_number > 0)),
    CONSTRAINT review_packages_stage_check CHECK ((stage = ANY (ARRAY['script_review'::public.episode_stage, 'visual_review'::public.episode_stage, 'storyboard_review'::public.episode_stage, 'production_ready'::public.episode_stage, 'qc_review'::public.episode_stage])))
);


--
-- Name: create_pre_render_review_packages(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_pre_render_review_packages() RETURNS SETOF public.review_packages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  candidate record;
  storyboard_shot jsonb;
  audio_cue jsonb;
  selected_task public.tasks;
  selected_artifact public.artifacts;
  selected_track public.audio_tracks;
  members jsonb := '[]'::jsonb;
  member_evidence jsonb;
  member_key text;
  expected_member_count integer;
  next_revision integer;
  created_package public.review_packages;
  has_approved_video boolean;
begin
  for candidate in
    select
      episode.id as episode_id,
      episode.account_id,
      package.id as storyboard_review_package_id,
      package.context_snapshot as storyboard_context
    from public.episodes episode
    join lateral (
      select review_package.*
      from public.review_packages review_package
      join public.approvals approval
        on approval.review_package_id = review_package.id
       and approval.stage = 'storyboard_approved'
       and approval.decision = 'approved'
      where review_package.episode_id = episode.id
        and review_package.stage = 'storyboard_review'
        and review_package.invalidated_at is null
      order by review_package.revision_number desc
      limit 1
    ) package on true
    where episode.stage = 'production_ready'
      and not exists (
        select 1
        from public.review_packages package
        where package.episode_id = episode.id
          and package.stage = 'production_ready'
          and package.invalidated_at is null
      )
    order by episode.updated_at, episode.id
    for update of episode skip locked
  loop
    if exists (select 1 from public.shot_preparation_drafts draft where draft.episode_id = candidate.episode_id and draft.review_package_id = candidate.storyboard_review_package_id) then
      select * into created_package from public.create_shot_preparation_review_package(candidate.episode_id, candidate.storyboard_review_package_id);
      if found then return next created_package; end if;
      continue;
    end if;
    members := '[]'::jsonb;

    for storyboard_shot in
      select value
      from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}')
    loop
      if storyboard_shot ->> 'shotType' = 'a_roll' then
        select task.* into selected_task
        from public.tasks task
        where task.episode_id = candidate.episode_id
          and task.task_type = 'generate_a_roll'
          and task.status = 'completed' and task.invalidated_at is null
          and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text
          and task.input_snapshot #>> '{shot,id}' = storyboard_shot ->> 'id'
        order by task.completed_at desc, task.id desc
        limit 1;
      elsif storyboard_shot ->> 'shotType' = 'b_roll' then
        select task.* into selected_task
        from public.tasks task
        where task.episode_id = candidate.episode_id
          and task.task_type = 'generate_b_roll'
          and task.status = 'completed' and task.invalidated_at is null
          and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text
          and task.input_snapshot #>> '{shot,id}' = storyboard_shot ->> 'id'
        order by task.completed_at desc, task.id desc
        limit 1;
      else
        raise exception 'Approved storyboard contains an invalid shot type' using errcode = '22023';
      end if;
      if not found then
        continue;
      end if;

      select artifact.* into selected_artifact
      from public.artifacts artifact
      where artifact.producer_task_id = selected_task.id
        and artifact.relative_path = selected_task.input_snapshot #>> '{output,relative_path}'
        and artifact.artifact_type = any (
          array(select jsonb_array_elements_text(selected_task.input_snapshot #> '{output,required_artifact_types}'))
        );
      if not found then
        continue;
      end if;

      member_key := format('shot:%s', storyboard_shot ->> 'id');
      member_evidence := jsonb_build_object(
        'member_kind', 'shot_media',
        'member_key', member_key,
        'shot', storyboard_shot,
        'task', jsonb_build_object('id', selected_task.id, 'type', selected_task.task_type, 'attempt', selected_task.attempt, 'provider', selected_task.provider, 'model', selected_task.model, 'prompt_version', selected_task.prompt_version, 'actual_cost_cents', selected_task.actual_cost_cents, 'result', selected_task.last_result),
        'artifact', jsonb_build_object('id', selected_artifact.id, 'artifact_type', selected_artifact.artifact_type, 'relative_path', selected_artifact.relative_path, 'sha256', selected_artifact.sha256, 'file_size', selected_artifact.file_size)
      );
      members := members || jsonb_build_array(member_evidence);
    end loop;

    expected_member_count := jsonb_array_length(candidate.storyboard_context #> '{worker_result,storyboard,shots}');
    if jsonb_array_length(members) <> expected_member_count then
      continue;
    end if;

    select exists (
      select 1
      from public.production_material_revisions material
      join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where material.episode_id = candidate.episode_id
        and material.material_type = 'video'
        and material.storage_path ~* '[.](mp4|mov|webm)$'
    ) into has_approved_video;

    if has_approved_video and exists (select 1 from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') shot where not exists (select 1 from public.audio_tracks track where track.episode_id = candidate.episode_id and track.track_kind = 'narration' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = shot ->> 'id')) then
      select track.* into selected_track
      from public.audio_tracks track
      join public.production_material_revisions material on material.id = track.source_material_revision_id
      join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where track.episode_id = candidate.episode_id
        and track.track_kind = 'derived'
      order by track.created_at desc, track.id desc
      limit 1;
      if not found then
        continue;
      end if;
      select * into selected_task from public.tasks where id = selected_track.source_task_id and status = 'completed' and invalidated_at is null; if not found then continue; end if;
      member_key := 'narration:derived-video';
      member_evidence := jsonb_build_object('member_kind','narration','member_key',member_key,'task',jsonb_build_object('id',selected_task.id,'type',selected_task.task_type,'attempt',selected_task.attempt,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'actual_cost_cents',selected_task.actual_cost_cents,'result',selected_task.last_result),'audio_track',jsonb_build_object('id',selected_track.id,'kind',selected_track.track_kind,'cue_id',selected_track.cue_id,'relative_path',selected_track.relative_path,'sha256',selected_track.sha256,'file_size',selected_track.file_size,'start_seconds',selected_track.start_seconds,'duration_seconds',selected_track.duration_seconds,'source_material_revision_id',selected_track.source_material_revision_id));
      members := members || jsonb_build_array(member_evidence);
      expected_member_count := expected_member_count + 1;
    else
      for storyboard_shot in select value from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') loop
        select track.* into selected_track
        from public.audio_tracks track
        where track.episode_id = candidate.episode_id
          and track.track_kind = 'narration'
          and track.source_review_package_id = candidate.storyboard_review_package_id
          and track.cue_id = storyboard_shot ->> 'id'
        order by track.created_at desc, track.id desc
        limit 1;
        if not found then
          continue;
        end if;
        select * into selected_task from public.tasks where id = selected_track.source_task_id and status = 'completed' and invalidated_at is null; if not found then continue; end if;
        member_key := format('narration:%s', storyboard_shot ->> 'id');
        member_evidence := jsonb_build_object('member_kind','narration','member_key',member_key,'task',jsonb_build_object('id',selected_task.id,'type',selected_task.task_type,'attempt',selected_task.attempt,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'actual_cost_cents',selected_task.actual_cost_cents,'result',selected_task.last_result),'audio_track',jsonb_build_object('id',selected_track.id,'kind',selected_track.track_kind,'cue_id',selected_track.cue_id,'relative_path',selected_track.relative_path,'sha256',selected_track.sha256,'file_size',selected_track.file_size,'start_seconds',selected_track.start_seconds,'duration_seconds',selected_track.duration_seconds));
        members := members || jsonb_build_array(member_evidence);
      end loop;
      expected_member_count := expected_member_count + jsonb_array_length(candidate.storyboard_context #> '{worker_result,storyboard,shots}');
      if jsonb_array_length(members) <> expected_member_count then
        continue;
      end if;
    end if;

    for audio_cue in select value from jsonb_array_elements(case when exists (select 1 from public.episodes episode join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = candidate.episode_id and (blueprint.policy -> 'soundtrack') is not null and jsonb_typeof(blueprint.policy -> 'soundtrack') <> 'null') then coalesce(candidate.storyboard_context #> '{worker_result,storyboard,audioCues}', '[]'::jsonb) else '[]'::jsonb end) loop
      expected_member_count := expected_member_count + 1;
      select track.* into selected_track
      from public.audio_tracks track
      where track.episode_id = candidate.episode_id
        and track.track_kind = audio_cue ->> 'kind'
        and track.source_review_package_id = candidate.storyboard_review_package_id
        and track.cue_id = audio_cue ->> 'id'
      order by track.created_at desc, track.id desc
      limit 1;
      if not found then
        continue;
      end if;
      select * into selected_task from public.tasks where id = selected_track.source_task_id and status = 'completed' and invalidated_at is null; if not found then continue; end if;
      member_key := format('soundtrack:%s', audio_cue ->> 'id');
      member_evidence := jsonb_build_object('member_kind','soundtrack','member_key',member_key,'cue',audio_cue,'task',jsonb_build_object('id',selected_task.id,'type',selected_task.task_type,'attempt',selected_task.attempt,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'actual_cost_cents',selected_task.actual_cost_cents,'result',selected_task.last_result),'audio_track',jsonb_build_object('id',selected_track.id,'kind',selected_track.track_kind,'cue_id',selected_track.cue_id,'relative_path',selected_track.relative_path,'sha256',selected_track.sha256,'file_size',selected_track.file_size,'start_seconds',selected_track.start_seconds,'duration_seconds',selected_track.duration_seconds));
      members := members || jsonb_build_array(member_evidence);
    end loop;
    if jsonb_array_length(members) <> expected_member_count then
      continue;
    end if;

    select coalesce(max(revision_number), 0) + 1 into next_revision
    from public.review_packages
    where episode_id = candidate.episode_id and stage = 'production_ready';

    insert into public.review_packages (episode_id, stage, revision_number, context_snapshot)
    values (candidate.episode_id, 'production_ready', next_revision, jsonb_build_object('review_kind','pre_render','approval_mode','qc_only','storyboard_review_package_id',candidate.storyboard_review_package_id,'storyboard',candidate.storyboard_context #> '{worker_result,storyboard}','members',members))
    returning * into created_package;

    insert into public.pre_render_review_members (review_package_id,member_key,member_kind,source_task_id,artifact_id,audio_track_id,evidence_snapshot)
    select created_package.id,
      evidence ->> 'member_key',
      evidence ->> 'member_kind',
      (evidence #>> '{task,id}')::uuid,
      case when evidence ? 'artifact' then (evidence #>> '{artifact,id}')::uuid else null end,
      case when evidence ? 'audio_track' then (evidence #>> '{audio_track,id}')::uuid else null end,
      evidence
    from jsonb_array_elements(members) evidence;

    insert into public.pre_render_review_member_decisions (review_package_id, member_key, decision, reason, actor_id, inherited_from_review_package_id)
    select
      created_package.id,
      member.member_key,
      'approved',
      '沿用未受本次返工影响的已批准成员。',
      previous_decision.actor_id,
      previous_decision.review_package_id
    from public.pre_render_review_members member
    join lateral (
      select decision.*
      from public.pre_render_review_member_decisions decision
      join public.pre_render_review_members previous_member
        on previous_member.review_package_id = decision.review_package_id
       and previous_member.member_key = decision.member_key
      join public.review_packages previous_package on previous_package.id = decision.review_package_id
      join public.tasks previous_task on previous_task.id = previous_member.source_task_id
      where previous_member.member_key = member.member_key
        and previous_member.source_task_id = member.source_task_id
        and decision.decision = 'approved'
        and previous_package.invalidated_at is null
        and previous_task.status = 'completed'
        and previous_task.invalidated_at is null
      order by decision.created_at desc
      limit 1
    ) previous_decision on true
    where member.review_package_id = created_package.id;

    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (candidate.account_id, candidate.episode_id, 'pre_render_review_package_created', jsonb_build_object('review_package_id',created_package.id,'storyboard_review_package_id',candidate.storyboard_review_package_id,'revision_number',next_revision,'member_count',jsonb_array_length(members)), null);
    return next created_package;
  end loop;
end;
$_$;


--
-- Name: create_pre_render_review_packages_for_episode(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_pre_render_review_packages_for_episode(p_episode_id uuid) RETURNS SETOF public.review_packages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  candidate record;
  storyboard_shot jsonb;
  audio_cue jsonb;
  selected_task public.tasks;
  selected_artifact public.artifacts;
  selected_track public.audio_tracks;
  members jsonb := '[]'::jsonb;
  member_evidence jsonb;
  member_key text;
  expected_member_count integer;
  next_revision integer;
  created_package public.review_packages;
  has_approved_video boolean;
begin
  for candidate in
    select
      episode.id as episode_id,
      episode.account_id,
      package.id as storyboard_review_package_id,
      package.context_snapshot as storyboard_context
    from public.episodes episode
    join lateral (
      select review_package.*
      from public.review_packages review_package
      join public.approvals approval
        on approval.review_package_id = review_package.id
       and approval.stage = 'storyboard_approved'
       and approval.decision = 'approved'
      where review_package.episode_id = episode.id
        and review_package.stage = 'storyboard_review'
        and review_package.invalidated_at is null
      order by review_package.revision_number desc
      limit 1
    ) package on true
    where episode.stage = 'production_ready' and episode.id = p_episode_id
      and not exists (
        select 1
        from public.review_packages package
        where package.episode_id = episode.id
          and package.stage = 'production_ready'
          and package.invalidated_at is null
      )
    order by episode.updated_at, episode.id
    for update of episode skip locked
  loop
    if exists (select 1 from public.shot_preparation_drafts draft where draft.episode_id = candidate.episode_id and draft.review_package_id = candidate.storyboard_review_package_id) then
      select * into created_package from public.create_shot_preparation_review_package(candidate.episode_id, candidate.storyboard_review_package_id);
      if found then return next created_package; end if;
      continue;
    end if;
    members := '[]'::jsonb;

    for storyboard_shot in
      select value
      from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}')
    loop
      if storyboard_shot ->> 'shotType' = 'a_roll' then
        select task.* into selected_task
        from public.tasks task
        where task.episode_id = candidate.episode_id
          and task.task_type = 'generate_a_roll'
          and task.status = 'completed' and task.invalidated_at is null
          and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text
          and task.input_snapshot #>> '{shot,id}' = storyboard_shot ->> 'id'
        order by task.completed_at desc, task.id desc
        limit 1;
      elsif storyboard_shot ->> 'shotType' = 'b_roll' then
        select task.* into selected_task
        from public.tasks task
        where task.episode_id = candidate.episode_id
          and task.task_type = 'generate_b_roll'
          and task.status = 'completed' and task.invalidated_at is null
          and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text
          and task.input_snapshot #>> '{shot,id}' = storyboard_shot ->> 'id'
        order by task.completed_at desc, task.id desc
        limit 1;
      else
        raise exception 'Approved storyboard contains an invalid shot type' using errcode = '22023';
      end if;
      if not found then
        continue;
      end if;

      select artifact.* into selected_artifact
      from public.artifacts artifact
      where artifact.producer_task_id = selected_task.id
        and artifact.relative_path = selected_task.input_snapshot #>> '{output,relative_path}'
        and artifact.artifact_type = any (
          array(select jsonb_array_elements_text(selected_task.input_snapshot #> '{output,required_artifact_types}'))
        );
      if not found then
        continue;
      end if;

      member_key := format('shot:%s', storyboard_shot ->> 'id');
      member_evidence := jsonb_build_object(
        'member_kind', 'shot_media',
        'member_key', member_key,
        'shot', storyboard_shot,
        'task', jsonb_build_object('id', selected_task.id, 'type', selected_task.task_type, 'attempt', selected_task.attempt, 'provider', selected_task.provider, 'model', selected_task.model, 'prompt_version', selected_task.prompt_version, 'actual_cost_cents', selected_task.actual_cost_cents, 'result', selected_task.last_result),
        'artifact', jsonb_build_object('id', selected_artifact.id, 'artifact_type', selected_artifact.artifact_type, 'relative_path', selected_artifact.relative_path, 'sha256', selected_artifact.sha256, 'file_size', selected_artifact.file_size)
      );
      members := members || jsonb_build_array(member_evidence);
    end loop;

    expected_member_count := jsonb_array_length(candidate.storyboard_context #> '{worker_result,storyboard,shots}');
    if jsonb_array_length(members) <> expected_member_count then
      continue;
    end if;

    select exists (
      select 1
      from public.production_material_revisions material
      join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where material.episode_id = candidate.episode_id
        and material.material_type = 'video'
        and material.storage_path ~* '[.](mp4|mov|webm)$'
    ) into has_approved_video;

    if has_approved_video and exists (select 1 from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') shot where not exists (select 1 from public.audio_tracks track where track.episode_id = candidate.episode_id and track.track_kind = 'narration' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = shot ->> 'id')) then
      select track.* into selected_track
      from public.audio_tracks track
      join public.production_material_revisions material on material.id = track.source_material_revision_id
      join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where track.episode_id = candidate.episode_id
        and track.track_kind = 'derived'
      order by track.created_at desc, track.id desc
      limit 1;
      if not found then
        continue;
      end if;
      select * into selected_task from public.tasks where id = selected_track.source_task_id and status = 'completed' and invalidated_at is null; if not found then continue; end if;
      member_key := 'narration:derived-video';
      member_evidence := jsonb_build_object('member_kind','narration','member_key',member_key,'task',jsonb_build_object('id',selected_task.id,'type',selected_task.task_type,'attempt',selected_task.attempt,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'actual_cost_cents',selected_task.actual_cost_cents,'result',selected_task.last_result),'audio_track',jsonb_build_object('id',selected_track.id,'kind',selected_track.track_kind,'cue_id',selected_track.cue_id,'relative_path',selected_track.relative_path,'sha256',selected_track.sha256,'file_size',selected_track.file_size,'start_seconds',selected_track.start_seconds,'duration_seconds',selected_track.duration_seconds,'source_material_revision_id',selected_track.source_material_revision_id));
      members := members || jsonb_build_array(member_evidence);
      expected_member_count := expected_member_count + 1;
    else
      for storyboard_shot in select value from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') loop
        select track.* into selected_track
        from public.audio_tracks track
        where track.episode_id = candidate.episode_id
          and track.track_kind = 'narration'
          and track.source_review_package_id = candidate.storyboard_review_package_id
          and track.cue_id = storyboard_shot ->> 'id'
        order by track.created_at desc, track.id desc
        limit 1;
        if not found then
          continue;
        end if;
        select * into selected_task from public.tasks where id = selected_track.source_task_id and status = 'completed' and invalidated_at is null; if not found then continue; end if;
        member_key := format('narration:%s', storyboard_shot ->> 'id');
        member_evidence := jsonb_build_object('member_kind','narration','member_key',member_key,'task',jsonb_build_object('id',selected_task.id,'type',selected_task.task_type,'attempt',selected_task.attempt,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'actual_cost_cents',selected_task.actual_cost_cents,'result',selected_task.last_result),'audio_track',jsonb_build_object('id',selected_track.id,'kind',selected_track.track_kind,'cue_id',selected_track.cue_id,'relative_path',selected_track.relative_path,'sha256',selected_track.sha256,'file_size',selected_track.file_size,'start_seconds',selected_track.start_seconds,'duration_seconds',selected_track.duration_seconds));
        members := members || jsonb_build_array(member_evidence);
      end loop;
      expected_member_count := expected_member_count + jsonb_array_length(candidate.storyboard_context #> '{worker_result,storyboard,shots}');
      if jsonb_array_length(members) <> expected_member_count then
        continue;
      end if;
    end if;

    for audio_cue in select value from jsonb_array_elements(case when exists (select 1 from public.episodes episode join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = candidate.episode_id and (blueprint.policy -> 'soundtrack') is not null and jsonb_typeof(blueprint.policy -> 'soundtrack') <> 'null') then coalesce(candidate.storyboard_context #> '{worker_result,storyboard,audioCues}', '[]'::jsonb) else '[]'::jsonb end) loop
      expected_member_count := expected_member_count + 1;
      select track.* into selected_track
      from public.audio_tracks track
      where track.episode_id = candidate.episode_id
        and track.track_kind = audio_cue ->> 'kind'
        and track.source_review_package_id = candidate.storyboard_review_package_id
        and track.cue_id = audio_cue ->> 'id'
      order by track.created_at desc, track.id desc
      limit 1;
      if not found then
        continue;
      end if;
      select * into selected_task from public.tasks where id = selected_track.source_task_id and status = 'completed' and invalidated_at is null; if not found then continue; end if;
      member_key := format('soundtrack:%s', audio_cue ->> 'id');
      member_evidence := jsonb_build_object('member_kind','soundtrack','member_key',member_key,'cue',audio_cue,'task',jsonb_build_object('id',selected_task.id,'type',selected_task.task_type,'attempt',selected_task.attempt,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'actual_cost_cents',selected_task.actual_cost_cents,'result',selected_task.last_result),'audio_track',jsonb_build_object('id',selected_track.id,'kind',selected_track.track_kind,'cue_id',selected_track.cue_id,'relative_path',selected_track.relative_path,'sha256',selected_track.sha256,'file_size',selected_track.file_size,'start_seconds',selected_track.start_seconds,'duration_seconds',selected_track.duration_seconds));
      members := members || jsonb_build_array(member_evidence);
    end loop;
    if jsonb_array_length(members) <> expected_member_count then
      continue;
    end if;

    select coalesce(max(revision_number), 0) + 1 into next_revision
    from public.review_packages
    where episode_id = candidate.episode_id and stage = 'production_ready';

    insert into public.review_packages (episode_id, stage, revision_number, context_snapshot)
    values (candidate.episode_id, 'production_ready', next_revision, jsonb_build_object('review_kind','pre_render','approval_mode','qc_only','storyboard_review_package_id',candidate.storyboard_review_package_id,'storyboard',candidate.storyboard_context #> '{worker_result,storyboard}','members',members))
    returning * into created_package;

    insert into public.pre_render_review_members (review_package_id,member_key,member_kind,source_task_id,artifact_id,audio_track_id,evidence_snapshot)
    select created_package.id,
      evidence ->> 'member_key',
      evidence ->> 'member_kind',
      (evidence #>> '{task,id}')::uuid,
      case when evidence ? 'artifact' then (evidence #>> '{artifact,id}')::uuid else null end,
      case when evidence ? 'audio_track' then (evidence #>> '{audio_track,id}')::uuid else null end,
      evidence
    from jsonb_array_elements(members) evidence;

    insert into public.pre_render_review_member_decisions (review_package_id, member_key, decision, reason, actor_id, inherited_from_review_package_id)
    select
      created_package.id,
      member.member_key,
      'approved',
      '沿用未受本次返工影响的已批准成员。',
      previous_decision.actor_id,
      previous_decision.review_package_id
    from public.pre_render_review_members member
    join lateral (
      select decision.*
      from public.pre_render_review_member_decisions decision
      join public.pre_render_review_members previous_member
        on previous_member.review_package_id = decision.review_package_id
       and previous_member.member_key = decision.member_key
      join public.review_packages previous_package on previous_package.id = decision.review_package_id
      join public.tasks previous_task on previous_task.id = previous_member.source_task_id
      where previous_member.member_key = member.member_key
        and previous_member.source_task_id = member.source_task_id
        and decision.decision = 'approved'
        and previous_package.invalidated_at is null
        and previous_task.status = 'completed'
        and previous_task.invalidated_at is null
      order by decision.created_at desc
      limit 1
    ) previous_decision on true
    where member.review_package_id = created_package.id;

    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (candidate.account_id, candidate.episode_id, 'pre_render_review_package_created', jsonb_build_object('review_package_id',created_package.id,'storyboard_review_package_id',candidate.storyboard_review_package_id,'revision_number',next_revision,'member_count',jsonb_array_length(members)), null);
    return next created_package;
  end loop;
end;
$_$;


--
-- Name: prompt_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompt_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    capability text NOT NULL,
    version integer NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    summary text NOT NULL,
    instructions text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    content_hash text NOT NULL,
    CONSTRAINT prompt_versions_capability_check CHECK ((capability = ANY (ARRAY['script_writing'::text, 'visual_planning'::text, 'storyboard_planning'::text]))),
    CONSTRAINT prompt_versions_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT prompt_versions_name_check CHECK ((char_length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT prompt_versions_summary_check CHECK ((char_length(TRIM(BOTH FROM summary)) > 0)),
    CONSTRAINT prompt_versions_version_check CHECK ((version > 0))
);


--
-- Name: create_prompt_version(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_prompt_version(p_account_id uuid, p_capability text, p_name text, p_summary text, p_instructions text DEFAULT ''::text) RETURNS public.prompt_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  membership_role public.member_role;
  next_version integer;
  created_prompt public.prompt_versions;
  prompt_slug text;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to create a prompt version' using errcode = '42501';
  end if;
  if p_capability not in ('script_writing', 'visual_planning', 'storyboard_planning') then
    raise exception 'Prompt capability is invalid' using errcode = '22023';
  end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_summary), '') = '' then
    raise exception 'Prompt name and summary are required' using errcode = '22023';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.prompt_versions
  where account_id = p_account_id and capability = p_capability;
  prompt_slug := replace(p_capability, '_', '-') || '-v' || next_version;

  insert into public.prompt_versions (account_id, capability, version, slug, name, summary, instructions, created_by)
  values (p_account_id, p_capability, next_version, prompt_slug, btrim(p_name), btrim(p_summary), coalesce(p_instructions, ''), auth.uid())
  returning * into created_prompt;

  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (p_account_id, 'prompt_version_created', jsonb_build_object('prompt_version_id', created_prompt.id, 'capability', p_capability, 'version', next_version, 'slug', prompt_slug), auth.uid());
  return created_prompt;
end;
$$;


--
-- Name: qc_review_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qc_review_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_package_id uuid NOT NULL,
    member_key text,
    at_seconds numeric NOT NULL,
    severity text NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_by uuid NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT qc_review_issues_at_seconds_check CHECK ((at_seconds >= (0)::numeric)),
    CONSTRAINT qc_review_issues_reason_check CHECK ((char_length(btrim(reason)) > 0)),
    CONSTRAINT qc_review_issues_severity_check CHECK ((severity = ANY (ARRAY['blocking'::text, 'warning'::text]))),
    CONSTRAINT qc_review_issues_status_check CHECK ((status = ANY (ARRAY['open'::text, 'accepted'::text, 'ignored'::text, 'revision_requested'::text])))
);


--
-- Name: create_qc_review_issue(uuid, text, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_qc_review_issue(p_review_package_id uuid, p_member_key text, p_at_seconds numeric, p_severity text, p_reason text) RETURNS public.qc_review_issues
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
    and package.context_snapshot ->> 'review_kind' = 'openchatcut_review_render'
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


--
-- Name: create_script_review_package(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_script_review_package() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  produced_artifact public.artifacts;
  completed_run public.task_runs;
  next_revision integer;
  created_package public.review_packages;
begin
  if new.task_type <> 'draft_script' or new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  select * into current_episode from public.episodes where id = new.episode_id for update;
  if current_episode.stage <> 'script_draft' then
    raise exception 'Script writing task can only complete from script_draft' using errcode = '22023';
  end if;
  select * into completed_run
  from public.task_runs
  where task_id = new.id and attempt = new.attempt - 1 and status = 'completed';
  if not found then
    raise exception 'Completed script writing task run is missing' using errcode = '22023';
  end if;
  select * into produced_artifact
  from public.artifacts
  where producer_task_id = new.id
    and artifact_type = 'script'
    and relative_path = new.input_snapshot #>> '{output,relative_path}';
  if not found then
    raise exception 'Script writing task is missing its frozen script artifact revision' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(completed_run.result -> 'artifacts') result_artifact
    where result_artifact ->> 'artifactType' = produced_artifact.artifact_type
      and result_artifact ->> 'relativePath' = produced_artifact.relative_path
      and result_artifact ->> 'sha256' = produced_artifact.sha256
      and (result_artifact ->> 'fileSize')::bigint = produced_artifact.file_size
  ) then
    raise exception 'Script artifact revision does not match the frozen worker result' using errcode = '22023';
  end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.review_packages
  where episode_id = new.episode_id and stage = 'script_review';

  insert into public.review_packages (
    episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot
  ) values (
    new.episode_id,
    new.id,
    completed_run.id,
    produced_artifact.id,
    'script_review',
    next_revision,
    new.input_snapshot || jsonb_build_object(
      'task_package', completed_run.task_package,
      'worker_result', completed_run.result,
      'artifact', jsonb_build_object(
        'id', produced_artifact.id,
        'relative_path', produced_artifact.relative_path,
        'sha256', produced_artifact.sha256,
        'file_size', produced_artifact.file_size
      )
    )
  ) returning * into created_package;

  update public.episodes set stage = 'script_review', updated_at = now() where id = new.episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (new.episode_id, 'script_draft', 'script_review', 'Worker submitted a frozen script review package.', null);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    new.episode_id,
    'script_review_package_created',
    jsonb_build_object('review_package_id', created_package.id, 'task_id', new.id, 'artifact_id', produced_artifact.id, 'revision_number', next_revision),
    null
  );
  return new;
end;
$$;


--
-- Name: create_script_revision_task_after_changes_requested(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_script_revision_task_after_changes_requested() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  previous_package public.review_packages;
  previous_task public.tasks;
  created_task public.tasks;
begin
  if new.stage <> 'script_review' or new.decision <> 'changes_requested' then
    return new;
  end if;
  select * into previous_package
  from public.review_packages
  where episode_id = new.episode_id and stage = 'script_review'
  order by revision_number desc
  limit 1;
  if not found then
    raise exception 'Script review package is required before requesting changes' using errcode = '22023';
  end if;
  select * into previous_task from public.tasks where id = previous_package.task_id;

  insert into public.tasks (
    episode_id, task_type, status, input_snapshot, budget_limit_cents,
    max_attempts, provider, model, prompt_version
  ) values (
    previous_task.episode_id,
    'draft_script',
    'ready',
    jsonb_set(
      previous_task.input_snapshot || jsonb_build_object(
        'review_feedback', jsonb_build_object(
          'review_package_id', previous_package.id,
          'reason', new.reason,
          'actor_id', new.actor_id
        )
      ),
      '{output,relative_path}',
      to_jsonb(format('episodes/%s/generated-script-v%s.md', new.episode_id, previous_package.revision_number + 1))
    ),
    previous_task.budget_limit_cents,
    previous_task.max_attempts,
    previous_task.provider,
    previous_task.model,
    previous_task.prompt_version
  ) returning * into created_task;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  select
    episode.account_id,
    episode.id,
    'script_revision_task_created',
    jsonb_build_object('task_id', created_task.id, 'review_package_id', previous_package.id, 'reason', new.reason),
    new.actor_id
  from public.episodes episode where episode.id = new.episode_id;
  return new;
end;
$$;


--
-- Name: series_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.series_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    series_id uuid NOT NULL,
    version integer NOT NULL,
    rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT series_versions_rules_check CHECK ((jsonb_typeof(rules) = 'object'::text)),
    CONSTRAINT series_versions_version_check CHECK ((version > 0))
);


--
-- Name: create_series(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_series(p_account_id uuid, p_name text, p_rules jsonb) RETURNS public.series_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  created_series public.series;
  created_version public.series_versions;
begin
  if not exists (select 1 from public.account_memberships where account_id = p_account_id and user_id = auth.uid() and role = 'owner') then
    raise exception 'Owner membership is required to create a series' using errcode = '42501';
  end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'Series name is required' using errcode = '22023'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' or exists (select 1 from jsonb_object_keys(p_rules) key where key not in ('positioning', 'format', 'characters', 'locations', 'visual_style', 'narrative_structure', 'restrictions')) then
    raise exception 'Series rules must contain only supported creative baseline fields' using errcode = '22023';
  end if;
  insert into public.series (account_id, name) values (p_account_id, trim(p_name)) returning * into created_series;
  insert into public.series_versions (series_id, account_id, version, rules, created_by) values (created_series.id, p_account_id, 1, p_rules, auth.uid()) returning * into created_version;
  insert into public.audit_events (account_id, event_type, payload, actor_id) values (p_account_id, 'series_created', jsonb_build_object('series_id', created_series.id, 'series_version_id', created_version.id, 'version', 1), auth.uid());
  return created_version;
end;
$$;


--
-- Name: create_series_version(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_series_version(p_series_id uuid, p_rules jsonb) RETURNS public.series_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  selected_series public.series;
  created_version public.series_versions;
  next_version integer;
begin
  select series.* into selected_series from public.series series join public.account_memberships membership on membership.account_id = series.account_id and membership.user_id = auth.uid() and membership.role = 'owner' where series.id = p_series_id for update;
  if not found then raise exception 'Owner membership is required to create a series version' using errcode = '42501'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' or exists (select 1 from jsonb_object_keys(p_rules) key where key not in ('positioning', 'format', 'characters', 'locations', 'visual_style', 'narrative_structure', 'restrictions')) then
    raise exception 'Series rules must contain only supported creative baseline fields' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.series_versions where series_id = selected_series.id;
  insert into public.series_versions (series_id, account_id, version, rules, created_by) values (selected_series.id, selected_series.account_id, next_version, p_rules, auth.uid()) returning * into created_version;
  insert into public.audit_events (account_id, event_type, payload, actor_id) values (selected_series.account_id, 'series_version_created', jsonb_build_object('series_id', selected_series.id, 'series_version_id', created_version.id, 'version', next_version), auth.uid());
  return created_version;
end;
$$;


--
-- Name: create_shot_preparation_review_package(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_shot_preparation_review_package(p_episode_id uuid, p_storyboard_review_package_id uuid) RETURNS SETOF public.review_packages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  episode_record public.episodes;
  storyboard_package public.review_packages;
  existing_package public.review_packages;
  draft public.shot_preparation_drafts;
  material public.production_material_revisions;
  audio_task public.tasks;
  audio_track public.audio_tracks;
  shot jsonb;
  member jsonb;
  members jsonb := '[]'::jsonb;
  confirmed_shots jsonb := '[]'::jsonb;
  package_record public.review_packages;
  next_revision integer;
  duration_settings jsonb;
  duration_decision jsonb;
begin
  select * into episode_record from public.episodes where id = p_episode_id;
  select * into storyboard_package from public.review_packages
  where id = p_storyboard_review_package_id and episode_id = p_episode_id and stage = 'storyboard_review' and invalidated_at is null;
  if not found or not public.has_current_shot_preparation_snapshot(p_episode_id, p_storyboard_review_package_id) then return; end if;
  duration_settings := public.shot_duration_settings(p_episode_id);

  select * into existing_package from public.review_packages
  where episode_id = p_episode_id and stage = 'production_ready' and invalidated_at is null
    and context_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text
  order by revision_number desc limit 1;
  if found then return next existing_package; return; end if;

  update public.review_packages set invalidated_at = now(), invalidated_reason = 'Superseded by the current frozen marker snapshot.'
  where episode_id = p_episode_id and stage = 'production_ready' and invalidated_at is null;

  for shot in select value from jsonb_array_elements(storyboard_package.context_snapshot #> '{worker_result,storyboard,shots}') loop
    select * into draft from public.shot_preparation_drafts
    where episode_id = p_episode_id and review_package_id = p_storyboard_review_package_id and shot_id = shot ->> 'id';
    select material_revision.* into material from public.production_material_revisions material_revision
    join public.material_revision_approvals approval on approval.material_revision_id = material_revision.id
    where material_revision.id = draft.selected_material_revision_id and material_revision.episode_id = p_episode_id;
    if not found then return; end if;

    duration_decision := public.shot_duration_decision(draft.audio_mode, case when draft.audio_mode = 'none' then null when draft.audio_mode = 'source' then draft.video_duration_seconds else draft.tts_actual_duration_seconds end, draft.video_duration_seconds, (shot ->> 'durationSeconds')::numeric, (duration_settings ->> 'frame_rate')::numeric, (duration_settings ->> 'allowed_frames')::integer, draft.video_duration_seconds);
    member := jsonb_build_object(
      'member_kind', 'shot_media', 'member_key', format('shot:%s', shot ->> 'id'), 'shot', shot,
      'input_fingerprint', draft.preparation_input_fingerprint, 'preparation_contract', draft.preparation_contract, 'audio_mode', draft.audio_mode,
      'subtitle_text', draft.subtitle_text, 'subtitles_enabled', draft.subtitles_enabled,
      'clip_segments', draft.clip_segments, 'composition', draft.composition, 'duration_seconds', draft.video_duration_seconds, 'duration_decision', duration_decision,
      'source_material', jsonb_build_object('id', material.id, 'artifact_type', 'source_video', 'relative_path', material.storage_path, 'sha256', material.sha256, 'file_size', material.file_size)
    );
    members := members || jsonb_build_array(member);

    if draft.audio_mode = 'tts' then
      select * into audio_track from public.audio_tracks where id = draft.current_audio_track_id;
      select * into audio_task from public.tasks where id = audio_track.source_task_id and status = 'completed' and invalidated_at is null;
      if not found then return; end if;
      members := members || jsonb_build_array(jsonb_build_object(
        'member_kind', 'narration', 'member_key', format('narration:%s', shot ->> 'id'), 'audio_mode', 'tts',
        'task', jsonb_build_object('id', audio_task.id, 'type', audio_task.task_type, 'attempt', audio_task.attempt, 'provider', audio_task.provider, 'model', audio_task.model, 'prompt_version', audio_task.prompt_version),
        'audio_track', jsonb_build_object('id', audio_track.id, 'kind', audio_track.track_kind, 'cue_id', audio_track.cue_id, 'relative_path', audio_track.relative_path, 'sha256', audio_track.sha256, 'file_size', audio_track.file_size, 'start_seconds', audio_track.start_seconds, 'duration_seconds', audio_track.duration_seconds)
      ));
    end if;

    confirmed_shots := confirmed_shots || jsonb_build_array(jsonb_build_object(
      'shot_id', shot ->> 'id', 'confirmation_status', 'confirmed', 'input_fingerprint', draft.preparation_input_fingerprint, 'preparation_contract', draft.preparation_contract,
      'source_material_revision_id', material.id, 'clip_segments', draft.clip_segments, 'composition', draft.composition,
      'audio_mode', draft.audio_mode, 'audio_track_id', case when draft.audio_mode = 'tts' then draft.current_audio_track_id else null end,
      'subtitle_text', draft.subtitle_text, 'subtitles_enabled', draft.subtitles_enabled, 'duration_decision', duration_decision
    ));
  end loop;

  members := members || public.storyboard_selected_audio_members(p_episode_id, p_storyboard_review_package_id);

  select coalesce(max(revision_number), 0) + 1 into next_revision from public.review_packages
  where episode_id = p_episode_id and stage = 'production_ready';
  insert into public.review_packages (episode_id, stage, revision_number, context_snapshot)
  values (p_episode_id, 'production_ready', next_revision, jsonb_build_object(
    'review_kind', 'pre_render', 'approval_mode', 'qc_only', 'confirmation_mode', 'shot_preparation',
    'storyboard_review_package_id', p_storyboard_review_package_id,
    'storyboard', storyboard_package.context_snapshot #> '{worker_result,storyboard}',
    'confirmed_shots', confirmed_shots, 'members', members
  )) returning * into package_record;

  insert into public.pre_render_review_members (review_package_id, member_key, member_kind, source_task_id, artifact_id, audio_track_id, source_material_revision_id, evidence_snapshot)
  select package_record.id, evidence ->> 'member_key', evidence ->> 'member_kind',
    case when evidence ? 'task' then (evidence #>> '{task,id}')::uuid else null end,
    null, case when evidence ? 'audio_track' then (evidence #>> '{audio_track,id}')::uuid else null end,
    case when evidence ? 'source_material' then (evidence #>> '{source_material,id}')::uuid else null end, evidence
  from jsonb_array_elements(members) evidence;
  return next package_record;
end;
$$;


--
-- Name: review_annotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_annotations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_package_id uuid NOT NULL,
    shot_id text NOT NULL,
    reason text NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_annotations_reason_check CHECK ((char_length(btrim(reason)) > 0)),
    CONSTRAINT review_annotations_shot_id_check CHECK ((char_length(btrim(shot_id)) > 0))
);


--
-- Name: create_storyboard_annotation(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_storyboard_annotation(p_review_package_id uuid, p_shot_id text, p_reason text) RETURNS public.review_annotations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  selected_package public.review_packages;
  selected_episode public.episodes;
  created_annotation public.review_annotations;
begin
  if coalesce(btrim(p_shot_id), '') = '' or coalesce(btrim(p_reason), '') = '' then
    raise exception 'Storyboard annotation requires a shot and reason' using errcode = '22023';
  end if;

  select review_package.* into selected_package
  from public.review_packages review_package
  join public.episodes episode on episode.id = review_package.episode_id
  join public.account_memberships membership on membership.account_id = episode.account_id
  where review_package.id = p_review_package_id
    and membership.user_id = auth.uid()
    and membership.role = 'owner'
  for update of review_package;
  if not found then
    raise exception 'Owner membership is required to annotate a storyboard review package' using errcode = '42501';
  end if;
  select * into selected_episode from public.episodes where id = selected_package.episode_id for update;
  if selected_package.stage <> 'storyboard_review' or selected_episode.stage <> 'storyboard_review' then
    raise exception 'Storyboard annotations are only allowed while the matching revision is under review' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.storyboard_review_shots shot
    where shot.review_package_id = p_review_package_id and shot.shot_id = btrim(p_shot_id)
  ) then
    raise exception 'Storyboard annotation shot does not exist in this frozen revision' using errcode = '22023';
  end if;

  insert into public.review_annotations (review_package_id, shot_id, reason, actor_id)
  values (p_review_package_id, btrim(p_shot_id), btrim(p_reason), auth.uid())
  returning * into created_annotation;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    selected_episode.account_id,
    selected_episode.id,
    'storyboard_annotation_created',
    jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', btrim(p_shot_id), 'annotation_id', created_annotation.id),
    auth.uid()
  );
  return created_annotation;
end;
$$;


--
-- Name: create_storyboard_review_package(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_storyboard_review_package() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  current_episode public.episodes;
  produced_artifact public.artifacts;
  completed_run public.task_runs;
  next_revision integer;
  created_package public.review_packages;
  storyboard_shot jsonb;
begin
  if new.task_type <> 'draft_storyboard' or new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  select * into current_episode from public.episodes where id = new.episode_id for update;
  if current_episode.stage <> 'storyboard_draft' then
    raise exception 'Storyboard planning task can only complete from storyboard_draft' using errcode = '22023';
  end if;
  select * into completed_run
  from public.task_runs
  where task_id = new.id and attempt = new.attempt - 1 and status = 'completed';
  if not found then
    raise exception 'Completed storyboard planning task run is missing' using errcode = '22023';
  end if;
  if jsonb_typeof(completed_run.result -> 'storyboard') <> 'object'
    or completed_run.result #>> '{storyboard,version}' <> 'storyboard/v1' then
    raise exception 'Storyboard planning task has invalid storyboard content' using errcode = '22023';
  end if;
  if jsonb_typeof(completed_run.result #> '{storyboard,shots}') <> 'array'
    or jsonb_array_length(completed_run.result #> '{storyboard,shots}') = 0 then
    raise exception 'Storyboard planning task has no reviewable shots' using errcode = '22023';
  end if;
  if exists (
    select 1
    from (
      select shot ->> 'id' as shot_id
      from jsonb_array_elements(completed_run.result #> '{storyboard,shots}') shot
    ) shot_ids
    group by shot_id
    having count(*) > 1
  ) then
    raise exception 'Storyboard planning task has duplicate shot IDs' using errcode = '22023';
  end if;
  for storyboard_shot in select value from jsonb_array_elements(completed_run.result #> '{storyboard,shots}')
  loop
    if jsonb_typeof(storyboard_shot) <> 'object'
      or coalesce(btrim(storyboard_shot ->> 'id'), '') = ''
      or coalesce(btrim(storyboard_shot ->> 'scriptSegment'), '') = ''
      or coalesce(btrim(storyboard_shot ->> 'productionMethod'), '') = ''
      or coalesce(btrim(storyboard_shot ->> 'targetSpec'), '') = ''
      or jsonb_typeof(storyboard_shot -> 'durationSeconds') <> 'number'
      or (storyboard_shot ->> 'durationSeconds')::numeric <= 0
      or storyboard_shot ->> 'shotType' not in ('a_roll', 'b_roll')
      or jsonb_typeof(storyboard_shot -> 'inputBasis') <> 'array'
      or jsonb_array_length(storyboard_shot -> 'inputBasis') = 0 then
      raise exception 'Storyboard planning task has an invalid shot' using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(storyboard_shot -> 'inputBasis') input_basis
      where jsonb_typeof(input_basis) <> 'object'
        or coalesce(btrim(input_basis ->> 'relativePath'), '') = ''
        or input_basis ->> 'sha256' !~ '^[0-9a-f]{64}$'
        or not exists (
          select 1 from jsonb_array_elements(new.input_snapshot -> 'input_artifacts') frozen_input
          where frozen_input ->> 'relativePath' = input_basis ->> 'relativePath'
            and frozen_input ->> 'sha256' = input_basis ->> 'sha256'
        )
    ) then
      raise exception 'Storyboard planning task references a non-frozen input' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from jsonb_array_elements(new.input_snapshot -> 'input_artifacts') frozen_input
      join jsonb_array_elements(storyboard_shot -> 'inputBasis') input_basis
        on input_basis ->> 'relativePath' = frozen_input ->> 'relativePath'
       and input_basis ->> 'sha256' = frozen_input ->> 'sha256'
      where frozen_input ->> 'artifactType' = 'main_script'
    ) then
      raise exception 'Storyboard shot must trace to the frozen main script' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from jsonb_array_elements(new.input_snapshot -> 'input_artifacts') frozen_input
      join jsonb_array_elements(storyboard_shot -> 'inputBasis') input_basis
        on input_basis ->> 'relativePath' = frozen_input ->> 'relativePath'
       and input_basis ->> 'sha256' = frozen_input ->> 'sha256'
      where frozen_input ->> 'artifactType' <> 'main_script'
    ) then
      raise exception 'Storyboard shot must trace to approved visual inputs' using errcode = '22023';
    end if;
  end loop;

  select * into produced_artifact
  from public.artifacts
  where producer_task_id = new.id
    and artifact_type = 'storyboard'
    and relative_path = new.input_snapshot #>> '{output,relative_path}';
  if not found then
    raise exception 'Storyboard planning task is missing its frozen storyboard artifact revision' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(completed_run.result -> 'artifacts') result_artifact
    where result_artifact ->> 'artifactType' = produced_artifact.artifact_type
      and result_artifact ->> 'relativePath' = produced_artifact.relative_path
      and result_artifact ->> 'sha256' = produced_artifact.sha256
      and (result_artifact ->> 'fileSize')::bigint = produced_artifact.file_size
  ) then
    raise exception 'Storyboard artifact revision does not match the frozen worker result' using errcode = '22023';
  end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.review_packages
  where episode_id = new.episode_id and stage = 'storyboard_review';

  insert into public.review_packages (
    episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot
  ) values (
    new.episode_id,
    new.id,
    completed_run.id,
    produced_artifact.id,
    'storyboard_review',
    next_revision,
    new.input_snapshot || jsonb_build_object(
      'task_package', completed_run.task_package,
      'worker_result', completed_run.result,
      'artifact', jsonb_build_object(
        'id', produced_artifact.id,
        'relative_path', produced_artifact.relative_path,
        'sha256', produced_artifact.sha256,
        'file_size', produced_artifact.file_size
      )
    )
  ) returning * into created_package;

  insert into public.storyboard_review_shots (review_package_id, shot_id)
  select created_package.id, btrim(shot ->> 'id')
  from jsonb_array_elements(completed_run.result #> '{storyboard,shots}') shot;

  update public.episodes set stage = 'storyboard_review', updated_at = now() where id = new.episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (new.episode_id, 'storyboard_draft', 'storyboard_review', 'Worker submitted a frozen storyboard review package.', null);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    new.episode_id,
    'storyboard_review_package_created',
    jsonb_build_object('review_package_id', created_package.id, 'task_id', new.id, 'artifact_id', produced_artifact.id, 'revision_number', next_revision),
    null
  );
  return new;
end;
$_$;


--
-- Name: create_storyboard_revision_review_package(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_storyboard_revision_review_package() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  completed_run public.task_runs;
  produced_artifact public.artifacts;
  package public.review_packages;
  next_revision integer;
  requested_by uuid;
begin
  if new.task_type <> 'draft_storyboard_revision' or new.status <> 'completed' or old.status = 'completed' then return new; end if;

  select * into current_episode from public.episodes where id = new.episode_id for update;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Storyboard revision must complete from storyboard_approved' using errcode = '22023'; end if;
  if not exists (
    select 1
    from public.review_packages base_package
    join public.approvals base_approval
      on base_approval.review_package_id = base_package.id
     and base_approval.stage = 'storyboard_approved'
     and base_approval.decision = 'approved'
    where base_package.id = (new.input_snapshot #>> '{storyboard_revision,base_review_package_id}')::uuid
      and base_package.episode_id = new.episode_id
      and base_package.stage = 'storyboard_review'
      and base_package.invalidated_at is null
      and base_package.revision_number = (
        select max(current_package.revision_number)
        from public.review_packages current_package
        join public.approvals current_approval
          on current_approval.review_package_id = current_package.id
         and current_approval.stage = 'storyboard_approved'
         and current_approval.decision = 'approved'
        where current_package.episode_id = new.episode_id
          and current_package.stage = 'storyboard_review'
          and current_package.invalidated_at is null
      )
  ) then
    raise exception 'Storyboard structure revision base package is stale' using errcode = '22023';
  end if;

  select * into completed_run from public.task_runs where task_id = new.id and attempt = new.attempt - 1 and status = 'completed';
  if not found or jsonb_typeof(completed_run.result -> 'storyboard') <> 'object' or completed_run.result #>> '{storyboard,version}' <> 'storyboard/v1' or jsonb_typeof(completed_run.result #> '{storyboard,shots}') <> 'array' or jsonb_array_length(completed_run.result #> '{storyboard,shots}') = 0 then raise exception 'Completed storyboard revision result is invalid' using errcode = '22023'; end if;
  if exists (select 1 from (select value ->> 'id' as shot_id from jsonb_array_elements(completed_run.result #> '{storyboard,shots}') value) ids group by shot_id having count(*) > 1) then raise exception 'Completed storyboard revision contains duplicate shot IDs' using errcode = '22023'; end if;

  select * into produced_artifact from public.artifacts where producer_task_id = new.id and artifact_type = 'storyboard' and relative_path = new.input_snapshot #>> '{output,relative_path}';
  if not found or not exists (select 1 from jsonb_array_elements(completed_run.result -> 'artifacts') result_artifact where result_artifact ->> 'artifactType' = produced_artifact.artifact_type and result_artifact ->> 'relativePath' = produced_artifact.relative_path and result_artifact ->> 'sha256' = produced_artifact.sha256 and (result_artifact ->> 'fileSize')::bigint = produced_artifact.file_size) then raise exception 'Storyboard revision artifact is missing or mismatched' using errcode = '22023'; end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision from public.review_packages where episode_id = new.episode_id and stage = 'storyboard_review';
  insert into public.review_packages (episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot)
  values (new.episode_id, new.id, completed_run.id, produced_artifact.id, 'storyboard_review', next_revision, new.input_snapshot || jsonb_build_object('task_package', completed_run.task_package, 'worker_result', completed_run.result, 'artifact', jsonb_build_object('id', produced_artifact.id, 'relative_path', produced_artifact.relative_path, 'sha256', produced_artifact.sha256, 'file_size', produced_artifact.file_size)))
  returning * into package;

  insert into public.storyboard_review_shots (review_package_id, shot_id)
  select package.id, value ->> 'id' from jsonb_array_elements(completed_run.result #> '{storyboard,shots}');

  select event.actor_id into requested_by
  from public.audit_events event
  where event.episode_id = new.episode_id
    and event.event_type = 'storyboard_structure_revision_requested'
    and event.payload ->> 'task_id' = new.id::text
    and event.actor_id is not null
  order by event.created_at desc, event.id desc
  limit 1;
  if requested_by is null then
    raise exception 'Storyboard structure revision requester is missing' using errcode = '22023';
  end if;

  insert into public.approvals (episode_id, stage, decision, reason, actor_id, review_package_id)
  values (new.episode_id, 'storyboard_approved', 'approved', 'Owner applied a deterministic storyboard structure revision.', requested_by, package.id);

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, new.episode_id, 'storyboard_structure_revision_applied', jsonb_build_object('review_package_id', package.id, 'task_id', new.id, 'base_review_package_id', new.input_snapshot #>> '{storyboard_revision,base_review_package_id}', 'input_fingerprint', new.input_snapshot #>> '{storyboard_revision,input_fingerprint}', 'revision_number', next_revision, 'operation', new.input_snapshot #> '{storyboard_revision,operation}'), requested_by);
  return new;
end;
$$;


--
-- Name: create_storyboard_revision_task_after_changes_requested(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_storyboard_revision_task_after_changes_requested() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  previous_package public.review_packages;
  previous_task public.tasks;
  created_task public.tasks;
  annotations jsonb;
begin
  if new.stage <> 'storyboard_review' or new.decision <> 'changes_requested' then
    return new;
  end if;
  select * into previous_package
  from public.review_packages
  where id = new.review_package_id and episode_id = new.episode_id and stage = 'storyboard_review';
  if not found then
    raise exception 'Storyboard review package is required before requesting changes' using errcode = '22023';
  end if;
  select * into previous_task from public.tasks where id = previous_package.task_id;
  select coalesce(jsonb_agg(jsonb_build_object('shot_id', annotation.shot_id, 'reason', annotation.reason) order by annotation.created_at, annotation.id), '[]'::jsonb)
  into annotations
  from public.review_annotations annotation
  where annotation.review_package_id = previous_package.id;

  insert into public.tasks (
    episode_id, task_type, status, input_snapshot, budget_limit_cents,
    max_attempts, provider, model, prompt_version
  ) values (
    previous_task.episode_id,
    'draft_storyboard',
    'ready',
    jsonb_set(
      previous_task.input_snapshot || jsonb_build_object(
        'review_feedback', jsonb_build_object(
          'review_package_id', previous_package.id,
          'reason', new.reason,
          'actor_id', new.actor_id
        ),
        'review_annotations', annotations
      ),
      '{output,relative_path}',
      to_jsonb(format('episodes/%s/storyboard-v%s.json', new.episode_id, previous_package.revision_number + 1))
    ),
    previous_task.budget_limit_cents,
    previous_task.max_attempts,
    previous_task.provider,
    previous_task.model,
    previous_task.prompt_version
  ) returning * into created_task;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  select
    episode.account_id,
    episode.id,
    'storyboard_revision_task_created',
    jsonb_build_object('task_id', created_task.id, 'review_package_id', previous_package.id, 'reason', new.reason, 'annotation_count', jsonb_array_length(annotations)),
    new.actor_id
  from public.episodes episode where episode.id = new.episode_id;
  return new;
end;
$$;


--
-- Name: create_visual_review_package(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_visual_review_package() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  produced_artifact public.artifacts;
  completed_run public.task_runs;
  required_artifact_type text;
  primary_artifact_type text;
  next_revision integer;
  created_package public.review_packages;
begin
  if new.task_type <> 'prepare_visual_brief' or new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  select * into current_episode from public.episodes where id = new.episode_id for update;
  if current_episode.stage <> 'visual_draft' then
    raise exception 'Visual asset preparation can only complete from visual_draft' using errcode = '22023';
  end if;
  select * into completed_run
  from public.task_runs
  where task_id = new.id and attempt = new.attempt - 1 and status = 'completed';
  if not found then
    raise exception 'Completed visual asset preparation task run is missing' using errcode = '22023';
  end if;
  if jsonb_typeof(new.input_snapshot #> '{output,required_artifact_types}') <> 'array' then
    raise exception 'Visual asset preparation task has invalid required artifact types' using errcode = '22023';
  end if;
  for required_artifact_type in
    select jsonb_array_elements_text(new.input_snapshot #> '{output,required_artifact_types}')
  loop
    if coalesce(btrim(required_artifact_type), '') = '' then
      raise exception 'Visual asset preparation task has an empty required artifact type' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.artifacts artifact
      join lateral jsonb_array_elements(completed_run.result -> 'artifacts') result_artifact on true
      where artifact.producer_task_id = new.id
        and artifact.artifact_type = required_artifact_type
        and result_artifact ->> 'artifactType' = artifact.artifact_type
        and result_artifact ->> 'relativePath' = artifact.relative_path
        and result_artifact ->> 'sha256' = artifact.sha256
        and (result_artifact ->> 'fileSize')::bigint = artifact.file_size
    ) then
      raise exception 'Visual asset preparation task is missing required % artifact revision', required_artifact_type using errcode = '22023';
    end if;
  end loop;

  primary_artifact_type := case
    when new.input_snapshot #> '{output,required_artifact_types}' @> jsonb_build_array('visual_asset_manifest') then 'visual_asset_manifest'
    else 'visual_brief'
  end;
  select * into produced_artifact
  from public.artifacts
  where producer_task_id = new.id
    and artifact_type = primary_artifact_type
    and relative_path = new.input_snapshot #>> '{output,relative_path}';
  if not found then
    raise exception 'Visual asset preparation task is missing its frozen % artifact revision', primary_artifact_type using errcode = '22023';
  end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.review_packages
  where episode_id = new.episode_id and stage = 'visual_review';

  insert into public.review_packages (
    episode_id, task_id, task_run_id, artifact_id, stage, revision_number, context_snapshot
  ) values (
    new.episode_id,
    new.id,
    completed_run.id,
    produced_artifact.id,
    'visual_review',
    next_revision,
    new.input_snapshot || jsonb_build_object(
      'task_package', completed_run.task_package,
      'worker_result', completed_run.result,
      'artifact', jsonb_build_object(
        'id', produced_artifact.id,
        'relative_path', produced_artifact.relative_path,
        'sha256', produced_artifact.sha256,
        'file_size', produced_artifact.file_size
      ),
      'generated_artifacts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', artifact.id,
          'artifact_type', artifact.artifact_type,
          'relative_path', artifact.relative_path,
          'sha256', artifact.sha256,
          'file_size', artifact.file_size
        ) order by artifact.created_at, artifact.id)
        from public.artifacts artifact
        where artifact.producer_task_id = new.id
      ), '[]'::jsonb)
    )
  ) returning * into created_package;

  update public.episodes set stage = 'visual_review', updated_at = now() where id = new.episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (new.episode_id, 'visual_draft', 'visual_review', 'Worker submitted a frozen visual asset review package.', null);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    new.episode_id,
    'visual_review_package_created',
    jsonb_build_object(
      'review_package_id', created_package.id,
      'task_id', new.id,
      'artifact_id', produced_artifact.id,
      'revision_number', next_revision
    ),
    null
  );
  return new;
end;
$$;


--
-- Name: create_visual_revision_task_after_changes_requested(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_visual_revision_task_after_changes_requested() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  previous_package public.review_packages;
  previous_task public.tasks;
  created_task public.tasks;
  next_output_path text;
begin
  if new.stage <> 'visual_review' or new.decision <> 'changes_requested' then
    return new;
  end if;
  select * into previous_package
  from public.review_packages
  where episode_id = new.episode_id and stage = 'visual_review'
  order by revision_number desc
  limit 1;
  if not found then
    raise exception 'Visual review package is required before requesting changes' using errcode = '22023';
  end if;
  select * into previous_task from public.tasks where id = previous_package.task_id;
  next_output_path := case
    when previous_task.input_snapshot #> '{output,required_artifact_types}' @> jsonb_build_array('visual_asset_manifest')
    then format('episodes/%s/visual-assets-v%s.md', new.episode_id, previous_package.revision_number + 1)
    else format('episodes/%s/visual-brief-v%s.md', new.episode_id, previous_package.revision_number + 1)
  end;

  insert into public.tasks (
    episode_id, task_type, status, input_snapshot, budget_limit_cents,
    max_attempts, provider, model, prompt_version
  ) values (
    previous_task.episode_id,
    previous_task.task_type,
    'ready',
    jsonb_set(
      previous_task.input_snapshot || jsonb_build_object(
        'review_feedback', jsonb_build_object(
          'review_package_id', previous_package.id,
          'reason', new.reason,
          'actor_id', new.actor_id
        )
      ),
      '{output,relative_path}',
      to_jsonb(next_output_path)
    ),
    previous_task.budget_limit_cents,
    previous_task.max_attempts,
    previous_task.provider,
    previous_task.model,
    previous_task.prompt_version
  ) returning * into created_task;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  select
    episode.account_id,
    episode.id,
    'visual_revision_task_created',
    jsonb_build_object('task_id', created_task.id, 'review_package_id', previous_package.id, 'reason', new.reason),
    new.actor_id
  from public.episodes episode where episode.id = new.episode_id;
  return new;
end;
$$;


--
-- Name: current_openchatcut_review_package(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_openchatcut_review_package(p_review_package_id uuid, p_allow_failed_review_render boolean DEFAULT false) RETURNS public.review_packages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
    and package.context_snapshot ->> 'review_kind' = 'openchatcut_review_render';
  if not found then raise exception 'Current OpenChatCut review package is required' using errcode = '22023'; end if;

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


--
-- Name: deactivate_blueprint_version(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deactivate_blueprint_version(p_account_id uuid, p_blueprint_version_id uuid) RETURNS public.account_blueprint_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  membership_role public.member_role;
  deactivated_blueprint public.account_blueprint_versions;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to deactivate a blueprint version' using errcode = '42501';
  end if;
  select blueprint.* into deactivated_blueprint
  from public.account_blueprint_versions blueprint
  join public.accounts account on account.id = blueprint.account_id
  where blueprint.account_id = p_account_id
    and blueprint.id = p_blueprint_version_id
    and blueprint.is_active
    and account.current_blueprint_version_id = blueprint.id
  for update;
  if not found then
    raise exception 'Only the current active blueprint can be deactivated' using errcode = '22023';
  end if;
  update public.account_blueprint_versions
  set is_active = false
  where id = p_blueprint_version_id
  returning * into deactivated_blueprint;
  update public.accounts set current_blueprint_version_id = null where id = p_account_id;
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (p_account_id, 'blueprint_version_deactivated', jsonb_build_object('blueprint_version_id', p_blueprint_version_id, 'version', deactivated_blueprint.version), auth.uid());
  return deactivated_blueprint;
end;
$$;


--
-- Name: delete_account(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_account(p_account_id uuid, p_confirmation text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  membership_role public.member_role;
  account_name text;
  episode_count integer;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid()
  for update;
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to delete an account' using errcode = '42501';
  end if;

  select name into account_name
  from public.accounts
  where id = p_account_id
  for update;
  if not found then
    raise exception 'Account does not exist' using errcode = 'P0002';
  end if;
  if btrim(coalesce(p_confirmation, '')) <> account_name then
    raise exception 'Account name confirmation does not match' using errcode = '22023';
  end if;

  select count(*)::integer into episode_count
  from public.episodes
  where account_id = p_account_id;
  if episode_count > 0 then
    raise exception 'Accounts with production orders cannot be deleted' using errcode = '23503';
  end if;

  delete from public.accounts where id = p_account_id;
  return true;
end;
$$;


--
-- Name: delete_episode(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_episode(p_episode_id uuid, p_actor_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  membership_role public.member_role;
  deleted_at timestamptz := now();
  task_count bigint;
  artifact_count bigint;
  approval_count bigint;
  transition_count bigint;
  audit_event_count bigint;
  material_count bigint;
  review_package_count bigint;
  audio_track_count bigint;
  audio_annotation_count bigint;
  composition_revision_count bigint;
  review_annotation_count bigint;
  pre_render_member_count bigint;
  pre_render_decision_count bigint;
  dependency_count bigint;
  invalidation_count bigint;
  experiment_count bigint;
  metric_snapshot_count bigint;
  asset_lock_count bigint;
begin
  select episode.* into current_episode
  from public.episodes episode
  where episode.id = p_episode_id
  for update;
  if not found then
    raise exception 'Episode % does not exist', p_episode_id using errcode = 'P0002';
  end if;

  select role into membership_role
  from public.account_memberships
  where account_id = current_episode.account_id and user_id = p_actor_id;
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to delete an episode' using errcode = '42501';
  end if;
  if not current_episode.is_test then
    raise exception 'Only test Episodes can be permanently deleted' using errcode = '42501';
  end if;
  if current_episode.archived_at is null then
    raise exception 'Episode must be archived before it can be permanently deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.tasks where episode_id = p_episode_id and status = 'running') then
    raise exception 'Episode has a running Worker task; wait for it to finish before deleting' using errcode = '55000';
  end if;
  if exists (select 1 from public.asset_locks where episode_id = p_episode_id and expires_at > now()) then
    raise exception 'Episode has an active asset lock; wait for it to expire before deleting' using errcode = '55000';
  end if;

  select count(*) into task_count from public.tasks where episode_id = p_episode_id;
  select count(*) into artifact_count from public.artifacts where episode_id = p_episode_id;
  select count(*) into approval_count from public.approvals where episode_id = p_episode_id;
  select count(*) into transition_count from public.state_transitions where episode_id = p_episode_id;
  select count(*) into audit_event_count from public.audit_events where episode_id = p_episode_id;
  select count(*) into material_count from public.production_material_revisions where episode_id = p_episode_id;
  select count(*) into review_package_count from public.review_packages where episode_id = p_episode_id;
  select count(*) into audio_track_count from public.audio_tracks where episode_id = p_episode_id;
  select count(*) into audio_annotation_count from public.audio_track_annotations where audio_track_id in (select id from public.audio_tracks where episode_id = p_episode_id);
  select count(*) into composition_revision_count from public.review_render_composition_revisions where episode_id = p_episode_id;
  select count(*) into review_annotation_count from public.review_annotations where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into pre_render_member_count from public.pre_render_review_members where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into pre_render_decision_count from public.pre_render_review_member_decisions where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into dependency_count from public.production_dependencies where episode_id = p_episode_id;
  select count(*) into invalidation_count from public.production_invalidations where episode_id = p_episode_id;
  select count(*) into experiment_count from public.experiments where episode_id = p_episode_id;
  select count(*) into metric_snapshot_count from public.metric_snapshots where episode_id = p_episode_id;
  select count(*) into asset_lock_count from public.asset_locks where episode_id = p_episode_id;

  delete from public.pre_render_review_member_decisions
  where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  delete from public.pre_render_review_members
  where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  delete from public.audio_track_annotations
  where audio_track_id in (select id from public.audio_tracks where episode_id = p_episode_id);
  delete from public.audio_tracks where episode_id = p_episode_id;
  delete from public.review_render_composition_revisions where episode_id = p_episode_id;
  delete from public.approvals where episode_id = p_episode_id;
  delete from public.review_packages where episode_id = p_episode_id;

  update public.episodes
  set main_script_revision_id = null
  where id = p_episode_id;
  delete from public.episodes where id = p_episode_id;

  return jsonb_build_object(
    'episode_id', p_episode_id,
    'account_id', current_episode.account_id,
    'title', current_episode.title,
    'deleted_at', deleted_at,
    'counts', jsonb_build_object(
      'tasks', task_count,
      'artifacts', artifact_count,
      'approvals', approval_count,
      'state_transitions', transition_count,
      'audit_events', audit_event_count,
      'production_material_revisions', material_count,
      'review_packages', review_package_count,
      'audio_tracks', audio_track_count,
      'audio_track_annotations', audio_annotation_count,
      'review_render_composition_revisions', composition_revision_count,
      'review_annotations', review_annotation_count,
      'pre_render_review_members', pre_render_member_count,
      'pre_render_review_member_decisions', pre_render_decision_count,
      'production_dependencies', dependency_count,
      'production_invalidations', invalidation_count,
      'experiments', experiment_count,
      'metric_snapshots', metric_snapshot_count,
      'asset_locks', asset_lock_count
    )
  );
end;
$$;


--
-- Name: delete_external_connection_version(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_external_connection_version(p_version_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare selected_version public.external_connection_versions;
begin
  select version.* into selected_version from public.external_connection_versions version join public.external_connections connection on connection.id = version.connection_id where version.id = p_version_id and connection.created_by = auth.uid() for update of version;
  if not found then raise exception 'External connection version does not exist' using errcode = 'P0002'; end if;
  if selected_version.id = (select current_version_id from public.external_connections where id = selected_version.connection_id) then raise exception 'Current external connection version cannot be deleted' using errcode = '22023'; end if;
  if selected_version.revoked_at is not null or exists (select 1 from public.external_connection_verifications where connection_version_id = selected_version.id) then raise exception 'Only an unverified draft connection version can be deleted' using errcode = '22023'; end if;
  if exists (select 1 from public.account_blueprint_versions blueprint where blueprint.policy @> jsonb_build_object('credential_ref', selected_version.id::text) or blueprint.policy @> jsonb_build_object('b_roll', jsonb_build_object('credential_ref', selected_version.id::text)) or blueprint.policy @> jsonb_build_object('narration', jsonb_build_object('credential_ref', selected_version.id::text)) or blueprint.policy @> jsonb_build_object('soundtrack', jsonb_build_object('credential_ref', selected_version.id::text)) or blueprint.policy @> jsonb_build_object('static_visual', jsonb_build_object('credential_ref', selected_version.id::text))) or exists (select 1 from public.tasks task where task.input_snapshot::text like '%' || selected_version.id::text || '%') then raise exception 'Referenced external connection version cannot be deleted' using errcode = '22023'; end if;
  perform vault.delete_secret(selected_version.vault_secret_id);
  delete from public.external_connection_versions where id = selected_version.id;
end;
$$;


--
-- Name: expire_shot_acoustic_alignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_shot_acoustic_alignment() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if old.acoustic_alignment is not null and new.acoustic_alignment is not distinct from old.acoustic_alignment and (
    old.current_audio_track_id is distinct from new.current_audio_track_id or old.subtitle_text is distinct from new.subtitle_text or old.tts_text is distinct from new.tts_text or old.tts_voice is distinct from new.tts_voice or old.tts_speaking_rate is distinct from new.tts_speaking_rate
  ) then
    new.acoustic_alignment := old.acoustic_alignment || jsonb_build_object('status','stale','detail','音频、字幕正文、音色或语速已变化；上一版成功时序仅作历史参考，不能用于当前确认。','generatedAt',now());
    if new.caption_contract is not null then new.caption_contract := jsonb_set(new.caption_contract, '{cues}', '[]'::jsonb); end if;
  end if;
  return new;
end;
$$;


--
-- Name: expire_shot_sync_preview(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_shot_sync_preview() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if old.preparation_input_fingerprint is distinct from new.preparation_input_fingerprint then
    new.pending_preview_task_id := null;
    new.preview_status := case when old.current_preview_artifact_id is null then 'pending' else 'ready' end;
    new.preview_error := null;
    new.confirmation_status := 'pending';
    new.confirmation_reason := null;
    new.confirmed_at := null;
    new.confirmed_by := null;
  end if;
  return new;
end;
$$;


--
-- Name: final_render_reuse_source(uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.final_render_reuse_source(p_task_id uuid, p_attempt integer, p_lease_token uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 select jsonb_build_object('reviewPackageId',p.id,'inputsMatch',source.input_snapshot->'review_render'=t.input_snapshot#>'{final_render,review_render}','video',case when v.id is null then null else jsonb_build_object('artifactType',v.artifact_type,'relativePath',v.relative_path,'sha256',v.sha256,'fileSize',v.file_size) end)
 from public.tasks t
 join public.episodes e on e.id=t.episode_id and e.stage='qc_passed'
 join public.review_packages p on p.id=(t.input_snapshot#>>'{final_render,source_review_package_id}')::uuid and p.episode_id=e.id and p.stage='qc_review' and p.invalidated_at is null
 join public.tasks source on source.id=p.task_id and source.episode_id=e.id and source.status='completed' and source.provider='openchatcut' and source.task_type='generate_review_render'
 left join lateral(select a.* from public.artifacts a where a.id=p.artifact_id and a.episode_id=e.id and a.producer_task_id=source.id and a.artifact_type in ('render','review_render_video') order by a.created_at desc,a.id limit 1)v on true
 where t.id=p_task_id and t.task_type='generate_final_render' and t.status='running' and t.attempt=p_attempt+1 and p_lease_token is not null and t.lease_token=p_lease_token and exists(select 1 from public.task_runs r where r.task_id=t.id and r.attempt=p_attempt and r.lease_token=p_lease_token and r.status='running') and t.claimed_at>now()-interval '30 minutes'

 and exists(select 1 from public.approvals a join public.account_memberships m on m.account_id=e.account_id and m.user_id=a.actor_id and m.role='owner' where a.review_package_id=p.id and a.episode_id=e.id and a.stage='qc_passed' and a.decision='approved');
$$;


--
-- Name: finish_notification_delivery(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_notification_delivery(p_event_id uuid, p_delivery_token uuid, p_outcome text) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 if p_outcome not in ('accepted','skipped','uncertain') then raise exception 'Invalid delivery outcome'; end if;
 update public.notification_delivery_events set outcome=p_outcome,completed_at=clock_timestamp()
 where event_id=p_event_id and delivery_token=p_delivery_token and outcome='reserved';
 return found;
end $$;


--
-- Name: freeze_manual_clip_on_pre_render_member(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_manual_clip_on_pre_render_member() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare clip_selection jsonb;
begin
  if new.member_kind = 'shot_media' then
    select task.input_snapshot -> 'clip_selection' into clip_selection from public.tasks task where task.id = new.source_task_id;
    if jsonb_typeof(clip_selection) = 'object' then new.evidence_snapshot := jsonb_set(new.evidence_snapshot, '{clip_selection}', clip_selection, true); end if;
  end if;
  return new;
end;
$$;


--
-- Name: freeze_manual_media_configuration_hash(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_manual_media_configuration_hash() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.provider = 'manual_upload' then new.input_snapshot := public.normalize_manual_media_task(new.episode_id, new.input_snapshot); end if;
  return new;
end;
$$;


--
-- Name: freeze_openai_image_generation_config(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_openai_image_generation_config() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  blueprint_policy jsonb;
  image_generation jsonb;
begin
  if new.task_type <> 'prepare_visual_brief' then
    return new;
  end if;

  select policy into blueprint_policy
  from public.account_blueprint_versions
  where id = (select blueprint_version_id from public.episodes where id = new.episode_id);
  image_generation := new.input_snapshot #> '{visual_assets,image_generation}';
  if image_generation is null then
    return new;
  end if;

  new.input_snapshot := jsonb_set(
    new.input_snapshot,
    '{visual_assets,image_generation}',
    jsonb_build_object(
      'provider', blueprint_policy #>> '{static_visual,executor,provider}',
      'adapter', blueprint_policy #>> '{static_visual,executor,adapter}',
      'model', blueprint_policy #>> '{static_visual,executor,model}',
      'credential_ref', blueprint_policy #>> '{static_visual,credential_ref}',
      'budget_cents', blueprint_policy #> '{static_visual,budget_cents}',
      'max_attempts', blueprint_policy #> '{static_visual,max_attempts}'
    )
  );
  return new;
end;
$$;


--
-- Name: freeze_owner_connection_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_owner_connection_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare policy jsonb; config_key text; ref text; image jsonb;
begin
  if new.provider = 'manual_upload' then return new; end if;
  select blueprint.policy into policy from public.episodes episode join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = new.episode_id;
  config_key := case new.task_type when 'generate_b_roll' then 'b_roll' when 'generate_narration' then 'narration' when 'generate_soundtrack' then 'soundtrack' else null end;
  if config_key is not null then
    ref := nullif(btrim(policy #>> array[config_key, 'credential_ref']), '');
    if ref is not null and new.input_snapshot ->> 'credential_ref' is null then new.input_snapshot := jsonb_set(coalesce(new.input_snapshot, '{}'::jsonb), '{credential_ref}', to_jsonb(ref), true); end if;
  elsif new.task_type = 'prepare_visual_brief' then
    image := new.input_snapshot #> '{visual_assets,image_generation}';
    ref := nullif(btrim(policy #>> '{static_visual,credential_ref}'), '');
    if jsonb_typeof(image) = 'object' and ref is not null and image ->> 'credential_ref' is null then new.input_snapshot := jsonb_set(new.input_snapshot, '{visual_assets,image_generation,credential_ref}', to_jsonb(ref), true); end if;
  end if;
  return new;
end;
$$;


--
-- Name: freeze_prepared_clips_on_review_render_task(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_prepared_clips_on_review_render_task() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare package_id uuid; member jsonb; clip_selection jsonb; prepared_members jsonb := '[]'::jsonb;
begin
  if new.task_type <> 'generate_review_render' or new.input_snapshot ->> 'capability' <> 'review_rendering' then return new; end if;
  package_id := (new.input_snapshot #>> '{review_render,pre_render_review_package_id}')::uuid;
  for member in select value from jsonb_array_elements(new.input_snapshot #> '{review_render,members}') loop
    if member ->> 'member_kind' = 'shot_media' then
      select evidence_snapshot -> 'clip_selection' into clip_selection
      from public.pre_render_review_members
      where review_package_id = package_id and member_key = member ->> 'member_key';
      if jsonb_typeof(clip_selection) = 'object' then
        member := jsonb_set(jsonb_set(member, '{start_seconds}', clip_selection -> 'start_seconds', true), '{duration_seconds}', clip_selection -> 'duration_seconds', true);
      end if;
    end if;
    prepared_members := prepared_members || jsonb_build_array(member);
  end loop;
  new.input_snapshot := jsonb_set(new.input_snapshot, '{review_render,members}', prepared_members, true);
  return new;
end;
$$;


--
-- Name: freeze_prompt_harness(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_prompt_harness() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if coalesce(btrim(new.instructions), '') = '' then
    raise exception 'Prompt Harness content is required' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (
    new.account_id is distinct from old.account_id
    or new.capability is distinct from old.capability
    or new.version is distinct from old.version
    or new.slug is distinct from old.slug
    or new.name is distinct from old.name
    or new.summary is distinct from old.summary
    or new.instructions is distinct from old.instructions
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Prompt Harness content is immutable';
  end if;

  new.content_hash := encode(extensions.digest(new.instructions, 'sha256'), 'hex');
  return new;
end;
$$;


--
-- Name: freeze_shared_planning_harness(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_shared_planning_harness() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  planning_executor jsonb;
  planning_capability text;
  selected_harness public.prompt_versions;
begin
  if new.task_type <> 'prepare_visual_brief' or new.input_snapshot ->> 'capability' <> 'visual_planning' or new.input_snapshot ? 'harness' then
    return new;
  end if;

  select blueprint.policy #> array['executors', case when blueprint.is_snapshot then 'visual_planning' else 'storyboard_planning' end],
         case when blueprint.is_snapshot then 'visual_planning' else 'storyboard_planning' end
  into planning_executor, planning_capability
  from public.episodes episode
  join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
  where episode.id = new.episode_id;

  if coalesce(btrim(planning_executor ->> 'adapter'), '') <> 'codex'
    or coalesce(btrim(planning_executor ->> 'model'), '') = ''
    or coalesce(btrim(planning_executor ->> 'harness_id'), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Visual preparation requires the shared storyboard Adapter, model, and Harness' using errcode = '22023';
  end if;

  select harness.*
  into selected_harness
  from public.prompt_versions harness
  join public.episodes episode on episode.account_id = harness.account_id
  where episode.id = new.episode_id
    and harness.id = (planning_executor ->> 'harness_id')::uuid
     and (harness.capability = 'storyboard_planning' or planning_capability = 'visual_planning' and harness.capability = 'visual_planning')
    and harness.is_active;

  if not found or coalesce(btrim(selected_harness.instructions), '') = '' then
    raise exception 'Visual preparation requires an active shared storyboard Harness' using errcode = '22023';
  end if;

  new.input_snapshot := jsonb_set(new.input_snapshot, '{harness}', jsonb_build_object(
    'id', selected_harness.id,
    'version', selected_harness.version,
    'content', selected_harness.instructions,
    'content_hash', selected_harness.content_hash,
    'adapter', 'codex',
    'model', planning_executor ->> 'model',
    'prompt_version', selected_harness.slug
  ), true);
  new.input_snapshot := jsonb_set(new.input_snapshot, '{executor}', jsonb_build_object(
    'provider', 'codex',
    'adapter', 'codex',
    'model', planning_executor ->> 'model',
    'prompt_version', selected_harness.slug
  ), true);
  new.model := planning_executor ->> 'model';
  new.prompt_version := selected_harness.slug;
  return new;
end;
$_$;


--
-- Name: freeze_shot_preparation_batch(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_shot_preparation_batch(p_episode_id uuid, p_review_package_id uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  selected_shot jsonb;
  draft public.shot_preparation_drafts;
  duration_settings jsonb;
  duration_decision jsonb;
begin
  select episode.* into current_episode from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id for update of episode;
  if not found or current_episode.stage <> 'storyboard_approved' then raise exception 'Owner shot workbench access is required' using errcode = '42501'; end if;
  select * into selected_package from public.review_packages
  where id = p_review_package_id and episode_id = p_episode_id and stage = 'storyboard_review' and invalidated_at is null;
  if not found then raise exception 'The current storyboard package is required' using errcode = '22023'; end if;
  duration_settings := public.shot_duration_settings(p_episode_id);

  for selected_shot in select value from jsonb_array_elements(selected_package.context_snapshot #> '{worker_result,storyboard,shots}') loop
    select * into draft from public.shot_preparation_drafts
    where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = selected_shot ->> 'id' for update;
    if not found or draft.selected_material_revision_id is null or jsonb_array_length(draft.clip_segments) = 0 or draft.subtitle_text = '' then
      raise exception 'Every shot needs a saved source, marker selection, and subtitle decision before freezing' using errcode = '22023';
    end if;
    if draft.audio_mode = 'tts' and not exists (
      select 1 from public.audio_tracks track join public.tasks task on task.id = track.source_task_id
      where track.id = draft.current_audio_track_id and track.track_kind = 'narration' and task.status = 'completed'
        and task.invalidated_at is null and task.input_snapshot #>> '{media,narration,text}' = draft.tts_text
        and task.input_snapshot ->> 'configuration_hash' = public.shot_tts_configuration_hash(p_episode_id, draft.id)
    ) then raise exception 'Every TTS shot needs its current generated narration before freezing' using errcode = '22023'; end if;
    duration_decision := public.shot_duration_decision(draft.audio_mode, case when draft.audio_mode = 'none' then null when draft.audio_mode = 'source' then draft.video_duration_seconds else draft.tts_actual_duration_seconds end, draft.video_duration_seconds, (selected_shot ->> 'durationSeconds')::numeric, (duration_settings ->> 'frame_rate')::numeric, (duration_settings ->> 'allowed_frames')::integer, draft.video_duration_seconds);
    update public.shot_preparation_drafts set frozen_at = now(), frozen_by = auth.uid(), confirmation_status = 'confirmed',
      confirmation_reason = 'Owner froze source and marker configuration for Studio.', confirmed_at = now(), confirmed_by = auth.uid(),
      video_status = 'ready', audio_status = case when audio_mode = 'tts' then audio_status else 'ready' end,
      warning_decision = case when (duration_decision ->> 'status') = 'needs_attention' then 'accepted' else 'not_required' end,
      warning_reason = case when (duration_decision ->> 'status') = 'needs_attention' then 'Marker duration accepted as an editable Studio starting point.' else null end,
      warning_accepted_at = case when (duration_decision ->> 'status') = 'needs_attention' then now() else null end,
      warning_accepted_by = case when (duration_decision ->> 'status') = 'needs_attention' then auth.uid() else null end, updated_at = now()
    where id = draft.id;
  end loop;

  if not exists (select 1 from public.create_shot_preparation_review_package(p_episode_id, p_review_package_id)) then
    raise exception 'Unable to freeze the source marker snapshot' using errcode = '22023';
  end if;
  update public.episodes set stage = 'production_ready', updated_at = now() where id = p_episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (p_episode_id, 'storyboard_approved', 'production_ready', '原片、片段标记和音频配置已冻结并进入 Studio。', auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_marker_batch_frozen', jsonb_build_object('review_package_id', p_review_package_id), auth.uid());
  perform public.orchestrate_review_render_tasks(p_episode_id);
  return;
end;
$$;


--
-- Name: freeze_worker_task_run(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_worker_task_run() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  selected_task public.tasks;
  selected_episode public.episodes;
begin
  select * into selected_task from public.tasks where id = new.task_id;
  if selected_task.task_type not in ('draft_script', 'prepare_visual_brief', 'draft_storyboard', 'generate_a_roll', 'generate_b_roll', 'generate_narration', 'extract_embedded_audio', 'generate_soundtrack') then return new; end if;
  select * into selected_episode from public.episodes where id = selected_task.episode_id;
  new.task_package := jsonb_strip_nulls(jsonb_build_object(
    'version', 'worker-task/v1',
    'task', jsonb_build_object('id', selected_task.id, 'type', selected_task.task_type, 'attempt', new.attempt),
    'episode', jsonb_build_object('id', selected_episode.id, 'account_id', selected_episode.account_id, 'blueprint_version_id', selected_episode.blueprint_version_id, 'title', selected_episode.title),
    'capability', selected_task.input_snapshot -> 'capability',
    'commission', selected_task.input_snapshot -> 'commission',
    'harness', selected_task.input_snapshot -> 'harness',
    'review_feedback', selected_task.input_snapshot -> 'review_feedback',
    'review_annotations', selected_task.input_snapshot -> 'review_annotations',
    'script_revision', selected_task.input_snapshot -> 'script_revision',
    'series_baseline', selected_task.input_snapshot -> 'series_baseline',
    'visual_review_package', selected_task.input_snapshot -> 'visual_review_package',
    'storyboard_review_package_id', selected_task.input_snapshot -> 'storyboard_review_package_id',
    'shot', selected_task.input_snapshot -> 'shot',
    'executor', selected_task.input_snapshot -> 'executor',
    'media', selected_task.input_snapshot -> 'media',
    'audio_track', selected_task.input_snapshot -> 'audio_track',
    'scheduling', selected_task.input_snapshot -> 'scheduling',
    'budget', (selected_task.input_snapshot -> 'budget') || jsonb_build_object('attempt', new.attempt),
    'allowed_tools', selected_task.input_snapshot -> 'allowed_tools',
    'output', selected_task.input_snapshot -> 'output',
    'input_artifacts', selected_task.input_snapshot -> 'input_artifacts',
    'forbidden_actions', jsonb_build_array('approve', 'publish', 'change_blueprint', 'change_episode_stage')
  ));
  return new;
end;
$$;


--
-- Name: generate_confirmed_shot_tts_batch(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_confirmed_shot_tts_batch(p_episode_id uuid, p_review_package_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
#variable_conflict use_variable
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  storyboard_shot jsonb;
  draft public.shot_preparation_drafts;
  existing_task public.tasks;
  generated_task public.tasks;
  blueprint_policy jsonb;
  narration_config jsonb;
  executor jsonb;
  provider text;
  adapter text;
  credential_ref text;
  config_hash text;
  details jsonb := '[]'::jsonb;
  created_count integer := 0;
  already_exists_count integer := 0;
  already_succeeded_count integer := 0;
  unconfirmed_count integer := 0;
  not_tts_count integer := 0;
  invalid_configuration_count integer := 0;
  other_count integer := 0;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate shot narration' using errcode = '42501'; end if;
  if current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then
    raise exception 'Shot narration can only be generated in the shot workbench' using errcode = '22023';
  end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id
    and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select blueprint.policy into blueprint_policy
  from public.account_blueprint_versions blueprint
  where blueprint.id = current_episode.blueprint_version_id;
  narration_config := blueprint_policy -> 'narration';
  executor := narration_config -> 'executor';
  provider := executor ->> 'provider';
  adapter := executor ->> 'adapter';
  credential_ref := nullif(btrim(narration_config ->> 'credential_ref'), '');

  for storyboard_shot in
    select shot.value
    from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) with ordinality shot(value, position)
    order by shot.position
  loop
    select * into draft
    from public.shot_preparation_drafts candidate
    where candidate.episode_id = p_episode_id
      and candidate.review_package_id = p_review_package_id
      and candidate.shot_id = storyboard_shot ->> 'id'
    for update;

    if not found then
      other_count := other_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', storyboard_shot ->> 'id', 'status', 'other', 'reason', '未找到已保存的镜头草稿；页面未保存修改不会进入本批。'));
      continue;
    end if;

    if draft.audio_mode <> 'tts' then
      not_tts_count := not_tts_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'not_tts', 'reason', '当前镜头不是 TTS 模式。'));
      continue;
    end if;

    if coalesce(btrim(draft.tts_text), '') = '' or draft.tts_text_confirmation_fingerprint is distinct from md5(btrim(draft.tts_text)) then
      unconfirmed_count := unconfirmed_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'unconfirmed', 'reason', '口播正文尚未保存并确认。'));
      continue;
    end if;

    config_hash := public.shot_tts_configuration_hash(p_episode_id, draft.id);
    if (provider, adapter) not in (('google_tts', 'google_tts'), ('volcengine_tts', 'volcengine_tts'))
      or config_hash is null
      or coalesce(btrim(draft.tts_voice), '') = ''
      or draft.tts_speaking_rate is null
      or draft.tts_speaking_rate <= 0
      or credential_ref is null
      or credential_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not exists (
        select 1
        from public.external_connection_versions version
        join public.external_connections connection on connection.id = version.connection_id
        join public.account_memberships connection_owner
          on connection_owner.account_id = current_episode.account_id
         and connection_owner.user_id = connection.created_by
         and connection_owner.role = 'owner'
        where version.id::text = credential_ref
          and connection.current_version_id = version.id
          and version.provider = provider
          and version.adapter = adapter
          and version.revoked_at is null
          and public.connection_version_is_verified(version.id)
      ) then
      invalid_configuration_count := invalid_configuration_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'invalid_configuration', 'reason', 'TTS 执行器、声音、语速或已验证连接配置不完整。'));
      continue;
    end if;

    select task.* into existing_task
    from public.tasks task
    where task.episode_id = p_episode_id
      and task.task_type = 'generate_narration'
      and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
      and task.input_snapshot ->> 'configuration_hash' = config_hash
    order by task.created_at desc
    limit 1
    for update;

    if found and existing_task.status in ('ready', 'running', 'completed') then
      if existing_task.status = 'completed' then
        already_succeeded_count := already_succeeded_count + 1;
        details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'already_succeeded', 'task_id', existing_task.id));
      else
        already_exists_count := already_exists_count + 1;
        details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'already_exists', 'task_id', existing_task.id));
      end if;
      continue;
    end if;

    if found and existing_task.status in ('blocked', 'failed') then
      other_count := other_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'other', 'task_id', existing_task.id, 'reason', '已有失败或阻塞任务；请使用单镜头安全重试。'));
      continue;
    end if;

    begin
      generated_task := public.generate_shot_tts(p_episode_id, p_review_package_id, draft.shot_id, false);
      created_count := created_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'created', 'task_id', generated_task.id));
    exception when others then
      other_count := other_count + 1;
      details := details || jsonb_build_array(jsonb_build_object('shot_id', draft.shot_id, 'status', 'other', 'reason', sqlerrm));
    end;
  end loop;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    p_episode_id,
    'shot_tts_batch_generation_requested',
    jsonb_build_object(
      'review_package_id', p_review_package_id,
      'created_count', created_count,
      'already_exists_count', already_exists_count,
      'already_succeeded_count', already_succeeded_count,
      'unconfirmed_count', unconfirmed_count,
      'not_tts_count', not_tts_count,
      'invalid_configuration_count', invalid_configuration_count,
      'other_count', other_count
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'version', 'shot-tts-batch/v1',
    'episode_id', p_episode_id,
    'review_package_id', p_review_package_id,
    'total_count', created_count + already_exists_count + already_succeeded_count + unconfirmed_count + not_tts_count + invalid_configuration_count + other_count,
    'created_count', created_count,
    'already_exists_count', already_exists_count,
    'already_succeeded_count', already_succeeded_count,
    'unconfirmed_count', unconfirmed_count,
    'not_tts_count', not_tts_count,
    'invalid_configuration_count', invalid_configuration_count,
    'other_count', other_count,
    'details', details
  );
end;
$_$;


--
-- Name: generate_shot_clip(uuid, uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_shot_clip(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_retry boolean DEFAULT false) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  draft public.shot_preparation_drafts;
  selected_material public.production_material_revisions;
  selected_package public.review_packages;
  selected_shot jsonb;
  segment jsonb;
  existing_task public.tasks;
  created_task public.tasks;
  config_hash text;
  output_type text;
  output_path text;
  task_snapshot jsonb;
  safe_shot_id text;
  total_duration numeric := 0;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate a shot clip' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Shot clips can only be generated in the shot workbench' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;
  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the approved storyboard' using errcode = '22023'; end if;

  select * into draft from public.shot_preparation_drafts
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id)
  for update;
  if not found or draft.selected_material_revision_id is null or jsonb_typeof(draft.clip_segments) <> 'array' or jsonb_array_length(draft.clip_segments) = 0 then raise exception 'Please save a source video and valid clip segments before generating' using errcode = '22023'; end if;
  for segment in select value from jsonb_array_elements(draft.clip_segments) loop
    if jsonb_typeof(segment) <> 'object' or jsonb_typeof(segment -> 'start_seconds') <> 'number' or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'start_seconds')::numeric < 0 or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
      or (segment ->> 'end_seconds')::numeric > 86400 then
      raise exception 'Clip segment is invalid' using errcode = '22023';
    end if;
    total_duration := public.shot_composition_playback_duration(draft.clip_segments, draft.composition);
  end loop;
  select material.* into selected_material
  from public.production_material_revisions material
  join public.material_revision_approvals approval on approval.material_revision_id = material.id
  where material.id = draft.selected_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'video'
    and material.material_purpose = case selected_shot ->> 'shotType' when 'a_roll' then 'a_roll' else 'b_roll' end;
  if not found then raise exception 'The selected source video is no longer approved for this shot' using errcode = '22023'; end if;

  config_hash := md5(jsonb_build_object('material_revision_id', selected_material.id, 'sha256', selected_material.sha256, 'clip_segments', draft.clip_segments)::text);
  select task.* into existing_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
    and task.input_snapshot ->> 'configuration_hash' = config_hash
  order by task.created_at desc for update limit 1;
  if found and existing_task.status in ('ready', 'running', 'completed') then return existing_task; end if;
  if found and existing_task.status in ('failed', 'blocked') and not p_retry then return existing_task; end if;

  update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'A newer shot clip generation was requested.'
  where task.episode_id = p_episode_id
    and task.task_type = case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
    and task.input_snapshot ->> 'storyboard_review_package_id' = p_review_package_id::text
    and task.input_snapshot #>> '{shot,id}' = draft.shot_id
    and coalesce(task.input_snapshot ->> 'pre_render_revision', '') = ''
    and task.status <> 'superseded';

  output_type := case selected_shot ->> 'shotType' when 'a_roll' then 'a_roll_video' else 'b_roll_asset' end;
  safe_shot_id := regexp_replace(btrim(p_shot_id), '[^a-zA-Z0-9_-]', '_', 'g');
  output_path := format('episodes/%s/shot-clips/%s-%s.mp4', p_episode_id, safe_shot_id, config_hash);
  task_snapshot := jsonb_build_object(
    'capability', 'shot_clip_preparation',
    'storyboard_review_package_id', p_review_package_id,
    'configuration_hash', config_hash,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', p_episode_id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
    'shot', selected_shot,
    'executor', jsonb_build_object('provider', 'ffmpeg', 'adapter', 'ffmpeg_trim_video', 'model', 'ffmpeg', 'prompt_version', 'shot-clip-v2'),
    'media', jsonb_build_object('adapter', 'ffmpeg_trim_video', 'video_clips', jsonb_build_object('source_relative_path', selected_material.storage_path, 'segments', draft.clip_segments, 'target_duration_seconds', total_duration)),
    'clip_selection', jsonb_build_object('segments', draft.clip_segments, 'duration_seconds', total_duration),
    'manual_source', jsonb_build_object('material_revision_id', selected_material.id),
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array(output_type), 'content_type', 'video/mp4', 'relative_path', output_path, 'review_stage', 'production_ready'),
    'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'source_video', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size)),
    'allowed_tools', jsonb_build_array('read', 'write')
  );
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end, 'ready', task_snapshot, 0, 2, 'ffmpeg', 'ffmpeg', 'shot-clip-v2')
  returning * into created_task;
  update public.shot_preparation_drafts
  set video_status = 'running', pending_video_task_id = created_task.id, video_error = null, updated_at = now()
  where id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_clip_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'configuration_hash', config_hash, 'retry', p_retry), auth.uid());
  return created_task;
end;
$$;


--
-- Name: generate_shot_review_video(uuid, uuid, jsonb, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_shot_review_video(p_episode_id uuid, p_review_package_id uuid, p_studio_project jsonb, p_accept_duration_risk boolean DEFAULT false, p_risk_reason text DEFAULT NULL::text) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  selected_shot jsonb;
  draft public.shot_preparation_drafts;
  material public.production_material_revisions;
  narration_track public.audio_tracks;
  created_package public.review_packages;
  created_task public.tasks;
  storyboard jsonb;
  duration_settings jsonb;
  duration_decision jsonb;
  blueprint_policy jsonb;
  series_rules jsonb;
  series_version_number integer;
  risk_count integer := 0;
  risk_reason text := btrim(coalesce(p_risk_reason, ''));
  runtime_constraints jsonb;
  composition_config jsonb;
  studio_revision text;
  default_composition constant jsonb := '{"aspect_ratio":"9:16","width":1080,"height":1920,"captions_enabled":true,"caption_style":"cinematic","crop":"cover","pacing":"standard","transition":"fade","layout":"lower_third","narration_gain_db":0,"bgm_gain_db":-12,"sfx_gain_db":-6}'::jsonb;
begin
  if p_studio_project is null
    or jsonb_typeof(p_studio_project) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_studio_project) key where key not in ('relative_path', 'sha256', 'file_size'))
    or jsonb_typeof(p_studio_project -> 'relative_path') <> 'string'
    or jsonb_typeof(p_studio_project -> 'sha256') <> 'string'
    or jsonb_typeof(p_studio_project -> 'file_size') <> 'number'
    or p_accept_duration_risk is null
    or (p_accept_duration_risk and risk_reason = '')
    or (not p_accept_duration_risk and risk_reason <> '') then
    raise exception '音画超过帧容差时必须由 Owner 明确接受并填写原因' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
  if not found or current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then
    raise exception 'Owner shot workbench access is required' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.tasks task
    where task.episode_id = p_episode_id
      and task.task_type = 'generate_review_render'
      and task.status in ('ready', 'running')
      and task.invalidated_at is null
  ) then
    raise exception 'A review render is already queued or running for this Episode' using errcode = '55000';
  end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval
    on approval.review_package_id = package.id
   and approval.stage = 'storyboard_approved'
   and approval.decision = 'approved'
  where package.id = p_review_package_id
    and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null
  for update of package;
  if not found then
    raise exception 'The approved storyboard review package is required' using errcode = '22023';
  end if;

  if p_studio_project ->> 'relative_path' !~ format('^episodes/%s/(studio-frozen/[0-9a-f-]{36}/index[.]html|openchatcut-frozen/[0-9a-f-]{36}/project[.]json)$', p_episode_id::text)
    or p_studio_project ->> 'sha256' !~ '^[0-9a-f]{64}$'
    or (p_studio_project ->> 'file_size')::numeric < 1
    or (p_studio_project ->> 'file_size')::numeric <> trunc((p_studio_project ->> 'file_size')::numeric) then
    raise exception 'Invalid frozen Studio project' using errcode = '22023';
  end if;
  studio_revision := coalesce(substring(p_studio_project ->> 'relative_path' from '/openchatcut-frozen/([^/]+)/project[.]json$'), substring(p_studio_project ->> 'relative_path' from '/studio-frozen/([^/]+)/index[.]html$'));

  storyboard := selected_package.context_snapshot #> '{worker_result,storyboard}';
  if coalesce(jsonb_typeof(storyboard -> 'shots'), '') <> 'array' then
    raise exception 'The approved storyboard must contain shots' using errcode = '22023';
  end if;
  if jsonb_array_length(storyboard -> 'shots') = 0 then
    raise exception 'The approved storyboard must contain shots' using errcode = '22023';
  end if;
  duration_settings := public.shot_duration_settings(p_episode_id);
  select policy into blueprint_policy
  from public.account_blueprint_versions
  where id = current_episode.blueprint_version_id
    and account_id = current_episode.account_id;
  select version.version, coalesce(version.rules, '{}'::jsonb) into series_version_number, series_rules
  from public.series_versions version
  where version.id = current_episode.series_version_id
    and version.account_id = current_episode.account_id;
  runtime_constraints := public.worker_runtime_constraints(
    jsonb_build_object('provider', 'openchatcut', 'media', jsonb_build_object('adapter', 'openchatcut'))
  );

  for selected_shot in select value from jsonb_array_elements(storyboard -> 'shots') loop
    select candidate.* into draft
    from public.shot_preparation_drafts candidate
    where candidate.episode_id = p_episode_id
      and candidate.review_package_id = p_review_package_id
      and candidate.shot_id = selected_shot ->> 'id'
    for update;
    if not found then
      raise exception 'Every shot needs a saved workbench draft' using errcode = '22023';
    end if;
    if draft.input_fingerprint is distinct from md5(selected_shot::text)
      or draft.selected_material_revision_id is null
      or (draft.subtitles_enabled and coalesce(btrim(draft.subtitle_text), '') = '')
      or draft.video_duration_seconds is null
      or draft.video_duration_seconds <= 0
      or coalesce(jsonb_typeof(draft.clip_segments), '') <> 'array' then
      raise exception 'Every shot needs a current source, valid clip segments, duration, and subtitle' using errcode = '22023';
    end if;
    if jsonb_array_length(draft.clip_segments) = 0 then
      raise exception 'Every shot needs a current source, valid clip segments, duration, and subtitle' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(draft.clip_segments) segment
      where jsonb_typeof(segment) <> 'object'
        or jsonb_typeof(segment -> 'start_seconds') <> 'number'
        or jsonb_typeof(segment -> 'end_seconds') <> 'number'
        or (segment ->> 'start_seconds')::numeric < 0
        or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
    ) then
      raise exception 'Every shot needs valid clip segment boundaries' using errcode = '22023';
    end if;

    select revision.* into material
    from public.production_material_revisions revision
    join public.material_revision_approvals approval
      on approval.material_revision_id = revision.id
    where revision.id = draft.selected_material_revision_id
      and revision.episode_id = p_episode_id
      and revision.material_type = 'video';
    if not found then
      raise exception 'Every shot needs an approved current video material revision' using errcode = '22023';
    end if;

    duration_decision := public.shot_duration_decision(
      draft.audio_mode,
      case when draft.audio_mode = 'tts' then draft.tts_actual_duration_seconds
           when draft.audio_mode = 'source' then draft.video_duration_seconds
           else null end,
      draft.video_duration_seconds,
      (selected_shot ->> 'durationSeconds')::numeric,
      (duration_settings ->> 'frame_rate')::numeric,
      (duration_settings ->> 'allowed_frames')::integer,
      draft.video_duration_seconds
    );
    if duration_decision ->> 'status' = 'needs_attention' then
      risk_count := risk_count + 1;
    end if;

    if draft.audio_mode = 'tts' then
      if coalesce(btrim(draft.tts_text), '') = '' then
        raise exception 'Every TTS shot needs saved and confirmed narration text' using errcode = '22023';
      end if;
      select track.* into narration_track
      from public.audio_tracks track
      join public.tasks task on task.id = track.source_task_id
      where track.id = draft.current_audio_track_id
        and track.episode_id = p_episode_id
        and track.source_review_package_id = p_review_package_id
        and track.cue_id = draft.shot_id
        and track.track_kind = 'narration'
        and track.sha256 is not null
        and track.file_size > 0
        and track.duration_seconds > 0
        and task.id = coalesce(draft.current_tts_task_id, track.source_task_id)
        and task.task_type = 'generate_narration'
        and task.status = 'completed'
        and task.invalidated_at is null
        and task.input_snapshot #>> '{media,narration,text}' = draft.tts_text
        and task.input_snapshot ->> 'configuration_hash' = public.shot_tts_configuration_hash(p_episode_id, draft.id);
      if not found then
        raise exception 'Every TTS shot needs its current successful narration and configuration fingerprint' using errcode = '22023';
      end if;
    elsif draft.audio_mode not in ('source', 'none') then
      raise exception 'Unsupported shot audio mode' using errcode = '22023';
    end if;
  end loop;

  if risk_count > 0 and not p_accept_duration_risk then
    raise exception '音画超过帧容差，必须由 Owner 明确接受并填写原因' using errcode = '22023';
  end if;
  if risk_count = 0 and p_accept_duration_risk then
    raise exception '当前没有音画超过帧容差的风险，不需要接受原因' using errcode = '22023';
  end if;

  update public.review_packages
  set invalidated_at = now(), invalidated_reason = 'Superseded by a newer explicit review video generation.'
  where episode_id = p_episode_id
    and stage = 'production_ready'
    and invalidated_at is null;

  select package.* into created_package
  from public.create_shot_preparation_review_package(p_episode_id, p_review_package_id) package
  limit 1;
  if not found then
    raise exception 'Unable to create the immutable shot review snapshot' using errcode = '22023';
  end if;

  update public.review_packages
  set context_snapshot = context_snapshot || jsonb_build_object(
    'blueprint_version_id', current_episode.blueprint_version_id,
    'blueprint_policy', coalesce(blueprint_policy, '{}'::jsonb),
    'series_version_id', current_episode.series_version_id,
    'series_rules', series_rules,
    'duration_settings', duration_settings,
    'effective_runtime_constraints', runtime_constraints,
    'studio_project', jsonb_build_object('revision', studio_revision, 'relative_path', p_studio_project ->> 'relative_path', 'sha256', p_studio_project ->> 'sha256', 'file_size', (p_studio_project ->> 'file_size')::bigint),
    'generation', jsonb_build_object('kind', 'explicit_review_video', 'risk_accepted', p_accept_duration_risk, 'risk_reason', nullif(risk_reason, ''))
  )
  where id = created_package.id;

  composition_config := default_composition || coalesce(series_rules -> 'openchatcut_composition', '{}'::jsonb) || jsonb_build_object(
    'frame_rate', (duration_settings ->> 'frame_rate')::numeric,
    'allowed_frames', (duration_settings ->> 'allowed_frames')::integer,
    'reason', 'Owner 明确提交的 Studio 工作版本。',
    'studio_project', p_studio_project,
    'studio_project_revision', studio_revision
  );
  insert into public.review_render_composition_revisions (episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, created_by, composition_config)
  values (p_episode_id, created_package.id, 1, composition_config ->> 'caption_style', composition_config ->> 'pacing', composition_config ->> 'crop', composition_config ->> 'transition', composition_config ->> 'layout', composition_config ->> 'reason', auth.uid(), composition_config);

  update public.episodes
  set stage = 'production_ready', updated_at = now()
  where id = p_episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (p_episode_id, current_episode.stage, 'production_ready', 'Owner 明确生成审核视频，冻结整单镜头快照。', auth.uid());

  select task.* into created_task
  from public.orchestrate_review_render_tasks(p_episode_id) task
  limit 1;
  if not found then
    raise exception 'Unable to create the review render task from the frozen snapshot' using errcode = '22023';
  end if;

  update public.tasks
  set input_snapshot = input_snapshot || jsonb_build_object(
    'blueprint_version_id', current_episode.blueprint_version_id,
    'blueprint_policy', coalesce(blueprint_policy, '{}'::jsonb),
    'series_version_id', current_episode.series_version_id,
    'series_baseline', case when current_episode.series_version_id is null then null else jsonb_build_object('version_id', current_episode.series_version_id, 'version', series_version_number, 'rules', series_rules) end,
    'duration_settings', duration_settings,
    'studio_project', jsonb_build_object('revision', studio_revision, 'relative_path', p_studio_project ->> 'relative_path', 'sha256', p_studio_project ->> 'sha256', 'file_size', (p_studio_project ->> 'file_size')::bigint),
    'effective_runtime_constraints', runtime_constraints,
    'generation', jsonb_build_object('kind', 'explicit_review_video', 'risk_accepted', p_accept_duration_risk, 'risk_reason', nullif(risk_reason, ''))
  )
  where id = created_task.id;

  update public.episodes
  set stage = 'render_ready', updated_at = now()
  where id = p_episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (p_episode_id, 'production_ready', 'render_ready', '审核视频任务已创建，Worker 只消费冻结整单快照。', auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_review_video_requested', jsonb_build_object(
    'review_package_id', created_package.id,
    'task_id', created_task.id,
    'blueprint_version_id', current_episode.blueprint_version_id,
    'blueprint_policy', coalesce(blueprint_policy, '{}'::jsonb),
    'series_version_id', current_episode.series_version_id,
    'duration_settings', duration_settings,
    'risk_count', risk_count,
    'risk_accepted', p_accept_duration_risk,
    'risk_reason', nullif(risk_reason, '')
  ), auth.uid());
  return next created_task;
end;
$_$;


--
-- Name: generate_shot_source_audio(uuid, uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_shot_source_audio(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_retry boolean DEFAULT false) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  draft public.shot_preparation_drafts;
  selected_package public.review_packages;
  prepared_video public.artifacts;
  existing_task public.tasks;
  created_task public.tasks;
  config_hash text;
  task_snapshot jsonb;
  output_path text;
  safe_shot_id text;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate shot source audio' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Shot source audio can only be generated in the shot workbench' using errcode = '22023'; end if;
  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;
  select * into draft from public.shot_preparation_drafts where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id) for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.audio_mode <> 'source' then raise exception 'Only source audio shots can extract original audio' using errcode = '22023'; end if;
  select artifact.* into prepared_video
  from public.artifacts artifact
  join public.tasks task on task.id = artifact.producer_task_id and task.status = 'completed'
  where artifact.id = draft.current_video_artifact_id and task.id = draft.current_video_task_id and artifact.episode_id = p_episode_id;
  if not found then raise exception '请先生成并校验当前准备片段，再提取原声。' using errcode = '22023'; end if;
  config_hash := md5(jsonb_build_object('video_artifact_id', prepared_video.id, 'sha256', prepared_video.sha256, 'file_size', prepared_video.file_size)::text);
  select task.* into existing_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = 'extract_embedded_audio'
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text and task.input_snapshot ->> 'configuration_hash' = config_hash
  order by task.created_at desc for update limit 1;
  if found and existing_task.status in ('ready', 'running', 'completed') then return existing_task; end if;
  if found and existing_task.status in ('failed', 'blocked') and not p_retry then return existing_task; end if;
  update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'A newer prepared video became current.'
  where task.episode_id = p_episode_id and task.task_type = 'extract_embedded_audio' and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text and task.status in ('ready', 'blocked', 'failed');
  safe_shot_id := regexp_replace(btrim(p_shot_id), '[^a-zA-Z0-9_-]', '_', 'g');
  output_path := format('episodes/%s/audio/shot-source-%s-%s.mp3', p_episode_id, safe_shot_id, config_hash);
  task_snapshot := jsonb_build_object(
    'capability', 'embedded_audio_extraction',
    'storyboard_review_package_id', p_review_package_id,
    'configuration_hash', config_hash,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', p_episode_id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
    'source_video_artifact', jsonb_build_object('id', prepared_video.id, 'relative_path', prepared_video.relative_path, 'sha256', prepared_video.sha256, 'file_size', prepared_video.file_size),
    'media', jsonb_build_object('adapter', 'ffmpeg_extract_audio', 'embedded_audio', jsonb_build_object('source_relative_path', prepared_video.relative_path, 'duration_seconds', greatest(coalesce(draft.clip_end_seconds - draft.clip_start_seconds, 0.001), 0.001))),
    'audio_track', jsonb_build_object('kind', 'source', 'cue_id', draft.shot_id, 'source_review_package_id', p_review_package_id, 'start_seconds', 0, 'duration_seconds', 0.001),
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array('shot_source_audio'), 'content_type', 'audio/mpeg', 'relative_path', output_path, 'review_stage', 'production_ready'),
    'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'prepared_shot_video', 'relativePath', prepared_video.relative_path, 'sha256', prepared_video.sha256, 'fileSize', prepared_video.file_size)),
    'allowed_tools', jsonb_build_array('read', 'write')
  );
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, 'extract_embedded_audio', 'ready', task_snapshot, 0, 2, 'ffmpeg', 'ffmpeg', 'shot-source-audio-v1')
  returning * into created_task;
  update public.shot_preparation_drafts set audio_status = 'running', pending_source_audio_task_id = created_task.id, source_audio_error = null, updated_at = now() where id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_source_audio_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'prepared_video_artifact_id', prepared_video.id, 'prepared_video_sha256', prepared_video.sha256, 'configuration_hash', config_hash, 'retry', p_retry), auth.uid());
  return created_task;
end;
$$;


--
-- Name: generate_shot_sync_preview(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_shot_sync_preview(p_episode_id uuid, p_review_package_id uuid, p_shot_id text) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  selected_shot jsonb;
  draft public.shot_preparation_drafts;
  material public.production_material_revisions;
  narration_track public.audio_tracks;
  narration_task public.tasks;
  selected_audio jsonb;
  audio_member jsonb;
  created_task public.tasks;
  existing_task public.tasks;
  storyboard jsonb;
  members jsonb := '[]'::jsonb;
  inputs jsonb := '[]'::jsonb;
  confirmed_shots jsonb;
  duration_seconds numeric;
  shot_offset_seconds numeric := 0;
  duration_decision jsonb;
  project_path text;
  proxy_path text;
  transition_value text;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
  if not found or current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then
    raise exception 'Owner shot workbench access is required' using errcode = '42501';
  end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval
    on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'The current approved storyboard package is required' using errcode = '22023'; end if;

  storyboard := selected_package.context_snapshot #> '{worker_result,storyboard}';
  select shot.value into selected_shot
  from jsonb_array_elements(storyboard -> 'shots') shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The selected shot is not in the approved storyboard' using errcode = '22023'; end if;
  select coalesce(sum((candidate.value ->> 'durationSeconds')::numeric), 0) into shot_offset_seconds
  from jsonb_array_elements(storyboard -> 'shots') with ordinality candidate(value, position)
  where candidate.position < (
    select selected.position
    from jsonb_array_elements(storyboard -> 'shots') with ordinality selected(value, position)
    where selected.value ->> 'id' = btrim(p_shot_id)
  );

  select target.* into draft from public.shot_preparation_drafts target
  where target.episode_id = p_episode_id and target.review_package_id = p_review_package_id
    and target.shot_id = btrim(p_shot_id) for update;
  if not found or draft.preparation_contract_status <> 'current' or draft.preparation_contract is null
    or draft.input_fingerprint is distinct from md5(selected_shot::text)
    or draft.preparation_input_fingerprint is distinct from draft.preparation_contract ->> 'input_fingerprint'
    or draft.selected_material_revision_id is null
    or coalesce(jsonb_typeof(draft.clip_segments), '') <> 'array'
    or jsonb_array_length(draft.clip_segments) = 0
    or draft.video_duration_seconds is null or draft.video_duration_seconds <= 0 then
    raise exception 'The shot needs a current preparation contract and valid media ranges' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(draft.clip_segments) segment
    where jsonb_typeof(segment) <> 'object'
      or jsonb_typeof(segment -> 'start_seconds') <> 'number'
      or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'start_seconds')::numeric < 0
      or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
  ) then raise exception 'The shot needs valid clip segment boundaries' using errcode = '22023'; end if;
  if draft.subtitles_enabled and (
    coalesce(draft.caption_contract ->> 'text', '') = ''
    or coalesce(jsonb_array_length(draft.caption_contract -> 'cues'), 0) = 0
    or draft.acoustic_alignment ->> 'status' <> 'completed'
  ) then raise exception 'Enabled captions need completed acoustic or manual timing cues' using errcode = '22023'; end if;
  if draft.audio_mode = 'tts' and (draft.audio_status <> 'ready' or draft.current_audio_track_id is null) then
    raise exception 'The TTS shot needs its current successful narration' using errcode = '22023';
  end if;
  

  select revision.* into material
  from public.production_material_revisions revision
  join public.material_revision_approvals approval on approval.material_revision_id = revision.id
  where revision.id = draft.selected_material_revision_id and revision.episode_id = p_episode_id and revision.material_type = 'video';
  if not found then raise exception 'The shot needs an approved immutable video material' using errcode = '22023'; end if;

  select task.* into existing_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = 'generate_shot_sync_preview'
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
    and task.input_snapshot ->> 'preview_input_fingerprint' = draft.preparation_input_fingerprint
    and (task.input_snapshot #>> '{review_render,members,0,duration_seconds}')::numeric = public.shot_composition_playback_duration(draft.clip_segments, draft.composition)
    and task.status in ('ready', 'running', 'completed')
  order by task.created_at desc limit 1;
  if found then return next existing_task; return; end if;

  duration_seconds := public.shot_composition_playback_duration(draft.clip_segments, draft.composition);
  duration_decision := public.shot_duration_decision(
    draft.audio_mode,
    case when draft.audio_mode = 'tts' then draft.tts_actual_duration_seconds when draft.audio_mode = 'source' then duration_seconds else null end,
    duration_seconds,
    (selected_shot ->> 'durationSeconds')::numeric,
    30, 2, duration_seconds
  );
  transition_value := case when draft.transition_mode = 'fade' then 'fade' else 'cut' end;
  project_path := format('episodes/%s/shot-previews/%s/%s/index.html', p_episode_id, regexp_replace(draft.shot_id, '[^a-zA-Z0-9_-]', '-', 'g'), draft.preparation_input_fingerprint);
  proxy_path := format('episodes/%s/shot-previews/%s/%s/proxy.mp4', p_episode_id, regexp_replace(draft.shot_id, '[^a-zA-Z0-9_-]', '-', 'g'), draft.preparation_input_fingerprint);

  members := jsonb_build_array(jsonb_build_object(
    'member_key', format('shot:%s', draft.shot_id), 'member_kind', 'shot_media',
    'source_material_revision_id', material.id, 'clip_segments', draft.clip_segments,
    'composition', draft.composition, 'preparation_contract', draft.preparation_contract,
    'audio_track_id', case when draft.audio_mode = 'tts' then draft.current_audio_track_id else null end,
    'input_fingerprint', draft.preparation_input_fingerprint, 'audio_mode', draft.audio_mode,
    'subtitle_text', draft.subtitle_text, 'subtitles_enabled', draft.subtitles_enabled,
    'relative_path', material.storage_path, 'sha256', material.sha256,
    'start_seconds', 0, 'duration_seconds', duration_seconds, 'duration_decision', duration_decision
  ));
  inputs := jsonb_build_array(jsonb_build_object('artifactType', 'source_video', 'relativePath', material.storage_path, 'sha256', material.sha256, 'fileSize', material.file_size));

  if draft.audio_mode = 'tts' then
    select track.* into narration_track
    from public.audio_tracks track join public.tasks task on task.id = track.source_task_id
    where track.id = draft.current_audio_track_id and track.episode_id = p_episode_id
      and track.source_review_package_id = p_review_package_id and track.cue_id = draft.shot_id
      and track.track_kind = 'narration' and task.id = coalesce(draft.current_tts_task_id, track.source_task_id)
      and task.task_type = 'generate_narration' and task.status = 'completed' and task.invalidated_at is null
      and task.input_snapshot #>> '{media,narration,text}' = draft.tts_text
      and task.input_snapshot ->> 'configuration_hash' = public.shot_tts_configuration_hash(p_episode_id, draft.id);
    if not found then raise exception 'The current narration track is not readable' using errcode = '22023'; end if;
    select task.* into narration_task from public.tasks task where task.id = narration_track.source_task_id;
    members := members || jsonb_build_array(jsonb_build_object(
      'member_key', format('narration:%s', draft.shot_id), 'member_kind', 'narration',
      'task_id', narration_task.id, 'audio_track_id', narration_track.id, 'audio_mode', 'tts',
      'relative_path', narration_track.relative_path, 'sha256', narration_track.sha256,
      'start_seconds', 0, 'duration_seconds', narration_track.duration_seconds
    ));
    inputs := inputs || jsonb_build_array(jsonb_build_object('artifactType', 'audio_track', 'relativePath', narration_track.relative_path, 'sha256', narration_track.sha256, 'fileSize', narration_track.file_size));
  end if;

  selected_audio := public.storyboard_selected_audio_members(p_episode_id, p_review_package_id);
  for audio_member in select value from jsonb_array_elements(selected_audio) loop
    if (audio_member ->> 'target_kind' = 'episode' and audio_member #>> '{cue,kind}' = 'bgm')
      or (audio_member ->> 'target_kind' = 'shot' and audio_member ->> 'target_id' = draft.shot_id and audio_member #>> '{cue,kind}' = 'sfx') then
      members := members || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'member_key', audio_member ->> 'member_key', 'member_kind', 'soundtrack',
        'audio_kind', audio_member #>> '{cue,kind}', 'task_id', audio_member #>> '{task,id}',
        'audio_track_id', audio_member #>> '{audio_track,id}',
        'relative_path', coalesce(audio_member #>> '{audio_track,relative_path}', audio_member #>> '{source_material,relative_path}'),
        'sha256', coalesce(audio_member #>> '{audio_track,sha256}', audio_member #>> '{source_material,sha256}'),
        'start_seconds', case when audio_member #>> '{cue,kind}' = 'bgm' then 0 else greatest(0, coalesce((audio_member #>> '{audio_track,start_seconds}')::numeric, 0) - shot_offset_seconds) end,
        'duration_seconds', least(duration_seconds, coalesce((audio_member #>> '{audio_track,duration_seconds}')::numeric, (audio_member ->> 'duration_seconds')::numeric))
      )));
      inputs := inputs || jsonb_build_array(jsonb_build_object(
        'artifactType', case when audio_member ? 'source_material' then 'soundtrack_audio' else 'audio_track' end,
        'relativePath', coalesce(audio_member #>> '{audio_track,relative_path}', audio_member #>> '{source_material,relative_path}'),
        'sha256', coalesce(audio_member #>> '{audio_track,sha256}', audio_member #>> '{source_material,sha256}'),
        'fileSize', coalesce((audio_member #>> '{audio_track,file_size}')::bigint, (audio_member #>> '{source_material,file_size}')::bigint)
      ));
    end if;
  end loop;

  confirmed_shots := jsonb_build_array(jsonb_build_object(
    'shot_id', draft.shot_id, 'confirmation_status', 'confirmed',
    'input_fingerprint', draft.preparation_input_fingerprint, 'preparation_contract', draft.preparation_contract,
    'source_material_revision_id', material.id, 'clip_segments', draft.clip_segments, 'composition', draft.composition,
    'audio_mode', draft.audio_mode, 'audio_track_id', case when draft.audio_mode = 'tts' then draft.current_audio_track_id else null end,
    'subtitle_text', draft.subtitle_text, 'subtitles_enabled', draft.subtitles_enabled, 'duration_decision', duration_decision
  ));

  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, 'generate_shot_sync_preview', 'ready', jsonb_build_object(
    'capability', 'review_rendering', 'allowed_tools', jsonb_build_array('read', 'write'),
    'preview_input_fingerprint', draft.preparation_input_fingerprint,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
    'review_render', jsonb_build_object(
      'pre_render_review_package_id', p_review_package_id, 'project_revision', 1, 'project_relative_path', project_path,
      'confirmation_mode', 'shot_preparation', 'confirmed_shots', confirmed_shots,
      'storyboard', jsonb_build_object('version', 'storyboard/v1', 'shots', jsonb_build_array(selected_shot), 'audioCues', '[]'::jsonb),
      'members', members,
      'adjustments', jsonb_build_object('aspect_ratio', '9:16', 'width', 1080, 'height', 1920, 'captions_enabled', draft.subtitles_enabled,
        'caption_style', 'minimal', 'pacing', 'standard', 'crop', 'cover', 'transition', transition_value, 'layout', 'center',
        'narration_gain_db', 0, 'bgm_gain_db', -12, 'sfx_gain_db', -6, 'frame_rate', 30, 'allowed_frames', 2,
        'reason', '当前镜头输入的同步预览与可编辑工程描述。')
    ),
    'input_artifacts', inputs,
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array('shot_preview_proxy', 'shot_editable_project', 'shot_preview_runtime', 'shot_preview_qc_report'),
      'content_type', 'video/mp4', 'relative_path', proxy_path, 'review_stage', 'storyboard_approved')
  ), 0, 1, 'openchatcut', 'openchatcut@0.2.14', 'shot-sync-preview-v1')
  returning * into created_task;

  update public.shot_preparation_drafts target
  set pending_preview_task_id = created_task.id, preview_status = 'running', preview_error = null,
      confirmation_status = 'pending', confirmation_reason = null, confirmed_at = null, confirmed_by = null, updated_at = now()
  where target.id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_sync_preview_requested', jsonb_build_object(
    'review_package_id', p_review_package_id, 'shot_id', draft.shot_id, 'task_id', created_task.id,
    'input_fingerprint', draft.preparation_input_fingerprint, 'transition_mode', draft.transition_mode
  ), auth.uid());
  return next created_task;
end;
$$;


--
-- Name: FUNCTION generate_shot_sync_preview(p_episode_id uuid, p_review_package_id uuid, p_shot_id text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.generate_shot_sync_preview(p_episode_id uuid, p_review_package_id uuid, p_shot_id text) IS 'Queues a synchronized OpenChatCut proxy and editable project. Source mode reads embedded audio directly from the approved video ranges.';


--
-- Name: generate_shot_tts(uuid, uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_shot_tts(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_retry boolean DEFAULT false) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
#variable_conflict use_variable
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  draft public.shot_preparation_drafts;
  blueprint_policy jsonb;
  narration_config jsonb;
  executor jsonb;
  voice jsonb;
  existing_task public.tasks;
  created_task public.tasks;
  provider text;
  adapter text;
  model text;
  prompt_version text;
  credential_ref text;
  config_hash text;
  budget_limit integer;
  max_attempts integer;
  task_snapshot jsonb;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate shot narration' using errcode = '42501'; end if;
  if current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then raise exception 'Shot narration can only be generated in the shot workbench' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select * into draft from public.shot_preparation_drafts
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id)
  for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.audio_mode <> 'tts' then raise exception 'Only TTS shots can generate narration' using errcode = '22023'; end if;
  if coalesce(btrim(coalesce(draft.tts_text, draft.subtitle_text)), '') = '' or coalesce(btrim(draft.tts_voice), '') = '' or draft.tts_speaking_rate is null or draft.tts_speaking_rate <= 0 then
    raise exception 'TTS 草稿必须包含口播内容、声音和有效语速' using errcode = '22023';
  end if;

  select blueprint.policy into blueprint_policy from public.account_blueprint_versions blueprint where blueprint.id = current_episode.blueprint_version_id;
  narration_config := blueprint_policy -> 'narration';
  executor := narration_config -> 'executor';
  provider := executor ->> 'provider';
  adapter := executor ->> 'adapter';
  model := coalesce(nullif(btrim(executor ->> 'model'), ''), 'standard');
  prompt_version := coalesce(nullif(btrim(executor ->> 'prompt_version'), ''), 'narration-v1');
  credential_ref := nullif(btrim(narration_config ->> 'credential_ref'), '');
  if (provider, adapter) not in (('google_tts', 'google_tts'), ('volcengine_tts', 'volcengine_tts')) then
    raise exception '蓝图没有可执行的 TTS Adapter' using errcode = '22023';
  end if;
  if credential_ref is null or credential_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (
    select 1 from public.external_connection_versions version
    join public.external_connections connection on connection.id = version.connection_id
    where version.id = credential_ref::uuid and connection.created_by = auth.uid()
      and connection.current_version_id = version.id and version.provider = provider and version.adapter = adapter
      and version.revoked_at is null and public.connection_version_is_verified(version.id)
  ) then
    raise exception 'TTS 外部连接版本未验证或与当前蓝图不兼容' using errcode = '22023';
  end if;
  voice := jsonb_build_object(
    'language_code', coalesce(nullif(btrim(draft.tts_language_code), ''), nullif(btrim(narration_config #>> '{voice,language_code}'), ''), 'zh-CN'),
    'name', draft.tts_voice,
    'speaking_rate', draft.tts_speaking_rate
  );
  config_hash := md5(jsonb_build_object('text', coalesce(draft.tts_text, draft.subtitle_text), 'voice', voice, 'provider', provider, 'adapter', adapter, 'model', model, 'prompt_version', prompt_version, 'connection_version_id', credential_ref)::text);

  select task.* into existing_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = 'generate_narration'
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
    and task.input_snapshot ->> 'configuration_hash' = config_hash
  order by task.created_at desc for update limit 1;
  if found and existing_task.status in ('ready', 'running') then return existing_task; end if;
  if found and existing_task.status = 'completed' and public.restore_completed_shot_tts_track(draft.id, existing_task.id) then return existing_task; end if;
  if found and existing_task.status = 'failed' and not p_retry then return existing_task; end if;

  budget_limit := case when (narration_config ->> 'budget_cents') ~ '^[0-9]+$' then (narration_config ->> 'budget_cents')::integer else 0 end;
  max_attempts := case when (narration_config ->> 'max_attempts') ~ '^[1-9][0-9]*$' then (narration_config ->> 'max_attempts')::integer else 1 end;
  task_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'capability', 'narration_generation', 'storyboard_review_package_id', p_review_package_id,
    'configuration_hash', config_hash, 'credential_ref', credential_ref,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', p_episode_id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
    'executor', jsonb_build_object('provider', provider, 'adapter', adapter, 'model', model, 'prompt_version', prompt_version),
    'media', jsonb_build_object('adapter', adapter, 'narration', jsonb_build_object('text', coalesce(draft.tts_text, draft.subtitle_text), 'voice', voice)), 'acoustic_alignment', jsonb_build_object('confirmed_text', draft.subtitle_text, 'text_fingerprint', encode(extensions.digest(convert_to(draft.subtitle_text, 'UTF8'), 'sha256'), 'hex')),
    'audio_track', jsonb_build_object('kind', 'narration', 'cue_id', draft.shot_id, 'source_review_package_id', p_review_package_id, 'start_seconds', 0, 'duration_seconds', 0.001),
    'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', max_attempts),
    'allowed_tools', coalesce(narration_config -> 'allowed_tools', jsonb_build_array('read', 'write')),
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array('narration_audio'), 'content_type', 'audio/mpeg', 'relative_path', format('episodes/%s/audio/shot-narration-%s-%s.mp3', p_episode_id, draft.shot_id, config_hash), 'review_stage', 'production_ready'),
    'input_artifacts', jsonb_build_array()
  ));
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, 'generate_narration', 'ready'::public.task_status, task_snapshot, budget_limit, max_attempts, provider, model, prompt_version)
  returning * into created_task;
  update public.shot_preparation_drafts
  set current_audio_track_id = null, current_tts_task_id = null, tts_actual_duration_seconds = null, audio_status = 'running', pending_tts_task_id = created_task.id, tts_error = null, updated_at = now()
  where id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_tts_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'configuration_hash', config_hash, 'retry', p_retry), auth.uid());
  return created_task;
end;
$_$;


--
-- Name: guard_b_roll_task_claim(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_b_roll_task_claim() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  capability_limit integer;
  provider_limit integer;
begin
  if new.task_type <> 'generate_b_roll' or old.status <> 'ready' or new.status <> 'running' then return new; end if;
  capability_limit := (new.input_snapshot #>> '{scheduling,max_concurrency}')::integer;
  provider_limit := (new.input_snapshot #>> '{scheduling,provider_max_concurrency}')::integer;
  perform pg_advisory_xact_lock(hashtext('b-roll:' || new.provider));
  if (select count(*) from public.tasks task where task.task_type = 'generate_b_roll' and task.episode_id = new.episode_id and task.status = 'running') >= capability_limit then
    raise exception 'B-roll capability concurrency limit reached' using errcode = '55000';
  end if;
  if (select count(*) from public.tasks task where task.task_type = 'generate_b_roll' and task.provider = new.provider and task.status = 'running') >= provider_limit then
    raise exception 'B-roll provider concurrency limit reached' using errcode = '55000';
  end if;
  insert into public.asset_locks (resource_key, episode_id, expires_at)
  values (format('b-roll-task:%s', new.id), new.episode_id, now() + interval '30 minutes')
  on conflict (resource_key) do update set expires_at = excluded.expires_at;
  return new;
end;
$$;


--
-- Name: has_current_shot_preparation_snapshot(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_current_shot_preparation_snapshot(p_episode_id uuid, p_storyboard_review_package_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
with storyboard as (
  select package.context_snapshot #> '{worker_result,storyboard,shots}' as shots
  from public.review_packages package
  where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review' and package.invalidated_at is null
), required_shots as (
  select shot.value from storyboard cross join lateral jsonb_array_elements(coalesce(storyboard.shots, '[]'::jsonb)) shot(value)
), valid_shots as (
  select required.value
  from required_shots required
  join public.shot_preparation_drafts draft on draft.episode_id = p_episode_id
    and draft.review_package_id = p_storyboard_review_package_id and draft.shot_id = required.value ->> 'id'
  join public.production_material_revisions material on material.id = draft.selected_material_revision_id
    and material.episode_id = p_episode_id and material.material_type = 'video'
  join public.material_revision_approvals approval on approval.material_revision_id = material.id
  where draft.input_fingerprint = md5(required.value::text) and draft.preparation_contract_status = 'current' and draft.preparation_contract is not null and draft.preparation_input_fingerprint = draft.preparation_contract ->> 'input_fingerprint' and (not draft.subtitles_enabled or coalesce(btrim(draft.subtitle_text), '') <> '')
    and jsonb_typeof(draft.clip_segments) = 'array' and jsonb_array_length(draft.clip_segments) > 0
    and not exists (
      select 1 from jsonb_array_elements(draft.clip_segments) segment
      where jsonb_typeof(segment) <> 'object'
        or jsonb_typeof(segment -> 'start_seconds') <> 'number'
        or jsonb_typeof(segment -> 'end_seconds') <> 'number'
        or (segment ->> 'start_seconds')::numeric < 0
        or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
    )
    and (draft.audio_mode <> 'tts' or exists (
      select 1 from public.audio_tracks track join public.tasks task on task.id = track.source_task_id
      where track.id = draft.current_audio_track_id and track.episode_id = p_episode_id
        and track.cue_id = draft.shot_id and track.source_review_package_id = p_storyboard_review_package_id
        and track.track_kind = 'narration' and track.sha256 is not null and track.file_size > 0
        and task.status = 'completed' and task.invalidated_at is null
        and task.input_snapshot #>> '{media,narration,text}' = draft.tts_text
        and task.input_snapshot ->> 'configuration_hash' = public.shot_tts_configuration_hash(p_episode_id, draft.id)
    ))
)
select exists (select 1 from storyboard where jsonb_typeof(storyboard.shots) = 'array' and jsonb_array_length(storyboard.shots) > 0)
  and (select count(*) from valid_shots) = (select count(*) from required_shots);
$$;


--
-- Name: has_required_artifacts(uuid, public.episode_stage); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_required_artifacts(p_episode_id uuid, p_to_stage public.episode_stage) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: production_material_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_material_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    revision_number integer NOT NULL,
    material_type text NOT NULL,
    source_kind text NOT NULL,
    source_path text NOT NULL,
    storage_path text NOT NULL,
    mime_type text NOT NULL,
    sha256 text NOT NULL,
    file_size bigint NOT NULL,
    is_main_script boolean DEFAULT false NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    material_purpose text DEFAULT 'general_reference'::text NOT NULL,
    CONSTRAINT production_material_revisions_file_size_check CHECK ((file_size >= 0)),
    CONSTRAINT production_material_revisions_material_purpose_check CHECK ((material_purpose = ANY (ARRAY['main_script'::text, 'supplemental_script'::text, 'general_reference'::text, 'visual_reference'::text, 'a_roll'::text, 'b_roll'::text, 'narration'::text, 'background_music'::text, 'sound_effect'::text, 'cover'::text]))),
    CONSTRAINT production_material_revisions_material_type_check CHECK ((char_length(TRIM(BOTH FROM material_type)) > 0)),
    CONSTRAINT production_material_revisions_mime_type_check CHECK ((char_length(TRIM(BOTH FROM mime_type)) > 0)),
    CONSTRAINT production_material_revisions_revision_number_check CHECK ((revision_number > 0)),
    CONSTRAINT production_material_revisions_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT production_material_revisions_source_kind_check CHECK ((source_kind = ANY (ARRAY['directory'::text, 'file'::text, 'paste'::text, 'worker'::text]))),
    CONSTRAINT production_material_revisions_source_path_check CHECK ((char_length(TRIM(BOTH FROM source_path)) > 0)),
    CONSTRAINT production_material_revisions_storage_path_check CHECK ((char_length(TRIM(BOTH FROM storage_path)) > 0))
);


--
-- Name: import_production_material(uuid, text, text, text, text, text, text, bigint, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.import_production_material(p_episode_id uuid, p_material_type text, p_source_kind text, p_source_path text, p_storage_path text, p_mime_type text, p_sha256 text, p_file_size bigint, p_is_main_script boolean, p_material_purpose text) RETURNS public.production_material_revisions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  created_revision public.production_material_revisions;
  current_episode public.episodes;
  next_revision integer;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;

  if not found then raise exception 'Owner membership is required to import production material' using errcode = '42501'; end if;
  if p_material_purpose not in ('main_script', 'supplemental_script', 'general_reference', 'visual_reference', 'a_roll', 'b_roll', 'narration', 'background_music', 'sound_effect', 'cover') then raise exception 'Unsupported material purpose' using errcode = '22023'; end if;
  if p_material_purpose = 'a_roll' and trim(p_material_type) <> 'video' then raise exception 'A-roll material must have video type' using errcode = '22023'; end if;
  if p_material_purpose = 'cover' and (trim(p_material_type) <> 'image' or p_mime_type !~* '^image/') then raise exception 'Cover material must have image type' using errcode = '22023'; end if;
  if p_is_main_script and trim(p_material_type) <> 'script' then raise exception 'Main script material must have script type' using errcode = '22023'; end if;
  if p_is_main_script and p_material_purpose <> 'main_script' then raise exception 'Main script material must have main_script purpose' using errcode = '22023'; end if;
  if not p_is_main_script and p_material_purpose = 'main_script' then raise exception 'Only the confirmed main script can use main_script purpose' using errcode = '22023'; end if;
  if p_is_main_script and current_episode.stage <> 'waiting_input' then raise exception 'A main script can only be imported while the episode is waiting for input' using errcode = '22023'; end if;
  if p_is_main_script and current_episode.main_script_revision_id is not null then raise exception 'A main script is already confirmed for this episode' using errcode = '22023'; end if;
  if p_storage_path !~ ('^episodes/' || p_episode_id::text || '/materials/[0-9a-f]{64}-[^/]+$') then raise exception 'Material storage path is outside the episode material directory' using errcode = '22023'; end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.production_material_revisions
  where episode_id = p_episode_id and material_type = trim(p_material_type);

  insert into public.production_material_revisions (episode_id, revision_number, material_type, material_purpose, source_kind, source_path, storage_path, mime_type, sha256, file_size, is_main_script, created_by)
  values (p_episode_id, next_revision, trim(p_material_type), p_material_purpose, p_source_kind, trim(p_source_path), p_storage_path, p_mime_type, p_sha256, p_file_size, p_is_main_script, auth.uid())
  returning * into created_revision;

  insert into public.material_revision_approvals (material_revision_id, approved_by) values (created_revision.id, auth.uid());
  if p_is_main_script then update public.episodes set main_script_revision_id = created_revision.id, updated_at = now() where id = p_episode_id; end if;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'production_material_imported', jsonb_build_object('material_revision_id', created_revision.id, 'material_type', created_revision.material_type, 'material_purpose', created_revision.material_purpose, 'sha256', created_revision.sha256, 'source_kind', created_revision.source_kind, 'is_main_script', created_revision.is_main_script, 'approval_id', (select id from public.material_revision_approvals where material_revision_id = created_revision.id)), auth.uid());
  return created_revision;
end;
$_$;


--
-- Name: initialize_notification_delivery(timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.initialize_notification_delivery(p_after_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 perform 1 from public.notification_delivery_state where singleton for update;
 if (select initialized from public.notification_delivery_state where singleton) then return false; end if;
 if (p_after_time is null) <> (p_after_id is null) then raise exception 'Both legacy cursor fields are required'; end if;
 update public.notification_delivery_events d set outcome='historical'
 from public.audit_events a where a.id=d.event_id and d.outcome='pending'
 and (p_after_time is null or (a.created_at,a.id)<=(p_after_time,p_after_id));
 update public.notification_delivery_state set initialized=true where singleton;
 return true;
end $$;


--
-- Name: invalidate_changed_series_baseline_dependents(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invalidate_changed_series_baseline_dependents() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.rules is distinct from old.rules then
    perform public.invalidate_dependent_production_work('series_version',new.id,'The frozen series visual baseline changed.');
  end if;
  return new;
end;
$$;


--
-- Name: invalidate_dependent_production_work(text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invalidate_dependent_production_work(p_upstream_kind text, p_upstream_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  dependency public.production_dependencies;
  source_task public.tasks;
  candidate_rank integer;
  episode_candidate record;
  target_stage public.episode_stage;
  approval public.approvals;
begin
  if p_upstream_kind not in ('material_revision', 'series_version', 'review_package') or btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Production invalidation input is invalid' using errcode = '22023';
  end if;
  for dependency in select * from public.production_dependencies where upstream_kind = p_upstream_kind and upstream_id = p_upstream_id loop
    insert into public.production_invalidations (episode_id,upstream_kind,upstream_id,target_kind,target_id,reason)
    values (dependency.episode_id,p_upstream_kind,p_upstream_id,dependency.downstream_kind,dependency.downstream_id,btrim(p_reason))
    on conflict do nothing;
    if dependency.downstream_kind = 'task' then
      update public.tasks set invalidated_at = now(), invalidated_reason = btrim(p_reason) where id = dependency.downstream_id and invalidated_at is null;
      select * into source_task from public.tasks where id = dependency.downstream_id;
      candidate_rank := case when source_task.task_type = 'prepare_visual_brief' then 1 when source_task.task_type = 'draft_storyboard' then 2 else 3 end;
    else
      update public.review_packages set invalidated_at = now(), invalidated_reason = btrim(p_reason) where id = dependency.downstream_id and invalidated_at is null;
      candidate_rank := 3;
      for approval in select * from public.approvals where review_package_id = dependency.downstream_id loop
        insert into public.production_invalidations (episode_id,upstream_kind,upstream_id,target_kind,target_id,reason)
        values (dependency.episode_id,p_upstream_kind,p_upstream_id,'approval',approval.id,btrim(p_reason))
        on conflict do nothing;
      end loop;
    end if;
  end loop;
  for episode_candidate in
    select episode.*, min(case when task.task_type = 'prepare_visual_brief' then 1 when task.task_type = 'draft_storyboard' then 2 else 3 end) as earliest_rank
    from public.episodes episode
    join public.production_dependencies candidate on candidate.episode_id = episode.id
    left join public.tasks task on candidate.downstream_kind = 'task' and task.id = candidate.downstream_id
    where candidate.upstream_kind = p_upstream_kind and candidate.upstream_id = p_upstream_id
    group by episode.id
  loop
    target_stage := case episode_candidate.earliest_rank when 1 then 'visual_draft'::public.episode_stage when 2 then 'storyboard_draft'::public.episode_stage else 'production_ready'::public.episode_stage end;
    if episode_candidate.stage > target_stage then
      update public.episodes set stage = target_stage, updated_at = now() where id = episode_candidate.id;
      insert into public.state_transitions (episode_id,from_stage,to_stage,reason,actor_id) values (episode_candidate.id,episode_candidate.stage,target_stage,btrim(p_reason),null);
      insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) values (episode_candidate.account_id,episode_candidate.id,'production_dependencies_invalidated',jsonb_build_object('upstream_kind',p_upstream_kind,'upstream_id',p_upstream_id,'to_stage',target_stage,'reason',btrim(p_reason)),null);
    end if;
  end loop;
end;
$$;


--
-- Name: invalidate_replaced_material_dependents(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invalidate_replaced_material_dependents() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare previous_revision public.production_material_revisions;
begin
  if new.material_purpose = 'cover' then return new; end if;
  select * into previous_revision
  from public.production_material_revisions revision
  where revision.episode_id = new.episode_id
    and revision.material_type = new.material_type
    and revision.source_path = new.source_path
    and revision.id <> new.id
  order by revision.revision_number desc
  limit 1;
  if found then perform public.invalidate_dependent_production_work('material_revision', previous_revision.id, 'A newer revision replaced an upstream production material.'); end if;
  return new;
end;
$$;


--
-- Name: invalidate_revised_storyboard_dependents(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invalidate_revised_storyboard_dependents() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare previous_package_id uuid;
begin
  if new.stage <> 'storyboard_review' then return new; end if;
  if coalesce(new.context_snapshot #>> '{review_feedback,review_package_id}', '') = '' then return new; end if;
  previous_package_id := (new.context_snapshot #>> '{review_feedback,review_package_id}')::uuid;
  perform public.invalidate_dependent_production_work('review_package',previous_package_id,'A revised storyboard replaced the upstream approved storyboard package.');
  return new;
end;
$$;


--
-- Name: invalidate_shot_source_audio_after_clip_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invalidate_shot_source_audio_after_clip_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.audio_mode = 'source' and (old.selected_material_revision_id is distinct from new.selected_material_revision_id or old.clip_start_seconds is distinct from new.clip_start_seconds or old.clip_end_seconds is distinct from new.clip_end_seconds) then
    update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'The prepared video selection changed.'
    where task.input_snapshot #>> '{shot_preparation,draft_id}' = new.id::text and task.task_type = 'extract_embedded_audio' and task.status in ('ready', 'running', 'blocked', 'failed');
    update public.shot_preparation_drafts set current_audio_track_id = null, pending_source_audio_task_id = null, audio_status = 'pending', source_audio_duration_seconds = null, source_audio_error = null, updated_at = now() where id = new.id;
  end if;
  return new;
end;
$$;


--
-- Name: invalidate_superseded_storyboard_narration_tasks_after_approval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invalidate_superseded_storyboard_narration_tasks_after_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.stage <> 'storyboard_approved' or new.decision <> 'approved' or new.review_package_id is null then
    return new;
  end if;

  update public.tasks task
  set status = 'superseded',
      invalidated_at = now(),
      invalidated_reason = 'Superseded by a newer approved storyboard package.'
  where task.episode_id = new.episode_id
    and task.task_type = 'generate_narration'
    and task.status in ('blocked', 'failed')
    and task.invalidated_at is null
    and task.input_snapshot ->> 'storyboard_review_package_id' is not null
    and task.input_snapshot ->> 'storyboard_review_package_id' <> new.review_package_id::text;

  return new;
end;
$$;


--
-- Name: is_account_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_account_member(target_account_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.account_memberships
    where account_id = target_account_id and user_id = auth.uid()
  );
$$;


--
-- Name: is_allowed_episode_transition(public.episode_stage, public.episode_stage); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_allowed_episode_transition(from_stage public.episode_stage, to_stage public.episode_stage) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
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


--
-- Name: link_review_package_approval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_review_package_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare review_stage public.episode_stage;
begin
  review_stage := case
    when new.stage in ('script_review', 'script_approved') then 'script_review'::public.episode_stage
    when new.stage in ('visual_review', 'visual_approved') then 'visual_review'::public.episode_stage
    when new.stage in ('storyboard_review', 'storyboard_approved') then 'storyboard_review'::public.episode_stage
    when new.stage in ('production_ready', 'render_ready') then 'production_ready'::public.episode_stage
    when new.stage in ('qc_review', 'qc_passed') then 'qc_review'::public.episode_stage
    else null
  end;
  if review_stage is null then return new; end if;
  select review_package.id into new.review_package_id from public.review_packages review_package where review_package.episode_id = new.episode_id and review_package.stage = review_stage and review_package.invalidated_at is null order by review_package.revision_number desc limit 1;
  if new.review_package_id is null then raise exception 'Review approval requires a current review package' using errcode = '22023'; end if;
  return new;
end;
$$;


--
-- Name: list_external_connection_versions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_external_connection_versions(p_connection_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, connection_id uuid, version integer, provider text, adapter text, endpoint text, created_at timestamp with time zone, revoked_at timestamp with time zone, is_current boolean, status text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select version.id, version.connection_id, version.version, version.provider, version.adapter, version.endpoint, version.created_at, version.revoked_at, connection.current_version_id = version.id,
    case when version.revoked_at is not null then 'revoked' else coalesce((select verification.status from public.external_connection_verifications verification where verification.connection_version_id = version.id order by verification.created_at desc, verification.id desc limit 1), 'unverified') end
  from public.external_connection_versions version join public.external_connections connection on connection.id = version.connection_id
  where connection.created_by = auth.uid() and (p_connection_id is null or version.connection_id = p_connection_id)
  order by version.connection_id, version.version desc;
$$;


--
-- Name: materialize_approved_script_revision(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.materialize_approved_script_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  approved_package public.review_packages;
  approved_artifact public.artifacts;
  current_episode public.episodes;
  next_revision integer;
  created_revision public.production_material_revisions;
begin
  if new.stage <> 'script_approved' or new.decision <> 'approved' then
    return new;
  end if;
  select * into current_episode from public.episodes where id = new.episode_id for update;
  if current_episode.stage <> 'script_approved' or current_episode.main_script_revision_id is not null then
    raise exception 'Approved generated script requires an episode without a main script revision' using errcode = '22023';
  end if;
  select * into approved_package from public.review_packages
  where id = new.review_package_id and episode_id = new.episode_id and stage = 'script_review';
  if not found then
    raise exception 'Approved generated script requires its script review package' using errcode = '22023';
  end if;
  select * into approved_artifact from public.artifacts
  where id = approved_package.artifact_id and episode_id = new.episode_id and artifact_type = 'script';
  if not found then
    raise exception 'Approved generated script artifact is missing' using errcode = '22023';
  end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.production_material_revisions
  where episode_id = new.episode_id and material_type = 'script';

  insert into public.production_material_revisions (
    episode_id, revision_number, material_type, source_kind, source_path, storage_path,
    mime_type, sha256, file_size, is_main_script, created_by
  ) values (
    new.episode_id,
    next_revision,
    'script',
    'worker',
    format('task:%s', approved_package.task_id),
    approved_artifact.relative_path,
    'text/markdown',
    approved_artifact.sha256,
    approved_artifact.file_size,
    true,
    new.actor_id
  ) returning * into created_revision;

  update public.episodes
  set main_script_revision_id = created_revision.id, updated_at = now()
  where id = new.episode_id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    new.episode_id,
    'generated_script_approved',
    jsonb_build_object('review_package_id', approved_package.id, 'material_revision_id', created_revision.id, 'artifact_id', approved_artifact.id),
    new.actor_id
  );
  return new;
end;
$$;


--
-- Name: normalize_manual_media_task(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_manual_media_task(p_episode_id uuid, p_input_snapshot jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare snapshot jsonb := coalesce(p_input_snapshot, '{}'::jsonb); capability text := snapshot ->> 'capability'; v_task_type text; target text;
begin
  if capability not in ('a_roll_manual_upload', 'b_roll_manual_upload', 'narration_manual_upload', 'soundtrack_manual_upload') then return snapshot; end if;
  v_task_type := case capability when 'a_roll_manual_upload' then 'generate_a_roll' when 'b_roll_manual_upload' then 'generate_b_roll' when 'narration_manual_upload' then 'generate_narration' else 'generate_soundtrack' end;
  target := case when v_task_type in ('generate_a_roll', 'generate_b_roll') then snapshot #>> '{shot,id}' else snapshot #>> '{audio_track,cue_id}' end;
  update public.tasks task set status = 'superseded'::public.task_status, invalidated_at = now(), invalidated_reason = 'Owner replaced automatic media with a fully satisfying manual upload.'
  where task.episode_id = p_episode_id and task.task_type = v_task_type and task.provider <> 'manual_upload' and task.status in ('ready', 'blocked', 'failed') and case when v_task_type in ('generate_a_roll', 'generate_b_roll') then task.input_snapshot #>> '{shot,id}' else task.input_snapshot #>> '{audio_track,cue_id}' end = target;
  return jsonb_set(snapshot, '{configuration_hash}', to_jsonb('manual-' || md5(snapshot::text)), true);
end;
$$;


--
-- Name: normalize_worker_task_runtime_constraints(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_worker_task_runtime_constraints() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.provider in ('codex', 'google_tts', 'volcengine_tts', 'pexels', 'ffmpeg', 'freesound', 'openchatcut', 'openai', 'cloudflare', 'whisperx')
    and jsonb_typeof(new.input_snapshot) = 'object' then
    new.input_snapshot := new.input_snapshot || jsonb_build_object(
      'runtime_constraints', public.worker_runtime_constraints(new.input_snapshot),
      'allowed_tools', public.worker_required_tools(new.input_snapshot ->> 'capability')
    );
  end if;
  return new;
end;
$$;


--
-- Name: official_external_connection_endpoint(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.official_external_connection_endpoint(p_provider text, p_adapter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    when p_provider = 'pexels' and p_adapter = 'pexels_video' then 'https://api.pexels.com'
    when p_provider = 'freesound' and p_adapter = 'freesound_preview' then 'https://freesound.org/apiv2'
    when p_provider = 'openai' and p_adapter = 'openai_images' then 'https://api.openai.com/v1'
    when p_provider = 'cloudflare' and p_adapter = 'workers_ai_images' then 'https://api.cloudflare.com/client/v4'
    when p_provider = 'google_tts' and p_adapter = 'google_tts' then 'https://texttospeech.googleapis.com/v1'
    when p_provider = 'volcengine_tts' and p_adapter = 'volcengine_tts' then 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse'
    else null
  end;
$$;


--
-- Name: orchestrate_a_roll_tasks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_a_roll_tasks() RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  candidate_id uuid;
  created_task public.tasks;
begin
  for candidate_id in
    select episode.id
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where blueprint.policy #>> '{a_roll,execution_path}' in ('external', 'local')
  loop
    for created_task in select * from public.orchestrate_a_roll_tasks_for_episode(candidate_id)
    loop
      if created_task.input_snapshot #>> '{executor,provider}' = 'openchatcut'
        and created_task.input_snapshot #>> '{executor,adapter}' = 'openchatcut_card_video'
        and created_task.input_snapshot #>> '{executor,model}' = 'openchatcut@0.2.14' then
        update public.tasks task
        set status = 'ready'::public.task_status,
            last_result = null,
            completed_at = null
        where task.id = created_task.id
        returning task.* into created_task;
      end if;
      return next created_task;
    end loop;
  end loop;
end;
$$;


--
-- Name: orchestrate_a_roll_tasks_for_episode(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_a_roll_tasks_for_episode(p_episode_id uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare created_task public.tasks;
begin
  for created_task in select * from public.orchestrate_a_roll_tasks_for_episode_without_card_adapter(p_episode_id)
  loop
    if created_task.input_snapshot #>> '{executor,provider}' = 'openchatcut'
      and created_task.input_snapshot #>> '{executor,adapter}' = 'openchatcut_card_video'
      and created_task.input_snapshot #>> '{executor,model}' = 'openchatcut@0.2.14' then
      update public.tasks task
      set status = 'ready'::public.task_status,
          last_result = null,
          completed_at = null
      where task.id = created_task.id
      returning task.* into created_task;
    end if;
    return next created_task;
  end loop;
end;
$$;


--
-- Name: orchestrate_a_roll_tasks_for_episode_without_card_adapter(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_a_roll_tasks_for_episode_without_card_adapter(p_episode_id uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  candidate record;
  storyboard_shot jsonb;
  selected_config jsonb;
  executor jsonb;
  allowed_tools jsonb;
  frozen_inputs jsonb;
  configuration_hash text;
  budget_limit integer;
  max_attempts integer;
  blocker_code text;
  blocker_detail text;
  configuration_blocker_code text;
  configuration_blocker_detail text;
  created_task public.tasks;
begin
  for candidate in
    select episode.*, blueprint.policy as blueprint_policy, series_version.rules as series_rules,
      review_package.id as storyboard_review_package_id, review_package.context_snapshot as storyboard_context
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join lateral (
      select package.* from public.review_packages package
      join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
      where package.episode_id = episode.id and package.stage = 'storyboard_review'
      order by package.revision_number desc limit 1
    ) review_package on true
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    where episode.stage = 'storyboard_approved' and (p_episode_id is null or episode.id = p_episode_id) and blueprint.policy #>> '{a_roll,execution_path}' in ('external', 'local')
    order by episode.updated_at, episode.id
    for update of episode skip locked
  loop
    selected_config := coalesce(candidate.series_rules -> 'a_roll', candidate.blueprint_policy -> 'a_roll');
    configuration_hash := md5(coalesce(selected_config::text, 'null'));
    blocker_code := null;
    blocker_detail := null;
    if jsonb_typeof(selected_config) <> 'object' then
      blocker_code := 'a_roll_executor_missing';
      blocker_detail := '蓝图或系列规则未声明 a_roll 执行器配置。';
    elsif jsonb_typeof(selected_config -> 'executor') <> 'object'
      or coalesce(btrim(selected_config #>> '{executor,provider}'), '') = ''
      or coalesce(btrim(selected_config #>> '{executor,model}'), '') = ''
      or coalesce(btrim(selected_config #>> '{executor,prompt_version}'), '') = ''
      or coalesce(btrim(selected_config #>> '{executor,adapter}'), '') = '' then
      blocker_code := 'a_roll_executor_invalid';
      blocker_detail := 'a_roll 执行器必须冻结 provider、model、prompt_version 与 adapter。';
    elsif jsonb_typeof(selected_config -> 'allowed_tools') <> 'array'
      or jsonb_array_length(selected_config -> 'allowed_tools') = 0
      or exists (select 1 from jsonb_array_elements(selected_config -> 'allowed_tools') tool where jsonb_typeof(tool) <> 'string' or coalesce(btrim(tool #>> '{}'), '') = '') then
      blocker_code := 'a_roll_allowed_tools_invalid';
      blocker_detail := 'a_roll 配置必须声明非空的允许工具或适配器清单。';
    elsif jsonb_typeof(selected_config -> 'budget_cents') <> 'number'
      or selected_config ->> 'budget_cents' !~ '^[1-9][0-9]*$'
      or length(selected_config ->> 'budget_cents') > 10
      or (length(selected_config ->> 'budget_cents') = 10 and selected_config ->> 'budget_cents' > '2147483647') then
      blocker_code := 'a_roll_budget_unavailable';
      blocker_detail := 'a_roll 配置必须提供不超过 2147483647 分的正整数预算。';
    elsif jsonb_typeof(selected_config -> 'max_attempts') <> 'number'
      or selected_config ->> 'max_attempts' !~ '^[1-9][0-9]*$'
      or length(selected_config ->> 'max_attempts') > 10
      or (length(selected_config ->> 'max_attempts') = 10 and selected_config ->> 'max_attempts' > '2147483647') then
      blocker_code := 'a_roll_retry_policy_invalid';
      blocker_detail := 'a_roll 配置必须提供不超过 2147483647 的正整数最大尝试次数。';
    elsif selected_config ? 'fallback_executor' and selected_config -> 'fallback_executor' <> selected_config -> 'executor' then
      blocker_code := 'a_roll_fallback_not_equivalent';
      blocker_detail := '非等价备用执行器不能替换冻结的 A-roll 执行器。';
    else
      blocker_code := 'a_roll_executor_unavailable';
      blocker_detail := '尚未注册可生成并验证视频输出的 A-roll 适配器；任务不会由通用 Codex Worker 代替执行。';
    end if;

    configuration_blocker_code := blocker_code;
    configuration_blocker_detail := blocker_detail;
    executor := selected_config -> 'executor';
    allowed_tools := selected_config -> 'allowed_tools';
    budget_limit := case when jsonb_typeof(selected_config -> 'budget_cents') = 'number' and selected_config ->> 'budget_cents' ~ '^[1-9][0-9]*$' and (length(selected_config ->> 'budget_cents') < 10 or (length(selected_config ->> 'budget_cents') = 10 and selected_config ->> 'budget_cents' <= '2147483647')) then (selected_config ->> 'budget_cents')::integer else 0 end;
    max_attempts := case when jsonb_typeof(selected_config -> 'max_attempts') = 'number' and selected_config ->> 'max_attempts' ~ '^[1-9][0-9]*$' and (length(selected_config ->> 'max_attempts') < 10 or (length(selected_config ->> 'max_attempts') = 10 and selected_config ->> 'max_attempts' <= '2147483647')) then (selected_config ->> 'max_attempts')::integer else 1 end;

    for storyboard_shot in
      select value from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') where value ->> 'shotType' = 'a_roll'
    loop
      if exists (
        select 1 from public.tasks task
        where task.episode_id = candidate.id and task.task_type = 'generate_a_roll'
          and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text
          and task.input_snapshot #>> '{shot,id}' = storyboard_shot ->> 'id'
          and task.input_snapshot ->> 'configuration_hash' = configuration_hash
      ) then
        continue;
      end if;

      blocker_code := configuration_blocker_code;
      blocker_detail := configuration_blocker_detail;
      select coalesce(jsonb_agg(frozen_input), '[]'::jsonb) into frozen_inputs
      from jsonb_array_elements(candidate.storyboard_context -> 'input_artifacts') frozen_input
      join jsonb_array_elements(storyboard_shot -> 'inputBasis') input_basis
        on frozen_input ->> 'relativePath' = input_basis ->> 'relativePath' and frozen_input ->> 'sha256' = input_basis ->> 'sha256';
      if jsonb_array_length(frozen_inputs) <> jsonb_array_length(storyboard_shot -> 'inputBasis') then
        blocker_code := 'a_roll_input_basis_invalid';
        blocker_detail := 'A-roll 镜头引用的冻结输入不完整。';
      end if;

      insert into public.tasks (
        episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts,
        provider, model, prompt_version, last_result, completed_at
      ) values (
        candidate.id, 'generate_a_roll', 'blocked'::public.task_status,
        jsonb_strip_nulls(jsonb_build_object(
          'capability', 'a_roll_generation', 'storyboard_review_package_id', candidate.storyboard_review_package_id,
          'configuration_hash', configuration_hash, 'shot', storyboard_shot, 'executor', executor,
          'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', max_attempts), 'allowed_tools', allowed_tools,
          'output', jsonb_build_object('required_artifact_types', jsonb_build_array('a_roll_video'), 'content_type', 'video/mp4', 'relative_path', format('episodes/%s/a-roll/%s.mp4', candidate.id, storyboard_shot ->> 'id'), 'review_stage', 'production_ready'),
          'input_artifacts', frozen_inputs
        )),
        budget_limit, max_attempts, coalesce(executor ->> 'provider', 'unconfigured'), coalesce(executor ->> 'model', 'unconfigured'), coalesce(executor ->> 'prompt_version', 'unconfigured'),
        jsonb_build_object(
          'version', 'worker-result/v1', 'taskId', '', 'status', 'blocked', 'artifacts', jsonb_build_array(),
          'validation', jsonb_build_object('passed', false, 'checks', jsonb_build_array()), 'actualCostCents', 0,
          'blockers', jsonb_build_array(jsonb_build_object('code', blocker_code, 'detail', blocker_detail)),
          'retry', jsonb_build_object('shouldRetry', false, 'reason', blocker_detail),
          'nextStep', '注册可验证视频输出的 A-roll 适配器后，使用新的冻结配置创建任务。'
        ), now()
      ) returning * into created_task;

      update public.tasks set last_result = jsonb_set(last_result, '{taskId}', to_jsonb(created_task.id::text)) where id = created_task.id returning * into created_task;
      insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
      values (candidate.account_id, candidate.id, 'a_roll_task_blocked', jsonb_build_object('task_id', created_task.id, 'shot_id', storyboard_shot ->> 'id', 'code', blocker_code, 'detail', blocker_detail), null);
      return next created_task;
    end loop;
  end loop;
end;
$_$;


--
-- Name: orchestrate_a_roll_tasks_without_card_adapter(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_a_roll_tasks_without_card_adapter() RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  candidate record;
  storyboard_shot jsonb;
  selected_config jsonb;
  executor jsonb;
  allowed_tools jsonb;
  frozen_inputs jsonb;
  configuration_hash text;
  budget_limit integer;
  max_attempts integer;
  blocker_code text;
  blocker_detail text;
  configuration_blocker_code text;
  configuration_blocker_detail text;
  created_task public.tasks;
begin
  for candidate in
    select episode.*, blueprint.policy as blueprint_policy, series_version.rules as series_rules,
      review_package.id as storyboard_review_package_id, review_package.context_snapshot as storyboard_context
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join lateral (
      select package.* from public.review_packages package
      join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
      where package.episode_id = episode.id and package.stage = 'storyboard_review'
      order by package.revision_number desc limit 1
    ) review_package on true
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    where episode.stage = 'storyboard_approved'
    order by episode.updated_at, episode.id
    for update of episode skip locked
  loop
    selected_config := coalesce(candidate.series_rules -> 'a_roll', candidate.blueprint_policy -> 'a_roll');
    configuration_hash := md5(coalesce(selected_config::text, 'null'));
    blocker_code := null;
    blocker_detail := null;
    if jsonb_typeof(selected_config) <> 'object' then
      blocker_code := 'a_roll_executor_missing';
      blocker_detail := '蓝图或系列规则未声明 a_roll 执行器配置。';
    elsif jsonb_typeof(selected_config -> 'executor') <> 'object'
      or coalesce(btrim(selected_config #>> '{executor,provider}'), '') = ''
      or coalesce(btrim(selected_config #>> '{executor,model}'), '') = ''
      or coalesce(btrim(selected_config #>> '{executor,prompt_version}'), '') = ''
      or coalesce(btrim(selected_config #>> '{executor,adapter}'), '') = '' then
      blocker_code := 'a_roll_executor_invalid';
      blocker_detail := 'a_roll 执行器必须冻结 provider、model、prompt_version 与 adapter。';
    elsif jsonb_typeof(selected_config -> 'allowed_tools') <> 'array'
      or jsonb_array_length(selected_config -> 'allowed_tools') = 0
      or exists (select 1 from jsonb_array_elements(selected_config -> 'allowed_tools') tool where jsonb_typeof(tool) <> 'string' or coalesce(btrim(tool #>> '{}'), '') = '') then
      blocker_code := 'a_roll_allowed_tools_invalid';
      blocker_detail := 'a_roll 配置必须声明非空的允许工具或适配器清单。';
    elsif jsonb_typeof(selected_config -> 'budget_cents') <> 'number'
      or selected_config ->> 'budget_cents' !~ '^[1-9][0-9]*$'
      or length(selected_config ->> 'budget_cents') > 10
      or (length(selected_config ->> 'budget_cents') = 10 and selected_config ->> 'budget_cents' > '2147483647') then
      blocker_code := 'a_roll_budget_unavailable';
      blocker_detail := 'a_roll 配置必须提供不超过 2147483647 分的正整数预算。';
    elsif jsonb_typeof(selected_config -> 'max_attempts') <> 'number'
      or selected_config ->> 'max_attempts' !~ '^[1-9][0-9]*$'
      or length(selected_config ->> 'max_attempts') > 10
      or (length(selected_config ->> 'max_attempts') = 10 and selected_config ->> 'max_attempts' > '2147483647') then
      blocker_code := 'a_roll_retry_policy_invalid';
      blocker_detail := 'a_roll 配置必须提供不超过 2147483647 的正整数最大尝试次数。';
    elsif selected_config ? 'fallback_executor' and selected_config -> 'fallback_executor' <> selected_config -> 'executor' then
      blocker_code := 'a_roll_fallback_not_equivalent';
      blocker_detail := '非等价备用执行器不能替换冻结的 A-roll 执行器。';
    else
      blocker_code := 'a_roll_executor_unavailable';
      blocker_detail := '尚未注册可生成并验证视频输出的 A-roll 适配器；任务不会由通用 Codex Worker 代替执行。';
    end if;

    configuration_blocker_code := blocker_code;
    configuration_blocker_detail := blocker_detail;
    executor := selected_config -> 'executor';
    allowed_tools := selected_config -> 'allowed_tools';
    budget_limit := case when jsonb_typeof(selected_config -> 'budget_cents') = 'number' and selected_config ->> 'budget_cents' ~ '^[1-9][0-9]*$' and (length(selected_config ->> 'budget_cents') < 10 or (length(selected_config ->> 'budget_cents') = 10 and selected_config ->> 'budget_cents' <= '2147483647')) then (selected_config ->> 'budget_cents')::integer else 0 end;
    max_attempts := case when jsonb_typeof(selected_config -> 'max_attempts') = 'number' and selected_config ->> 'max_attempts' ~ '^[1-9][0-9]*$' and (length(selected_config ->> 'max_attempts') < 10 or (length(selected_config ->> 'max_attempts') = 10 and selected_config ->> 'max_attempts' <= '2147483647')) then (selected_config ->> 'max_attempts')::integer else 1 end;

    for storyboard_shot in
      select value from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') where value ->> 'shotType' = 'a_roll'
    loop
      if exists (
        select 1 from public.tasks task
        where task.episode_id = candidate.id and task.task_type = 'generate_a_roll'
          and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text
          and task.input_snapshot #>> '{shot,id}' = storyboard_shot ->> 'id'
          and task.input_snapshot ->> 'configuration_hash' = configuration_hash
      ) then
        continue;
      end if;

      blocker_code := configuration_blocker_code;
      blocker_detail := configuration_blocker_detail;
      select coalesce(jsonb_agg(frozen_input), '[]'::jsonb) into frozen_inputs
      from jsonb_array_elements(candidate.storyboard_context -> 'input_artifacts') frozen_input
      join jsonb_array_elements(storyboard_shot -> 'inputBasis') input_basis
        on frozen_input ->> 'relativePath' = input_basis ->> 'relativePath' and frozen_input ->> 'sha256' = input_basis ->> 'sha256';
      if jsonb_array_length(frozen_inputs) <> jsonb_array_length(storyboard_shot -> 'inputBasis') then
        blocker_code := 'a_roll_input_basis_invalid';
        blocker_detail := 'A-roll 镜头引用的冻结输入不完整。';
      end if;

      insert into public.tasks (
        episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts,
        provider, model, prompt_version, last_result, completed_at
      ) values (
        candidate.id, 'generate_a_roll', 'blocked'::public.task_status,
        jsonb_strip_nulls(jsonb_build_object(
          'capability', 'a_roll_generation', 'storyboard_review_package_id', candidate.storyboard_review_package_id,
          'configuration_hash', configuration_hash, 'shot', storyboard_shot, 'executor', executor,
          'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', max_attempts), 'allowed_tools', allowed_tools,
          'output', jsonb_build_object('required_artifact_types', jsonb_build_array('a_roll_video'), 'content_type', 'video/mp4', 'relative_path', format('episodes/%s/a-roll/%s.mp4', candidate.id, storyboard_shot ->> 'id'), 'review_stage', 'production_ready'),
          'input_artifacts', frozen_inputs
        )),
        budget_limit, max_attempts, coalesce(executor ->> 'provider', 'unconfigured'), coalesce(executor ->> 'model', 'unconfigured'), coalesce(executor ->> 'prompt_version', 'unconfigured'),
        jsonb_build_object(
          'version', 'worker-result/v1', 'taskId', '', 'status', 'blocked', 'artifacts', jsonb_build_array(),
          'validation', jsonb_build_object('passed', false, 'checks', jsonb_build_array()), 'actualCostCents', 0,
          'blockers', jsonb_build_array(jsonb_build_object('code', blocker_code, 'detail', blocker_detail)),
          'retry', jsonb_build_object('shouldRetry', false, 'reason', blocker_detail),
          'nextStep', '注册可验证视频输出的 A-roll 适配器后，使用新的冻结配置创建任务。'
        ), now()
      ) returning * into created_task;

      update public.tasks set last_result = jsonb_set(last_result, '{taskId}', to_jsonb(created_task.id::text)) where id = created_task.id returning * into created_task;
      insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
      values (candidate.account_id, candidate.id, 'a_roll_task_blocked', jsonb_build_object('task_id', created_task.id, 'shot_id', storyboard_shot ->> 'id', 'code', blocker_code, 'detail', blocker_detail), null);
      return next created_task;
    end loop;
  end loop;
end;
$_$;


--
-- Name: orchestrate_a_roll_tasks_without_manual_path(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_a_roll_tasks_without_manual_path() RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare created_task public.tasks;
begin
  for created_task in select * from public.orchestrate_a_roll_tasks_without_card_adapter()
  loop
    if created_task.input_snapshot #>> '{executor,provider}' = 'openchatcut'
      and created_task.input_snapshot #>> '{executor,adapter}' = 'openchatcut_card_video'
      and created_task.input_snapshot #>> '{executor,model}' = 'openchatcut@0.2.14' then
      update public.tasks task
      set status = 'ready'::public.task_status,
          last_result = null,
          completed_at = null
      where task.id = created_task.id
      returning task.* into created_task;
    end if;
    return next created_task;
  end loop;
end;
$$;


--
-- Name: orchestrate_b_roll_tasks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_b_roll_tasks(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare candidate_id uuid;
begin
  for candidate_id in
    select episode.id
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where (p_episode_id is null or episode.id = p_episode_id)
      and (blueprint.policy -> 'b_roll') is not null
      and jsonb_typeof(blueprint.policy -> 'b_roll') <> 'null'
      and blueprint.policy #>> '{b_roll,execution_path}' in ('external', 'local')
  loop
    return query select * from public.orchestrate_b_roll_tasks_configured(candidate_id);
  end loop;
end;
$$;


--
-- Name: orchestrate_b_roll_tasks_all(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_b_roll_tasks_all() RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  created_task public.tasks;
  corrected_query text;
begin
  for created_task in select * from public.orchestrate_b_roll_tasks_legacy()
  loop
    if created_task.status = 'ready' then
      corrected_query := left(btrim(created_task.input_snapshot #>> '{shot,scriptSegment}'), 100);
      if corrected_query = '' then raise exception 'B-roll task is missing a frozen search query basis' using errcode = '22023'; end if;
      update public.tasks set input_snapshot = jsonb_set(input_snapshot, '{media,b_roll,query}', to_jsonb(corrected_query)) where id = created_task.id returning * into created_task;
    end if;
    return next created_task;
  end loop;
end;
$$;


--
-- Name: orchestrate_b_roll_tasks_configured(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_b_roll_tasks_configured(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  created_task public.tasks;
  is_local_card boolean;
begin
  select blueprint.policy #>> '{b_roll,executor,provider}' = 'openchatcut'
    and blueprint.policy #>> '{b_roll,executor,adapter}' = 'openchatcut_card_video'
    and blueprint.policy #>> '{b_roll,executor,model}' = 'openchatcut@0.2.14'
  into is_local_card
  from public.episodes episode
  join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
  where episode.id = p_episode_id;

  if coalesce(is_local_card, false) then
    for created_task in select * from public.orchestrate_b_roll_tasks_without_connection_ref(p_episode_id)
    loop
      update public.tasks task
      set status = 'ready'::public.task_status,
          input_snapshot = jsonb_set(task.input_snapshot - 'credential_ref', '{media}', jsonb_build_object('adapter', 'openchatcut_card_video', 'card_video', jsonb_build_object('shot', task.input_snapshot -> 'shot')), true),
          last_result = null,
          completed_at = null
      where task.id = created_task.id
      returning task.* into created_task;
      return next created_task;
    end loop;
    return;
  end if;

  return query select * from public.orchestrate_b_roll_tasks_with_connection_ref(p_episode_id);
end;
$$;


--
-- Name: orchestrate_b_roll_tasks_legacy(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_b_roll_tasks_legacy(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  candidate record; storyboard_shot jsonb; selected_config jsonb; executor jsonb; allowed_tools jsonb; frozen_inputs jsonb;
  configuration_hash text; budget_limit integer; total_budget integer; max_attempts integer; max_concurrency integer; provider_max_concurrency integer; committed_budget bigint;
  blocker_code text; blocker_detail text; created_task public.tasks; frozen_query text;
begin
  for candidate in
    select episode.*, blueprint.policy as blueprint_policy, review_package.id as storyboard_review_package_id, review_package.context_snapshot as storyboard_context
    from public.episodes episode join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join lateral (select package.* from public.review_packages package join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved' where package.episode_id = episode.id and package.stage = 'storyboard_review' order by package.revision_number desc limit 1) review_package on true
    where episode.stage = 'storyboard_approved' and (p_episode_id is null or episode.id = p_episode_id)
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    selected_config := candidate.blueprint_policy -> 'b_roll';
    configuration_hash := md5(coalesce(selected_config::text, 'null'));
    blocker_code := null; blocker_detail := null;
    if jsonb_typeof(selected_config) <> 'object' then blocker_code := 'b_roll_executor_missing'; blocker_detail := '账号蓝图未声明 b_roll 执行器配置。';
    elsif jsonb_typeof(selected_config -> 'executor') <> 'object' or coalesce(btrim(selected_config #>> '{executor,provider}'), '') = '' or coalesce(btrim(selected_config #>> '{executor,model}'), '') = '' or coalesce(btrim(selected_config #>> '{executor,prompt_version}'), '') = '' or coalesce(btrim(selected_config #>> '{executor,adapter}'), '') = '' then blocker_code := 'b_roll_executor_invalid'; blocker_detail := 'b_roll 执行器必须冻结 provider、model、prompt_version 与 adapter。';
    elsif selected_config #>> '{executor,provider}' <> 'pexels' or selected_config #>> '{executor,adapter}' <> 'pexels_video' or selected_config #>> '{executor,model}' <> 'pexels-video-v1' then blocker_code := 'b_roll_executor_unavailable'; blocker_detail := '当前仅注册 Pexels 视频适配器；配置必须精确声明 pexels/pexels_video/pexels-video-v1。';
    elsif jsonb_typeof(selected_config -> 'allowed_tools') <> 'array' or jsonb_array_length(selected_config -> 'allowed_tools') = 0 then blocker_code := 'b_roll_allowed_tools_invalid'; blocker_detail := 'b_roll 配置必须声明非空的允许工具清单。';
    elsif jsonb_typeof(selected_config -> 'per_shot_budget_cents') <> 'number' or selected_config ->> 'per_shot_budget_cents' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'per_shot_budget_cents') > 10 or (length(selected_config ->> 'per_shot_budget_cents') = 10 and selected_config ->> 'per_shot_budget_cents' > '2147483647') then blocker_code := 'b_roll_budget_unavailable'; blocker_detail := 'b_roll 配置必须提供有效的单镜头预算。';
    elsif jsonb_typeof(selected_config -> 'total_budget_cents') <> 'number' or selected_config ->> 'total_budget_cents' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'total_budget_cents') > 10 or (length(selected_config ->> 'total_budget_cents') = 10 and selected_config ->> 'total_budget_cents' > '2147483647') then blocker_code := 'b_roll_total_budget_unavailable'; blocker_detail := 'b_roll 配置必须提供有效的总预算。';
    elsif jsonb_typeof(selected_config -> 'max_attempts') <> 'number' or selected_config ->> 'max_attempts' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'max_attempts') > 9 or jsonb_typeof(selected_config -> 'max_concurrency') <> 'number' or selected_config ->> 'max_concurrency' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'max_concurrency') > 9 or jsonb_typeof(selected_config -> 'provider_max_concurrency') <> 'number' or selected_config ->> 'provider_max_concurrency' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'provider_max_concurrency') > 9 then blocker_code := 'b_roll_scheduling_invalid'; blocker_detail := 'b_roll 配置必须冻结重试、能力并发与供应商并发上限。';
    elsif selected_config ? 'fallback_executor' and selected_config -> 'fallback_executor' <> selected_config -> 'executor' then blocker_code := 'b_roll_fallback_not_equivalent'; blocker_detail := '非等价备用执行器不能替换冻结的 B-roll 执行器。'; end if;
    executor := selected_config -> 'executor'; allowed_tools := selected_config -> 'allowed_tools';
    budget_limit := case when jsonb_typeof(selected_config -> 'per_shot_budget_cents') = 'number' and selected_config ->> 'per_shot_budget_cents' ~ '^[1-9][0-9]*$' and (length(selected_config ->> 'per_shot_budget_cents') < 10 or (length(selected_config ->> 'per_shot_budget_cents') = 10 and selected_config ->> 'per_shot_budget_cents' <= '2147483647')) then (selected_config ->> 'per_shot_budget_cents')::integer else 0 end;
    total_budget := case when jsonb_typeof(selected_config -> 'total_budget_cents') = 'number' and selected_config ->> 'total_budget_cents' ~ '^[1-9][0-9]*$' and (length(selected_config ->> 'total_budget_cents') < 10 or (length(selected_config ->> 'total_budget_cents') = 10 and selected_config ->> 'total_budget_cents' <= '2147483647')) then (selected_config ->> 'total_budget_cents')::integer else 0 end;
    max_attempts := case when jsonb_typeof(selected_config -> 'max_attempts') = 'number' and selected_config ->> 'max_attempts' ~ '^[1-9][0-9]*$' and length(selected_config ->> 'max_attempts') < 10 then (selected_config ->> 'max_attempts')::integer else 1 end;
    max_concurrency := case when jsonb_typeof(selected_config -> 'max_concurrency') = 'number' and selected_config ->> 'max_concurrency' ~ '^[1-9][0-9]*$' and length(selected_config ->> 'max_concurrency') < 10 then (selected_config ->> 'max_concurrency')::integer else 1 end;
    provider_max_concurrency := case when jsonb_typeof(selected_config -> 'provider_max_concurrency') = 'number' and selected_config ->> 'provider_max_concurrency' ~ '^[1-9][0-9]*$' and length(selected_config ->> 'provider_max_concurrency') < 10 then (selected_config ->> 'provider_max_concurrency')::integer else 1 end;
    for storyboard_shot in select value from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') where value ->> 'shotType' = 'b_roll'
    loop
      if exists (select 1 from public.tasks task where task.episode_id = candidate.id and task.task_type = 'generate_b_roll' and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text and task.input_snapshot #>> '{shot,id}' = storyboard_shot ->> 'id') then continue; end if;
      select coalesce(jsonb_agg(frozen_input), '[]'::jsonb) into frozen_inputs from jsonb_array_elements(candidate.storyboard_context -> 'input_artifacts') frozen_input join jsonb_array_elements(storyboard_shot -> 'inputBasis') input_basis on frozen_input ->> 'relativePath' = input_basis ->> 'relativePath' and frozen_input ->> 'sha256' = input_basis ->> 'sha256';
      if jsonb_array_length(frozen_inputs) <> jsonb_array_length(storyboard_shot -> 'inputBasis') then blocker_code := 'b_roll_input_basis_invalid'; blocker_detail := 'B-roll 镜头引用的冻结输入不完整。'; end if;
      select coalesce(sum(task.budget_limit_cents), 0)::bigint into committed_budget from public.tasks task where task.episode_id = candidate.id and task.task_type = 'generate_b_roll' and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text and task.status <> 'blocked';
      if blocker_code is null and total_budget < 2147483647 and committed_budget + budget_limit > total_budget then blocker_code := 'b_roll_budget_exhausted'; blocker_detail := '剩余 B-roll 总预算不足以创建该冻结镜头任务。'; end if;
      frozen_query := left(btrim(concat_ws(' ', storyboard_shot ->> 'productionMethod', storyboard_shot ->> 'scriptSegment')), 400);
      if frozen_query = '' then blocker_code := 'b_roll_query_invalid'; blocker_detail := 'B-roll 镜头缺少可冻结的检索词。'; end if;
      insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, last_result, completed_at)
      values (candidate.id, 'generate_b_roll', case when blocker_code is null then 'ready'::public.task_status else 'blocked'::public.task_status end,
        jsonb_strip_nulls(jsonb_build_object('capability', 'b_roll_generation', 'storyboard_review_package_id', candidate.storyboard_review_package_id, 'configuration_hash', configuration_hash, 'shot', storyboard_shot, 'executor', executor, 'media', jsonb_build_object('adapter','pexels_video','b_roll',jsonb_build_object('query', frozen_query, 'target_duration_seconds', (storyboard_shot ->> 'durationSeconds')::numeric, 'shot', storyboard_shot)), 'scheduling', jsonb_build_object('max_concurrency', max_concurrency, 'provider_max_concurrency', provider_max_concurrency), 'budget', jsonb_build_object('limit_cents', budget_limit, 'total_limit_cents', total_budget, 'max_attempts', max_attempts), 'allowed_tools', allowed_tools, 'output', jsonb_build_object('required_artifact_types', jsonb_build_array('b_roll_asset'), 'content_type', 'video/mp4', 'relative_path', format('episodes/%s/b-roll/%s.mp4', candidate.id, storyboard_shot ->> 'id'), 'review_stage', 'production_ready'), 'input_artifacts', frozen_inputs)), budget_limit, max_attempts, coalesce(executor ->> 'provider', 'unconfigured'), coalesce(executor ->> 'model', 'unconfigured'), coalesce(executor ->> 'prompt_version', 'unconfigured'),
        case when blocker_code is null then null else jsonb_build_object('version','worker-result/v1','taskId','','status','blocked','artifacts',jsonb_build_array(),'validation',jsonb_build_object('passed',false,'checks',jsonb_build_array()),'actualCostCents',0,'blockers',jsonb_build_array(jsonb_build_object('code',blocker_code,'detail',blocker_detail)),'retry',jsonb_build_object('shouldRetry',false,'reason',blocker_detail),'nextStep','修正冻结的 B-roll 配置后，使用新的配置创建任务。') end,
        case when blocker_code is null then null else now() end) returning * into created_task;
      if blocker_code is not null then update public.tasks set last_result = jsonb_set(last_result, '{taskId}', to_jsonb(created_task.id::text)) where id = created_task.id returning * into created_task; insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'b_roll_task_blocked', jsonb_build_object('task_id',created_task.id,'shot_id',storyboard_shot ->> 'id','code',blocker_code,'detail',blocker_detail), null); end if;
      return next created_task;
    end loop;
  end loop;
end;
$_$;


--
-- Name: orchestrate_b_roll_tasks_legacy_all(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_b_roll_tasks_legacy_all() RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  candidate record; storyboard_shot jsonb; selected_config jsonb; executor jsonb; allowed_tools jsonb; frozen_inputs jsonb;
  configuration_hash text; budget_limit integer; total_budget integer; max_attempts integer; max_concurrency integer; provider_max_concurrency integer; committed_budget integer;
  blocker_code text; blocker_detail text; created_task public.tasks; frozen_query text;
begin
  for candidate in
    select episode.*, blueprint.policy as blueprint_policy, series_version.rules as series_rules, review_package.id as storyboard_review_package_id, review_package.context_snapshot as storyboard_context
    from public.episodes episode join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join lateral (select package.* from public.review_packages package join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved' where package.episode_id = episode.id and package.stage = 'storyboard_review' order by package.revision_number desc limit 1) review_package on true
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    where episode.stage = 'storyboard_approved' order by episode.updated_at, episode.id for update of episode skip locked
  loop
    selected_config := coalesce(candidate.series_rules -> 'b_roll', candidate.blueprint_policy -> 'b_roll');
    configuration_hash := md5(coalesce(selected_config::text, 'null'));
    blocker_code := null; blocker_detail := null;
    if jsonb_typeof(selected_config) <> 'object' then blocker_code := 'b_roll_executor_missing'; blocker_detail := '蓝图或系列规则未声明 b_roll 执行器配置。';
    elsif jsonb_typeof(selected_config -> 'executor') <> 'object' or coalesce(btrim(selected_config #>> '{executor,provider}'), '') = '' or coalesce(btrim(selected_config #>> '{executor,model}'), '') = '' or coalesce(btrim(selected_config #>> '{executor,prompt_version}'), '') = '' or coalesce(btrim(selected_config #>> '{executor,adapter}'), '') = '' then blocker_code := 'b_roll_executor_invalid'; blocker_detail := 'b_roll 执行器必须冻结 provider、model、prompt_version 与 adapter。';
    elsif selected_config #>> '{executor,provider}' <> 'pexels' or selected_config #>> '{executor,adapter}' <> 'pexels_video' or selected_config #>> '{executor,model}' <> 'pexels-video-v1' then blocker_code := 'b_roll_executor_unavailable'; blocker_detail := '当前仅注册 Pexels 视频适配器；配置必须精确声明 pexels/pexels_video/pexels-video-v1。';
    elsif jsonb_typeof(selected_config -> 'allowed_tools') <> 'array' or jsonb_array_length(selected_config -> 'allowed_tools') = 0 then blocker_code := 'b_roll_allowed_tools_invalid'; blocker_detail := 'b_roll 配置必须声明非空的允许工具清单。';
    elsif jsonb_typeof(selected_config -> 'per_shot_budget_cents') <> 'number' or selected_config ->> 'per_shot_budget_cents' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'per_shot_budget_cents') > 10 or (length(selected_config ->> 'per_shot_budget_cents') = 10 and selected_config ->> 'per_shot_budget_cents' > '2147483647') then blocker_code := 'b_roll_budget_unavailable'; blocker_detail := 'b_roll 配置必须提供有效的单镜头预算。';
    elsif jsonb_typeof(selected_config -> 'total_budget_cents') <> 'number' or selected_config ->> 'total_budget_cents' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'total_budget_cents') > 10 or (length(selected_config ->> 'total_budget_cents') = 10 and selected_config ->> 'total_budget_cents' > '2147483647') then blocker_code := 'b_roll_total_budget_unavailable'; blocker_detail := 'b_roll 配置必须提供有效的总预算。';
    elsif jsonb_typeof(selected_config -> 'max_attempts') <> 'number' or selected_config ->> 'max_attempts' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'max_attempts') > 9 or jsonb_typeof(selected_config -> 'max_concurrency') <> 'number' or selected_config ->> 'max_concurrency' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'max_concurrency') > 9 or jsonb_typeof(selected_config -> 'provider_max_concurrency') <> 'number' or selected_config ->> 'provider_max_concurrency' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'provider_max_concurrency') > 9 then blocker_code := 'b_roll_scheduling_invalid'; blocker_detail := 'b_roll 配置必须冻结重试、能力并发与供应商并发上限。';
    elsif selected_config ? 'fallback_executor' and selected_config -> 'fallback_executor' <> selected_config -> 'executor' then blocker_code := 'b_roll_fallback_not_equivalent'; blocker_detail := '非等价备用执行器不能替换冻结的 B-roll 执行器。'; end if;
    executor := selected_config -> 'executor'; allowed_tools := selected_config -> 'allowed_tools';
    budget_limit := case when jsonb_typeof(selected_config -> 'per_shot_budget_cents') = 'number' and selected_config ->> 'per_shot_budget_cents' ~ '^[1-9][0-9]*$' and (length(selected_config ->> 'per_shot_budget_cents') < 10 or (length(selected_config ->> 'per_shot_budget_cents') = 10 and selected_config ->> 'per_shot_budget_cents' <= '2147483647')) then (selected_config ->> 'per_shot_budget_cents')::integer else 0 end;
    total_budget := case when jsonb_typeof(selected_config -> 'total_budget_cents') = 'number' and selected_config ->> 'total_budget_cents' ~ '^[1-9][0-9]*$' and (length(selected_config ->> 'total_budget_cents') < 10 or (length(selected_config ->> 'total_budget_cents') = 10 and selected_config ->> 'total_budget_cents' <= '2147483647')) then (selected_config ->> 'total_budget_cents')::integer else 0 end;
    max_attempts := case when jsonb_typeof(selected_config -> 'max_attempts') = 'number' and selected_config ->> 'max_attempts' ~ '^[1-9][0-9]*$' and length(selected_config ->> 'max_attempts') < 10 then (selected_config ->> 'max_attempts')::integer else 1 end;
    max_concurrency := case when jsonb_typeof(selected_config -> 'max_concurrency') = 'number' and selected_config ->> 'max_concurrency' ~ '^[1-9][0-9]*$' and length(selected_config ->> 'max_concurrency') < 10 then (selected_config ->> 'max_concurrency')::integer else 1 end;
    provider_max_concurrency := case when jsonb_typeof(selected_config -> 'provider_max_concurrency') = 'number' and selected_config ->> 'provider_max_concurrency' ~ '^[1-9][0-9]*$' and length(selected_config ->> 'provider_max_concurrency') < 10 then (selected_config ->> 'provider_max_concurrency')::integer else 1 end;
    for storyboard_shot in select value from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') where value ->> 'shotType' = 'b_roll'
    loop
      if exists (select 1 from public.tasks task where task.episode_id = candidate.id and task.task_type = 'generate_b_roll' and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text and task.input_snapshot #>> '{shot,id}' = storyboard_shot ->> 'id' and task.input_snapshot ->> 'configuration_hash' = configuration_hash) then continue; end if;
      select coalesce(jsonb_agg(frozen_input), '[]'::jsonb) into frozen_inputs from jsonb_array_elements(candidate.storyboard_context -> 'input_artifacts') frozen_input join jsonb_array_elements(storyboard_shot -> 'inputBasis') input_basis on frozen_input ->> 'relativePath' = input_basis ->> 'relativePath' and frozen_input ->> 'sha256' = input_basis ->> 'sha256';
      if jsonb_array_length(frozen_inputs) <> jsonb_array_length(storyboard_shot -> 'inputBasis') then blocker_code := 'b_roll_input_basis_invalid'; blocker_detail := 'B-roll 镜头引用的冻结输入不完整。'; end if;
      select coalesce(sum(task.budget_limit_cents), 0) into committed_budget from public.tasks task where task.episode_id = candidate.id and task.task_type = 'generate_b_roll' and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text and task.status <> 'blocked';
      if blocker_code is null and committed_budget + budget_limit > total_budget then blocker_code := 'b_roll_budget_exhausted'; blocker_detail := '剩余 B-roll 总预算不足以创建该冻结镜头任务。'; end if;
      frozen_query := left(btrim(concat_ws(' ', storyboard_shot ->> 'productionMethod', storyboard_shot ->> 'scriptSegment')), 400);
      if frozen_query = '' then blocker_code := 'b_roll_query_invalid'; blocker_detail := 'B-roll 镜头缺少可冻结的检索词。'; end if;
      insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, last_result, completed_at)
      values (candidate.id, 'generate_b_roll', case when blocker_code is null then 'ready'::public.task_status else 'blocked'::public.task_status end,
        jsonb_strip_nulls(jsonb_build_object('capability', 'b_roll_generation', 'storyboard_review_package_id', candidate.storyboard_review_package_id, 'configuration_hash', configuration_hash, 'shot', storyboard_shot, 'executor', executor, 'media', jsonb_build_object('adapter','pexels_video','b_roll',jsonb_build_object('query', frozen_query, 'target_duration_seconds', (storyboard_shot ->> 'durationSeconds')::numeric, 'shot', storyboard_shot)), 'scheduling', jsonb_build_object('max_concurrency', max_concurrency, 'provider_max_concurrency', provider_max_concurrency), 'budget', jsonb_build_object('limit_cents', budget_limit, 'total_limit_cents', total_budget, 'max_attempts', max_attempts), 'allowed_tools', allowed_tools, 'output', jsonb_build_object('required_artifact_types', jsonb_build_array('b_roll_asset'), 'content_type', 'video/mp4', 'relative_path', format('episodes/%s/b-roll/%s.mp4', candidate.id, storyboard_shot ->> 'id'), 'review_stage', 'production_ready'), 'input_artifacts', frozen_inputs)), budget_limit, max_attempts, coalesce(executor ->> 'provider', 'unconfigured'), coalesce(executor ->> 'model', 'unconfigured'), coalesce(executor ->> 'prompt_version', 'unconfigured'),
        case when blocker_code is null then null else jsonb_build_object('version','worker-result/v1','taskId','','status','blocked','artifacts',jsonb_build_array(),'validation',jsonb_build_object('passed',false,'checks',jsonb_build_array()),'actualCostCents',0,'blockers',jsonb_build_array(jsonb_build_object('code',blocker_code,'detail',blocker_detail)),'retry',jsonb_build_object('shouldRetry',false,'reason',blocker_detail),'nextStep','修正冻结的 B-roll 配置后，使用新的配置创建任务。') end,
        case when blocker_code is null then null else now() end) returning * into created_task;
      if blocker_code is not null then update public.tasks set last_result = jsonb_set(last_result, '{taskId}', to_jsonb(created_task.id::text)) where id = created_task.id returning * into created_task; insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'b_roll_task_blocked', jsonb_build_object('task_id',created_task.id,'shot_id',storyboard_shot ->> 'id','code',blocker_code,'detail',blocker_detail), null); end if;
      return next created_task;
    end loop;
  end loop;
end;
$_$;


--
-- Name: orchestrate_b_roll_tasks_with_connection_ref(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_b_roll_tasks_with_connection_ref(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  created_task public.tasks;
  frozen_credential_ref text;
begin
  for created_task in
    select * from public.orchestrate_b_roll_tasks_without_connection_ref(p_episode_id)
  loop
    select nullif(btrim(blueprint.policy #>> '{b_roll,credential_ref}'), '')
    into frozen_credential_ref
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where episode.id = created_task.episode_id;

    if frozen_credential_ref is null then
      raise exception 'B-roll task is missing a frozen credential reference' using errcode = '22023';
    end if;

    update public.tasks task
    set input_snapshot = jsonb_set(task.input_snapshot, '{credential_ref}', to_jsonb(frozen_credential_ref))
    where task.id = created_task.id
    returning task.* into created_task;

    return next created_task;
  end loop;
end;
$$;


--
-- Name: orchestrate_b_roll_tasks_without_connection_ref(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_b_roll_tasks_without_connection_ref(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare created_task public.tasks; corrected_query text;
begin
  for created_task in select * from public.orchestrate_b_roll_tasks_legacy(p_episode_id)
  loop
    if created_task.status = 'ready' then
      corrected_query := left(btrim(created_task.input_snapshot #>> '{shot,scriptSegment}'), 100);
      if corrected_query = '' then raise exception 'B-roll task is missing a frozen search query basis' using errcode = '22023'; end if;
      update public.tasks set input_snapshot = jsonb_set(input_snapshot, '{media,b_roll,query}', to_jsonb(corrected_query)) where id = created_task.id returning * into created_task;
    end if;
    return next created_task;
  end loop;
end;
$$;


--
-- Name: orchestrate_embedded_audio_tasks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_embedded_audio_tasks(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare candidate record; created_task public.tasks;
begin
  for candidate in
    select material.*, approval.id as approval_id, episode.account_id, episode.blueprint_version_id
    from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    join public.episodes episode on episode.id = material.episode_id
    where material.material_type = 'video'
      and material.storage_path ~* '[.](mp4|mov|webm)$'
      and episode.audio_source_mode = 'source'
      and (p_episode_id is null or material.episode_id = p_episode_id)
    order by material.created_at, material.id for update of material skip locked
  loop
    if exists (select 1 from public.tasks task where task.task_type = 'extract_embedded_audio' and task.input_snapshot ->> 'source_material_revision_id' = candidate.id::text) then continue; end if;
    insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version)
    values (candidate.episode_id,'extract_embedded_audio','ready',jsonb_build_object(
      'capability','embedded_audio_extraction','source_material_revision_id',candidate.id,'source_material_approval_id',candidate.approval_id,'source_video_revision_sha256',candidate.sha256,
      'media',jsonb_build_object('adapter','ffmpeg_extract_audio','embedded_audio',jsonb_build_object('source_relative_path',candidate.storage_path,'duration_seconds',0.001)),
      'audio_track',jsonb_build_object('kind','derived','cue_id',format('material-v%s',candidate.revision_number),'source_material_revision_id',candidate.id,'start_seconds',0,'duration_seconds',0.001),
      'budget',jsonb_build_object('limit_cents',0,'max_attempts',1),'allowed_tools',jsonb_build_array('read','write'),
      'output',jsonb_build_object('required_artifact_types',jsonb_build_array('derived_audio'),'content_type','audio/mpeg','relative_path',format('episodes/%s/audio/derived-material-v%s.mp3',candidate.episode_id,candidate.revision_number),'review_stage','production_ready'),
      'input_artifacts',jsonb_build_array(jsonb_build_object('artifactType','source_video_material','relativePath',candidate.storage_path,'sha256',candidate.sha256,'fileSize',candidate.file_size))),0,1,'ffmpeg','ffmpeg','embedded-audio-v1') returning * into created_task;
    return next created_task;
  end loop;
end;
$_$;


--
-- Name: orchestrate_final_render_tasks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_final_render_tasks(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare candidate record; created_task public.tasks; output_path text; project_path text;
begin
  for candidate in select episode.id as episode_id,package.id as package_id,source.input_snapshot as source_snapshot,project_artifact.*,runtime_artifact.relative_path as runtime_relative_path,runtime_artifact.sha256 as runtime_sha256,runtime_artifact.file_size as runtime_file_size,qc_artifact.relative_path as qc_relative_path,qc_artifact.sha256 as qc_sha256,qc_artifact.file_size as qc_file_size from public.episodes episode join lateral (select package.* from public.review_packages package join public.approvals approval on approval.review_package_id=package.id and approval.stage='qc_passed' and approval.decision='approved' where package.episode_id=episode.id and package.stage='qc_review' and package.invalidated_at is null order by package.revision_number desc limit 1) package on true join public.tasks source on source.id=package.task_id and source.status='completed' join public.artifacts project_artifact on project_artifact.producer_task_id=source.id and project_artifact.artifact_type='review_render_project' join public.artifacts runtime_artifact on runtime_artifact.producer_task_id=source.id and runtime_artifact.artifact_type='review_render_runtime' join public.artifacts qc_artifact on qc_artifact.producer_task_id=source.id and qc_artifact.artifact_type='review_qc_report' where episode.stage='qc_passed' and (p_episode_id is null or episode.id=p_episode_id) order by episode.updated_at,episode.id for update of episode skip locked loop
    if exists (select 1 from public.tasks task where task.episode_id=candidate.episode_id and task.task_type='generate_final_render' and task.input_snapshot #>> '{final_render,source_review_package_id}'=candidate.package_id::text) then continue; end if;
    project_path:=format('episodes/%s/final-render/v%s/index.html',candidate.episode_id,candidate.source_snapshot #>> '{review_render,project_revision}'); output_path:=format('episodes/%s/final-render/v%s/final-render.mp4',candidate.episode_id,candidate.source_snapshot #>> '{review_render,project_revision}');
    insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) values (candidate.episode_id,'generate_final_render','ready',jsonb_build_object('capability','final_rendering','allowed_tools',jsonb_build_array('read','write'),'final_render',jsonb_build_object('source_review_package_id',candidate.package_id,'source_project',jsonb_build_object('artifact_type',candidate.artifact_type,'relative_path',candidate.relative_path,'sha256',candidate.sha256,'file_size',candidate.file_size),'source_runtime',jsonb_build_object('artifact_type','review_render_runtime','relative_path',candidate.runtime_relative_path,'sha256',candidate.runtime_sha256,'file_size',candidate.runtime_file_size),'source_qc_report',jsonb_build_object('artifact_type','review_qc_report','relative_path',candidate.qc_relative_path,'sha256',candidate.qc_sha256,'file_size',candidate.qc_file_size),'project_relative_path',project_path,'project_revision',(candidate.source_snapshot #>> '{review_render,project_revision}')::integer,'review_render',candidate.source_snapshot->'review_render'),'input_artifacts',(candidate.source_snapshot->'input_artifacts')||jsonb_build_array(jsonb_build_object('artifactType',candidate.artifact_type,'relativePath',candidate.relative_path,'sha256',candidate.sha256,'fileSize',candidate.file_size),jsonb_build_object('artifactType','review_render_runtime','relativePath',candidate.runtime_relative_path,'sha256',candidate.runtime_sha256,'fileSize',candidate.runtime_file_size),jsonb_build_object('artifactType','review_qc_report','relativePath',candidate.qc_relative_path,'sha256',candidate.qc_sha256,'fileSize',candidate.qc_file_size)),'output',jsonb_build_object('required_artifact_types',jsonb_build_array('final_render','final_render_project','final_qc_report'),'content_type','video/mp4','relative_path',output_path,'review_stage','qc_passed')),0,1,'openchatcut','openchatcut@0.2.14','final-render-v1') returning * into created_task; return next created_task;
  end loop;
end; $$;


--
-- Name: orchestrate_narration_tasks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_narration_tasks(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  return;
end;
$$;


--
-- Name: orchestrate_narration_tasks_all(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_narration_tasks_all() RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare candidate record; selected_config jsonb; executor jsonb; configuration_hash text; shot jsonb; shot_duration numeric; start_seconds numeric; budget_limit integer; max_attempts integer; blocker_code text; blocker_detail text; created_task public.tasks;
begin
  for candidate in
    select episode.*, blueprint.policy as blueprint_policy, series_version.rules as series_rules, review_package.id as storyboard_review_package_id, review_package.context_snapshot as storyboard_context
    from public.episodes episode join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join lateral (select package.* from public.review_packages package join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved' where package.episode_id = episode.id and package.stage = 'storyboard_review' order by package.revision_number desc limit 1) review_package on true
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    where episode.stage = 'storyboard_approved'
      and not exists (select 1 from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id where material.episode_id = episode.id and material.material_type = 'video' and material.storage_path ~* '[.](mp4|mov|webm)$')
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    selected_config := coalesce(candidate.series_rules -> 'narration', candidate.blueprint_policy -> 'narration'); configuration_hash := md5(coalesce(selected_config::text, 'null')); executor := selected_config -> 'executor'; start_seconds := 0;
    for shot in select value from jsonb_array_elements(coalesce(candidate.storyboard_context #> '{worker_result,storyboard,shots}', '[]'::jsonb))
    loop
      if coalesce(btrim(shot ->> 'id'), '') = '' or coalesce(btrim(shot ->> 'scriptSegment'), '') = '' or coalesce(shot ->> 'durationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$' or (shot ->> 'durationSeconds')::numeric <= 0 then raise exception 'Approved storyboard shot is invalid' using errcode = '22023'; end if;
      shot_duration := (shot ->> 'durationSeconds')::numeric;
      if exists (select 1 from public.tasks task where task.episode_id = candidate.id and task.task_type = 'generate_narration' and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text and task.input_snapshot #>> '{audio_track,cue_id}' = shot ->> 'id' and task.input_snapshot ->> 'configuration_hash' = configuration_hash) then start_seconds := start_seconds + shot_duration; continue; end if;
      blocker_code := null; blocker_detail := null;
      if jsonb_typeof(selected_config) <> 'object' then blocker_code := 'narration_executor_missing'; blocker_detail := '蓝图或系列规则未声明 narration 执行器配置。';
      elsif jsonb_typeof(executor) <> 'object' or executor ->> 'provider' <> 'google_tts' or executor ->> 'adapter' <> 'google_tts' or coalesce(btrim(executor ->> 'model'), '') = '' or coalesce(btrim(executor ->> 'prompt_version'), '') = '' then blocker_code := 'narration_executor_invalid'; blocker_detail := '旁白配置必须精确声明 google_tts 适配器、模型与提示版本。';
      elsif jsonb_typeof(selected_config -> 'allowed_tools') <> 'array' or jsonb_array_length(selected_config -> 'allowed_tools') = 0 then blocker_code := 'narration_allowed_tools_invalid'; blocker_detail := '旁白配置必须声明非空的允许工具清单。';
      elsif jsonb_typeof(selected_config -> 'budget_cents') <> 'number' or selected_config ->> 'budget_cents' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'budget_cents') > 10 or (length(selected_config ->> 'budget_cents') = 10 and selected_config ->> 'budget_cents' > '2147483647') then blocker_code := 'narration_budget_invalid'; blocker_detail := '旁白配置必须提供有效预算。';
      elsif jsonb_typeof(selected_config -> 'max_attempts') <> 'number' or selected_config ->> 'max_attempts' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'max_attempts') > 10 or (length(selected_config ->> 'max_attempts') = 10 and selected_config ->> 'max_attempts' > '2147483647') then blocker_code := 'narration_scheduling_invalid'; blocker_detail := '旁白配置必须提供有效最大尝试次数。';
      elsif jsonb_typeof(selected_config -> 'voice') <> 'object' or coalesce(btrim(selected_config #>> '{voice,language_code}'), '') = '' or coalesce(btrim(selected_config #>> '{voice,name}'), '') = '' or jsonb_typeof(selected_config #> '{voice,speaking_rate}') <> 'number' or (selected_config #>> '{voice,speaking_rate}')::numeric <= 0 then blocker_code := 'narration_voice_invalid'; blocker_detail := '旁白配置必须冻结有效语言、声音与语速。'; end if;
      budget_limit := case when blocker_code is null then (selected_config ->> 'budget_cents')::integer else 0 end; max_attempts := case when blocker_code is null then (selected_config ->> 'max_attempts')::integer else 1 end;
      insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version,last_result,completed_at)
      values (candidate.id,'generate_narration',case when blocker_code is null then 'ready'::public.task_status else 'blocked'::public.task_status end,
        jsonb_strip_nulls(jsonb_build_object('capability','narration_generation','storyboard_review_package_id',candidate.storyboard_review_package_id,'configuration_hash',configuration_hash,'executor',executor,'media',jsonb_build_object('adapter','google_tts','narration',jsonb_build_object('text',btrim(shot ->> 'scriptSegment'),'voice',selected_config -> 'voice')),'audio_track',jsonb_build_object('kind','narration','cue_id',shot ->> 'id','source_review_package_id',candidate.storyboard_review_package_id,'start_seconds',start_seconds,'duration_seconds',shot_duration),'budget',jsonb_build_object('limit_cents',budget_limit,'max_attempts',max_attempts),'allowed_tools',selected_config -> 'allowed_tools','output',jsonb_build_object('required_artifact_types',jsonb_build_array('narration_audio'),'content_type','audio/mpeg','relative_path',format('episodes/%s/audio/narration-%s-%s.mp3',candidate.id,candidate.storyboard_review_package_id,shot ->> 'id'),'review_stage','production_ready'),'input_artifacts',candidate.storyboard_context -> 'input_artifacts')),
        budget_limit,max_attempts,coalesce(executor ->> 'provider','unconfigured'),coalesce(executor ->> 'model','unconfigured'),coalesce(executor ->> 'prompt_version','unconfigured'),case when blocker_code is null then null else jsonb_build_object('version','worker-result/v1','taskId','','status','blocked','artifacts',jsonb_build_array(),'validation',jsonb_build_object('passed',false,'checks',jsonb_build_array()),'actualCostCents',0,'blockers',jsonb_build_array(jsonb_build_object('code',blocker_code,'detail',blocker_detail)),'retry',jsonb_build_object('shouldRetry',false,'reason',blocker_detail),'nextStep','修正冻结的旁白配置后，使用新的配置创建任务。') end,case when blocker_code is null then null else now() end) returning * into created_task;
      if blocker_code is not null then update public.tasks set last_result = jsonb_set(last_result, '{taskId}', to_jsonb(created_task.id::text)) where id = created_task.id returning * into created_task; insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) values (candidate.account_id,candidate.id,'narration_task_blocked',jsonb_build_object('task_id',created_task.id,'cue_id',shot ->> 'id','code',blocker_code,'detail',blocker_detail),null); end if;
      return next created_task; start_seconds := start_seconds + shot_duration;
    end loop;
  end loop;
end;
$_$;


--
-- Name: orchestrate_narration_tasks_configured(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_narration_tasks_configured(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  created_task public.tasks;
  frozen_credential_ref text;
begin
  for created_task in
    select * from public.orchestrate_narration_tasks_without_connection_ref(p_episode_id)
  loop
    select nullif(btrim(blueprint.policy #>> '{narration,credential_ref}'), '')
    into frozen_credential_ref
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where episode.id = created_task.episode_id;

    if frozen_credential_ref is null then
      raise exception 'Narration task is missing a frozen credential reference' using errcode = '22023';
    end if;

    update public.tasks task
    set input_snapshot = jsonb_set(task.input_snapshot, '{credential_ref}', to_jsonb(frozen_credential_ref))
    where task.id = created_task.id
    returning task.* into created_task;

    return next created_task;
  end loop;
end;
$$;


--
-- Name: orchestrate_narration_tasks_without_connection_ref(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_narration_tasks_without_connection_ref(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare candidate record; selected_config jsonb; executor jsonb; configuration_hash text; shot jsonb; shot_duration numeric; start_seconds numeric; budget_limit integer; max_attempts integer; blocker_code text; blocker_detail text; created_task public.tasks;
begin
  for candidate in
    select episode.*, blueprint.policy as blueprint_policy, series_version.rules as series_rules, review_package.id as storyboard_review_package_id, review_package.context_snapshot as storyboard_context
    from public.episodes episode join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join lateral (select package.* from public.review_packages package join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved' where package.episode_id = episode.id and package.stage = 'storyboard_review' order by package.revision_number desc limit 1) review_package on true
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    where episode.stage = 'storyboard_approved' and (p_episode_id is null or episode.id = p_episode_id)
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    selected_config := coalesce(candidate.series_rules -> 'narration', candidate.blueprint_policy -> 'narration'); configuration_hash := md5(coalesce(selected_config::text, 'null')); executor := selected_config -> 'executor'; start_seconds := 0;
    for shot in select value from jsonb_array_elements(coalesce(candidate.storyboard_context #> '{worker_result,storyboard,shots}', '[]'::jsonb))
    loop
      if coalesce(btrim(shot ->> 'id'), '') = '' or coalesce(btrim(shot ->> 'scriptSegment'), '') = '' or coalesce(shot ->> 'durationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$' or (shot ->> 'durationSeconds')::numeric <= 0 then raise exception 'Approved storyboard shot is invalid' using errcode = '22023'; end if;
      shot_duration := (shot ->> 'durationSeconds')::numeric;
      if exists (select 1 from public.tasks task where task.episode_id = candidate.id and task.task_type = 'generate_narration' and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text and task.input_snapshot #>> '{audio_track,cue_id}' = shot ->> 'id' and task.input_snapshot ->> 'configuration_hash' = configuration_hash) then start_seconds := start_seconds + shot_duration; continue; end if;
      blocker_code := null; blocker_detail := null;
      if jsonb_typeof(selected_config) <> 'object' then blocker_code := 'narration_executor_missing'; blocker_detail := '蓝图或系列规则未声明 narration 执行器配置。';
      elsif jsonb_typeof(executor) <> 'object' or not ((executor ->> 'provider' = 'google_tts' and executor ->> 'adapter' = 'google_tts') or (executor ->> 'provider' = 'volcengine_tts' and executor ->> 'adapter' = 'volcengine_tts')) or coalesce(btrim(executor ->> 'model'), '') = '' or coalesce(btrim(executor ->> 'prompt_version'), '') = '' then blocker_code := 'narration_executor_invalid'; blocker_detail := '旁白配置必须精确声明已登记的 TTS 适配器、模型与提示版本。';
      elsif jsonb_typeof(selected_config -> 'allowed_tools') <> 'array' or jsonb_array_length(selected_config -> 'allowed_tools') = 0 then blocker_code := 'narration_allowed_tools_invalid'; blocker_detail := '旁白配置必须声明非空的允许工具清单。';
      elsif jsonb_typeof(selected_config -> 'budget_cents') <> 'number' or selected_config ->> 'budget_cents' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'budget_cents') > 10 or (length(selected_config ->> 'budget_cents') = 10 and selected_config ->> 'budget_cents' > '2147483647') then blocker_code := 'narration_budget_invalid'; blocker_detail := '旁白配置必须提供有效预算。';
      elsif jsonb_typeof(selected_config -> 'max_attempts') <> 'number' or selected_config ->> 'max_attempts' !~ '^[1-9][0-9]*$' or length(selected_config ->> 'max_attempts') > 10 or (length(selected_config ->> 'max_attempts') = 10 and selected_config ->> 'max_attempts' > '2147483647') then blocker_code := 'narration_scheduling_invalid'; blocker_detail := '旁白配置必须提供有效最大尝试次数。';
      elsif jsonb_typeof(selected_config -> 'voice') <> 'object' or coalesce(btrim(selected_config #>> '{voice,language_code}'), '') = '' or coalesce(btrim(selected_config #>> '{voice,name}'), '') = '' or jsonb_typeof(selected_config #> '{voice,speaking_rate}') <> 'number' or (selected_config #>> '{voice,speaking_rate}')::numeric <= 0 then blocker_code := 'narration_voice_invalid'; blocker_detail := '旁白配置必须冻结有效语言、声音与语速。'; end if;
      budget_limit := case when blocker_code is null then (selected_config ->> 'budget_cents')::integer else 0 end; max_attempts := case when blocker_code is null then (selected_config ->> 'max_attempts')::integer else 1 end;
      insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version,last_result,completed_at)
      values (candidate.id,'generate_narration',case when blocker_code is null then 'ready'::public.task_status else 'blocked'::public.task_status end,
        jsonb_strip_nulls(jsonb_build_object('capability','narration_generation','storyboard_review_package_id',candidate.storyboard_review_package_id,'configuration_hash',configuration_hash,'executor',executor,'media',jsonb_build_object('adapter',executor ->> 'adapter','narration',jsonb_build_object('text',btrim(shot ->> 'scriptSegment'),'voice',selected_config -> 'voice')),'audio_track',jsonb_build_object('kind','narration','cue_id',shot ->> 'id','source_review_package_id',candidate.storyboard_review_package_id,'start_seconds',start_seconds,'duration_seconds',shot_duration),'budget',jsonb_build_object('limit_cents',budget_limit,'max_attempts',max_attempts),'allowed_tools',selected_config -> 'allowed_tools','output',jsonb_build_object('required_artifact_types',jsonb_build_array('narration_audio'),'content_type','audio/mpeg','relative_path',format('episodes/%s/audio/narration-%s-%s.mp3',candidate.id,candidate.storyboard_review_package_id,shot ->> 'id'),'review_stage','production_ready'),'input_artifacts',candidate.storyboard_context -> 'input_artifacts')),
        budget_limit,max_attempts,coalesce(executor ->> 'provider','unconfigured'),coalesce(executor ->> 'model','unconfigured'),coalesce(executor ->> 'prompt_version','unconfigured'),case when blocker_code is null then null else jsonb_build_object('version','worker-result/v1','taskId','','status','blocked','artifacts',jsonb_build_array(),'validation',jsonb_build_object('passed',false,'checks',jsonb_build_array()),'actualCostCents',0,'blockers',jsonb_build_array(jsonb_build_object('code',blocker_code,'detail',blocker_detail)),'retry',jsonb_build_object('shouldRetry',false,'reason',blocker_detail),'nextStep','修正冻结的旁白配置后，使用新的配置创建任务。') end,case when blocker_code is null then null else now() end) returning * into created_task;
      if blocker_code is not null then update public.tasks set last_result = jsonb_set(last_result, '{taskId}', to_jsonb(created_task.id::text)) where id = created_task.id returning * into created_task; insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) values (candidate.account_id,candidate.id,'narration_task_blocked',jsonb_build_object('task_id',created_task.id,'cue_id',shot ->> 'id','code',blocker_code,'detail',blocker_detail),null); end if;
      return next created_task; start_seconds := start_seconds + shot_duration;
    end loop;
  end loop;
end;
$_$;


--
-- Name: orchestrate_provided_script_tasks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_provided_script_tasks() RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  candidate_id uuid;
begin
  for candidate_id in
    select episode.id
    from public.episodes episode
    where episode.stage = 'script_approved'
      and episode.main_script_revision_id is not null
      and not exists (
        select 1
        from public.tasks task
        where task.episode_id = episode.id
          and task.task_type = 'prepare_visual_brief'
      )
    order by episode.updated_at, episode.id
  loop
    return query
    select *
    from public.orchestrate_provided_script_tasks_for_episode(candidate_id);
  end loop;
end;
$$;


--
-- Name: orchestrate_provided_script_tasks_for_episode(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_provided_script_tasks_for_episode(p_episode_id uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  candidate record;
  created_task public.tasks;
  selected_harness public.prompt_versions;
  allowed_tools jsonb;
  legacy_executor jsonb;
  external_visual_inputs jsonb;
  image_generation jsonb;
  task_snapshot jsonb;
  executor_model text := 'gpt-5.6-luna';
  prompt_version text := 'visual-preparation-v1';
  budget_limit integer := 0;
begin
  for candidate in
    select episode.*, blueprint.is_snapshot as blueprint_is_snapshot, blueprint.policy, script_revision.id as script_revision_id, script_revision.storage_path as script_storage_path, script_revision.sha256 as script_sha256, script_revision.file_size as script_file_size, script_revision.mime_type as script_mime_type, series_version.id as frozen_series_version_id, series_version.version as frozen_series_version, series_version.rules as frozen_series_rules
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join public.production_material_revisions script_revision on script_revision.id = episode.main_script_revision_id and script_revision.episode_id = episode.id and script_revision.is_main_script
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    where episode.id = p_episode_id
      and episode.stage = 'script_approved'
      and not exists (select 1 from public.tasks task where task.episode_id = episode.id and task.task_type = 'prepare_visual_brief')
    for update of episode skip locked
  loop
    if jsonb_typeof(candidate.policy -> 'allowed_tools') <> 'array' or jsonb_array_length(candidate.policy -> 'allowed_tools') = 0 or exists (select 1 from jsonb_array_elements(candidate.policy -> 'allowed_tools') tool where jsonb_typeof(tool) <> 'string' or coalesce(btrim(tool #>> '{}'), '') = '') then
      raise exception 'Blueprint % has invalid allowed_tools', candidate.blueprint_version_id using errcode = '22023';
    end if;

    legacy_executor := case when candidate.blueprint_is_snapshot then candidate.policy #> '{executors,visual_planning}' else null end;
    if jsonb_typeof(legacy_executor) = 'object'
      and legacy_executor ->> 'adapter' = 'codex'
      and coalesce(btrim(legacy_executor ->> 'model'), '') <> ''
      and coalesce(legacy_executor ->> 'harness_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select harness.* into selected_harness
      from public.prompt_versions harness
      where harness.id = (legacy_executor ->> 'harness_id')::uuid
        and harness.account_id = candidate.account_id
        and harness.capability = 'visual_planning'
        and harness.is_active;
      if found and coalesce(btrim(selected_harness.instructions), '') <> '' then
        executor_model := legacy_executor ->> 'model';
        prompt_version := selected_harness.slug;
        budget_limit := case when candidate.policy #>> '{budgets,visual_planning_cents}' ~ '^[0-9]+$' then (candidate.policy #>> '{budgets,visual_planning_cents}')::integer else 0 end;
      else
        selected_harness := null;
      end if;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('artifactType', 'external_visual_input', 'materialPurpose', material.material_purpose, 'relativePath', material.storage_path, 'sha256', material.sha256, 'fileSize', material.file_size) order by material.created_at, material.id), '[]'::jsonb)
    into external_visual_inputs
    from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.episode_id = candidate.id
      and material.material_purpose in ('visual_reference', 'a_roll', 'b_roll')
      and material.material_type in ('image', 'video', 'reference');

    image_generation := case when coalesce(btrim(candidate.policy #>> '{static_visual,executor,provider}'), '') <> '' and coalesce(btrim(candidate.policy #>> '{static_visual,executor,adapter}'), '') <> '' then jsonb_build_object('provider', candidate.policy #>> '{static_visual,executor,provider}', 'adapter', candidate.policy #>> '{static_visual,executor,adapter}', 'model', candidate.policy #>> '{static_visual,executor,model}') else null end;
    allowed_tools := candidate.policy -> 'allowed_tools';
    task_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'capability', 'visual_planning',
      'execution_mode', case when selected_harness.id is null then 'worker_default' else 'legacy_frozen' end,
      'script_revision', jsonb_build_object('id', candidate.script_revision_id, 'storage_path', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'file_size', candidate.script_file_size, 'mime_type', candidate.script_mime_type),
      'series_baseline', case when candidate.frozen_series_version_id is null then null else jsonb_build_object('version_id', candidate.frozen_series_version_id, 'version', candidate.frozen_series_version, 'rules', candidate.frozen_series_rules) end,
      'visual_assets', jsonb_strip_nulls(jsonb_build_object('external_inputs', external_visual_inputs, 'image_generation', image_generation)),
      'harness', case when selected_harness.id is null then null else jsonb_build_object('id', selected_harness.id, 'version', selected_harness.version, 'content', selected_harness.instructions, 'content_hash', selected_harness.content_hash, 'adapter', 'codex', 'model', executor_model, 'prompt_version', prompt_version) end,
      'executor', jsonb_build_object('provider', 'codex', 'adapter', 'codex', 'model', executor_model, 'prompt_version', prompt_version),
      'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', 2),
      'allowed_tools', allowed_tools,
      'output', jsonb_build_object('required_artifact_types', jsonb_build_array('visual_asset_manifest'), 'content_type', 'text/markdown', 'relative_path', format('episodes/%s/visual-assets-v1.md', candidate.id), 'review_stage', 'visual_review'),
      'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'main_script', 'relativePath', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'fileSize', candidate.script_file_size)) || external_visual_inputs
    ));
    task_snapshot := task_snapshot || jsonb_build_object('prompt_context', public.build_prompt_context(candidate.id, task_snapshot));
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (candidate.id, 'prepare_visual_brief', 'ready', task_snapshot, budget_limit, 2, 'codex', executor_model, prompt_version)
    returning * into created_task;
    update public.episodes set stage = 'visual_draft', updated_at = now() where id = candidate.id;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'script_approved', 'visual_draft', 'Orchestrator froze visual asset preparation from the approved script and uploaded visual media.', null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'visual_asset_preparation_task_created', jsonb_build_object('task_id', created_task.id, 'script_revision_id', candidate.script_revision_id, 'external_visual_inputs', jsonb_array_length(external_visual_inputs), 'execution_mode', task_snapshot ->> 'execution_mode'), null);
    return next created_task;
  end loop;
end;
$_$;


--
-- Name: orchestrate_review_render_tasks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_review_render_tasks(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  default_config constant jsonb := '{"aspect_ratio":"9:16","width":1080,"height":1920,"captions_enabled":true,"caption_style":"cinematic","crop":"cover","pacing":"standard","transition":"fade","layout":"lower_third","narration_gain_db":0,"bgm_gain_db":-12,"sfx_gain_db":-6,"frame_rate":30,"allowed_frames":2}'::jsonb;
begin
  for candidate in
    select episode.id as episode_id, episode.stage as episode_stage, package.id as pre_render_review_package_id, package.context_snapshot,
      coalesce(series_version.rules, '{}'::jsonb) as series_rules, coalesce(package.context_snapshot ->> 'approval_mode', '') = 'qc_only' as auto_qc
    from public.episodes episode
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    join lateral (select package.* from public.review_packages package where package.episode_id = episode.id and package.stage = 'production_ready' and package.invalidated_at is null
      and ((episode.stage = 'production_ready' and package.context_snapshot ->> 'approval_mode' = 'qc_only') or episode.stage = 'render_ready') order by package.revision_number desc limit 1) package on true
    where episode.stage in ('production_ready', 'render_ready') and (p_episode_id is null or episode.id = p_episode_id)
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    select * into composition from public.review_render_composition_revisions where pre_render_review_package_id = candidate.pre_render_review_package_id order by revision_number desc limit 1;
    if candidate.episode_stage = 'production_ready' or not found then
      select coalesce(max(revision_number), 0) + 1 into default_revision from public.review_render_composition_revisions where pre_render_review_package_id = candidate.pre_render_review_package_id;
      config := coalesce(candidate.series_rules -> 'openchatcut_composition', default_config);
      insert into public.review_render_composition_revisions (episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, composition_config)
      values (candidate.episode_id, candidate.pre_render_review_package_id, default_revision, config ->> 'caption_style', config ->> 'pacing', config ->> 'crop', config ->> 'transition', config ->> 'layout', '系列默认合成配置。', config)
      on conflict (pre_render_review_package_id, revision_number) do nothing;
      select * into composition from public.review_render_composition_revisions where pre_render_review_package_id = candidate.pre_render_review_package_id order by revision_number desc limit 1;
    end if;
    if exists (select 1 from public.tasks where episode_id = candidate.episode_id and task_type = 'generate_review_render' and input_snapshot #>> '{review_render,composition_revision_id}' = composition.id::text) then continue; end if;

    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'member_key', member.member_key, 'member_kind', member.member_kind, 'audio_kind', member.evidence_snapshot #>> '{cue,kind}',
      'task_id', member.source_task_id, 'artifact_id', member.artifact_id, 'audio_track_id', member.audio_track_id,
      'source_material_revision_id', member.source_material_revision_id, 'clip_segments', member.evidence_snapshot -> 'clip_segments',
      'audio_mode', member.evidence_snapshot ->> 'audio_mode', 'subtitle_text', member.evidence_snapshot ->> 'subtitle_text',
      'subtitles_enabled', (member.evidence_snapshot ->> 'subtitles_enabled')::boolean,
      'duration_decision', member.evidence_snapshot -> 'duration_decision', 'composition', member.evidence_snapshot -> 'composition',
      'relative_path', coalesce(member.evidence_snapshot #>> '{source_material,relative_path}', member.evidence_snapshot #>> '{artifact,relative_path}', member.evidence_snapshot #>> '{audio_track,relative_path}'),
      'sha256', coalesce(member.evidence_snapshot #>> '{source_material,sha256}', member.evidence_snapshot #>> '{artifact,sha256}', member.evidence_snapshot #>> '{audio_track,sha256}'),
      'input_fingerprint', member.evidence_snapshot ->> 'input_fingerprint', 'preparation_contract', member.evidence_snapshot -> 'preparation_contract',
      'start_seconds', coalesce((member.evidence_snapshot #>> '{audio_track,start_seconds}')::numeric, 0),
      'duration_seconds', coalesce((member.evidence_snapshot #>> '{audio_track,duration_seconds}')::numeric, (member.evidence_snapshot ->> 'duration_seconds')::numeric, (member.evidence_snapshot #>> '{shot,durationSeconds}')::numeric)
    ))
      || case
        when member.evidence_snapshot -> 'preparation_contract' is null then '{}'::jsonb
        else jsonb_build_object('preparation_contract', member.evidence_snapshot -> 'preparation_contract')
      end
      order by member.member_key), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'artifactType', case when member.source_material_revision_id is not null then 'source_video' when member.artifact_id is null then 'audio_track' else member.evidence_snapshot #>> '{artifact,artifact_type}' end,
      'relativePath', coalesce(member.evidence_snapshot #>> '{source_material,relative_path}', member.evidence_snapshot #>> '{artifact,relative_path}', member.evidence_snapshot #>> '{audio_track,relative_path}'),
      'sha256', coalesce(member.evidence_snapshot #>> '{source_material,sha256}', member.evidence_snapshot #>> '{artifact,sha256}', member.evidence_snapshot #>> '{audio_track,sha256}'),
      'fileSize', coalesce((member.evidence_snapshot #>> '{source_material,file_size}')::bigint, (member.evidence_snapshot #>> '{artifact,file_size}')::bigint, (member.evidence_snapshot #>> '{audio_track,file_size}')::bigint)
    ) order by member.member_key), '[]'::jsonb) into members, inputs
    from public.pre_render_review_members member left join public.pre_render_review_member_decisions decision
      on decision.review_package_id = member.review_package_id and decision.member_key = member.member_key and decision.decision = 'approved'
    where member.review_package_id = candidate.pre_render_review_package_id and (candidate.auto_qc or decision.member_key is not null);
    if jsonb_array_length(members) = 0 or jsonb_array_length(inputs) <> jsonb_array_length(members) then continue; end if;

    project_path := format('episodes/%s/review-render/v%s/index.html', candidate.episode_id, composition.revision_number);
    render_path := format('episodes/%s/review-render/v%s/review-render.mp4', candidate.episode_id, composition.revision_number);
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (candidate.episode_id, 'generate_review_render', 'ready', jsonb_build_object(
      'capability', 'review_rendering', 'allowed_tools', jsonb_build_array('read', 'write'),
      'review_render', jsonb_build_object('pre_render_review_package_id', candidate.pre_render_review_package_id, 'composition_revision_id', composition.id, 'project_revision', composition.revision_number, 'project_relative_path', project_path, 'confirmation_mode', candidate.context_snapshot -> 'confirmation_mode', 'confirmed_shots', candidate.context_snapshot -> 'confirmed_shots', 'storyboard', candidate.context_snapshot -> 'storyboard', 'members', members, 'adjustments', composition.composition_config || jsonb_build_object('reason', composition.reason)),
      'input_artifacts', inputs, 'output', jsonb_build_object('required_artifact_types', jsonb_build_array('render', 'review_render_project', 'review_render_runtime', 'review_qc_report'), 'content_type', 'video/mp4', 'relative_path', render_path, 'review_stage', 'qc_review')
    ), 0, 1, 'openchatcut', 'openchatcut@0.2.14', 'review-render-v4') returning * into created_task;
    return next created_task;
  end loop;
end;
$$;


--
-- Name: FUNCTION orchestrate_review_render_tasks(p_episode_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.orchestrate_review_render_tasks(p_episode_id uuid) IS 'Creates immutable review-render tasks while preserving explicit null fields inside nested shot preparation contracts.';


--
-- Name: orchestrate_soundtrack_tasks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_soundtrack_tasks(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare candidate_id uuid;
begin
  for candidate_id in
    select episode.id
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where (p_episode_id is null or episode.id = p_episode_id)
      and blueprint.policy #>> '{soundtrack,execution_path}' in ('external', 'local')
  loop
    return query select * from public.orchestrate_soundtrack_tasks_without_manual_path(candidate_id);
  end loop;
end;
$$;


--
-- Name: orchestrate_soundtrack_tasks_without_manual_path(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_soundtrack_tasks_without_manual_path(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  candidate record;
  cue jsonb;
  selected_config jsonb;
  executor jsonb;
  configuration_hash text;
  created_task public.tasks;
  blocker_code text;
  blocker_detail text;
  frozen_credential_ref text;
  budget_limit integer;
  max_attempts integer;
begin
  for candidate in
    select episode.*, blueprint.policy as blueprint_policy, series_version.rules as series_rules, review_package.id as review_package_id, review_package.context_snapshot as review_context
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join lateral (
      select package.*
      from public.review_packages package
      join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
      where package.episode_id = episode.id and package.stage = 'storyboard_review'
      order by package.revision_number desc
      limit 1
    ) review_package on true
    left join public.series_versions series_version on series_version.id = episode.series_version_id and series_version.account_id = episode.account_id
    where episode.stage = 'storyboard_approved'
      and (p_episode_id is null or episode.id = p_episode_id)
      and blueprint.policy -> 'soundtrack' is not null
      and jsonb_typeof(blueprint.policy -> 'soundtrack') <> 'null'
    order by episode.updated_at, episode.id
    for update of episode skip locked
  loop
    selected_config := coalesce(candidate.series_rules -> 'soundtrack', candidate.blueprint_policy -> 'soundtrack');
    configuration_hash := md5(coalesce(selected_config::text, 'null'));
    executor := selected_config -> 'executor';
    frozen_credential_ref := nullif(btrim(candidate.blueprint_policy #>> '{soundtrack,credential_ref}'), '');

    for cue in select value from jsonb_array_elements(coalesce(candidate.review_context #> '{worker_result,storyboard,audioCues}', '[]'::jsonb))
    loop
      if cue ->> 'kind' not in ('bgm', 'sfx')
        or coalesce(btrim(cue ->> 'id'), '') = ''
        or coalesce(btrim(cue ->> 'description'), '') = ''
        or length(cue ->> 'description') > 100
        or coalesce(cue ->> 'durationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$'
        or coalesce(cue ->> 'startSeconds', '') !~ '^[0-9]+([.][0-9]+)?$'
        or (cue ->> 'durationSeconds')::numeric <= 0
        or (cue ->> 'startSeconds')::numeric < 0 then
        raise exception 'Storyboard audio cue is invalid' using errcode = '22023';
      end if;

      if exists (
        select 1 from public.tasks task
        where task.episode_id = candidate.id
          and task.task_type = 'generate_soundtrack'
          and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.review_package_id::text
          and task.input_snapshot #>> '{audio_track,cue_id}' = cue ->> 'id'
          and task.input_snapshot ->> 'configuration_hash' = configuration_hash
      ) then
        continue;
      end if;

      blocker_code := null;
      blocker_detail := null;
      if jsonb_typeof(selected_config) <> 'object' then
        blocker_code := 'soundtrack_executor_missing';
        blocker_detail := '蓝图或系列规则未声明声轨执行器配置。';
      elsif jsonb_typeof(executor) <> 'object'
        or executor ->> 'provider' <> 'freesound'
        or executor ->> 'adapter' <> 'freesound_preview'
        or executor ->> 'model' <> 'freesound-preview-v1'
        or coalesce(btrim(executor ->> 'prompt_version'), '') = '' then
        blocker_code := 'soundtrack_executor_invalid';
        blocker_detail := '测试声轨配置必须精确声明 freesound/freesound_preview/freesound-preview-v1。';
      elsif frozen_credential_ref is null then
        blocker_code := 'soundtrack_credential_missing';
        blocker_detail := '声轨配置必须冻结一个连接引用。';
      elsif jsonb_typeof(selected_config -> 'allowed_tools') <> 'array' or jsonb_array_length(selected_config -> 'allowed_tools') = 0 then
        blocker_code := 'soundtrack_allowed_tools_invalid';
        blocker_detail := '声轨配置必须声明非空的允许工具清单。';
      elsif jsonb_typeof(selected_config -> 'budget_cents') <> 'number'
        or selected_config ->> 'budget_cents' !~ '^[0-9]+$'
        or length(selected_config ->> 'budget_cents') > 10
        or (length(selected_config ->> 'budget_cents') = 10 and selected_config ->> 'budget_cents' > '2147483647') then
        blocker_code := 'soundtrack_budget_invalid';
        blocker_detail := '声轨配置必须提供有效预算。';
      elsif jsonb_typeof(selected_config -> 'max_attempts') <> 'number'
        or selected_config ->> 'max_attempts' !~ '^[1-9][0-9]*$'
        or length(selected_config ->> 'max_attempts') > 10
        or (length(selected_config ->> 'max_attempts') = 10 and selected_config ->> 'max_attempts' > '2147483647') then
        blocker_code := 'soundtrack_scheduling_invalid';
        blocker_detail := '声轨配置必须提供有效最大尝试次数。';
      elsif coalesce(btrim(cue ->> 'searchQuery'), '') = ''
        or length(cue ->> 'searchQuery') > 100
        or cue ->> 'searchQuery' !~ '^[A-Za-z0-9][A-Za-z0-9 ''-]*$' then
        blocker_code := 'soundtrack_search_query_invalid';
        blocker_detail := 'Freesound 声轨必须冻结不超过 100 字符的英文检索词。';
      end if;

      budget_limit := case when blocker_code is null then (selected_config ->> 'budget_cents')::integer else 0 end;
      max_attempts := case when blocker_code is null then (selected_config ->> 'max_attempts')::integer else 1 end;

      insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, last_result, completed_at)
      values (
        candidate.id,
        'generate_soundtrack',
        case when blocker_code is null then 'ready'::public.task_status else 'blocked'::public.task_status end,
        jsonb_strip_nulls(jsonb_build_object(
          'capability', 'soundtrack_generation',
          'storyboard_review_package_id', candidate.review_package_id,
          'configuration_hash', configuration_hash,
          'credential_ref', frozen_credential_ref,
          'executor', executor,
          'media', jsonb_build_object('adapter', 'freesound_preview', 'soundtrack', jsonb_build_object('query', btrim(cue ->> 'searchQuery'), 'target_duration_seconds', (cue ->> 'durationSeconds')::numeric, 'cue', jsonb_build_object('id', cue ->> 'id', 'kind', cue ->> 'kind', 'description', cue ->> 'description', 'search_query', cue ->> 'searchQuery', 'start_seconds', (cue ->> 'startSeconds')::numeric, 'duration_seconds', (cue ->> 'durationSeconds')::numeric))),
          'audio_track', jsonb_build_object('kind', cue ->> 'kind', 'cue_id', cue ->> 'id', 'source_review_package_id', candidate.review_package_id, 'start_seconds', (cue ->> 'startSeconds')::numeric, 'duration_seconds', (cue ->> 'durationSeconds')::numeric),
          'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', max_attempts),
          'allowed_tools', selected_config -> 'allowed_tools',
          'output', jsonb_build_object('required_artifact_types', jsonb_build_array('soundtrack_audio'), 'content_type', 'audio/mpeg', 'relative_path', format('episodes/%s/audio/%s-%s.mp3', candidate.id, cue ->> 'kind', cue ->> 'id'), 'review_stage', 'production_ready'),
          'input_artifacts', candidate.review_context -> 'input_artifacts'
        )),
        budget_limit,
        max_attempts,
        coalesce(executor ->> 'provider', 'unconfigured'),
        coalesce(executor ->> 'model', 'unconfigured'),
        coalesce(executor ->> 'prompt_version', 'unconfigured'),
        case when blocker_code is null then null else jsonb_build_object('version', 'worker-result/v1', 'taskId', '', 'status', 'blocked', 'artifacts', jsonb_build_array(), 'validation', jsonb_build_object('passed', false, 'checks', jsonb_build_array()), 'actualCostCents', 0, 'blockers', jsonb_build_array(jsonb_build_object('code', blocker_code, 'detail', blocker_detail)), 'retry', jsonb_build_object('shouldRetry', false, 'reason', blocker_detail), 'nextStep', '修正冻结的声轨检索词后，使用新的分镜修订创建任务。') end,
        case when blocker_code is null then null else now() end
      ) returning * into created_task;

      if blocker_code is not null then
        update public.tasks
        set last_result = jsonb_set(last_result, '{taskId}', to_jsonb(created_task.id::text))
        where id = created_task.id
        returning * into created_task;
        insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
        values (candidate.account_id, candidate.id, 'soundtrack_task_blocked', jsonb_build_object('task_id', created_task.id, 'cue_id', cue ->> 'id', 'code', blocker_code, 'detail', blocker_detail), null);
      end if;

      return next created_task;
    end loop;
  end loop;
end;
$_$;


--
-- Name: orchestrate_storyboard_tasks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_storyboard_tasks() RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  candidate record;
  created_task public.tasks;
  selected_harness public.prompt_versions;
  allowed_tools jsonb;
  budget_limit integer;
  adapter text;
  executor_model text;
  harness_id_text text;
  visual_inputs jsonb;
  task_snapshot jsonb;
begin
  for candidate in
    select episode.*, blueprint.policy, script_revision.id as script_revision_id, script_revision.storage_path as script_storage_path, script_revision.sha256 as script_sha256, script_revision.file_size as script_file_size, visual_package.id as visual_review_package_id, visual_package.revision_number as visual_review_revision_number, visual_package.task_id as visual_task_id, visual_package.context_snapshot -> 'series_baseline' as frozen_series_baseline, visual_package.context_snapshot as visual_context
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join public.production_material_revisions script_revision on script_revision.id = episode.main_script_revision_id and script_revision.episode_id = episode.id and script_revision.is_main_script
    join lateral (
      select review_package.* from public.review_packages review_package join public.approvals approval on approval.review_package_id = review_package.id and approval.stage = 'visual_approved' and approval.decision = 'approved'
      where review_package.episode_id = episode.id and review_package.stage = 'visual_review' order by review_package.revision_number desc limit 1
    ) visual_package on true
    where episode.stage = 'visual_approved'
      and not exists (
        select 1 from public.tasks task
        where task.episode_id = episode.id
          and task.task_type = 'draft_storyboard'
          and task.status in ('ready'::public.task_status, 'running'::public.task_status)
      )
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    if jsonb_typeof(candidate.policy -> 'allowed_tools') <> 'array' or jsonb_array_length(candidate.policy -> 'allowed_tools') = 0 or exists (select 1 from jsonb_array_elements(candidate.policy -> 'allowed_tools') tool where jsonb_typeof(tool) <> 'string' or coalesce(btrim(tool #>> '{}'), '') = '') then raise exception 'Blueprint % has invalid allowed_tools', candidate.blueprint_version_id using errcode = '22023'; end if;
    if jsonb_typeof(candidate.policy #> '{budgets,storyboard_planning_cents}') <> 'number' or candidate.policy #>> '{budgets,storyboard_planning_cents}' !~ '^[0-9]+$' then raise exception 'Blueprint % has invalid storyboard planning budget', candidate.blueprint_version_id using errcode = '22023'; end if;
    adapter := nullif(btrim(candidate.policy #>> '{executors,storyboard_planning,adapter}'), '');
    executor_model := nullif(btrim(candidate.policy #>> '{executors,storyboard_planning,model}'), '');
    harness_id_text := nullif(btrim(candidate.policy #>> '{executors,storyboard_planning,harness_id}'), '');
    if adapter <> 'codex' or executor_model is null or harness_id_text is null or harness_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Blueprint % must select a registered Codex storyboard Adapter, model, and Harness', candidate.blueprint_version_id using errcode = '22023'; end if;
    select harness.* into selected_harness from public.prompt_versions harness where harness.id = harness_id_text::uuid and harness.account_id = candidate.account_id and harness.capability = 'storyboard_planning' and harness.is_active;
    if not found or coalesce(btrim(selected_harness.instructions), '') = '' then raise exception 'Blueprint % must select an active storyboard Harness from its account', candidate.blueprint_version_id using errcode = '22023'; end if;
    visual_inputs := case
      when candidate.visual_context #> '{output,required_artifact_types}' @> jsonb_build_array('visual_asset_manifest')
      then coalesce((select jsonb_agg(jsonb_build_object('artifactType', artifact.artifact_type, 'relativePath', artifact.relative_path, 'sha256', artifact.sha256, 'fileSize', artifact.file_size) order by artifact.created_at, artifact.id) from public.artifacts artifact where artifact.producer_task_id = candidate.visual_task_id and artifact.artifact_type = 'visual_asset_manifest'), '[]'::jsonb)
      else coalesce((select jsonb_agg(jsonb_build_object('artifactType', artifact.artifact_type, 'relativePath', artifact.relative_path, 'sha256', artifact.sha256, 'fileSize', artifact.file_size) order by artifact.created_at, artifact.id) from public.artifacts artifact where artifact.producer_task_id = candidate.visual_task_id), '[]'::jsonb)
    end;
    visual_inputs := visual_inputs || coalesce((select jsonb_agg(input_artifact) from jsonb_array_elements(candidate.visual_context -> 'input_artifacts') input_artifact where input_artifact ->> 'artifactType' <> 'main_script' and not exists (select 1 from jsonb_array_elements(visual_inputs) existing where existing ->> 'relativePath' = input_artifact ->> 'relativePath' and existing ->> 'sha256' = input_artifact ->> 'sha256')), '[]'::jsonb);
    if jsonb_array_length(visual_inputs) = 0 then raise exception 'Approved visual asset manifest is missing' using errcode = '22023'; end if;
    allowed_tools := candidate.policy -> 'allowed_tools';
    budget_limit := (candidate.policy #>> '{budgets,storyboard_planning_cents}')::integer;
    task_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'capability', 'storyboard_planning',
      'script_revision', jsonb_build_object('id', candidate.script_revision_id, 'storage_path', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'file_size', candidate.script_file_size),
      'series_baseline', candidate.frozen_series_baseline,
      'visual_review_package', jsonb_build_object('id', candidate.visual_review_package_id, 'revision_number', candidate.visual_review_revision_number),
      'harness', jsonb_build_object('id', selected_harness.id, 'version', selected_harness.version, 'content', selected_harness.instructions, 'content_hash', selected_harness.content_hash, 'adapter', 'codex', 'model', executor_model, 'prompt_version', selected_harness.slug),
      'executor', jsonb_build_object('provider', 'codex', 'adapter', 'codex', 'model', executor_model, 'prompt_version', selected_harness.slug),
      'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', 2),
      'allowed_tools', allowed_tools,
      'output', jsonb_build_object('required_artifact_types', jsonb_build_array('storyboard'), 'content_type', 'application/json', 'relative_path', format('episodes/%s/storyboard-v1.json', candidate.id), 'review_stage', 'storyboard_review'),
      'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'main_script', 'relativePath', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'fileSize', candidate.script_file_size)) || visual_inputs
    ));
    task_snapshot := task_snapshot || jsonb_build_object('prompt_context', public.build_prompt_context(candidate.id, task_snapshot));
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
    values (candidate.id, 'draft_storyboard', 'ready', task_snapshot, budget_limit, 2, 'codex', executor_model, selected_harness.slug)
    returning * into created_task;
    update public.episodes set stage = 'storyboard_draft', updated_at = now() where id = candidate.id;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'visual_approved', 'storyboard_draft', 'Orchestrator froze the storyboard Adapter, Harness, approved visual asset manifest, and approved visual inputs.', null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'storyboard_task_created', jsonb_build_object('task_id', created_task.id, 'visual_review_package_id', candidate.visual_review_package_id, 'script_revision_id', candidate.script_revision_id, 'harness_id', selected_harness.id), null);
    return next created_task;
  end loop;
end;
$_$;


--
-- Name: orchestrate_storyboard_tasks_for_episode(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orchestrate_storyboard_tasks_for_episode(p_episode_id uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  candidate record;
  created_task public.tasks;
  selected_harness public.prompt_versions;
  allowed_tools jsonb;
  budget_limit integer;
  adapter text;
  executor_model text;
  harness_id_text text;
  visual_inputs jsonb;
  task_snapshot jsonb;
begin
  for candidate in
    select episode.*, blueprint.policy, script_revision.id as script_revision_id, script_revision.storage_path as script_storage_path, script_revision.sha256 as script_sha256, script_revision.file_size as script_file_size, visual_package.id as visual_review_package_id, visual_package.revision_number as visual_review_revision_number, visual_package.task_id as visual_task_id, visual_package.context_snapshot -> 'series_baseline' as frozen_series_baseline, visual_package.context_snapshot as visual_context
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join public.production_material_revisions script_revision on script_revision.id = episode.main_script_revision_id and script_revision.episode_id = episode.id and script_revision.is_main_script
    join lateral (select review_package.* from public.review_packages review_package join public.approvals approval on approval.review_package_id = review_package.id and approval.stage = 'visual_approved' and approval.decision = 'approved' where review_package.episode_id = episode.id and review_package.stage = 'visual_review' order by review_package.revision_number desc limit 1) visual_package on true
    where episode.id = p_episode_id
      and episode.stage = 'visual_approved'
      and not exists (select 1 from public.tasks task where task.episode_id = episode.id and task.task_type = 'draft_storyboard' and task.status in ('ready'::public.task_status, 'running'::public.task_status))
    for update of episode skip locked
  loop
    if jsonb_typeof(candidate.policy -> 'allowed_tools') <> 'array' or jsonb_array_length(candidate.policy -> 'allowed_tools') = 0 or exists (select 1 from jsonb_array_elements(candidate.policy -> 'allowed_tools') tool where jsonb_typeof(tool) <> 'string' or coalesce(btrim(tool #>> '{}'), '') = '') then raise exception 'Blueprint % has invalid allowed_tools', candidate.blueprint_version_id using errcode = '22023'; end if;
    if jsonb_typeof(candidate.policy #> '{budgets,storyboard_planning_cents}') <> 'number' or candidate.policy #>> '{budgets,storyboard_planning_cents}' !~ '^[0-9]+$' then raise exception 'Blueprint % has invalid storyboard planning budget', candidate.blueprint_version_id using errcode = '22023'; end if;
    adapter := nullif(btrim(candidate.policy #>> '{executors,storyboard_planning,adapter}'), '');
    executor_model := nullif(btrim(candidate.policy #>> '{executors,storyboard_planning,model}'), '');
    harness_id_text := nullif(btrim(candidate.policy #>> '{executors,storyboard_planning,harness_id}'), '');
    if adapter <> 'codex' or executor_model is null or harness_id_text is null or harness_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Blueprint % must select a registered Codex storyboard Adapter, model, and Harness', candidate.blueprint_version_id using errcode = '22023'; end if;
    select harness.* into selected_harness from public.prompt_versions harness where harness.id = harness_id_text::uuid and harness.account_id = candidate.account_id and harness.capability = 'storyboard_planning' and harness.is_active;
    if not found or coalesce(btrim(selected_harness.instructions), '') = '' then raise exception 'Blueprint % must select an active storyboard Harness from its account', candidate.blueprint_version_id using errcode = '22023'; end if;
    visual_inputs := case when candidate.visual_context #> '{output,required_artifact_types}' @> jsonb_build_array('visual_asset_manifest') then coalesce((select jsonb_agg(jsonb_build_object('artifactType', artifact.artifact_type, 'relativePath', artifact.relative_path, 'sha256', artifact.sha256, 'fileSize', artifact.file_size) order by artifact.created_at, artifact.id) from public.artifacts artifact where artifact.producer_task_id = candidate.visual_task_id and artifact.artifact_type = 'visual_asset_manifest'), '[]'::jsonb) else coalesce((select jsonb_agg(jsonb_build_object('artifactType', artifact.artifact_type, 'relativePath', artifact.relative_path, 'sha256', artifact.sha256, 'fileSize', artifact.file_size) order by artifact.created_at, artifact.id) from public.artifacts artifact where artifact.producer_task_id = candidate.visual_task_id), '[]'::jsonb) end;
    visual_inputs := visual_inputs || coalesce((select jsonb_agg(input_artifact) from jsonb_array_elements(candidate.visual_context -> 'input_artifacts') input_artifact where input_artifact ->> 'artifactType' <> 'main_script' and not exists (select 1 from jsonb_array_elements(visual_inputs) existing where existing ->> 'relativePath' = input_artifact ->> 'relativePath' and existing ->> 'sha256' = input_artifact ->> 'sha256')), '[]'::jsonb);
    if jsonb_array_length(visual_inputs) = 0 then raise exception 'Approved visual asset manifest is missing' using errcode = '22023'; end if;
    allowed_tools := candidate.policy -> 'allowed_tools';
    budget_limit := (candidate.policy #>> '{budgets,storyboard_planning_cents}')::integer;
    task_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'capability', 'storyboard_planning',
      'script_revision', jsonb_build_object('id', candidate.script_revision_id, 'storage_path', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'file_size', candidate.script_file_size),
      'series_baseline', candidate.frozen_series_baseline,
      'visual_review_package', jsonb_build_object('id', candidate.visual_review_package_id, 'revision_number', candidate.visual_review_revision_number),
      'harness', jsonb_build_object('id', selected_harness.id, 'version', selected_harness.version, 'content', selected_harness.instructions, 'content_hash', selected_harness.content_hash, 'adapter', 'codex', 'model', executor_model, 'prompt_version', selected_harness.slug),
      'executor', jsonb_build_object('provider', 'codex', 'adapter', 'codex', 'model', executor_model, 'prompt_version', selected_harness.slug),
      'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', 2),
      'allowed_tools', allowed_tools,
      'output', jsonb_build_object('required_artifact_types', jsonb_build_array('storyboard'), 'content_type', 'application/json', 'relative_path', format('episodes/%s/storyboard-v1.json', candidate.id), 'review_stage', 'storyboard_review'),
      'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'main_script', 'relativePath', candidate.script_storage_path, 'sha256', candidate.script_sha256, 'fileSize', candidate.script_file_size)) || visual_inputs
    ));
    task_snapshot := task_snapshot || jsonb_build_object('prompt_context', public.build_prompt_context(candidate.id, task_snapshot));
    insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version) values (candidate.id, 'draft_storyboard', 'ready', task_snapshot, budget_limit, 2, 'codex', executor_model, selected_harness.slug) returning * into created_task;
    update public.episodes set stage = 'storyboard_draft', updated_at = now() where id = candidate.id;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'visual_approved', 'storyboard_draft', 'Orchestrator froze the storyboard Adapter, Harness, approved visual asset manifest, and approved visual inputs.', null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'storyboard_task_created', jsonb_build_object('task_id', created_task.id, 'visual_review_package_id', candidate.visual_review_package_id, 'script_revision_id', candidate.script_revision_id, 'harness_id', selected_harness.id), null);
    return next created_task;
  end loop;
end;
$_$;


--
-- Name: prevent_episode_for_archived_account(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_episode_for_archived_account() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if exists (
    select 1
    from public.accounts
    where id = new.account_id and archived_at is not null
  ) then
    raise exception 'Archived accounts cannot create production orders' using errcode = '22023';
  end if;
  return new;
end;
$$;


--
-- Name: protect_frozen_shot_preparation_inputs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_frozen_shot_preparation_inputs() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_stage public.episode_stage;
begin
  select stage into current_stage from public.episodes where id = old.episode_id;
  if old.frozen_at is not null
    and current_stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review')
    and (
      old.selected_material_revision_id is distinct from new.selected_material_revision_id
      or old.clip_segments is distinct from new.clip_segments
      or old.composition is distinct from new.composition
      or old.audio_mode is distinct from new.audio_mode
      or old.tts_text is distinct from new.tts_text
      or old.tts_voice is distinct from new.tts_voice
      or old.tts_speaking_rate is distinct from new.tts_speaking_rate
      or old.subtitle_text is distinct from new.subtitle_text
      or old.subtitles_enabled is distinct from new.subtitles_enabled
      or old.caption_contract is distinct from new.caption_contract or old.bgm_ducking_level is distinct from new.bgm_ducking_level or old.transition_mode is distinct from new.transition_mode
    ) then
    raise exception 'Frozen shot drafts cannot be edited; create a new storyboard revision' using errcode = '22023';
  end if;
  return new;
end;
$$;


--
-- Name: queue_frozen_shot_source_audio(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_frozen_shot_source_audio(p_draft_id uuid, p_retry boolean DEFAULT false) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  draft public.shot_preparation_drafts;
  prepared_video public.artifacts;
  existing_task public.tasks;
  created_task public.tasks;
  config_hash text;
  output_path text;
begin
  select * into draft from public.shot_preparation_drafts where id = p_draft_id for update;
  if not found or draft.frozen_at is null or draft.audio_mode <> 'source' or draft.current_video_artifact_id is null then return null; end if;
  select artifact.* into prepared_video from public.artifacts artifact
  join public.tasks task on task.id = artifact.producer_task_id and task.status = 'completed' and task.invalidated_at is null
  where artifact.id = draft.current_video_artifact_id and task.id = draft.current_video_task_id;
  if not found then return null; end if;
  config_hash := md5(jsonb_build_object('video_artifact_id', prepared_video.id, 'sha256', prepared_video.sha256)::text);
  select task.* into existing_task from public.tasks task
  where task.episode_id = draft.episode_id and task.task_type = 'extract_embedded_audio'
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text and task.input_snapshot ->> 'configuration_hash' = config_hash
  order by task.created_at desc for update limit 1;
  if found and existing_task.status in ('ready', 'running', 'completed') then return existing_task; end if;
  if found and existing_task.status in ('failed', 'blocked') and not p_retry then return existing_task; end if;
  update public.tasks set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Frozen source audio retry requested.'
  where id = existing_task.id and existing_task.status in ('failed', 'blocked');
  output_path := format('episodes/%s/audio/shot-source-%s-%s.mp3', draft.episode_id, regexp_replace(draft.shot_id, '[^a-zA-Z0-9_-]', '_', 'g'), config_hash);
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (draft.episode_id, 'extract_embedded_audio', 'ready', jsonb_build_object(
    'capability', 'embedded_audio_extraction', 'storyboard_review_package_id', draft.review_package_id, 'configuration_hash', config_hash,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', draft.episode_id, 'review_package_id', draft.review_package_id, 'shot_id', draft.shot_id),
    'source_video_artifact', jsonb_build_object('id', prepared_video.id, 'relative_path', prepared_video.relative_path, 'sha256', prepared_video.sha256, 'file_size', prepared_video.file_size),
    'media', jsonb_build_object('adapter', 'ffmpeg_extract_audio', 'embedded_audio', jsonb_build_object('source_relative_path', prepared_video.relative_path, 'duration_seconds', draft.video_duration_seconds)),
    'audio_track', jsonb_build_object('kind', 'source', 'cue_id', draft.shot_id, 'source_review_package_id', draft.review_package_id, 'start_seconds', 0, 'duration_seconds', 0.001),
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array('shot_source_audio'), 'content_type', 'audio/mpeg', 'relative_path', output_path, 'review_stage', 'production_ready'),
    'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'prepared_shot_video', 'relativePath', prepared_video.relative_path, 'sha256', prepared_video.sha256, 'fileSize', prepared_video.file_size)),
    'allowed_tools', jsonb_build_array('read', 'write')
  ), 0, 2, 'ffmpeg', 'ffmpeg', 'shot-source-audio-v1') returning * into created_task;
  update public.shot_preparation_drafts set audio_status = 'running', pending_source_audio_task_id = created_task.id, source_audio_error = null, updated_at = now() where id = draft.id;
  return created_task;
end;
$$;


--
-- Name: queue_source_audio_after_frozen_clip(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_source_audio_after_frozen_clip() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare draft_id uuid;
begin
  if new.status <> 'completed' or new.task_type not in ('generate_a_roll', 'generate_b_roll') or new.input_snapshot #>> '{shot_preparation,draft_id}' is null then return new; end if;
  draft_id := (new.input_snapshot #>> '{shot_preparation,draft_id}')::uuid;
  perform public.queue_frozen_shot_source_audio(draft_id, false);
  return new;
end;
$$;


--
-- Name: read_episode_production(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_episode_production(p_episode_id uuid, p_known jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare e public.episodes; payload jsonb; changes jsonb:='{}'; hashes jsonb:='{}'; patches jsonb:='{}';
 section record; digest text; versions jsonb; item_versions jsonb; token text; rows_changed jsonb; ids jsonb; row_hashes jsonb; changed_ids uuid[];
begin
 select * into e from public.episodes where id=p_episode_id;
 if not found or not exists(select 1 from public.account_memberships where account_id=e.account_id and user_id=(select auth.uid()) and role='owner') then return null; end if;
 select coalesce(jsonb_object_agg(v.section,v.token),'{}') into versions from (select m.section,sum(m.revision)::text as token from public.episode_read_revisions m where m.episode_id=p_episode_id and m.item_id<>'' group by m.section) v;
 select coalesce(jsonb_object_agg(m.section||'/'||m.item_id,m.revision::text),'{}') into item_versions from public.episode_read_revisions m where m.episode_id=p_episode_id and m.section in ('tasks','taskRuns') and m.item_id<>'';
 payload:=jsonb_build_object(
  'episode',to_jsonb(e),
  'blueprint',(select to_jsonb(b) from public.account_blueprint_versions b where b.id=e.blueprint_version_id),
  'seriesVersion',(select to_jsonb(s) from public.series_versions s where s.id=e.series_version_id),
  'connectionVersions',coalesce((select jsonb_agg(to_jsonb(v) order by v.connection_id,v.version desc) from public.list_external_connection_versions(null) v),'[]'::jsonb));
 for section in select * from jsonb_each(payload) loop
  digest:=md5(section.value::text);hashes:=hashes||jsonb_build_object(section.key,digest);
  if p_known->>section.key is distinct from digest then changes:=changes||jsonb_build_object(section.key,section.value);end if;
 end loop;
 token:='v:'||coalesce(versions->>'materialRevisions','0');hashes:=hashes||jsonb_build_object('materialRevisions',token);
 if p_known->>'materialRevisions' is distinct from token then
  changes:=changes||jsonb_build_object('materialRevisions',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.production_material_revisions r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'shotPreparationDrafts','0');hashes:=hashes||jsonb_build_object('shotPreparationDrafts',token);
 if p_known->>'shotPreparationDrafts' is distinct from token then
  changes:=changes||jsonb_build_object('shotPreparationDrafts',coalesce((select jsonb_agg(to_jsonb(r) order by updated_at desc,id) from public.shot_preparation_drafts r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'storyboardAudioSelections','0');hashes:=hashes||jsonb_build_object('storyboardAudioSelections',token);
 if p_known->>'storyboardAudioSelections' is distinct from token then
  changes:=changes||jsonb_build_object('storyboardAudioSelections',coalesce((select jsonb_agg(to_jsonb(r) order by updated_at desc,id) from public.storyboard_audio_selections r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'reviewPackages','0');hashes:=hashes||jsonb_build_object('reviewPackages',token);
 if p_known->>'reviewPackages' is distinct from token then
  changes:=changes||jsonb_build_object('reviewPackages',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.review_packages r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'artifacts','0');hashes:=hashes||jsonb_build_object('artifacts',token);
 if p_known->>'artifacts' is distinct from token then
  changes:=changes||jsonb_build_object('artifacts',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.artifacts r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'audioTracks','0');hashes:=hashes||jsonb_build_object('audioTracks',token);
 if p_known->>'audioTracks' is distinct from token then
  changes:=changes||jsonb_build_object('audioTracks',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.audio_tracks r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'tasks','0');hashes:=hashes||jsonb_build_object('tasks',token);
 if p_known->>'tasks' is distinct from token then
  select coalesce(jsonb_agg(r.id order by r.created_at desc,r.id),'[]'),coalesce(jsonb_object_agg('tasks/'||r.id,'v:'||coalesce(item_versions->>('tasks/'||r.id),'0')),'{}'),array_agg(r.id) filter(where p_known->>('tasks/'||r.id) is distinct from 'v:'||coalesce(item_versions->>('tasks/'||r.id),'0')) into ids,row_hashes,changed_ids
   from public.tasks r where r.episode_id=p_episode_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id),'[]') into rows_changed
   from public.tasks r where r.id=any(changed_ids);
  hashes:=hashes||row_hashes;
  patches:=patches||jsonb_build_object('tasks',jsonb_build_object('ids',ids,'rows',rows_changed));
 else
  select coalesce(jsonb_object_agg(key,value),'{}') into row_hashes from jsonb_each(p_known) where key like 'tasks/%';hashes:=hashes||row_hashes;
 end if;
 token:='v:'||coalesce(versions->>'transitions','0');hashes:=hashes||jsonb_build_object('transitions',token);
 if p_known->>'transitions' is distinct from token then
  changes:=changes||jsonb_build_object('transitions',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.state_transitions r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'reviewAnnotations','0')||':'||coalesce(versions->>'reviewPackages','0');hashes:=hashes||jsonb_build_object('reviewAnnotations',token);
 if p_known->>'reviewAnnotations' is distinct from token then
  changes:=changes||jsonb_build_object('reviewAnnotations',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.review_annotations r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'qcReviewIssues','0')||':'||coalesce(versions->>'reviewPackages','0');hashes:=hashes||jsonb_build_object('qcReviewIssues',token);
 if p_known->>'qcReviewIssues' is distinct from token then
  changes:=changes||jsonb_build_object('qcReviewIssues',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.qc_review_issues r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'preRenderReviewMembers','0')||':'||coalesce(versions->>'reviewPackages','0');hashes:=hashes||jsonb_build_object('preRenderReviewMembers',token);
 if p_known->>'preRenderReviewMembers' is distinct from token then
  changes:=changes||jsonb_build_object('preRenderReviewMembers',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.pre_render_review_members r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'preRenderReviewMemberDecisions','0')||':'||coalesce(versions->>'reviewPackages','0');hashes:=hashes||jsonb_build_object('preRenderReviewMemberDecisions',token);
 if p_known->>'preRenderReviewMemberDecisions' is distinct from token then
  changes:=changes||jsonb_build_object('preRenderReviewMemberDecisions',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,review_package_id,member_key) from public.pre_render_review_member_decisions r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'audioTrackAnnotations','0')||':'||coalesce(versions->>'audioTracks','0');hashes:=hashes||jsonb_build_object('audioTrackAnnotations',token);
 if p_known->>'audioTrackAnnotations' is distinct from token then
  changes:=changes||jsonb_build_object('audioTrackAnnotations',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.audio_track_annotations r where audio_track_id in (select id from public.audio_tracks where episode_id=p_episode_id)),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'taskRuns','0')||':'||coalesce(versions->>'tasks','0');hashes:=hashes||jsonb_build_object('taskRuns',token);
 if p_known->>'taskRuns' is distinct from token then
  select coalesce(jsonb_agg(r.id order by r.started_at desc,r.id),'[]'),coalesce(jsonb_object_agg('taskRuns/'||r.id,'v:'||coalesce(item_versions->>('taskRuns/'||r.id),'0')),'{}'),array_agg(r.id) filter(where p_known->>('taskRuns/'||r.id) is distinct from 'v:'||coalesce(item_versions->>('taskRuns/'||r.id),'0')) into ids,row_hashes,changed_ids
   from public.task_runs r where r.task_id in (select id from public.tasks where episode_id=p_episode_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'task_id',r.task_id,'status',r.status,'attempt',r.attempt,'started_at',r.started_at,'completed_at',r.completed_at) order by r.started_at desc,r.id),'[]') into rows_changed
   from public.task_runs r where r.id=any(changed_ids);
  hashes:=hashes||row_hashes;
  patches:=patches||jsonb_build_object('taskRuns',jsonb_build_object('ids',ids,'rows',rows_changed));
 else
  select coalesce(jsonb_object_agg(key,value),'{}') into row_hashes from jsonb_each(p_known) where key like 'taskRuns/%';hashes:=hashes||row_hashes;
 end if;
 return jsonb_build_object('hashes',hashes,'sections',changes,'patches',patches);
end $$;


--
-- Name: record_episode_worker_preflight(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_episode_worker_preflight(p_episode_id uuid, p_owner_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1
    from public.episodes episode
    join public.account_memberships membership on membership.account_id = episode.account_id
    where episode.id = p_episode_id and membership.user_id = p_owner_id and membership.role = 'owner'
  ) then raise exception 'Owner membership is required to record Worker preflight' using errcode = '42501'; end if;
  update public.episodes set worker_preflight_at = now() where id = p_episode_id;
end;
$$;


--
-- Name: record_external_connection_verification(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_external_connection_verification(p_connection_id uuid, p_status text, p_detail text) RETURNS public.external_connections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare updated_connection public.external_connections; version_id uuid;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Worker service role is required to record a connection verification' using errcode = '42501'; end if;
  if p_status not in ('verified', 'invalid', 'retryable') or char_length(trim(p_detail)) not between 1 and 500 then raise exception 'Connection verification is invalid' using errcode = '22023'; end if;
  select version.id into version_id from public.external_connection_versions version where version.id = p_connection_id and version.revoked_at is null;
  if version_id is null then raise exception 'External connection version does not exist' using errcode = 'P0002'; end if;
  update public.external_connections connection
  set status = p_status, last_verification_detail = trim(p_detail), last_verified_at = now()
  from public.external_connection_versions version
  where version.id = p_connection_id and connection.id = version.connection_id and connection.current_version_id = version.id
  returning connection.* into updated_connection;
  if not found then raise exception 'Current external connection version does not exist' using errcode = 'P0002'; end if;
  insert into public.external_connection_verifications (connection_id, connection_version_id, status, detail)
  values (updated_connection.id, p_connection_id, p_status, trim(p_detail));
  return updated_connection;
end;
$$;


--
-- Name: record_pre_render_member_dependencies(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_pre_render_member_dependencies() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  package public.review_packages;
  source_task public.tasks;
  source_input jsonb;
  material public.production_material_revisions;
  series_version_id uuid;
begin
  select * into package from public.review_packages where id = new.review_package_id;
  if coalesce(package.context_snapshot ->> 'storyboard_review_package_id', '') <> '' then
    insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
    values (package.episode_id, 'review_package', (package.context_snapshot ->> 'storyboard_review_package_id')::uuid, 'review_package', package.id)
    on conflict do nothing;
  end if;
  if new.source_material_revision_id is not null then
    insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
    values (package.episode_id, 'material_revision', new.source_material_revision_id, 'review_package', package.id)
    on conflict do nothing;
    return new;
  end if;
  select * into source_task from public.tasks where id = new.source_task_id;
  if not found then raise exception 'Pre-render member source task is missing' using errcode = '22023'; end if;
  for source_input in select value from jsonb_array_elements(coalesce(source_task.input_snapshot -> 'input_artifacts', '[]'::jsonb)) loop
    select revision.* into material from public.production_material_revisions revision
    where revision.episode_id = package.episode_id and revision.storage_path = source_input ->> 'relativePath' and revision.sha256 = source_input ->> 'sha256' limit 1;
    if found then
      insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
      values (package.episode_id, 'material_revision', material.id, 'task', source_task.id), (package.episode_id, 'material_revision', material.id, 'review_package', package.id)
      on conflict do nothing;
    end if;
  end loop;
  if coalesce(source_task.input_snapshot #>> '{series_baseline,version_id}', '') <> '' then
    series_version_id := (source_task.input_snapshot #>> '{series_baseline,version_id}')::uuid;
    insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
    values (package.episode_id, 'series_version', series_version_id, 'task', source_task.id), (package.episode_id, 'series_version', series_version_id, 'review_package', package.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;


--
-- Name: artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    artifact_type text NOT NULL,
    relative_path text NOT NULL,
    sha256 text NOT NULL,
    file_size bigint NOT NULL,
    producer_task_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artifacts_file_size_check CHECK ((file_size >= 0)),
    CONSTRAINT artifacts_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: record_publish_input(uuid, text, text, text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_publish_input(p_episode_id uuid, p_artifact_type text, p_relative_path text, p_sha256 text, p_file_size bigint) RETURNS public.artifacts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare selected_episode public.episodes; existing public.artifacts; producer public.tasks; expected_path text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Only the local publish input registrar may record an input' using errcode='42501'; end if;
  if p_artifact_type not in ('cover','metadata') or p_sha256 !~ '^[0-9a-f]{64}$' or p_file_size < 1 then raise exception 'Publish input is invalid' using errcode='22023'; end if;
  select * into selected_episode from public.episodes where id=p_episode_id for update;
  if not found or selected_episode.stage <> 'qc_passed' then raise exception 'Publish inputs require qc_passed' using errcode='22023'; end if;
  if p_artifact_type = 'cover' then
    if p_relative_path !~ ('^episodes/' || p_episode_id::text || '/publish-input/cover-v1\.(jpg|png|webp)$') then raise exception 'Publish input path is invalid' using errcode='22023'; end if;
  else
    expected_path := 'episodes/' || p_episode_id::text || '/publish-input/metadata-v1.json';
    if p_relative_path <> expected_path then raise exception 'Publish input path is invalid' using errcode='22023'; end if;
  end if;
  select * into existing from public.artifacts where episode_id=p_episode_id and artifact_type=p_artifact_type;
  if found then if existing.relative_path<>p_relative_path or existing.sha256<>p_sha256 or existing.file_size<>p_file_size then raise exception 'Publish input is already fixed' using errcode='22023'; end if; return existing; end if;
  insert into public.tasks (episode_id,task_type,status,input_snapshot) values (p_episode_id,'register_publish_input','completed',jsonb_build_object('artifact_type',p_artifact_type,'relative_path',p_relative_path,'sha256',p_sha256,'file_size',p_file_size)) returning * into producer;
  insert into public.artifacts (episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id) values (p_episode_id,p_artifact_type,p_relative_path,p_sha256,p_file_size,producer.id) returning * into existing;
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) values (selected_episode.account_id,p_episode_id,'publish_input_registered',jsonb_build_object('artifact_type',p_artifact_type,'relative_path',p_relative_path,'sha256',p_sha256),auth.uid());
  return existing;
end; $_$;


--
-- Name: record_publish_package(uuid, text, text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_publish_package(p_episode_id uuid, p_relative_path text, p_sha256 text, p_file_size bigint) RETURNS public.artifacts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare current_episode public.episodes; recorded_artifact public.artifacts; publish_task public.tasks; expected_path text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Only the local publish-prep worker may record a publish package' using errcode = '42501'; end if;
  select * into current_episode from public.episodes where id = p_episode_id for update;
  if not found then raise exception 'Episode % does not exist', p_episode_id using errcode = 'P0002'; end if;
  if current_episode.stage <> 'qc_passed' then raise exception 'Publish package requires qc_passed' using errcode = '22023'; end if;
  expected_path := 'episodes/' || p_episode_id::text || '/publish-package/manifest.json';
  if p_relative_path <> expected_path or p_sha256 !~ '^[0-9a-f]{64}$' or p_file_size < 0 then raise exception 'Publish package index is invalid' using errcode = '22023'; end if;
  if not exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'final_render') or not exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'final_qc_report') then raise exception 'Final render and final QC report are required before a publish package' using errcode = '22023'; end if;
  select * into recorded_artifact from public.artifacts where episode_id = p_episode_id and artifact_type = 'publish_package' and relative_path = p_relative_path;
  if found then if recorded_artifact.sha256 <> p_sha256 or recorded_artifact.file_size <> p_file_size then raise exception 'Publish package is already fixed for this episode' using errcode = '22023'; end if; return recorded_artifact; end if;
  insert into public.tasks (episode_id,task_type,status,input_snapshot) values (p_episode_id,'prepare_publish_package','completed',jsonb_build_object('publish_package',jsonb_build_object('relative_path',p_relative_path,'sha256',p_sha256,'file_size',p_file_size))) returning * into publish_task;
  insert into public.artifacts (episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id) values (p_episode_id,'publish_package',p_relative_path,p_sha256,p_file_size,publish_task.id) returning * into recorded_artifact;
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) values (current_episode.account_id,p_episode_id,'publish_package_generated',jsonb_build_object('relative_path',p_relative_path,'sha256',p_sha256,'file_size',p_file_size),auth.uid()); return recorded_artifact;
end; $_$;


--
-- Name: record_publish_package_verification(uuid, text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_publish_package_verification(p_episode_id uuid, p_sha256 text, p_file_size bigint) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: record_shot_video_duration_after_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_shot_video_duration_after_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.task_type in ('generate_a_roll', 'generate_b_roll') and new.status = 'completed' and new.input_snapshot #>> '{shot_preparation,draft_id}' is not null then
    update public.shot_preparation_drafts
    set video_duration_seconds = coalesce((new.last_result #>> '{validation,videoDurationSeconds}')::numeric, (new.input_snapshot #>> '{clip_selection,duration_seconds}')::numeric), updated_at = now()
    where id = (new.input_snapshot #>> '{shot_preparation,draft_id}')::uuid and current_video_task_id = new.id;
  end if;
  return new;
end;
$$;


--
-- Name: record_task_production_dependencies(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_task_production_dependencies() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  source_input jsonb;
  material public.production_material_revisions;
  series_version_id uuid;
  storyboard_package_id uuid;
begin
  if coalesce(new.input_snapshot ->> 'storyboard_review_package_id', '') <> '' then
    storyboard_package_id := (new.input_snapshot ->> 'storyboard_review_package_id')::uuid;
    insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
    values (new.episode_id, 'review_package', storyboard_package_id, 'task', new.id)
    on conflict do nothing;
  end if;

  for source_input in select value from jsonb_array_elements(coalesce(new.input_snapshot -> 'input_artifacts', '[]'::jsonb)) loop
    select revision.* into material
    from public.production_material_revisions revision
    where revision.episode_id = new.episode_id
      and revision.storage_path = source_input ->> 'relativePath'
      and revision.sha256 = source_input ->> 'sha256'
    limit 1;
    if found then
      insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
      values (new.episode_id, 'material_revision', material.id, 'task', new.id)
      on conflict do nothing;
    end if;
  end loop;

  if coalesce(new.input_snapshot #>> '{series_baseline,version_id}', '') <> '' then
    series_version_id := (new.input_snapshot #>> '{series_baseline,version_id}')::uuid;
    insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
    values (new.episode_id, 'series_version', series_version_id, 'task', new.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;


--
-- Name: recover_duration_decision_review_render_tasks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recover_duration_decision_review_render_tasks() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
  recovered_count integer := 0;
begin
  for source_task in
    select task.*
    from public.tasks task
    where task.task_type = 'generate_review_render'
      and task.status = 'blocked'
      and task.invalidated_at is null
      and jsonb_typeof(task.input_snapshot -> 'series_baseline') = 'object'
      and jsonb_typeof(task.input_snapshot #> '{series_baseline,version}') = 'number'
      and (task.input_snapshot #>> '{series_baseline,version}') ~ '^[1-9][0-9]*$'
      and coalesce(task.input_snapshot -> 'series_baseline' ->> 'version_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (
        select 1
        from jsonb_array_elements(case when jsonb_typeof(task.last_result -> 'blockers') = 'array' then task.last_result -> 'blockers' else '[]'::jsonb end) blocker
        where blocker ->> 'code' = 'task_package_invalid'
          and blocker ->> 'detail' = '镜头时长判定格式无效。'
      )
      and jsonb_typeof(task.input_snapshot -> 'review_render') = 'object'
      and jsonb_typeof(task.input_snapshot #> '{review_render,project_revision}') = 'number'
      and jsonb_typeof(task.input_snapshot #> '{review_render,project_relative_path}') = 'string'
      and btrim(task.input_snapshot #>> '{review_render,project_relative_path}') <> ''
      and jsonb_typeof(task.input_snapshot -> 'output') = 'object'
      and jsonb_typeof(task.input_snapshot #> '{output,relative_path}') = 'string'
      and btrim(task.input_snapshot #>> '{output,relative_path}') <> ''
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
      raise exception 'duration-invalid review render task has an unexpected series version';
    end if;

    select version.* into series_row
    from public.series_versions version
    where version.id = episode_row.series_version_id
      and version.account_id = episode_row.account_id;
    if not found
      or series_row.version < 1
      or series_row.version <> (source_task.input_snapshot #>> '{series_baseline,version}')::integer then
      raise exception 'duration-invalid review render task has an unexpected series version';
    end if;

    if coalesce(source_task.input_snapshot #>> '{review_render,pre_render_review_package_id}', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(source_task.input_snapshot #>> '{review_render,composition_revision_id}', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'duration-invalid review render task is missing its frozen package or composition';
    end if;

    select package.* into source_package
    from public.review_packages package
    where package.id = (source_task.input_snapshot #>> '{review_render,pre_render_review_package_id}')::uuid
      and package.episode_id = source_task.episode_id
      and package.stage = 'production_ready'
      and package.invalidated_at is null;
    if not found then
      raise exception 'duration-invalid review render task has no current production package';
    end if;

    select composition.* into source_composition
    from public.review_render_composition_revisions composition
    where composition.id = (source_task.input_snapshot #>> '{review_render,composition_revision_id}')::uuid
      and composition.episode_id = source_task.episode_id
      and composition.pre_render_review_package_id = source_package.id;
    if not found then
      raise exception 'duration-invalid review render task has no matching composition revision';
    end if;

    if source_composition.revision_number <> (source_task.input_snapshot #>> '{review_render,project_revision}')::integer
      or source_task.input_snapshot #>> '{review_render,project_relative_path}' <> format('episodes/%s/review-render/v%s/index.html', source_task.episode_id, source_composition.revision_number)
      or source_task.input_snapshot #>> '{output,relative_path}' <> format('episodes/%s/review-render/v%s/review-render.mp4', source_task.episode_id, source_composition.revision_number) then
      raise exception 'duration-invalid review render task has inconsistent frozen paths';
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
      '修复冻结时长判定快照后重新排队审核渲染。',
      null,
      coalesce(source_composition.composition_config, '{}'::jsonb) || jsonb_build_object('reason', '修复冻结时长判定快照后重新排队审核渲染。')
    )
    returning * into new_composition;

    project_path := format('episodes/%s/review-render/v%s/index.html', source_task.episode_id, next_revision);
    render_path := format('episodes/%s/review-render/v%s/review-render.mp4', source_task.episode_id, next_revision);
    new_snapshot := source_task.input_snapshot
      || jsonb_build_object(
        'recovered_from_task_id', source_task.id,
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
    recovered_count := recovered_count + 1;
  end loop;
  return recovered_count;
end;
$_$;


--
-- Name: recover_expired_worker_tasks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recover_expired_worker_tasks() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare stale public.tasks; expired_result jsonb; recovered integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Worker service role is required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('loop-worker-lease-recovery',0));
  for stale in select * from public.tasks
    where status='running' and (claimed_at is null or claimed_at <= clock_timestamp()-interval '30 minutes')
    order by id for update skip locked
  loop
    expired_result := jsonb_build_object('version','worker-result/v1','taskId',stale.id,'status','failed','artifacts','[]'::jsonb,
      'validation',jsonb_build_object('passed',false,'checks',jsonb_build_array(jsonb_build_object('name','worker_lease','passed',false,'detail','Worker lease expired before it reported a result.'))),
      'actualCostCents',0,'blockers','[]'::jsonb,'retry',jsonb_build_object('shouldRetry',stale.attempt < stale.max_attempts,'reason','Worker lease expired.'),'nextStep','Retry after the Worker is available.');
    update public.task_runs set status='failed',result=expired_result,completed_at=clock_timestamp()
      where task_id=stale.id and attempt=stale.attempt-1 and status='running';
    update public.tasks set status=case when stale.attempt < stale.max_attempts then 'ready'::public.task_status else 'failed'::public.task_status end,
      claimed_at=null,lease_token=null,completed_at=case when stale.attempt < stale.max_attempts then null else clock_timestamp() end,last_result=expired_result where id=stale.id;
    insert into public.audit_events(account_id,episode_id,event_type,payload)
      select account_id,id,'worker_lease_expired',jsonb_build_object('task_id',stale.id,'attempt',stale.attempt-1) from public.episodes where id=stale.episode_id;
    recovered := recovered+1;
  end loop;
  return recovered;
end $$;


--
-- Name: refresh_shot_audio_mix_after_selection(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_shot_audio_mix_after_selection() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update public.shot_preparation_drafts draft set
    frozen_at = null, frozen_by = null, confirmation_status = 'pending', confirmation_reason = null,
    confirmed_at = null, confirmed_by = null, updated_at = now()
  where draft.episode_id = new.episode_id and draft.review_package_id = new.review_package_id
    and (new.target_kind = 'episode' or draft.shot_id = new.target_id);
  return new;
end;
$$;


--
-- Name: refresh_shot_preparation_contract(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_shot_preparation_contract() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.caption_contract is null then
    new.caption_contract := jsonb_build_object(
      'version', 'shot-captions/v1', 'enabled', new.subtitles_enabled,
      'content_mode', case when new.audio_mode = 'tts' then 'follow_tts' else 'independent' end,
      'text', new.subtitle_text, 'cues', '[]'::jsonb,
      'spatial', jsonb_build_object('version', 'shot-caption-space/v1', 'anchor', 'bottom-center', 'safe_area', 'title-safe', 'max_lines', 2, 'max_characters_per_line', 16)
    );
  end if;
  new.preparation_contract := public.build_shot_preparation_contract(new);
  new.preparation_input_fingerprint := new.preparation_contract ->> 'input_fingerprint';
  return new;
end;
$$;


--
-- Name: refresh_worker_task_lease(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_worker_task_lease(p_task_id uuid, p_attempt integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin raise exception 'Lease token is required; upgrade Worker' using errcode='42501'; end $$;


--
-- Name: refresh_worker_task_lease(uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_worker_task_lease(p_task_id uuid, p_attempt integer, p_lease_token uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
  update public.tasks set claimed_at=clock_timestamp() where id=p_task_id;
  return true;
end $$;


--
-- Name: register_completed_audio_track(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_completed_audio_track() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare selected_artifact public.artifacts; track_snapshot jsonb; actual_duration numeric; source_material public.production_material_revisions;
begin
  if new.status <> 'completed' or new.task_type not in ('generate_narration', 'extract_embedded_audio', 'generate_soundtrack') then return new; end if;
  track_snapshot := new.input_snapshot -> 'audio_track';
  if jsonb_typeof(track_snapshot) <> 'object' then raise exception 'Completed audio task is missing its frozen audio track snapshot' using errcode = '22023'; end if;
  if coalesce(new.last_result ->> 'audioDurationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$' or (new.last_result ->> 'audioDurationSeconds')::numeric <= 0 then raise exception 'Completed audio task is missing its probed duration' using errcode = '22023'; end if;
  actual_duration := (new.last_result ->> 'audioDurationSeconds')::numeric;
  if track_snapshot ? 'source_material_revision_id' then
    select material.* into source_material from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id where material.id = (track_snapshot ->> 'source_material_revision_id')::uuid and material.episode_id = new.episode_id;
    if not found then raise exception 'Completed audio task source material approval is invalid' using errcode = '22023'; end if;
  end if;
  select * into selected_artifact from public.artifacts artifact where artifact.producer_task_id = new.id and artifact.relative_path = new.input_snapshot #>> '{output,relative_path}';
  if not found then raise exception 'Completed audio task is missing its frozen output artifact' using errcode = '22023'; end if;
  insert into public.audio_tracks (episode_id,source_task_id,source_artifact_id,source_review_package_id,source_material_revision_id,track_kind,cue_id,relative_path,sha256,file_size,start_seconds,duration_seconds)
  values (new.episode_id,new.id,selected_artifact.id,nullif(track_snapshot ->> 'source_review_package_id','')::uuid,source_material.id,track_snapshot ->> 'kind',nullif(track_snapshot ->> 'cue_id',''),selected_artifact.relative_path,selected_artifact.sha256,selected_artifact.file_size,coalesce((track_snapshot ->> 'start_seconds')::numeric,0),actual_duration);
  return new;
end;
$_$;


--
-- Name: register_completed_review_render(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_completed_review_render() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare render_artifact public.artifacts; qc_artifact public.artifacts; task_run public.task_runs; package public.review_packages; next_revision integer; previous_stage public.episode_stage;
begin
  if new.status <> 'completed' or new.task_type <> 'generate_review_render' or old.status = 'completed' then return new; end if;
  select * into render_artifact from public.artifacts where producer_task_id = new.id and artifact_type = 'render' and relative_path = new.input_snapshot #>> '{output,relative_path}';
  select * into qc_artifact from public.artifacts where producer_task_id = new.id and artifact_type = 'review_qc_report';
  select * into task_run from public.task_runs where task_id = new.id and attempt = new.attempt - 1;
  if not found or render_artifact.id is null or qc_artifact.id is null then raise exception 'Completed review render is missing QC evidence' using errcode = '22023'; end if;
  select coalesce(max(revision_number), 0) + 1 into next_revision from public.review_packages where episode_id = new.episode_id and stage = 'qc_review';
  insert into public.review_packages (episode_id,task_id,task_run_id,artifact_id,stage,revision_number,context_snapshot) values (new.episode_id,new.id,task_run.id,render_artifact.id,'qc_review',next_revision,jsonb_build_object('review_kind','openchatcut_review_render','pre_render_review_package_id',new.input_snapshot #>> '{review_render,pre_render_review_package_id}','composition_revision_id',new.input_snapshot #>> '{review_render,composition_revision_id}','composition_adjustments',new.input_snapshot #> '{review_render,adjustments}','project_revision',new.input_snapshot #>> '{review_render,project_revision}','project_relative_path',new.input_snapshot #>> '{review_render,project_relative_path}','qc_report',jsonb_build_object('artifact_id',qc_artifact.id,'relative_path',qc_artifact.relative_path,'sha256',qc_artifact.sha256,'file_size',qc_artifact.file_size),'studio_project',new.input_snapshot #> '{review_render,adjustments,studio_project}',
    'studio_project_revision',new.input_snapshot #>> '{review_render,adjustments,studio_project_revision}',
    'frozen_input_artifacts',new.input_snapshot -> 'input_artifacts','technical_evidence',new.last_result -> 'validation')) returning * into package;
  select stage into previous_stage from public.episodes where id = new.episode_id for update; if previous_stage <> 'render_ready' then raise exception 'Review render completed outside render_ready stage' using errcode = '22023'; end if;
  update public.episodes set stage = 'qc_review', updated_at = now() where id = new.episode_id; insert into public.state_transitions (episode_id,from_stage,to_stage,reason,actor_id) values (new.episode_id,'render_ready','qc_review','OpenChatCut deterministic review render completed.',null);
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) select episode.account_id,episode.id,'review_render_created',jsonb_build_object('review_package_id',package.id,'task_id',new.id,'project_revision',new.input_snapshot #>> '{review_render,project_revision}'),null from public.episodes episode where episode.id = new.episode_id;
  return new;
end; $$;


--
-- Name: register_manual_a_roll(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_manual_a_roll(p_episode_id uuid, p_material_revision_id uuid, p_shot_id text, p_storyboard_review_package_id uuid) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  selected_material public.production_material_revisions;
  selected_package public.review_packages;
  selected_shot jsonb;
  created_task public.tasks;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to register manual A-roll' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual A-roll can only be bound after storyboard approval' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'Current approved storyboard package is required' using errcode = '22023'; end if;

  select material.* into selected_material
  from public.production_material_revisions material
  join public.material_revision_approvals approval on approval.material_revision_id = material.id
  where material.id = p_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'video' and material.material_purpose = 'a_roll';
  if not found then raise exception 'Approved A-roll video material is required' using errcode = '22023'; end if;

  select value into selected_shot
  from jsonb_array_elements(selected_package.context_snapshot #> '{worker_result,storyboard,shots}') as shot(value)
  where value ->> 'id' = btrim(p_shot_id) and value ->> 'shotType' = 'a_roll';
  if not found then raise exception 'Approved storyboard A-roll shot does not exist' using errcode = '22023'; end if;

  update public.tasks task
  set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner replaced unavailable automatic A-roll with an immutable manual upload.'
  where task.episode_id = p_episode_id
    and task.task_type = 'generate_a_roll'
    and task.status in ('ready', 'blocked', 'failed')
    and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text
    and task.input_snapshot #>> '{shot,id}' = selected_shot ->> 'id';

  if exists (
    select 1 from public.tasks task
    where task.episode_id = p_episode_id
      and task.task_type = 'generate_a_roll'
      and task.status <> 'superseded'
      and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text
      and task.input_snapshot #>> '{shot,id}' = selected_shot ->> 'id'
  ) then raise exception 'This storyboard shot already has frozen A-roll media' using errcode = '22023'; end if;

  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, actual_cost_cents, completed_at, last_result)
  values (
    p_episode_id,
    'generate_a_roll',
    'completed',
    jsonb_build_object(
      'capability', 'a_roll_manual_upload',
      'storyboard_review_package_id', p_storyboard_review_package_id,
      'shot', selected_shot,
      'manual_source', jsonb_build_object('material_revision_id', selected_material.id, 'source_kind', selected_material.source_kind),
      'output', jsonb_build_object('required_artifact_types', jsonb_build_array('a_roll_video'), 'content_type', selected_material.mime_type, 'relative_path', selected_material.storage_path, 'review_stage', 'production_ready'),
      'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'manual_a_roll_upload', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size))
    ),
    0, 1, 'manual_upload', 'owner-provided-video', 'manual-a-roll-v1', 0, now(),
    jsonb_build_object('version', 'manual-result/v1', 'status', 'completed', 'artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'a_roll_video', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size)), 'validation', jsonb_build_object('passed', true, 'checks', jsonb_build_array(jsonb_build_object('name', 'immutable_material_revision', 'passed', true, 'detail', 'Owner-provided A-roll is bound to this approved storyboard shot.'))), 'actualCostCents', 0, 'blockers', jsonb_build_array(), 'retry', jsonb_build_object('shouldRetry', false, 'reason', 'Manual source is immutable.'), 'nextStep', 'Proceed to pre-render review after the remaining media is ready.')
  ) returning * into created_task;

  insert into public.artifacts (episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id)
  values (p_episode_id, 'a_roll_video', selected_material.storage_path, selected_material.sha256, selected_material.file_size, created_task.id);
  insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id)
  values (p_episode_id, 'material_revision', selected_material.id, 'task', created_task.id)
  on conflict do nothing;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'manual_a_roll_registered', jsonb_build_object('task_id', created_task.id, 'material_revision_id', selected_material.id, 'shot_id', selected_shot ->> 'id', 'storyboard_review_package_id', selected_package.id), auth.uid());
  return created_task;
end;
$$;


--
-- Name: register_manual_audio(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_manual_audio(p_episode_id uuid, p_material_revision_id uuid, p_target_id text, p_storyboard_review_package_id uuid) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare current_episode public.episodes; selected_material public.production_material_revisions; selected_package public.review_packages; target jsonb; item jsonb; created_task public.tasks; created_artifact public.artifacts; target_kind text; target_task_type text; target_artifact_type text; target_start numeric := 0; target_duration numeric;
begin
  select episode.* into current_episode from public.episodes episode join public.account_memberships membership on membership.account_id = episode.account_id where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner' for update of episode;
  if not found then raise exception 'Owner membership is required to register manual audio' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual audio can only be bound after storyboard approval' using errcode = '22023'; end if;
  select package.* into selected_package from public.review_packages package join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved' where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'Current approved storyboard package is required' using errcode = '22023'; end if;
  select material.* into selected_material from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id where material.id = p_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'audio' and material.material_purpose in ('narration', 'background_music', 'sound_effect');
  if not found then raise exception 'Approved narration, music, or sound effect material is required' using errcode = '22023'; end if;
  if selected_material.material_purpose = 'narration' then
    for item in select value from jsonb_array_elements(selected_package.context_snapshot #> '{worker_result,storyboard,shots}') loop
      if item ->> 'id' = btrim(p_target_id) then target := item; exit; end if;
      if coalesce(item ->> 'durationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'Approved storyboard shot duration is invalid' using errcode = '22023'; end if;
      target_start := target_start + (item ->> 'durationSeconds')::numeric;
    end loop;
    target_kind := 'narration'; target_task_type := 'generate_narration'; target_artifact_type := 'narration_audio';
  else
    target_kind := case selected_material.material_purpose when 'background_music' then 'bgm' else 'sfx' end;
    select value into target from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,audioCues}', '[]'::jsonb)) as cue(value) where value ->> 'id' = btrim(p_target_id) and value ->> 'kind' = target_kind;
    target_task_type := 'generate_soundtrack'; target_artifact_type := 'soundtrack_audio';
    if found then target_start := (target ->> 'startSeconds')::numeric; end if;
  end if;
  if target is null or coalesce(target ->> 'durationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$' or (target ->> 'durationSeconds')::numeric <= 0 then raise exception 'Approved storyboard audio target does not exist or is invalid' using errcode = '22023'; end if;
  target_duration := (target ->> 'durationSeconds')::numeric;
  update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner replaced automatic audio with an immutable manual upload.' where task.episode_id = p_episode_id and task.task_type = target_task_type and task.status in ('ready', 'blocked', 'failed') and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text and task.input_snapshot #>> '{audio_track,cue_id}' = target ->> 'id';
  if exists (select 1 from public.tasks task where task.episode_id = p_episode_id and task.task_type = target_task_type and task.status <> 'superseded' and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text and task.input_snapshot #>> '{audio_track,cue_id}' = target ->> 'id') then raise exception 'This storyboard audio target already has frozen media' using errcode = '22023'; end if;
  if exists (select 1 from public.artifacts artifact where artifact.episode_id = p_episode_id and artifact.relative_path = selected_material.storage_path) then raise exception 'This audio material is already bound to another storyboard target' using errcode = '22023'; end if;
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, actual_cost_cents, completed_at, last_result)
  values (p_episode_id, target_task_type, 'completed', jsonb_build_object('capability', case when target_kind = 'narration' then 'narration_manual_upload' else 'soundtrack_manual_upload' end, 'storyboard_review_package_id', p_storyboard_review_package_id, 'configuration_hash', 'manual', 'audio_track', jsonb_build_object('kind', target_kind, 'cue_id', target ->> 'id', 'source_review_package_id', p_storyboard_review_package_id, 'source_material_revision_id', selected_material.id, 'start_seconds', target_start, 'duration_seconds', target_duration), 'manual_source', jsonb_build_object('material_revision_id', selected_material.id, 'source_kind', selected_material.source_kind), 'output', jsonb_build_object('required_artifact_types', jsonb_build_array(target_artifact_type), 'content_type', selected_material.mime_type, 'relative_path', selected_material.storage_path, 'review_stage', 'production_ready'), 'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'manual_audio_upload', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size))), 0, 1, 'manual_upload', 'owner-provided-audio', 'manual-audio-v1', 0, now(), jsonb_build_object('version', 'manual-result/v1', 'status', 'completed', 'artifacts', jsonb_build_array(jsonb_build_object('artifactType', target_artifact_type, 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size)), 'validation', jsonb_build_object('passed', true, 'checks', jsonb_build_array(jsonb_build_object('name', 'immutable_material_revision', 'passed', true, 'detail', 'Owner-provided audio is bound to this approved storyboard target.'))), 'actualCostCents', 0, 'blockers', jsonb_build_array(), 'retry', jsonb_build_object('shouldRetry', false, 'reason', 'Manual source is immutable.'), 'nextStep', 'Proceed to pre-render review after the remaining media is ready.')) returning * into created_task;
  insert into public.artifacts (episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id) values (p_episode_id, target_artifact_type, selected_material.storage_path, selected_material.sha256, selected_material.file_size, created_task.id) returning * into created_artifact;
  insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, source_material_revision_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds) values (p_episode_id, created_task.id, created_artifact.id, p_storyboard_review_package_id, selected_material.id, target_kind, target ->> 'id', selected_material.storage_path, selected_material.sha256, selected_material.file_size, target_start, target_duration);
  insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id) values (p_episode_id, 'material_revision', selected_material.id, 'task', created_task.id) on conflict do nothing;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, p_episode_id, 'manual_audio_registered', jsonb_build_object('task_id', created_task.id, 'material_revision_id', selected_material.id, 'target_id', target ->> 'id', 'track_kind', target_kind, 'storyboard_review_package_id', p_storyboard_review_package_id), auth.uid());
  return created_task;
end;
$_$;


--
-- Name: register_manual_b_roll(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_manual_b_roll(p_episode_id uuid, p_material_revision_id uuid, p_shot_id text, p_storyboard_review_package_id uuid) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare current_episode public.episodes; selected_material public.production_material_revisions; selected_package public.review_packages; selected_shot jsonb; created_task public.tasks;
begin
  select episode.* into current_episode from public.episodes episode join public.account_memberships membership on membership.account_id = episode.account_id where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner' for update of episode;
  if not found then raise exception 'Owner membership is required to register manual B-roll' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual B-roll can only be bound after storyboard approval' using errcode = '22023'; end if;
  select package.* into selected_package from public.review_packages package join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved' where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'Current approved storyboard package is required' using errcode = '22023'; end if;
  select material.* into selected_material from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id where material.id = p_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'video' and material.material_purpose = 'b_roll';
  if not found then raise exception 'Approved B-roll video material is required' using errcode = '22023'; end if;
  select value into selected_shot from jsonb_array_elements(selected_package.context_snapshot #> '{worker_result,storyboard,shots}') as shot(value) where value ->> 'id' = btrim(p_shot_id) and value ->> 'shotType' = 'b_roll';
  if not found then raise exception 'Approved storyboard B-roll shot does not exist' using errcode = '22023'; end if;
  update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner replaced automatic B-roll with an immutable manual upload.' where task.episode_id = p_episode_id and task.task_type = 'generate_b_roll' and task.status in ('ready', 'blocked', 'failed') and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text and task.input_snapshot #>> '{shot,id}' = selected_shot ->> 'id';
  if exists (select 1 from public.tasks task where task.episode_id = p_episode_id and task.task_type = 'generate_b_roll' and task.status <> 'superseded' and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text and task.input_snapshot #>> '{shot,id}' = selected_shot ->> 'id') then raise exception 'This storyboard shot already has frozen B-roll media' using errcode = '22023'; end if;
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, actual_cost_cents, completed_at, last_result)
  values (p_episode_id, 'generate_b_roll', 'completed', jsonb_build_object('capability', 'b_roll_manual_upload', 'storyboard_review_package_id', p_storyboard_review_package_id, 'configuration_hash', 'manual', 'shot', selected_shot, 'manual_source', jsonb_build_object('material_revision_id', selected_material.id, 'source_kind', selected_material.source_kind), 'output', jsonb_build_object('required_artifact_types', jsonb_build_array('b_roll_asset'), 'content_type', selected_material.mime_type, 'relative_path', selected_material.storage_path, 'review_stage', 'production_ready'), 'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'manual_b_roll_upload', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size))), 0, 1, 'manual_upload', 'owner-provided-video', 'manual-b-roll-v1', 0, now(), jsonb_build_object('version', 'manual-result/v1', 'status', 'completed', 'artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'b_roll_asset', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size)), 'validation', jsonb_build_object('passed', true, 'checks', jsonb_build_array(jsonb_build_object('name', 'immutable_material_revision', 'passed', true, 'detail', 'Owner-provided B-roll is bound to this approved storyboard shot.'))), 'actualCostCents', 0, 'blockers', jsonb_build_array(), 'retry', jsonb_build_object('shouldRetry', false, 'reason', 'Manual source is immutable.'), 'nextStep', 'Proceed to pre-render review after the remaining media is ready.')) returning * into created_task;
  insert into public.artifacts (episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id) values (p_episode_id, 'b_roll_asset', selected_material.storage_path, selected_material.sha256, selected_material.file_size, created_task.id);
  insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id) values (p_episode_id, 'material_revision', selected_material.id, 'task', created_task.id) on conflict do nothing;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, p_episode_id, 'manual_b_roll_registered', jsonb_build_object('task_id', created_task.id, 'material_revision_id', selected_material.id, 'shot_id', selected_shot ->> 'id', 'storyboard_review_package_id', selected_package.id), auth.uid());
  return created_task;
end;
$$;


--
-- Name: register_manual_episode_narration(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_manual_episode_narration(p_episode_id uuid, p_material_revision_id uuid, p_storyboard_review_package_id uuid) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  current_episode public.episodes;
  selected_material public.production_material_revisions;
  selected_package public.review_packages;
  created_task public.tasks;
  created_artifact public.artifacts;
  total_duration numeric;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to register manual Episode narration' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual Episode narration can only be bound after storyboard approval' using errcode = '22023'; end if;
  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'Current approved storyboard package is required' using errcode = '22023'; end if;
  select material.* into selected_material
  from public.production_material_revisions material
  join public.material_revision_approvals approval on approval.material_revision_id = material.id
  where material.id = p_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'audio' and material.material_purpose = 'narration';
  if not found then raise exception 'Approved narration audio material is required' using errcode = '22023'; end if;
  select sum((shot ->> 'durationSeconds')::numeric) into total_duration
  from jsonb_array_elements(selected_package.context_snapshot #> '{worker_result,storyboard,shots}') shot
  where (shot ->> 'durationSeconds') ~ '^[0-9]+([.][0-9]+)?$' and (shot ->> 'durationSeconds')::numeric > 0;
  if total_duration is null or total_duration <= 0 then raise exception 'Approved storyboard narration duration is invalid' using errcode = '22023'; end if;
  update public.tasks task
  set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner replaced automatic narration with an immutable Episode manual upload.'
  where task.episode_id = p_episode_id and task.task_type = 'generate_narration' and task.status in ('ready', 'blocked', 'failed') and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text;
  if exists (select 1 from public.audio_tracks track where track.episode_id = p_episode_id and track.source_review_package_id = p_storyboard_review_package_id and track.track_kind = 'narration' and track.cue_id = p_episode_id::text) then raise exception 'This Episode already has frozen narration' using errcode = '22023'; end if;
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version, actual_cost_cents, completed_at, last_result)
  values (p_episode_id, 'generate_narration', 'completed', jsonb_build_object('capability', 'narration_manual_upload', 'storyboard_review_package_id', p_storyboard_review_package_id, 'configuration_hash', 'manual', 'audio_track', jsonb_build_object('kind', 'narration', 'cue_id', p_episode_id::text, 'source_review_package_id', p_storyboard_review_package_id, 'start_seconds', 0, 'duration_seconds', total_duration), 'manual_source', jsonb_build_object('material_revision_id', selected_material.id, 'source_kind', selected_material.source_kind), 'output', jsonb_build_object('required_artifact_types', jsonb_build_array('narration_audio'), 'content_type', selected_material.mime_type, 'relative_path', selected_material.storage_path, 'review_stage', 'production_ready'), 'input_artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'manual_audio_upload', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size))), 0, 1, 'manual_upload', 'owner-provided-audio', 'manual-episode-narration-v1', 0, now(), jsonb_build_object('version', 'manual-result/v1', 'status', 'completed', 'artifacts', jsonb_build_array(jsonb_build_object('artifactType', 'narration_audio', 'relativePath', selected_material.storage_path, 'sha256', selected_material.sha256, 'fileSize', selected_material.file_size)), 'validation', jsonb_build_object('passed', true, 'checks', jsonb_build_array()), 'actualCostCents', 0, 'blockers', jsonb_build_array(), 'retry', jsonb_build_object('shouldRetry', false, 'reason', 'Manual source is immutable.'), 'nextStep', 'Proceed after the remaining media is ready.')) returning * into created_task;
  insert into public.artifacts (episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id) values (p_episode_id, 'narration_audio', selected_material.storage_path, selected_material.sha256, selected_material.file_size, created_task.id) returning * into created_artifact;
  insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, source_material_revision_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds) values (p_episode_id, created_task.id, created_artifact.id, p_storyboard_review_package_id, selected_material.id, 'narration', p_episode_id::text, selected_material.storage_path, selected_material.sha256, selected_material.file_size, 0, total_duration);
  insert into public.production_dependencies (episode_id, upstream_kind, upstream_id, downstream_kind, downstream_id) values (p_episode_id, 'material_revision', selected_material.id, 'task', created_task.id) on conflict do nothing;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, p_episode_id, 'manual_episode_narration_registered', jsonb_build_object('task_id', created_task.id, 'material_revision_id', selected_material.id, 'storyboard_review_package_id', selected_package.id), auth.uid());
  return created_task;
end;
$_$;


--
-- Name: release_b_roll_task_lock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_b_roll_task_lock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.task_type = 'generate_b_roll' and old.status = 'running' and new.status <> 'running' then
    delete from public.asset_locks where resource_key = format('b-roll-task:%s', new.id);
  end if;
  return new;
end;
$$;


--
-- Name: rename_account(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rename_account(p_account_id uuid, p_account_name text) RETURNS public.accounts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  membership_role public.member_role;
  renamed_account public.accounts;
  previous_name text;
begin
  if char_length(trim(p_account_name)) = 0 then
    raise exception 'Account name is required' using errcode = '22023';
  end if;
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to rename an account' using errcode = '42501';
  end if;
  select name into previous_name from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Account does not exist' using errcode = 'P0002';
  end if;
  update public.accounts
  set name = trim(p_account_name)
  where id = p_account_id
  returning * into renamed_account;
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (p_account_id, 'account_renamed', jsonb_build_object('previous_name', previous_name, 'name', renamed_account.name), auth.uid());
  return renamed_account;
end;
$$;


--
-- Name: replace_manual_shot_media(uuid, uuid, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_manual_shot_media(p_episode_id uuid, p_material_revision_id uuid, p_shot_id text, p_storyboard_review_package_id uuid, p_kind text) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  created_task public.tasks;
  replaced_count integer;
  target_task_type text;
begin
  if p_kind not in ('a_roll', 'b_roll') then
    raise exception 'Manual shot media kind must be a_roll or b_roll' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to replace manual shot media' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual shot media can only be replaced before production advances' using errcode = '22023'; end if;

  target_task_type := case p_kind when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end;
  update public.tasks task
  set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner replaced the confirmed manual shot media before production advanced.'
  where task.episode_id = p_episode_id
    and task.task_type = target_task_type
    and task.status = 'completed'
    and task.provider = 'manual_upload'
    and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text
    and task.input_snapshot #>> '{shot,id}' = btrim(p_shot_id);
  get diagnostics replaced_count = row_count;
  if replaced_count = 0 then raise exception 'Confirmed manual shot media does not exist' using errcode = 'P0002'; end if;

  if p_kind = 'a_roll' then
    created_task := public.register_manual_a_roll(p_episode_id, p_material_revision_id, p_shot_id, p_storyboard_review_package_id);
  else
    created_task := public.register_manual_b_roll(p_episode_id, p_material_revision_id, p_shot_id, p_storyboard_review_package_id);
  end if;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'manual_shot_media_replaced', jsonb_build_object('kind', p_kind, 'material_revision_id', p_material_revision_id, 'shot_id', btrim(p_shot_id), 'storyboard_review_package_id', p_storyboard_review_package_id, 'task_id', created_task.id, 'replaced_task_count', replaced_count), auth.uid());
  return created_task;
end;
$$;


--
-- Name: report_worker_progress(uuid, integer, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_worker_progress(p_task_id uuid, p_attempt integer, p_lease_token uuid, p_progress jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
  if p_progress->>'version' is distinct from 'worker-progress/v1' or jsonb_typeof(p_progress->'progress') is distinct from 'object' then
    raise exception 'Worker progress is invalid' using errcode='22023'; end if;
  update public.tasks set last_result=p_progress where id=p_task_id;
  update public.task_runs set result=p_progress where task_id=p_task_id and attempt=p_attempt and lease_token=p_lease_token;
end $$;


--
-- Name: report_worker_result(uuid, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_worker_result(p_task_id uuid, p_attempt integer, p_result jsonb) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin raise exception 'Lease token is required; upgrade Worker' using errcode='42501'; end $$;


--
-- Name: report_worker_result(uuid, integer, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_worker_result(p_task_id uuid, p_attempt integer, p_result jsonb, p_lease_token uuid) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare reported public.tasks;
begin
  perform public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
  reported := public.report_worker_result_base(p_task_id,p_attempt,p_result);
  update public.tasks set lease_token=null where id=p_task_id returning * into reported;
  return reported;
end $$;


--
-- Name: report_worker_result_base(uuid, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_worker_result_base(p_task_id uuid, p_attempt integer, p_result jsonb) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  selected_task public.tasks;
  result_status public.task_status;
  actual_cost integer;
  should_retry boolean;
  artifact jsonb;
  validation_check jsonb;
  blocker jsonb;
  required_artifact_type text;
  normalized_path text;
begin
  if jsonb_typeof(p_result) <> 'object'
    or p_result ->> 'version' <> 'worker-result/v1'
    or p_result ->> 'taskId' <> p_task_id::text
    or jsonb_typeof(p_result -> 'status') <> 'string'
    or jsonb_typeof(p_result -> 'actualCostCents') <> 'number'
    or p_result ->> 'actualCostCents' !~ '^[0-9]+$'
    or jsonb_typeof(p_result -> 'retry') <> 'object'
    or jsonb_typeof(p_result -> 'retry' -> 'shouldRetry') <> 'boolean'
    or coalesce(btrim(p_result -> 'retry' ->> 'reason'), '') = ''
    or jsonb_typeof(p_result -> 'artifacts') <> 'array'
    or jsonb_typeof(p_result -> 'validation') <> 'object'
    or jsonb_typeof(p_result -> 'validation' -> 'passed') <> 'boolean'
    or jsonb_typeof(p_result -> 'validation' -> 'checks') <> 'array'
    or jsonb_typeof(p_result -> 'blockers') <> 'array'
    or jsonb_typeof(p_result -> 'nextStep') <> 'string'
    or coalesce(btrim(p_result ->> 'nextStep'), '') = '' then
    raise exception 'Worker result has an invalid schema' using errcode = '22023';
  end if;
  if p_result ->> 'status' not in ('completed', 'blocked', 'failed') then
    raise exception 'Worker result status is invalid' using errcode = '22023';
  end if;

  for validation_check in select value from jsonb_array_elements(p_result -> 'validation' -> 'checks') loop
    if jsonb_typeof(validation_check) <> 'object'
      or jsonb_typeof(validation_check -> 'name') <> 'string'
      or coalesce(btrim(validation_check ->> 'name'), '') = ''
      or jsonb_typeof(validation_check -> 'passed') <> 'boolean'
      or jsonb_typeof(validation_check -> 'detail') <> 'string'
      or coalesce(btrim(validation_check ->> 'detail'), '') = '' then
      raise exception 'Worker validation check has an invalid schema' using errcode = '22023';
    end if;
  end loop;

  for blocker in select value from jsonb_array_elements(p_result -> 'blockers') loop
    if jsonb_typeof(blocker) <> 'object'
      or jsonb_typeof(blocker -> 'code') <> 'string'
      or coalesce(btrim(blocker ->> 'code'), '') = ''
      or jsonb_typeof(blocker -> 'detail') <> 'string'
      or coalesce(btrim(blocker ->> 'detail'), '') = '' then
      raise exception 'Worker blocker has an invalid schema' using errcode = '22023';
    end if;
  end loop;

  for artifact in select value from jsonb_array_elements(p_result -> 'artifacts') loop
    normalized_path := replace(artifact ->> 'relativePath', E'\\', '/');
    if jsonb_typeof(artifact) <> 'object'
      or jsonb_typeof(artifact -> 'artifactType') <> 'string'
      or coalesce(btrim(artifact ->> 'artifactType'), '') = ''
      or jsonb_typeof(artifact -> 'relativePath') <> 'string'
      or normalized_path = ''
      or normalized_path ~ '(^/|^[A-Za-z]:/|(^|/)([.]|[.][.])(/|$)|//|/$)'
      or jsonb_typeof(artifact -> 'sha256') <> 'string'
      or artifact ->> 'sha256' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(artifact -> 'fileSize') <> 'number'
      or artifact ->> 'fileSize' !~ '^[0-9]+$' then
      raise exception 'Worker artifact has an invalid schema' using errcode = '22023';
    end if;
  end loop;

  result_status := (p_result ->> 'status')::public.task_status;
  actual_cost := (p_result ->> 'actualCostCents')::integer;
  should_retry := (p_result -> 'retry' ->> 'shouldRetry')::boolean;

  select * into selected_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task % does not exist', p_task_id using errcode = 'P0002';
  end if;
  if selected_task.status <> 'running' or selected_task.attempt <> p_attempt + 1 then
    raise exception 'Task is not running for this attempt' using errcode = '42501';
  end if;
  if selected_task.claimed_at < now() - interval '30 minutes' then
    raise exception 'Worker lease has expired' using errcode = '42501';
  end if;
  if not exists (select 1 from public.task_runs where task_id = p_task_id and attempt = p_attempt and status = 'running' for update) then
    raise exception 'Task run does not exist or is already reported' using errcode = '42501';
  end if;

  if result_status = 'completed' and ((p_result -> 'validation' ->> 'passed')::boolean is not true or jsonb_array_length(p_result -> 'artifacts') = 0 or jsonb_array_length(p_result -> 'blockers') > 0) then
    raise exception 'Completed worker result must contain validated artifacts without blockers' using errcode = '22023';
  end if;
  if result_status = 'blocked' and jsonb_array_length(p_result -> 'blockers') = 0 then
    raise exception 'Blocked worker result must include blockers' using errcode = '22023';
  end if;
  if result_status in ('completed', 'blocked') and should_retry then
    raise exception 'Completed or blocked worker result cannot request a retry' using errcode = '22023';
  end if;
  if result_status = 'failed' and should_retry and selected_task.attempt >= selected_task.max_attempts then
    raise exception 'Failed worker result cannot retry after the maximum attempts' using errcode = '22023';
  end if;

  if result_status = 'completed' then
    if jsonb_typeof(selected_task.input_snapshot #> '{output,required_artifact_types}') <> 'array'
      or jsonb_array_length(selected_task.input_snapshot #> '{output,required_artifact_types}') = 0 then
      raise exception 'Task has an invalid output artifact schema' using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(selected_task.input_snapshot #> '{output,required_artifact_types}') required_artifact
      where jsonb_typeof(required_artifact) <> 'string'
        or coalesce(btrim(required_artifact #>> '{}'), '') = ''
    ) then
      raise exception 'Task has an invalid output artifact schema' using errcode = '22023';
    end if;
    for required_artifact_type in select value #>> '{}' from jsonb_array_elements(selected_task.input_snapshot #> '{output,required_artifact_types}') loop
      if coalesce(btrim(required_artifact_type), '') = '' then
        raise exception 'Task has an invalid output artifact schema' using errcode = '22023';
      end if;
      if not exists (
        select 1
        from jsonb_array_elements(p_result -> 'artifacts') result_artifact
        where result_artifact ->> 'artifactType' = required_artifact_type
      ) then
        raise exception 'Completed worker result is missing required artifact type %', required_artifact_type using errcode = '22023';
      end if;
    end loop;

    insert into public.artifacts (episode_id, artifact_type, relative_path, sha256, file_size, producer_task_id)
    select
      selected_task.episode_id,
      result_artifact ->> 'artifactType',
      result_artifact ->> 'relativePath',
      result_artifact ->> 'sha256',
      (result_artifact ->> 'fileSize')::bigint,
      selected_task.id
    from jsonb_array_elements(p_result -> 'artifacts') result_artifact;
  end if;

  update public.task_runs
  set result = p_result,
      status = result_status,
      actual_cost_cents = actual_cost,
      completed_at = now()
  where task_id = p_task_id and attempt = p_attempt;

  update public.tasks
  set status = case when result_status = 'failed' and should_retry then 'ready'::public.task_status else result_status end,
      claimed_at = case when result_status = 'failed' and should_retry then null else claimed_at end,
      completed_at = case when result_status = 'failed' and should_retry then null else now() end,
      actual_cost_cents = actual_cost,
      last_result = p_result
  where id = p_task_id
  returning * into selected_task;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  select
    episode.account_id,
    episode.id,
    'worker_result_reported',
    jsonb_build_object('task_id', p_task_id, 'attempt', p_attempt, 'status', result_status, 'actual_cost_cents', actual_cost),
    null
  from public.episodes episode
  where episode.id = selected_task.episode_id;

  return selected_task;
end;
$_$;


--
-- Name: request_qc_member_revision(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_qc_member_revision(p_issue_id uuid) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: request_review_render_revision(uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_review_render_revision(p_review_package_id uuid, p_composition jsonb, p_reason text) RETURNS public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  selected_package public.review_packages;
  selected_episode public.episodes;
  next_revision integer;
  previous_stage public.episode_stage;
  width integer;
  height integer;
  canonical_composition jsonb;
begin
  if p_composition ? 'studio_project' and (
    jsonb_typeof(p_composition -> 'studio_project') is distinct from 'object'
    or jsonb_typeof(p_composition -> 'studio_project' -> 'composition') is distinct from 'object'
  ) then
    raise exception 'Invalid frozen Studio composition' using errcode = '22023';
  end if;
  canonical_composition := case when p_composition ? 'studio_project'
    then (p_composition -> 'studio_project' -> 'composition') || jsonb_build_object('studio_project', (p_composition -> 'studio_project') - 'composition')
    else p_composition
  end;

  if btrim(coalesce(p_reason, '')) = ''
    or canonical_composition is null
    or jsonb_typeof(canonical_composition) <> 'object'
    or exists (select 1 from jsonb_object_keys(canonical_composition) key where key not in ('aspect_ratio', 'width', 'height', 'captions_enabled', 'caption_style', 'crop', 'pacing', 'transition', 'layout', 'narration_gain_db', 'bgm_gain_db', 'sfx_gain_db', 'studio_project', 'frame_rate', 'allowed_frames'))
    or canonical_composition ->> 'aspect_ratio' not in ('9:16', '16:9', '1:1')
    or jsonb_typeof(canonical_composition -> 'width') <> 'number'
    or jsonb_typeof(canonical_composition -> 'height') <> 'number'
    or jsonb_typeof(canonical_composition -> 'captions_enabled') <> 'boolean'
    or canonical_composition ->> 'caption_style' not in ('cinematic', 'minimal')
    or canonical_composition ->> 'crop' not in ('cover', 'contain')
    or canonical_composition ->> 'pacing' not in ('gentle', 'standard', 'compact')
    or canonical_composition ->> 'transition' not in ('fade', 'cut')
    or canonical_composition ->> 'layout' not in ('lower_third', 'center')
    or jsonb_typeof(canonical_composition -> 'narration_gain_db') <> 'number'
    or jsonb_typeof(canonical_composition -> 'bgm_gain_db') <> 'number'
    or jsonb_typeof(canonical_composition -> 'sfx_gain_db') <> 'number'
    or jsonb_typeof(canonical_composition -> 'frame_rate') <> 'number'
    or (canonical_composition ->> 'frame_rate')::numeric <= 0
    or jsonb_typeof(canonical_composition -> 'allowed_frames') <> 'number'
    or (canonical_composition ->> 'allowed_frames')::numeric < 0
    or (canonical_composition ->> 'allowed_frames')::numeric <> trunc((canonical_composition ->> 'allowed_frames')::numeric)
    or (canonical_composition ? 'studio_project' and (
      jsonb_typeof(canonical_composition -> 'studio_project') <> 'object'
      or exists (select 1 from jsonb_object_keys(canonical_composition -> 'studio_project') key where key not in ('relative_path', 'sha256', 'file_size'))
      or jsonb_typeof(canonical_composition -> 'studio_project' -> 'relative_path') <> 'string'
      or jsonb_typeof(canonical_composition -> 'studio_project' -> 'sha256') <> 'string'
      or jsonb_typeof(canonical_composition -> 'studio_project' -> 'file_size') <> 'number'
    )) then
    raise exception 'Invalid review render composition adjustment' using errcode = '22023';
  end if;

  width := (canonical_composition ->> 'width')::integer;
  height := (canonical_composition ->> 'height')::integer;
  if width < 1
    or height < 1
    or (canonical_composition ->> 'aspect_ratio' = '9:16' and width * 16 <> height * 9)
    or (canonical_composition ->> 'aspect_ratio' = '16:9' and width * 9 <> height * 16)
    or (canonical_composition ->> 'aspect_ratio' = '1:1' and width <> height) then
    raise exception 'Invalid review render composition dimensions' using errcode = '22023';
  end if;

  select * into selected_package from public.current_openchatcut_review_package(p_review_package_id, true);
  select * into selected_episode from public.episodes where id = selected_package.episode_id;
  if (canonical_composition ->> 'frame_rate')::numeric <> (public.shot_duration_settings(selected_episode.id) ->> 'frame_rate')::numeric
    or (canonical_composition ->> 'allowed_frames')::integer <> (public.shot_duration_settings(selected_episode.id) ->> 'allowed_frames')::integer then
    raise exception 'Studio duration settings must match the frozen shot duration settings' using errcode = '22023';
  end if;
  if canonical_composition ? 'studio_project' and (
    canonical_composition #>> '{studio_project,relative_path}' !~ format('^episodes/%s/(studio-frozen/[0-9a-f-]{36}/index[.]html|openchatcut-frozen/[0-9a-f-]{36}/project[.]json)$', selected_episode.id::text)
    or canonical_composition #>> '{studio_project,sha256}' !~ '^[0-9a-f]{64}$'
    or (canonical_composition #>> '{studio_project,file_size}')::bigint < 1
  ) then
    raise exception 'Invalid frozen Studio project' using errcode = '22023';
  end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.review_render_composition_revisions
  where pre_render_review_package_id = (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid;
  insert into public.review_render_composition_revisions (
    episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, created_by, composition_config
  ) values (
    selected_episode.id, (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid, next_revision,
    canonical_composition ->> 'caption_style', canonical_composition ->> 'pacing', canonical_composition ->> 'crop', canonical_composition ->> 'transition',
    canonical_composition ->> 'layout', btrim(p_reason), auth.uid(), canonical_composition
  );
  previous_stage := selected_episode.stage;
  update public.episodes set stage = 'render_ready', updated_at = now()
  where id = selected_episode.id returning * into selected_episode;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (selected_episode.id, previous_stage, 'render_ready', btrim(p_reason), auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    selected_episode.account_id, selected_episode.id, 'review_render_composition_requested',
    jsonb_build_object('review_package_id', selected_package.id, 'revision_number', next_revision), auth.uid()
  );
  return selected_episode;
end;
$_$;


--
-- Name: request_shot_acoustic_alignment(uuid, uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_shot_acoustic_alignment(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_local_only boolean DEFAULT false) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare draft public.shot_preparation_drafts; track public.audio_tracks; episode public.episodes; created_task public.tasks; text_fingerprint text; input_version text;
begin
  select * into episode from public.episodes where id = p_episode_id and public.is_account_member(account_id) for update;
  if not found then raise exception 'Episode is not accessible' using errcode='42501'; end if;
  select * into draft from public.shot_preparation_drafts where episode_id=p_episode_id and review_package_id=p_review_package_id and shot_id=p_shot_id for update;
  if not found or not draft.subtitles_enabled or btrim(draft.subtitle_text)='' then raise exception '当前镜头没有可对齐的已确认字幕' using errcode='22023'; end if;
  select * into track from public.audio_tracks where id=draft.current_audio_track_id and episode_id=p_episode_id;
  if not found then raise exception '当前镜头没有可复用的成功音轨' using errcode='22023'; end if;
  text_fingerprint := encode(extensions.digest(convert_to(draft.subtitle_text,'UTF8'),'sha256'),'hex');
  input_version := encode(extensions.digest(convert_to(jsonb_build_object('audioSha256',track.sha256,'textFingerprint',text_fingerprint,'voice',coalesce(draft.tts_voice,''),'speakingRate',coalesce(draft.tts_speaking_rate,1),'provider','whisperx','model','large-v3','connectionVersionId',null)::text,'UTF8'),'sha256'),'hex');
  select task.* into created_task from public.tasks task where task.episode_id=p_episode_id and task.task_type='align_shot_captions' and task.input_snapshot #>> '{shot_preparation,draft_id}'=draft.id::text and task.input_snapshot #>> '{acoustic_alignment,input_version}'=input_version and task.status in ('ready','running') order by task.created_at desc limit 1;
  if found then return created_task; end if;
  insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version)
  values (p_episode_id,'align_shot_captions','ready',jsonb_build_object(
    'capability','acoustic_alignment','shot_preparation',jsonb_build_object('draft_id',draft.id,'review_package_id',p_review_package_id,'shot_id',p_shot_id),
    'executor',jsonb_build_object('provider','whisperx','adapter','whisperx_local','model','large-v3','prompt_version','whisperx-alignment-v1'),
    'acoustic_alignment',jsonb_build_object('confirmed_text',draft.subtitle_text,'text_fingerprint',text_fingerprint,'audio_relative_path',track.relative_path,'audio_sha256',track.sha256,'input_version',input_version,'voice',coalesce(draft.tts_voice,''),'speaking_rate',coalesce(draft.tts_speaking_rate,1),'strategy',case when p_local_only then 'local' else 'auto' end),
    'input_artifacts',jsonb_build_array(jsonb_build_object('artifactType','audio_track','relativePath',track.relative_path,'sha256',track.sha256,'fileSize',track.file_size)),
    'output',jsonb_build_object('required_artifact_types',jsonb_build_array('acoustic_alignment_evidence'),'content_type','application/json','relative_path',format('episodes/%s/alignment/%s-%s.json',p_episode_id,p_shot_id,input_version),'review_stage','production_ready'),
    'allowed_tools',jsonb_build_array('read','write')
  ),0,2,'whisperx','large-v3','whisperx-alignment-v1') returning * into created_task;
  update public.shot_preparation_drafts set pending_alignment_task_id=created_task.id, acoustic_alignment=coalesce(acoustic_alignment,jsonb_build_object('version','acoustic-alignment/v1','method','none','granularity','none','inputVersion',input_version,'audioSha256',track.sha256,'textFingerprint',text_fingerprint,'provider','whisperx','model','large-v3','connectionVersionId',null,'wordCount',0,'cues','[]'::jsonb,'reviewIssues','[]'::jsonb,'attempts','[]'::jsonb)) || jsonb_build_object('status','waiting','detail','本地 WhisperX 对齐任务等待 Worker。','generatedAt',now()) where id=draft.id;
  insert into public.audit_events(account_id,episode_id,event_type,payload,actor_id) values(episode.account_id,p_episode_id,'shot_acoustic_alignment_requested',jsonb_build_object('task_id',created_task.id,'shot_id',p_shot_id,'local_only',p_local_only),auth.uid());
  return created_task;
end;
$$;


--
-- Name: request_shot_structure_revision(uuid, uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_shot_structure_revision(p_episode_id uuid, p_review_package_id uuid, p_operation jsonb, p_reason text) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  base_task public.tasks;
  created_task public.tasks;
  storyboard jsonb;
  shots jsonb;
  operation jsonb := p_operation;
  operation_kind text := btrim(coalesce(p_operation ->> 'kind', ''));
  request_hash text;
  shot jsonb;
  other_shot jsonb;
  indexes integer[];
  index_value integer;
  expected_duration numeric;
  part jsonb;
begin
  if btrim(coalesce(p_reason, '')) = '' or jsonb_typeof(p_operation) <> 'object' then
    raise exception 'Storyboard structure revision reason and operation are required' using errcode = '22023';
  end if;
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
    and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
  if not found then raise exception 'Owner membership is required for storyboard structure revision' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Storyboard structure revision requires an approved storyboard' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id
    and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review' and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;
  if selected_package.revision_number <> (select max(revision_number) from public.review_packages where episode_id = p_episode_id and stage = 'storyboard_review' and invalidated_at is null) then
    raise exception 'The storyboard review package is stale' using errcode = '22023';
  end if;
  select task.* into base_task from public.tasks task where task.id = selected_package.task_id and task.episode_id = p_episode_id;
  if not found then raise exception 'The approved storyboard task is required' using errcode = '22023'; end if;
  request_hash := md5(jsonb_build_object('review_package_id', p_review_package_id, 'operation', public.canonical_storyboard_structure_revision_operation(p_operation), 'reason', btrim(p_reason))::text);
  select task.* into created_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = 'draft_storyboard_revision'
    and task.input_snapshot ->> 'structure_revision_hash' = request_hash
  order by task.created_at desc limit 1;
  if found then return created_task; end if;
  if exists (
    select 1 from public.tasks task
    where task.episode_id = p_episode_id
      and task.task_type = 'draft_storyboard_revision'
      and task.status in ('ready', 'running')
  ) then
    raise exception 'A storyboard structure revision is already running' using errcode = '22023';
  end if;

  storyboard := selected_package.context_snapshot #> '{worker_result,storyboard}';
  shots := storyboard -> 'shots';
  if jsonb_typeof(shots) <> 'array' or jsonb_array_length(shots) = 0 then raise exception 'The approved storyboard has no shots' using errcode = '22023'; end if;
  if operation_kind = 'add_after' then
    select value into shot from jsonb_array_elements(shots) where value ->> 'id' = p_operation ->> 'afterShotId';
    if not found or jsonb_typeof(p_operation -> 'shot') <> 'object' then raise exception 'Add-after target is invalid' using errcode = '22023'; end if;
    if btrim(coalesce(p_operation #>> '{shot,scriptSegment}', '')) = '' or coalesce((p_operation #>> '{shot,durationSeconds}')::numeric, 0) <= 0 then raise exception 'Added shot is invalid' using errcode = '22023'; end if;
    operation := p_operation || jsonb_build_object('shot', (p_operation -> 'shot') || jsonb_build_object('id', 'shot-' || substr(md5(request_hash || ':add'), 1, 24), 'inputBasis', shot -> 'inputBasis'));
  elsif operation_kind = 'delete' then
    if jsonb_array_length(shots) = 1 or not exists (select 1 from jsonb_array_elements(shots) value where value ->> 'id' = p_operation ->> 'shotId') then raise exception 'Delete target is invalid' using errcode = '22023'; end if;
  elsif operation_kind = 'split' then
    select value into shot from jsonb_array_elements(shots) where value ->> 'id' = p_operation ->> 'shotId';
    if not found or jsonb_typeof(p_operation -> 'parts') <> 'array' or jsonb_array_length(p_operation -> 'parts') < 2 then raise exception 'Split operation is invalid' using errcode = '22023'; end if;
    expected_duration := 0;
    for part in select value from jsonb_array_elements(p_operation -> 'parts') loop
      if btrim(coalesce(part ->> 'scriptSegment', '')) = '' or coalesce((part ->> 'durationSeconds')::numeric, 0) <= 0 then raise exception 'Split part is invalid' using errcode = '22023'; end if;
      expected_duration := expected_duration + (part ->> 'durationSeconds')::numeric;
    end loop;
    if abs(expected_duration - (shot ->> 'durationSeconds')::numeric) > 0.05 then raise exception 'Split duration must equal source duration' using errcode = '22023'; end if;
    operation := p_operation || jsonb_build_object('parts', (select jsonb_agg(value || jsonb_build_object('id', 'shot-' || substr(md5(request_hash || ':split:' || ordinality::text), 1, 24)) order by ordinality) from jsonb_array_elements(p_operation -> 'parts') with ordinality as part(value, ordinality)));
  elsif operation_kind = 'merge' then
    if jsonb_typeof(p_operation -> 'shotIds') <> 'array' or jsonb_array_length(p_operation -> 'shotIds') < 2 or (select count(distinct value) from jsonb_array_elements_text(p_operation -> 'shotIds')) <> jsonb_array_length(p_operation -> 'shotIds') then raise exception 'Merge operation is invalid' using errcode = '22023'; end if;
    indexes := array[]::integer[];
    for other_shot in select value from jsonb_array_elements(shots) with ordinality as rows(value, ordinality) where value ->> 'id' in (select jsonb_array_elements_text(p_operation -> 'shotIds')) loop
      indexes := indexes || (select ordinality::integer from jsonb_array_elements(shots) with ordinality as rows(value, ordinality) where value ->> 'id' = other_shot ->> 'id');
    end loop;
    if coalesce(array_length(indexes, 1), 0) <> jsonb_array_length(p_operation -> 'shotIds') or (select max(value) - min(value) + 1 from unnest(indexes) value) <> array_length(indexes, 1) or exists (select 1 from unnest(indexes) with ordinality selected(index_value, position) where index_value <> indexes[1] + position - 1) then raise exception 'Only adjacent shots in storyboard order can be merged' using errcode = '22023'; end if;
    operation := p_operation || jsonb_build_object('newShotId', 'shot-' || substr(md5(request_hash || ':merge'), 1, 24));
  elsif operation_kind = 'reorder' then
    if jsonb_typeof(p_operation -> 'shotIds') <> 'array' or jsonb_array_length(p_operation -> 'shotIds') <> jsonb_array_length(shots) or (select count(distinct value) from jsonb_array_elements_text(p_operation -> 'shotIds')) <> jsonb_array_length(shots) or exists (select 1 from jsonb_array_elements_text(p_operation -> 'shotIds') id where not exists (select 1 from jsonb_array_elements(shots) value where value ->> 'id' = id)) then raise exception 'Reorder operation must contain every shot once' using errcode = '22023'; end if;
  elsif operation_kind = 'change_type' then
    if p_operation ->> 'shotType' not in ('a_roll', 'b_roll') or not exists (select 1 from jsonb_array_elements(shots) value where value ->> 'id' = p_operation ->> 'shotId') then raise exception 'Shot type operation is invalid' using errcode = '22023'; end if;
  elsif operation_kind = 'change_duration' then
    if coalesce((p_operation ->> 'durationSeconds')::numeric, 0) <= 0 or not exists (select 1 from jsonb_array_elements(shots) value where value ->> 'id' = p_operation ->> 'shotId') then raise exception 'Shot duration operation is invalid' using errcode = '22023'; end if;
  else raise exception 'Unsupported storyboard structure operation' using errcode = '22023'; end if;

  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (
    p_episode_id, 'draft_storyboard_revision', 'ready',
    base_task.input_snapshot || jsonb_build_object(
      'structure_revision_hash', request_hash,
      'storyboard_revision', jsonb_build_object('version', 'storyboard-revision/v1', 'base_review_package_id', p_review_package_id, 'input_fingerprint', md5(storyboard::text), 'operation', operation, 'storyboard', storyboard),
      'output', jsonb_build_object('required_artifact_types', jsonb_build_array('storyboard'), 'content_type', 'application/json', 'relative_path', format('episodes/%s/storyboard-revision-%s.json', p_episode_id, coalesce((select max(revision_number) + 1 from public.review_packages where episode_id = p_episode_id and stage = 'storyboard_review'), 1)), 'review_stage', 'storyboard_review')
    ),
    base_task.budget_limit_cents, 1, 'codex', base_task.model, 'storyboard-revision-v1'
  ) returning * into created_task;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'storyboard_structure_revision_requested', jsonb_build_object('task_id', created_task.id, 'review_package_id', p_review_package_id, 'input_fingerprint', md5(storyboard::text), 'structure_revision_hash', request_hash, 'operation', operation), auth.uid());
  return created_task;
end;
$$;


--
-- Name: request_studio_storyboard_revision(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_studio_storyboard_revision(p_review_package_id uuid, p_reason text) RETURNS public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  selected_qc_package public.review_packages;
  selected_pre_render_package public.review_packages;
  selected_storyboard_package public.review_packages;
  selected_episode public.episodes;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Studio structural revision reason is required' using errcode = '22023'; end if;
  select * into selected_qc_package from public.current_openchatcut_review_package(p_review_package_id, false);
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
  update public.review_packages set invalidated_at = now(), invalidated_reason = 'Studio structural revision requested' where id = selected_qc_package.id; update public.review_packages set invalidated_at = now(), invalidated_reason = 'Studio structural revision requested' where id = selected_pre_render_package.id;
  update public.episodes set stage = 'visual_approved', updated_at = now() where id = selected_episode.id returning * into selected_episode;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (selected_episode.id, 'qc_review', 'visual_approved', btrim(p_reason), auth.uid());
  perform public.orchestrate_storyboard_tasks_for_episode(selected_episode.id);
  select * into selected_episode from public.episodes where id = selected_episode.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (selected_episode.account_id, selected_episode.id, 'studio_storyboard_revision_requested', jsonb_build_object('qc_review_package_id', selected_qc_package.id, 'storyboard_review_package_id', selected_storyboard_package.id), auth.uid());
  return selected_episode;
end;
$$;


--
-- Name: require_production_asset_root(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.require_production_asset_root() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.stage = 'production_ready'::public.episode_stage and old.stage is distinct from new.stage
    and not exists (
      select 1
      from public.account_blueprint_versions blueprint
      where blueprint.id = new.blueprint_version_id
        and btrim(coalesce(blueprint.policy ->> 'asset_root', '')) <> ''
    ) then
    raise exception 'Production readiness requires an asset root' using errcode = '22023';
  end if;
  return new;
end;
$$;


--
-- Name: reset_shot_preparation_confirmation_after_input_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_shot_preparation_confirmation_after_input_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if old.confirmation_status in ('confirmed', 'skipped') and (
    old.selected_material_revision_id is distinct from new.selected_material_revision_id
    or old.clip_start_seconds is distinct from new.clip_start_seconds
    or old.clip_end_seconds is distinct from new.clip_end_seconds
    or old.current_video_artifact_id is distinct from new.current_video_artifact_id
    or old.current_video_task_id is distinct from new.current_video_task_id
    or old.audio_mode is distinct from new.audio_mode
    or old.current_audio_track_id is distinct from new.current_audio_track_id
    or old.current_tts_task_id is distinct from new.current_tts_task_id
    or old.tts_text is distinct from new.tts_text
    or old.tts_voice is distinct from new.tts_voice
    or old.tts_speaking_rate is distinct from new.tts_speaking_rate
    or old.subtitle_text is distinct from new.subtitle_text
    or old.subtitles_enabled is distinct from new.subtitles_enabled
  ) then
    new.confirmation_status := 'pending';
    new.warning_decision := 'not_required';
    new.warning_reason := null;
    new.warning_accepted_at := null;
    new.warning_accepted_by := null;
    new.confirmation_reason := null;
    new.confirmed_at := null;
    new.confirmed_by := null;
    new.skipped_at := null;
    new.skipped_by := null;
  end if;
  return new;
end;
$$;


--
-- Name: reset_shot_tts_confirmation_after_text_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_shot_tts_confirmation_after_text_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if old.tts_text is distinct from new.tts_text or old.audio_mode is distinct from new.audio_mode then
    new.tts_text_confirmation_fingerprint := null;
    new.tts_text_confirmed_at := null;
    new.tts_text_confirmed_by := null;
  end if;
  return new;
end;
$$;


--
-- Name: resolve_external_connection_secret(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_external_connection_secret(p_connection_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare resolved_secret text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Worker service role is required to resolve a connection secret' using errcode = '42501'; end if;
  select secret.decrypted_secret into resolved_secret
  from public.external_connection_versions version
  join vault.decrypted_secrets secret on secret.id = version.vault_secret_id
  where version.id = p_connection_id and version.revoked_at is null;
  return resolved_secret;
end;
$$;


--
-- Name: resolve_external_connection_secret(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_external_connection_secret(p_connection_id uuid, p_account_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare resolved_secret text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Worker service role is required to resolve a connection secret' using errcode = '42501'; end if;
  select secret.decrypted_secret into resolved_secret
  from public.external_connection_versions version
  join public.external_connections connection on connection.id = version.connection_id
  join vault.decrypted_secrets secret on secret.id = version.vault_secret_id
  where version.id = p_connection_id and version.revoked_at is null
    and connection.current_version_id = version.id
    and public.connection_version_is_verified(version.id)
    and exists (select 1 from public.account_memberships membership where membership.account_id = p_account_id and membership.user_id = connection.created_by and membership.role = 'owner');
  if resolved_secret is null then raise exception 'External connection is not owned by the task account' using errcode = '42501'; end if;
  return resolved_secret;
end;
$$;


--
-- Name: resolve_qc_review_issue(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_qc_review_issue(p_issue_id uuid, p_status text) RETURNS public.qc_review_issues
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: restore_completed_shot_tts_track(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_completed_shot_tts_track(p_draft_id uuid, p_task_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  draft public.shot_preparation_drafts;
  track public.audio_tracks;
begin
  select * into draft
  from public.shot_preparation_drafts
  where id = p_draft_id
  for update;

  if not found or draft.audio_mode <> 'tts' then return false; end if;

  select * into track
  from public.audio_tracks candidate
  where candidate.episode_id = draft.episode_id
    and candidate.source_review_package_id = draft.review_package_id
    and candidate.cue_id = draft.shot_id
    and candidate.track_kind = 'narration'
    and candidate.source_task_id = p_task_id
  order by candidate.created_at desc
  limit 1;

  if not found then return false; end if;

  update public.shot_preparation_drafts
  set current_audio_track_id = track.id,
      current_tts_task_id = p_task_id,
      pending_tts_task_id = null,
      tts_actual_duration_seconds = track.duration_seconds,
      audio_status = 'ready',
      tts_error = null,
      updated_at = now()
  where id = draft.id;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  select episode.account_id, draft.episode_id, 'shot_tts_completed_track_reused',
    jsonb_build_object('task_id', p_task_id, 'audio_track_id', track.id, 'review_package_id', draft.review_package_id, 'shot_id', draft.shot_id),
    auth.uid()
  from public.episodes episode
  where episode.id = draft.episode_id;

  return true;
end;
$$;


--
-- Name: retry_failed_final_render(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retry_failed_final_render(p_episode_id uuid, p_reason text) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  selected_episode public.episodes;
  selected_task public.tasks;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Retry reason is required' using errcode = '22023';
  end if;

  select episode.* into selected_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id
    and membership.user_id = auth.uid()
    and membership.role = 'owner'
  for update of episode;
  if not found then
    raise exception 'Owner membership is required to retry final rendering' using errcode = '42501';
  end if;
  if selected_episode.stage <> 'qc_passed' then
    raise exception 'Only qc-passed episodes can retry final rendering' using errcode = '22023';
  end if;

  select task.* into selected_task
  from public.tasks task
  join public.review_packages package on package.id::text = task.input_snapshot #>> '{final_render,source_review_package_id}'
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'qc_passed' and approval.decision = 'approved'
  where task.episode_id = selected_episode.id
    and task.task_type = 'generate_final_render'
    and package.invalidated_at is null
  order by task.created_at desc
  limit 1
  for update of task;
  if not found or selected_task.status <> 'failed' then
    raise exception 'The current final render has not failed' using errcode = '22023';
  end if;

  update public.tasks
  set status = 'ready',
      max_attempts = selected_task.attempt + 1,
      claimed_at = null,
      completed_at = null
  where id = selected_task.id
  returning * into selected_task;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    selected_episode.account_id,
    selected_episode.id,
    'final_render_retry_requested',
    jsonb_build_object('task_id', selected_task.id, 'attempt', selected_task.attempt, 'reason', btrim(p_reason)),
    auth.uid()
  );
  return selected_task;
end;
$$;


--
-- Name: reuse_shot_preparation_history_after_storyboard_approval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reuse_shot_preparation_history_after_storyboard_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  package_record public.review_packages;
  episode_record public.episodes;
  shot jsonb;
  previous public.shot_preparation_drafts;
  old_track public.audio_tracks;
  reusable_video boolean;
  reusable_audio boolean;
  new_track public.audio_tracks;
  operation_kind text;
  operation_shot_id text;
  preserve_duration_inputs boolean;
  preserve_type_inputs boolean;
begin
  if new.stage <> 'storyboard_approved' or new.decision <> 'approved' or new.review_package_id is null then return new; end if;

  select episode.* into episode_record from public.episodes episode where episode.id = new.episode_id;
  select package.* into package_record
  from public.review_packages package
  where package.id = new.review_package_id
    and package.episode_id = new.episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null;
  if not found or episode_record.stage <> 'storyboard_approved' then return new; end if;

  operation_kind := coalesce(package_record.context_snapshot #>> '{storyboard_revision,operation,kind}', '');
  operation_shot_id := nullif(btrim(package_record.context_snapshot #>> '{storyboard_revision,operation,shotId}'), '');

  for shot in select value from jsonb_array_elements(coalesce(package_record.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    preserve_duration_inputs := operation_kind = 'change_duration' and operation_shot_id = shot ->> 'id';
    preserve_type_inputs := operation_kind = 'change_type' and operation_shot_id = shot ->> 'id';

    select draft.* into previous
    from public.shot_preparation_drafts draft
    where draft.episode_id = episode_record.id
      and draft.shot_id = shot ->> 'id'
      and draft.review_package_id <> package_record.id
      and (
        draft.input_fingerprint = md5(shot::text)
        or preserve_duration_inputs
        or preserve_type_inputs
      )
    order by (draft.input_fingerprint = md5(shot::text)) desc, draft.updated_at desc, draft.id desc
    limit 1;
    if not found then continue; end if;

    reusable_video := not preserve_type_inputs
      and previous.current_video_artifact_id is not null
      and previous.current_video_task_id is not null
      and exists (
        select 1
        from public.artifacts artifact
        join public.tasks task on task.id = previous.current_video_task_id
        where artifact.id = previous.current_video_artifact_id
          and artifact.producer_task_id = task.id
          and artifact.episode_id = episode_record.id
          and task.episode_id = episode_record.id
          and task.status = 'completed'
          and task.invalidated_at is null
      );

    select track.* into old_track
    from public.audio_tracks track
    join public.tasks task on task.id = track.source_task_id
    join public.artifacts artifact on artifact.id = track.source_artifact_id
    where (not preserve_type_inputs or previous.audio_mode = 'tts')
      and track.id = previous.current_audio_track_id
      and track.episode_id = episode_record.id
      and track.cue_id = previous.shot_id
      and task.status = 'completed'
      and task.invalidated_at is null
      and artifact.episode_id = episode_record.id
      and artifact.sha256 = track.sha256
      and artifact.file_size = track.file_size;
    reusable_audio := found;

    if reusable_audio then
      insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds)
      select episode_record.id, old_track.source_task_id, old_track.source_artifact_id, package_record.id, old_track.track_kind, old_track.cue_id, old_track.relative_path, old_track.sha256, old_track.file_size, old_track.start_seconds, old_track.duration_seconds
      where not exists (
        select 1 from public.audio_tracks existing
        where existing.episode_id = episode_record.id
          and existing.source_review_package_id = package_record.id
          and existing.track_kind = old_track.track_kind
          and existing.cue_id = old_track.cue_id
          and existing.source_task_id = old_track.source_task_id
          and existing.source_artifact_id = old_track.source_artifact_id
      );
      select track.* into new_track
      from public.audio_tracks track
      where track.episode_id = episode_record.id
        and track.source_review_package_id = package_record.id
        and track.source_task_id = old_track.source_task_id
        and track.cue_id = old_track.cue_id
      order by track.created_at desc, track.id desc
      limit 1;
    else
      new_track := null;
    end if;

    update public.shot_preparation_drafts draft
    set audio_mode = previous.audio_mode,
        video_status = case when reusable_video then 'ready' else 'pending' end,
        audio_status = case when previous.audio_mode = 'none' or reusable_audio then 'ready' else 'pending' end,
        confirmation_status = case when preserve_duration_inputs or preserve_type_inputs then 'pending' else previous.confirmation_status end,
        subtitle_text = previous.subtitle_text,
        subtitles_enabled = previous.subtitles_enabled,
        tts_voice = previous.tts_voice,
        tts_speaking_rate = previous.tts_speaking_rate,
        tts_text = previous.tts_text,
        tts_language_code = previous.tts_language_code,
        tts_override_voice = previous.tts_override_voice,
        tts_override_speaking_rate = previous.tts_override_speaking_rate,
        tts_text_confirmation_fingerprint = previous.tts_text_confirmation_fingerprint,
        tts_text_confirmed_at = previous.tts_text_confirmed_at,
        tts_text_confirmed_by = previous.tts_text_confirmed_by,
        selected_material_revision_id = case when preserve_type_inputs then null else previous.selected_material_revision_id end,
        clip_start_seconds = case when preserve_type_inputs then null else previous.clip_start_seconds end,
        clip_end_seconds = case when preserve_type_inputs then null else previous.clip_end_seconds end,
        clip_segments = case when preserve_type_inputs then '[]'::jsonb else previous.clip_segments end,
        video_duration_seconds = case when preserve_type_inputs then null else previous.video_duration_seconds end,
        current_video_artifact_id = case when reusable_video then previous.current_video_artifact_id else null end,
        current_video_task_id = case when reusable_video then previous.current_video_task_id else null end,
        current_audio_track_id = case when new_track.id is not null then new_track.id else null end,
        current_tts_task_id = case when previous.audio_mode = 'tts' and new_track.id is not null then new_track.source_task_id else null end,
        pending_video_task_id = null,
        pending_tts_task_id = null,
        pending_source_audio_task_id = null,
        video_error = null,
        tts_actual_duration_seconds = case when reusable_audio then previous.tts_actual_duration_seconds else null end,
        tts_error = case when reusable_audio then previous.tts_error else null end,
        source_audio_duration_seconds = case when reusable_audio then previous.source_audio_duration_seconds else null end,
        source_audio_error = case when reusable_audio then previous.source_audio_error else null end,
        warning_decision = case when preserve_duration_inputs or preserve_type_inputs then 'not_required' else previous.warning_decision end,
        warning_reason = case when preserve_duration_inputs or preserve_type_inputs then null else previous.warning_reason end,
        warning_accepted_at = case when preserve_duration_inputs or preserve_type_inputs then null else previous.warning_accepted_at end,
        warning_accepted_by = case when preserve_duration_inputs or preserve_type_inputs then null else previous.warning_accepted_by end,
        confirmation_reason = case when preserve_duration_inputs or preserve_type_inputs then null else previous.confirmation_reason end,
        confirmed_at = case when preserve_duration_inputs or preserve_type_inputs then null else previous.confirmed_at end,
        confirmed_by = case when preserve_duration_inputs or preserve_type_inputs then null else previous.confirmed_by end,
        skipped_at = case when preserve_duration_inputs or preserve_type_inputs then null else previous.skipped_at end,
        skipped_by = case when preserve_duration_inputs or preserve_type_inputs then null else previous.skipped_by end,
        frozen_at = null,
        frozen_by = null,
        updated_at = now()
    where draft.episode_id = episode_record.id
      and draft.review_package_id = package_record.id
      and draft.shot_id = shot ->> 'id';
  end loop;
  return new;
end;
$$;


--
-- Name: pre_render_review_member_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_render_review_member_decisions (
    review_package_id uuid NOT NULL,
    member_key text NOT NULL,
    decision text NOT NULL,
    reason text NOT NULL,
    actor_id uuid NOT NULL,
    inherited_from_review_package_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pre_render_review_member_decisions_decision_check CHECK ((decision = ANY (ARRAY['approved'::text, 'changes_requested'::text]))),
    CONSTRAINT pre_render_review_member_decisions_member_key_check CHECK ((btrim(member_key) <> ''::text)),
    CONSTRAINT pre_render_review_member_decisions_reason_check CHECK ((btrim(reason) <> ''::text))
);


--
-- Name: review_pre_render_member(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_pre_render_member(p_review_package_id uuid, p_member_key text, p_decision text, p_reason text) RETURNS public.pre_render_review_member_decisions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  selected_package public.review_packages;
  selected_member public.pre_render_review_members;
  selected_task public.tasks;
  membership_role public.member_role;
  created_task public.tasks;
  saved_decision public.pre_render_review_member_decisions;
  original_path text;
  suffix text;
  next_path text;
begin
  if p_decision not in ('approved', 'changes_requested') or btrim(coalesce(p_member_key, '')) = '' or btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Pre-render member review input is invalid' using errcode = '22023';
  end if;
  select package.* into selected_package
  from public.review_packages package
  join public.episodes episode on episode.id = package.episode_id
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid()
  where package.id = p_review_package_id and package.stage = 'production_ready' and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'A current pre-render review package is required' using errcode = '22023'; end if;
  select role into membership_role from public.account_memberships membership join public.episodes episode on episode.account_id = membership.account_id where episode.id = selected_package.episode_id and membership.user_id = auth.uid();
  if membership_role is distinct from 'owner' then raise exception 'Owner membership is required to review a pre-render member' using errcode = '42501'; end if;
  select * into selected_member from public.pre_render_review_members where review_package_id = selected_package.id and member_key = btrim(p_member_key) for update;
  if not found then raise exception 'Pre-render member does not belong to this package' using errcode = '22023'; end if;

  if p_decision = 'approved' then
    insert into public.pre_render_review_member_decisions (review_package_id,member_key,decision,reason,actor_id)
    values (selected_package.id,selected_member.member_key,'approved',btrim(p_reason),auth.uid())
    on conflict (review_package_id,member_key) do update set decision = excluded.decision, reason = excluded.reason, actor_id = excluded.actor_id, inherited_from_review_package_id = null, created_at = now()
    returning * into saved_decision;
    return saved_decision;
  end if;

  select * into selected_task from public.tasks where id = selected_member.source_task_id for update;
  if selected_task.task_type = 'extract_embedded_audio' then raise exception 'Derived audio must be revised by replacing its approved source video revision' using errcode = '22023'; end if;
  if selected_task.task_type not in ('generate_a_roll', 'generate_b_roll', 'generate_narration', 'generate_soundtrack') then raise exception 'Pre-render member task type is not revisionable' using errcode = '22023'; end if;
  original_path := selected_task.input_snapshot #>> '{output,relative_path}';
  suffix := right(original_path, strpos(reverse(original_path), '.'));
  next_path := case when suffix = '' then format('%s-pre-render-v%s', original_path, selected_package.revision_number + 1) else left(original_path, length(original_path) - length(suffix)) || format('-pre-render-v%s%s', selected_package.revision_number + 1, suffix) end;
  insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version)
  values (
    selected_task.episode_id, selected_task.task_type, 'ready',
    jsonb_set(jsonb_set(selected_task.input_snapshot || jsonb_build_object('pre_render_revision',selected_package.id::text,'review_feedback',jsonb_build_object('review_package_id',selected_package.id,'member_key',selected_member.member_key,'reason',btrim(p_reason),'actor_id',auth.uid())), '{output,relative_path}', to_jsonb(next_path), true), '{output,review_stage}', to_jsonb('production_ready'::text), true),
    selected_task.budget_limit_cents, selected_task.max_attempts, selected_task.provider, selected_task.model, selected_task.prompt_version
  ) returning * into created_task;
  insert into public.pre_render_review_member_decisions (review_package_id,member_key,decision,reason,actor_id)
  values (selected_package.id,selected_member.member_key,'changes_requested',btrim(p_reason),auth.uid())
  on conflict (review_package_id,member_key) do update set decision = excluded.decision, reason = excluded.reason, actor_id = excluded.actor_id, inherited_from_review_package_id = null, created_at = now()
  returning * into saved_decision;
  update public.review_packages set invalidated_at = now(), invalidated_reason = format('Owner requested a revision for %s.', selected_member.member_key) where id = selected_package.id;
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id)
  select episode.account_id, episode.id, 'pre_render_member_revision_task_created', jsonb_build_object('review_package_id',selected_package.id,'member_key',selected_member.member_key,'task_id',created_task.id,'reason',btrim(p_reason)), auth.uid()
  from public.episodes episode where episode.id = selected_package.episode_id;
  return saved_decision;
end;
$$;


--
-- Name: external_connection_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_connection_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connection_id uuid NOT NULL,
    version integer NOT NULL,
    vault_secret_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    provider text NOT NULL,
    adapter text NOT NULL,
    endpoint text NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT external_connection_versions_version_check CHECK ((version > 0))
);


--
-- Name: revoke_external_connection_version(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_external_connection_version(p_version_id uuid) RETURNS public.external_connection_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare selected_version public.external_connection_versions;
begin
  select version.* into selected_version from public.external_connection_versions version join public.external_connections connection on connection.id = version.connection_id where version.id = p_version_id and connection.created_by = auth.uid() for update of version;
  if not found then raise exception 'External connection version does not exist' using errcode = 'P0002'; end if;
  update public.external_connection_versions set revoked_at = coalesce(revoked_at, now()) where id = p_version_id returning * into selected_version;
  if selected_version.id = (select current_version_id from public.external_connections where id = selected_version.connection_id) then update public.external_connections set status = 'invalid', last_verification_detail = '当前连接版本已被 Owner 撤销。', last_verified_at = now() where id = selected_version.connection_id; end if;
  return selected_version;
end;
$$;


--
-- Name: rotate_external_connection(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rotate_external_connection(p_connection_id uuid, p_provider text, p_adapter text, p_secret text) RETURNS public.external_connections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare connection public.external_connections; next_version integer; next_id uuid := gen_random_uuid(); official_endpoint text := public.official_external_connection_endpoint(trim(p_provider), trim(p_adapter));
begin
  select candidate.* into connection from public.external_connections candidate where candidate.id = p_connection_id and candidate.created_by = auth.uid() for update;
  if not found then raise exception 'External connection does not exist' using errcode = 'P0002'; end if;
  if official_endpoint is null or char_length(trim(p_secret)) not between 1 and 4096 then raise exception 'Registered provider, adapter, and secret are required' using errcode = '22023'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.external_connection_versions where connection_id = p_connection_id;
  insert into public.external_connection_versions (id, connection_id, version, provider, adapter, endpoint, vault_secret_id)
  values (next_id, p_connection_id, next_version, trim(p_provider), trim(p_adapter), official_endpoint, vault.create_secret(trim(p_secret)));
  update public.external_connections set provider = trim(p_provider), adapter = trim(p_adapter), endpoint = official_endpoint, current_version_id = next_id, status = 'unverified', last_verification_detail = null, last_verified_at = null where id = p_connection_id returning * into connection;
  return connection;
end;
$$;


--
-- Name: save_episode_tts_settings(uuid, text, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_episode_tts_settings(p_episode_id uuid, p_tts_language_code text, p_tts_voice text, p_tts_speaking_rate numeric) RETURNS public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  updated_episode public.episodes;
  changed boolean;
begin
  if coalesce(btrim(p_tts_language_code), '') = '' or coalesce(btrim(p_tts_voice), '') = '' or p_tts_speaking_rate is null or p_tts_speaking_rate <= 0 then
    raise exception '本期 TTS 设置必须包含语言、声音和有效语速' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to save Episode TTS settings' using errcode = '42501'; end if;
  if current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then raise exception '本期 TTS 设置只能在镜头工作台保存' using errcode = '22023'; end if;

  changed := current_episode.tts_language_code is distinct from btrim(p_tts_language_code)
    or current_episode.tts_voice is distinct from btrim(p_tts_voice)
    or current_episode.tts_speaking_rate is distinct from p_tts_speaking_rate;

  update public.episodes
  set tts_language_code = btrim(p_tts_language_code), tts_voice = btrim(p_tts_voice), tts_speaking_rate = p_tts_speaking_rate, updated_at = now()
  where id = p_episode_id
  returning * into updated_episode;

  if changed then
    update public.tasks task
    set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Episode TTS settings changed.'
    where task.episode_id = p_episode_id and task.task_type = 'generate_narration' and task.status in ('ready', 'running', 'blocked', 'failed');
    update public.shot_preparation_drafts draft
    set tts_language_code = btrim(p_tts_language_code), tts_voice = coalesce(draft.tts_override_voice, btrim(p_tts_voice)), tts_speaking_rate = coalesce(draft.tts_override_speaking_rate, p_tts_speaking_rate),
        current_audio_track_id = null, current_tts_task_id = null, pending_tts_task_id = null,
        tts_actual_duration_seconds = null, tts_error = null, audio_status = case when draft.audio_mode = 'tts' then 'pending' else draft.audio_status end,
        updated_at = now()
    where draft.episode_id = p_episode_id and draft.audio_mode = 'tts';
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, p_episode_id, 'episode_tts_settings_updated', jsonb_build_object(
      'previous', jsonb_build_object('language_code', current_episode.tts_language_code, 'voice', current_episode.tts_voice, 'speaking_rate', current_episode.tts_speaking_rate),
      'current', jsonb_build_object('language_code', updated_episode.tts_language_code, 'voice', updated_episode.tts_voice, 'speaking_rate', updated_episode.tts_speaking_rate)
    ), auth.uid());
  end if;
  return updated_episode;
end;
$$;


--
-- Name: save_manual_shot_clip(uuid, uuid, text, uuid, text, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_manual_shot_clip(p_episode_id uuid, p_material_revision_id uuid, p_shot_id text, p_storyboard_review_package_id uuid, p_kind text, p_clip_start_seconds numeric, p_clip_end_seconds numeric) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  selected_shot jsonb;
  target_duration numeric;
  clip_selection jsonb;
  created_task public.tasks;
  replaced_count integer;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to save a manual shot clip' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Manual shot clips can only be saved before Studio composition' using errcode = '22023'; end if;
  if p_kind not in ('a_roll', 'b_roll') then raise exception 'Manual shot clip kind must be a_roll or b_roll' using errcode = '22023'; end if;

  select shot.value into selected_shot
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  cross join lateral jsonb_array_elements(package.context_snapshot #> '{worker_result,storyboard,shots}') shot(value)
  where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null
    and shot.value ->> 'id' = btrim(p_shot_id) and shot.value ->> 'shotType' = p_kind;
  if not found then raise exception 'Current approved storyboard shot is required' using errcode = '22023'; end if;
  target_duration := (selected_shot ->> 'durationSeconds')::numeric;
  if p_clip_start_seconds < 0 or p_clip_end_seconds <= p_clip_start_seconds or p_clip_end_seconds > 86400 then raise exception 'Clip range is invalid' using errcode = '22023'; end if;
  if abs((p_clip_end_seconds - p_clip_start_seconds) - target_duration) > 0.05 then raise exception 'Clip duration must match the approved storyboard duration' using errcode = '22023'; end if;

  update public.tasks task
  set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner replaced the prepared manual shot clip before Studio composition.'
  where task.episode_id = p_episode_id and task.task_type = case p_kind when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
    and task.status = 'completed' and task.provider = 'manual_upload'
    and task.input_snapshot ->> 'storyboard_review_package_id' = p_storyboard_review_package_id::text
    and task.input_snapshot #>> '{shot,id}' = btrim(p_shot_id);
  get diagnostics replaced_count = row_count;

  if p_kind = 'a_roll' then
    created_task := public.register_manual_a_roll(p_episode_id, p_material_revision_id, p_shot_id, p_storyboard_review_package_id);
  else
    created_task := public.register_manual_b_roll(p_episode_id, p_material_revision_id, p_shot_id, p_storyboard_review_package_id);
  end if;

  clip_selection := jsonb_build_object('start_seconds', p_clip_start_seconds, 'end_seconds', p_clip_end_seconds, 'duration_seconds', p_clip_end_seconds - p_clip_start_seconds);
  update public.tasks task
  set input_snapshot = jsonb_set(jsonb_set(task.input_snapshot, '{clip_selection}', clip_selection, true), '{configuration_hash}', to_jsonb('manual-' || md5((jsonb_set(task.input_snapshot, '{clip_selection}', clip_selection, true))::text)), true)
  where task.id = created_task.id
  returning * into created_task;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'manual_shot_clip_saved', jsonb_build_object('kind', p_kind, 'material_revision_id', p_material_revision_id, 'shot_id', btrim(p_shot_id), 'storyboard_review_package_id', p_storyboard_review_package_id, 'task_id', created_task.id, 'clip_selection', clip_selection, 'replaced_task_count', replaced_count), auth.uid());
  return created_task;
end;
$$;


--
-- Name: save_shot_audio_mix(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_shot_audio_mix(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_bgm_ducking_level text) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  draft public.shot_preparation_drafts;
  changed boolean;
begin
  if p_bgm_ducking_level not in ('off', 'light', 'medium', 'strong') then
    raise exception 'BGM ducking level is invalid' using errcode = '22023';
  end if;
  select target.* into draft
  from public.shot_preparation_drafts target
  join public.episodes episode on episode.id = target.episode_id
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where target.episode_id = p_episode_id and target.review_package_id = p_review_package_id and target.shot_id = btrim(p_shot_id)
  for update of target;
  if not found then raise exception 'Owner shot workbench access is required' using errcode = '42501'; end if;
  if p_bgm_ducking_level <> 'off' and (draft.audio_mode = 'none' or not exists (
    select 1 from public.storyboard_audio_selections selection
    where selection.episode_id = p_episode_id and selection.review_package_id = p_review_package_id
      and selection.target_kind = 'episode' and selection.target_id = p_episode_id::text and selection.audio_kind = 'bgm'
      and (selection.cue_id is not null or selection.material_revision_id is not null)
  )) then raise exception 'BGM ducking requires BGM and an audible main voice' using errcode = '22023'; end if;
  changed := draft.bgm_ducking_level is distinct from p_bgm_ducking_level;
  update public.shot_preparation_drafts target set
    bgm_ducking_level = p_bgm_ducking_level,
    frozen_at = case when changed then null else target.frozen_at end,
    frozen_by = case when changed then null else target.frozen_by end,
    confirmation_status = case when changed then 'pending' else target.confirmation_status end,
    confirmation_reason = case when changed then null else target.confirmation_reason end,
    confirmed_at = case when changed then null else target.confirmed_at end,
    confirmed_by = case when changed then null else target.confirmed_by end,
    updated_at = now()
  where target.id = draft.id returning * into draft;
  return draft;
end;
$$;


--
-- Name: save_shot_caption_contract(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_shot_caption_contract(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_caption_contract jsonb) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  draft public.shot_preparation_drafts;
  caption_changed boolean;
begin
  select episode.* into current_episode from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id for update of episode;
  if not found or current_episode.stage not in ('storyboard_approved', 'render_ready', 'qc_review') then
    raise exception 'Owner shot workbench access is required' using errcode = '42501';
  end if;
  if not public.is_valid_shot_caption_contract(p_caption_contract) then
    raise exception 'Shot caption contract is invalid' using errcode = '22023';
  end if;
  select * into draft from public.shot_preparation_drafts
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id) for update;
  if not found then raise exception 'Shot preparation draft is required' using errcode = '22023'; end if;
  if p_caption_contract ->> 'content_mode' = 'follow_tts'
    and (draft.audio_mode <> 'tts' or p_caption_contract ->> 'text' is distinct from draft.tts_text) then
    raise exception 'Follow-TTS captions must reference the current final TTS text' using errcode = '22023';
  end if;
  caption_changed := draft.caption_contract is distinct from p_caption_contract;
  update public.shot_preparation_drafts target
  set caption_contract = p_caption_contract,
      subtitle_text = p_caption_contract ->> 'text',
      subtitles_enabled = (p_caption_contract ->> 'enabled')::boolean,
      frozen_at = case when caption_changed then null else target.frozen_at end,
      frozen_by = case when caption_changed then null else target.frozen_by end,
      confirmation_status = case when caption_changed then 'pending' else target.confirmation_status end,
      confirmation_reason = case when caption_changed then null else target.confirmation_reason end,
      confirmed_at = case when caption_changed then null else target.confirmed_at end,
      confirmed_by = case when caption_changed then null else target.confirmed_by end,
      updated_at = now()
  where target.id = draft.id
  returning * into draft;
  if caption_changed then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, p_episode_id, 'shot_caption_contract_saved', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', btrim(p_shot_id), 'content_mode', p_caption_contract ->> 'content_mode', 'subtitles_enabled', p_caption_contract -> 'enabled', 'preparation_input_fingerprint', draft.preparation_input_fingerprint), auth.uid());
  end if;
  return draft;
end;
$$;


--
-- Name: save_shot_clip_draft(uuid, uuid, text, uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_shot_clip_draft(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_material_revision_id uuid, p_clip_start_seconds numeric, p_clip_end_seconds numeric) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  selected_shot jsonb;
  selected_material public.production_material_revisions;
  saved_draft public.shot_preparation_drafts;
  target_duration numeric;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to save a shot clip draft' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Shot clip drafts can only be saved in the shot workbench' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the approved storyboard' using errcode = '22023'; end if;
  target_duration := (selected_shot ->> 'durationSeconds')::numeric;

  if p_material_revision_id is not null then
    select material.* into selected_material
    from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.id = p_material_revision_id and material.episode_id = p_episode_id
      and material.material_type = 'video'
      and material.material_purpose = case selected_shot ->> 'shotType' when 'a_roll' then 'a_roll' else 'b_roll' end;
    if not found then raise exception 'Approved video material for this storyboard shot is required' using errcode = '22023'; end if;
    if p_clip_start_seconds is null or p_clip_end_seconds is null or p_clip_start_seconds < 0 or p_clip_end_seconds <= p_clip_start_seconds or p_clip_end_seconds > 86400 then raise exception 'Clip range is invalid' using errcode = '22023'; end if;
    if abs((p_clip_end_seconds - p_clip_start_seconds) - target_duration) > 0.05 then raise exception 'Clip duration must match the approved storyboard duration' using errcode = '22023'; end if;
  end if;

  update public.shot_preparation_drafts
  set selected_material_revision_id = p_material_revision_id,
      clip_start_seconds = p_clip_start_seconds,
      clip_end_seconds = p_clip_end_seconds,
      video_status = case when current_video_artifact_id is null then 'pending' else 'ready' end,
      video_error = null,
      pending_video_task_id = null,
      updated_at = now()
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id)
  returning * into saved_draft;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;

  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_clip_draft_saved', jsonb_build_object('shot_id', btrim(p_shot_id), 'material_revision_id', p_material_revision_id, 'clip_start_seconds', p_clip_start_seconds, 'clip_end_seconds', p_clip_end_seconds), auth.uid());
  return saved_draft;
end;
$$;


--
-- Name: save_shot_manual_alignment(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_shot_manual_alignment(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_cues jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare draft public.shot_preparation_drafts; track public.audio_tracks; normalized jsonb; cue_text text; text_fingerprint text; input_version text; cue jsonb; previous_end numeric := -1;
begin
  select * into draft from public.shot_preparation_drafts where episode_id=p_episode_id and review_package_id=p_review_package_id and shot_id=p_shot_id and public.is_account_member((select account_id from public.episodes where id=p_episode_id)) for update;
  if not found or jsonb_typeof(p_cues)<>'array' or jsonb_array_length(p_cues)=0 then raise exception '人工时序输入无效' using errcode='22023'; end if;
  select * into track from public.audio_tracks where id=draft.current_audio_track_id;
  if not found then raise exception '当前镜头没有可复用的成功音轨' using errcode='22023'; end if;
  for cue in select value from jsonb_array_elements(p_cues) loop
    if jsonb_typeof(cue)<>'object' or coalesce(cue->>'id','')='' or coalesce(cue->>'text','')='' or jsonb_typeof(cue->'start_ms')<>'number' or jsonb_typeof(cue->'end_ms')<>'number' or (cue->>'start_ms')::numeric < 0 or (cue->>'end_ms')::numeric <= (cue->>'start_ms')::numeric or (cue->>'start_ms')::numeric < previous_end then
      raise exception '人工时序区间无效或发生重叠' using errcode='22023';
    end if;
    previous_end := (cue->>'end_ms')::numeric;
  end loop;
  select jsonb_agg(jsonb_build_object('id',value->>'id','text',value->>'text','startMs',value->'start_ms','endMs',value->'end_ms') order by ordinality), jsonb_agg(value order by ordinality), string_agg(value->>'text','' order by ordinality) into normalized,p_cues,cue_text from jsonb_array_elements(p_cues) with ordinality;
  if regexp_replace(cue_text,'[[:space:]，。！？；：,.!?;:、]','','g') <> regexp_replace(draft.subtitle_text,'[[:space:]，。！？；：,.!?;:、]','','g') then raise exception '人工时序只能调整时间，不能替换 Owner 字幕正文' using errcode='22023'; end if;
  text_fingerprint:=encode(extensions.digest(convert_to(draft.subtitle_text,'UTF8'),'sha256'),'hex'); input_version:=encode(extensions.digest(convert_to(jsonb_build_object('audioSha256',track.sha256,'textFingerprint',text_fingerprint,'method','manual')::text,'UTF8'),'sha256'),'hex');
  update public.shot_preparation_drafts set caption_contract=jsonb_set(caption_contract,'{cues}',p_cues), pending_alignment_task_id=null, acoustic_alignment=jsonb_build_object('version','acoustic-alignment/v1','status','completed','method','manual','granularity','phrase','inputVersion',input_version,'audioSha256',track.sha256,'textFingerprint',text_fingerprint,'provider','owner','model','manual','connectionVersionId',null,'wordCount',jsonb_array_length(normalized),'cues',normalized,'reviewIssues','[]'::jsonb,'attempts','[]'::jsonb,'detail','Owner 已保存人工字幕时序。','generatedAt',now()) where id=draft.id;
end;
$$;


--
-- Name: save_shot_preparation_draft(uuid, uuid, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_shot_preparation_draft(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_audio_mode text, p_subtitle_text text, p_subtitles_enabled boolean) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  existing_draft public.shot_preparation_drafts;
  saved_draft public.shot_preparation_drafts;
  selected_shot jsonb;
begin
  if p_audio_mode not in ('tts', 'source', 'none')
    or coalesce(btrim(p_shot_id), '') = ''
    or coalesce(btrim(p_subtitle_text), '') = ''
    or p_subtitles_enabled is null then
    raise exception 'Shot preparation draft is invalid' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to save a shot preparation draft' using errcode = '42501'; end if;
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Shot preparation drafts can only be saved after storyboard approval' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id
    and package.episode_id = p_episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the approved storyboard' using errcode = '22023'; end if;

  select draft.* into existing_draft
  from public.shot_preparation_drafts draft
  where draft.episode_id = p_episode_id and draft.review_package_id = p_review_package_id and draft.shot_id = btrim(p_shot_id)
  for update;

  insert into public.shot_preparation_drafts (episode_id, review_package_id, shot_id, audio_mode, subtitle_text, subtitles_enabled, tts_voice, tts_speaking_rate)
  select p_episode_id, p_review_package_id, btrim(p_shot_id), p_audio_mode, btrim(p_subtitle_text), p_subtitles_enabled,
    nullif(btrim((blueprint.policy #>> '{narration,voice,name}')), ''),
    case when (blueprint.policy #>> '{narration,voice,speaking_rate}') ~ '^[0-9]+([.][0-9]+)?$' then (blueprint.policy #>> '{narration,voice,speaking_rate}')::numeric else null end
  from public.account_blueprint_versions blueprint
  where blueprint.id = current_episode.blueprint_version_id
  on conflict (episode_id, review_package_id, shot_id) do update set
    audio_mode = excluded.audio_mode,
    subtitle_text = excluded.subtitle_text,
    subtitles_enabled = excluded.subtitles_enabled,
    updated_at = now()
  returning * into saved_draft;

  if existing_draft.id is null or existing_draft.audio_mode is distinct from saved_draft.audio_mode or existing_draft.subtitle_text is distinct from saved_draft.subtitle_text or existing_draft.subtitles_enabled is distinct from saved_draft.subtitles_enabled then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, current_episode.id, 'shot_preparation_draft_saved', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', btrim(p_shot_id), 'audio_mode', p_audio_mode, 'subtitles_enabled', p_subtitles_enabled), auth.uid());
  end if;
  return saved_draft;
end;
$_$;


--
-- Name: save_shot_preparation_draft(uuid, uuid, text, text, text, boolean, text, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_shot_preparation_draft(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_audio_mode text, p_subtitle_text text, p_subtitles_enabled boolean, p_tts_text text, p_tts_voice text, p_tts_speaking_rate numeric) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  existing_draft public.shot_preparation_drafts;
  saved_draft public.shot_preparation_drafts;
  blueprint_policy jsonb;
  selected_shot jsonb;
  next_tts_text text;
  next_tts_voice text;
  next_tts_rate numeric;
  next_language_code text;
  mode_changed boolean;
  audio_changed boolean;
begin
  if p_audio_mode not in ('tts', 'source', 'none') or coalesce(btrim(p_shot_id), '') = '' or (p_subtitles_enabled and coalesce(btrim(p_subtitle_text), '') = '') or p_subtitles_enabled is null then
    raise exception 'Shot preparation draft is invalid' using errcode = '22023';
  end if;
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to save a shot preparation draft' using errcode = '42501'; end if;
  if current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then raise exception 'Shot preparation drafts can only be saved after storyboard approval' using errcode = '22023'; end if;
  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;
  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the approved storyboard' using errcode = '22023'; end if;
  select draft.* into existing_draft from public.shot_preparation_drafts draft
  where draft.episode_id = p_episode_id and draft.review_package_id = p_review_package_id and draft.shot_id = btrim(p_shot_id)
  for update;
  select blueprint.policy into blueprint_policy from public.account_blueprint_versions blueprint where blueprint.id = current_episode.blueprint_version_id;
  next_tts_text := coalesce(nullif(btrim(p_tts_text), ''), nullif(btrim(p_subtitle_text), ''), nullif(btrim(selected_shot ->> 'scriptSegment'), ''));
  next_tts_voice := coalesce(existing_draft.tts_override_voice, current_episode.tts_voice, nullif(btrim(p_tts_voice), ''), existing_draft.tts_voice);
  next_tts_rate := coalesce(existing_draft.tts_override_speaking_rate, current_episode.tts_speaking_rate, p_tts_speaking_rate, existing_draft.tts_speaking_rate);
  next_language_code := coalesce(current_episode.tts_language_code, existing_draft.tts_language_code, 'zh-CN');
  if p_audio_mode = 'tts' and (coalesce(next_tts_text, '') = '' or coalesce(next_tts_voice, '') = '' or next_tts_rate is null or next_tts_rate <= 0) then
    raise exception 'TTS 草稿必须包含口播内容、声音和有效语速' using errcode = '22023';
  end if;
  mode_changed := existing_draft.id is null or existing_draft.audio_mode is distinct from p_audio_mode;
  audio_changed := mode_changed or (p_audio_mode = 'tts' and (existing_draft.tts_text is distinct from next_tts_text or existing_draft.tts_voice is distinct from next_tts_voice or existing_draft.tts_speaking_rate is distinct from next_tts_rate));
  if mode_changed and existing_draft.id is not null then
    update public.tasks task
    set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner switched this shot to another audio mode.'
    where task.input_snapshot #>> '{shot_preparation,draft_id}' = existing_draft.id::text and task.status in ('ready', 'running', 'blocked', 'failed');
  end if;
  insert into public.shot_preparation_drafts (
    episode_id, review_package_id, shot_id, audio_mode, subtitle_text, subtitles_enabled,
    tts_text, tts_voice, tts_speaking_rate, tts_language_code, audio_status, tts_error, source_audio_error
  ) values (
    p_episode_id, p_review_package_id, btrim(p_shot_id), p_audio_mode,
    case when p_audio_mode = 'tts' then next_tts_text else btrim(p_subtitle_text) end,
    p_subtitles_enabled, next_tts_text, next_tts_voice, next_tts_rate, next_language_code,
    case when p_audio_mode in ('none', 'source') then 'ready' when audio_changed then 'pending' else coalesce(existing_draft.audio_status, 'pending') end,
    case when audio_changed then null else existing_draft.tts_error end,
    case when p_audio_mode = 'source' then null else existing_draft.source_audio_error end
  )
  on conflict (episode_id, review_package_id, shot_id) do update set
    audio_mode = excluded.audio_mode,
    subtitle_text = excluded.subtitle_text,
    subtitles_enabled = excluded.subtitles_enabled,
    tts_text = excluded.tts_text,
    tts_voice = excluded.tts_voice,
    tts_speaking_rate = excluded.tts_speaking_rate,
    tts_language_code = excluded.tts_language_code,
    audio_status = excluded.audio_status,
    tts_error = excluded.tts_error,
    source_audio_error = null,
    source_audio_duration_seconds = null,
    confirmation_status = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode
      or excluded.subtitle_text is distinct from shot_preparation_drafts.subtitle_text
      or excluded.tts_text is distinct from shot_preparation_drafts.tts_text
      or excluded.tts_voice is distinct from shot_preparation_drafts.tts_voice
      or excluded.tts_speaking_rate is distinct from shot_preparation_drafts.tts_speaking_rate
      then 'pending' else shot_preparation_drafts.confirmation_status end,
    current_audio_track_id = case when excluded.audio_mode in ('none', 'source') or excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.current_audio_track_id end,
    current_tts_task_id = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.current_tts_task_id end,
    pending_tts_task_id = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.pending_tts_task_id end,
    pending_source_audio_task_id = null,
    updated_at = now()
  returning * into saved_draft;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, current_episode.id, 'shot_audio_mode_saved', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', btrim(p_shot_id), 'audio_mode', p_audio_mode, 'subtitles_enabled', p_subtitles_enabled, 'audio_changed', audio_changed), auth.uid());
  return saved_draft;
end;
$$;


--
-- Name: save_shot_transition_mode(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_shot_transition_mode(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_transition_mode text) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  draft public.shot_preparation_drafts;
begin
  if p_transition_mode not in ('cut', 'fade', 'studio') then
    raise exception 'Shot transition mode is invalid' using errcode = '22023';
  end if;
  select target.* into draft
  from public.shot_preparation_drafts target
  join public.episodes episode on episode.id = target.episode_id
  join public.account_memberships membership
    on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where target.episode_id = p_episode_id
    and target.review_package_id = p_review_package_id
    and target.shot_id = btrim(p_shot_id)
  for update of target;
  if not found then raise exception 'Owner shot workbench access is required' using errcode = '42501'; end if;

  update public.shot_preparation_drafts target
  set transition_mode = p_transition_mode, preparation_contract_status = 'current',
      frozen_at = case when target.transition_mode is distinct from p_transition_mode then null else target.frozen_at end,
      frozen_by = case when target.transition_mode is distinct from p_transition_mode then null else target.frozen_by end,
      updated_at = now()
  where target.id = draft.id
  returning * into draft;
  return draft;
end;
$$;


--
-- Name: save_shot_tts_override(uuid, uuid, text, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_shot_tts_override(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_tts_voice text, p_tts_speaking_rate numeric) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  draft public.shot_preparation_drafts;
  blueprint_policy jsonb;
  default_voice text;
  default_rate numeric;
  changed boolean;
  saved public.shot_preparation_drafts;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found or current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then
    raise exception 'Owner shot workbench access is required' using errcode = '42501';
  end if;
  perform public.assert_current_storyboard_shot(p_episode_id, p_review_package_id, p_shot_id);
  if (p_tts_voice is null) <> (p_tts_speaking_rate is null) or coalesce(btrim(p_tts_voice), '') = '' and p_tts_speaking_rate is not null or p_tts_speaking_rate is not null and p_tts_speaking_rate <= 0 then
    raise exception '单镜头覆盖必须同时包含声音和有效语速，或同时恢复本期设置' using errcode = '22023';
  end if;

  select * into draft from public.shot_preparation_drafts
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id)
  for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.audio_mode <> 'tts' then raise exception 'Only TTS shots can override narration settings' using errcode = '22023'; end if;
  if draft.frozen_at is not null and not exists (select 1 from public.episodes episode where episode.id = p_episode_id and episode.stage in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review')) then raise exception 'Frozen shot drafts cannot be edited' using errcode = '22023'; end if;

  select policy into blueprint_policy from public.account_blueprint_versions where id = current_episode.blueprint_version_id;
  default_voice := current_episode.tts_voice;
  default_rate := current_episode.tts_speaking_rate;
  changed := draft.tts_override_voice is distinct from nullif(btrim(p_tts_voice), '') or draft.tts_override_speaking_rate is distinct from p_tts_speaking_rate;
  update public.shot_preparation_drafts
  set tts_override_voice = nullif(btrim(p_tts_voice), ''),
      tts_override_speaking_rate = p_tts_speaking_rate,
      tts_voice = coalesce(nullif(btrim(p_tts_voice), ''), default_voice),
      tts_speaking_rate = coalesce(p_tts_speaking_rate, default_rate),
      current_audio_track_id = case when changed then null else current_audio_track_id end,
      current_tts_task_id = case when changed then null else current_tts_task_id end,
      pending_tts_task_id = case when changed then null else pending_tts_task_id end,
      audio_status = case when changed then 'pending' else audio_status end,
      tts_actual_duration_seconds = case when changed then null else tts_actual_duration_seconds end,
      tts_error = case when changed then null else tts_error end,
      updated_at = now()
  where id = draft.id
  returning * into saved;
  if changed then
    update public.tasks set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Shot TTS override changed.'
    where episode_id = p_episode_id and task_type = 'generate_narration' and status in ('ready', 'running', 'blocked', 'failed')
      and input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text;
  end if;
  return saved;
end;
$$;


--
-- Name: save_shot_workbench_composition_draft(uuid, uuid, text, uuid, jsonb, jsonb, numeric, text, text, boolean, text, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_shot_workbench_composition_draft(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_material_revision_id uuid, p_clip_segments jsonb, p_composition jsonb, p_source_video_duration_seconds numeric, p_audio_mode text, p_subtitle_text text, p_subtitles_enabled boolean, p_tts_text text, p_tts_voice text, p_tts_speaking_rate numeric) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  draft public.shot_preparation_drafts;
  composition_changed boolean;
  source_duration_changed boolean;
begin
  if jsonb_typeof(p_clip_segments) <> 'array'
    or not public.is_valid_shot_composition(p_composition, jsonb_array_length(p_clip_segments)) then
    raise exception 'Shot composition is invalid' using errcode = '22023';
  end if;
  if p_source_video_duration_seconds is null
    or p_source_video_duration_seconds <= 0
    or p_source_video_duration_seconds > 86400 then
    raise exception 'Approved source video duration is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_clip_segments) segment
    where jsonb_typeof(segment) <> 'object'
      or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'end_seconds')::numeric > p_source_video_duration_seconds
  ) then
    raise exception 'Every media range must be valid for the approved source' using errcode = '22023';
  end if;

  draft := public.save_shot_workbench_draft(
    p_episode_id, p_review_package_id, p_shot_id, p_material_revision_id, p_clip_segments,
    p_audio_mode, p_subtitle_text, p_subtitles_enabled, p_tts_text, p_tts_voice, p_tts_speaking_rate
  );
  composition_changed := draft.composition is distinct from p_composition;
  source_duration_changed := draft.source_video_duration_seconds is distinct from p_source_video_duration_seconds;
  update public.shot_preparation_drafts target
  set composition = p_composition,
      video_duration_seconds = public.shot_composition_playback_duration(p_clip_segments, p_composition),
      source_video_duration_seconds = p_source_video_duration_seconds,
      frozen_at = case when composition_changed or source_duration_changed then null else target.frozen_at end,
      frozen_by = case when composition_changed or source_duration_changed then null else target.frozen_by end,
      confirmation_status = case when composition_changed or source_duration_changed then 'pending' else target.confirmation_status end,
      confirmation_reason = case when composition_changed or source_duration_changed then null else target.confirmation_reason end,
      confirmed_at = case when composition_changed or source_duration_changed then null else target.confirmed_at end,
      confirmed_by = case when composition_changed or source_duration_changed then null else target.confirmed_by end,
      updated_at = now()
  where target.id = draft.id
  returning * into draft;
  return draft;
end;
$$;


--
-- Name: save_shot_workbench_draft(uuid, uuid, text, uuid, jsonb, text, text, boolean, text, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_shot_workbench_draft(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_material_revision_id uuid, p_clip_segments jsonb, p_audio_mode text, p_subtitle_text text, p_subtitles_enabled boolean, p_tts_text text, p_tts_voice text, p_tts_speaking_rate numeric) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  draft public.shot_preparation_drafts;
  selected_package public.review_packages;
  selected_shot jsonb;
  segment jsonb;
  total_duration numeric := 0;
  changed boolean;
begin
  select current_draft.* into draft
  from public.shot_preparation_drafts current_draft
  where current_draft.episode_id = p_episode_id and current_draft.review_package_id = p_review_package_id and current_draft.shot_id = btrim(p_shot_id)
  for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.frozen_at is not null and not exists (select 1 from public.episodes episode where episode.id = p_episode_id and episode.stage in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review')) then raise exception 'Frozen shot drafts cannot be edited' using errcode = '22023'; end if;
  if p_clip_segments is null or jsonb_typeof(p_clip_segments) <> 'array' or jsonb_array_length(p_clip_segments) = 0 then raise exception 'At least one clip segment is required' using errcode = '22023'; end if;
  for segment in select value from jsonb_array_elements(p_clip_segments) loop
    if jsonb_typeof(segment) <> 'object' or jsonb_typeof(segment -> 'start_seconds') <> 'number' or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'start_seconds')::numeric < 0 or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
      or (segment ->> 'end_seconds')::numeric > 86400 then
      raise exception 'Clip segment is invalid' using errcode = '22023';
    end if;
    total_duration := public.clip_segment_union_duration(p_clip_segments);
  end loop;

  select package.* into selected_package from public.review_packages package
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  select shot.value into selected_shot from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the current storyboard' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.id = p_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'video'
      and material.material_purpose = case selected_shot ->> 'shotType' when 'a_roll' then 'a_roll' else 'b_roll' end
  ) then raise exception 'Approved video material for this shot is required' using errcode = '22023'; end if;

  perform public.save_shot_preparation_draft(p_episode_id, p_review_package_id, p_shot_id, p_audio_mode, p_subtitle_text, p_subtitles_enabled, p_tts_text, p_tts_voice, p_tts_speaking_rate);
  changed := draft.selected_material_revision_id is distinct from p_material_revision_id or draft.clip_segments is distinct from p_clip_segments;
  update public.shot_preparation_drafts
  set input_fingerprint = md5(selected_shot::text),
      selected_material_revision_id = p_material_revision_id,
      clip_segments = p_clip_segments,
      clip_start_seconds = null,
      clip_end_seconds = null,
      video_duration_seconds = total_duration,
      current_video_artifact_id = current_video_artifact_id,
      current_video_task_id = current_video_task_id,
      pending_video_task_id = null,
      video_status = case when changed then 'pending' else video_status end,
      video_error = case when changed then null else video_error end,
      current_audio_track_id = case when changed and audio_mode = 'source' then null else current_audio_track_id end,
      pending_source_audio_task_id = null,
      audio_status = case when audio_mode in ('none', 'source') then 'ready' else audio_status end,
      source_audio_error = null,
      source_audio_duration_seconds = null,
      updated_at = now()
  where id = draft.id returning * into draft;
  return draft;
end;
$$;


--
-- Name: storyboard_audio_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storyboard_audio_selections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    review_package_id uuid NOT NULL,
    target_kind text NOT NULL,
    target_id text NOT NULL,
    audio_kind text NOT NULL,
    cue_id text,
    material_revision_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storyboard_audio_selections_audio_kind_check CHECK ((audio_kind = ANY (ARRAY['bgm'::text, 'sfx'::text]))),
    CONSTRAINT storyboard_audio_selections_check CHECK ((((target_kind = 'episode'::text) AND (audio_kind = 'bgm'::text)) OR ((target_kind = 'shot'::text) AND (audio_kind = 'sfx'::text)))),
    CONSTRAINT storyboard_audio_selections_check1 CHECK ((num_nonnulls(cue_id, material_revision_id) <= 1)),
    CONSTRAINT storyboard_audio_selections_target_kind_check CHECK ((target_kind = ANY (ARRAY['episode'::text, 'shot'::text])))
);


--
-- Name: save_storyboard_audio_selection(uuid, uuid, text, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_storyboard_audio_selection(p_episode_id uuid, p_review_package_id uuid, p_target_kind text, p_target_id text, p_audio_kind text, p_cue_id text, p_material_revision_id uuid DEFAULT NULL::uuid) RETURNS public.storyboard_audio_selections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  current_package public.review_packages;
  saved public.storyboard_audio_selections;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id
    and membership.user_id = auth.uid()
    and membership.role = 'owner';
  if not found then raise exception 'Episode not found' using errcode = 'P0002'; end if;
  select * into current_package from public.review_packages
  where id = p_review_package_id and episode_id = p_episode_id and stage = 'storyboard_review' and invalidated_at is null;
  if not found then raise exception 'Storyboard review package not found' using errcode = 'P0002'; end if;
  if (p_target_kind = 'episode' and (p_audio_kind <> 'bgm' or p_target_id <> p_episode_id::text))
    or (p_target_kind = 'shot' and p_audio_kind <> 'sfx')
    or p_target_kind not in ('episode', 'shot') then
    raise exception 'Audio selection target is invalid' using errcode = '22023';
  end if;
  if p_target_kind = 'shot' and not exists (
    select 1 from jsonb_array_elements(coalesce(current_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot
    where shot ->> 'id' = p_target_id
  ) then raise exception 'Storyboard shot not found' using errcode = 'P0002'; end if;
  if p_cue_id is not null and not exists (
    select 1 from jsonb_array_elements(coalesce(current_package.context_snapshot #> '{worker_result,storyboard,audioCues}', '[]'::jsonb)) cue
    where cue ->> 'id' = p_cue_id and cue ->> 'kind' = p_audio_kind
  ) then raise exception 'Storyboard audio cue not found' using errcode = 'P0002'; end if;
  if p_material_revision_id is not null and (p_audio_kind <> 'bgm' or not exists (
    select 1 from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.id = p_material_revision_id
      and material.episode_id = p_episode_id
      and material.material_type = 'audio'
      and material.material_purpose = 'background_music'
  )) then raise exception 'Approved background music material is required' using errcode = 'P0002'; end if;
  if num_nonnulls(nullif(btrim(p_cue_id), ''), p_material_revision_id) > 1 then
    raise exception 'Choose either a storyboard cue or an uploaded audio file' using errcode = '22023';
  end if;

  insert into public.storyboard_audio_selections (episode_id, review_package_id, target_kind, target_id, audio_kind, cue_id, material_revision_id, created_by)
  values (p_episode_id, p_review_package_id, p_target_kind, btrim(p_target_id), p_audio_kind, nullif(btrim(p_cue_id), ''), p_material_revision_id, auth.uid())
  on conflict (episode_id, review_package_id, target_kind, target_id, audio_kind) do update
  set cue_id = excluded.cue_id, material_revision_id = excluded.material_revision_id, updated_at = now()
  returning * into saved;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'storyboard_audio_selection_saved', jsonb_build_object('review_package_id', p_review_package_id, 'target_kind', p_target_kind, 'target_id', p_target_id, 'audio_kind', p_audio_kind, 'cue_id', saved.cue_id, 'material_revision_id', saved.material_revision_id), auth.uid());
  return saved;
end;
$$;


--
-- Name: seed_account_prompt_versions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_account_prompt_versions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.prompt_versions (account_id, capability, version, slug, name, summary, instructions, created_by)
  values
    (new.id, 'script_writing', 1, 'script-writing-v1', '脚本生成 v1', '根据账号定位、系列基线和委托说明生成可审核脚本。', '生成结构完整、可进入审核的脚本初稿。', auth.uid()),
    (new.id, 'visual_planning', 1, 'visual-planning-v1', '视觉规划 v1', '根据脚本和系列基线规划角色、地点和画面参考。', '输出可追溯到脚本的视觉规划和参考素材说明。', auth.uid()),
    (new.id, 'storyboard_planning', 1, 'storyboard-planning-v1', '分镜规划 v1', '根据已审核脚本和视觉规划生成结构化分镜。', '输出可审核的分镜 JSON，并保留脚本和视觉输入依据。', auth.uid())
  on conflict (account_id, slug) do nothing;
  return new;
end;
$$;


--
-- Name: seed_shot_preparation_drafts_after_storyboard_approval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_shot_preparation_drafts_after_storyboard_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  episode_record public.episodes;
  package_record public.review_packages;
  narration_policy jsonb;
  voice jsonb;
  shot jsonb;
  previous public.shot_preparation_drafts;
begin
  if new.stage <> 'storyboard_approved' or new.decision <> 'approved' or new.review_package_id is null then return new; end if;
  select episode.* into episode_record from public.episodes episode where episode.id = new.episode_id;
  select package.* into package_record
  from public.review_packages package
  where package.id = new.review_package_id
    and package.episode_id = new.episode_id
    and package.stage = 'storyboard_review'
    and package.invalidated_at is null;
  if not found or episode_record.stage <> 'storyboard_approved' then return new; end if;

  narration_policy := (select blueprint.policy -> 'narration' from public.account_blueprint_versions blueprint where blueprint.id = episode_record.blueprint_version_id);
  voice := narration_policy -> 'voice';
  for shot in select value from jsonb_array_elements(coalesce(package_record.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    select draft.* into previous
    from public.shot_preparation_drafts draft
    where draft.episode_id = episode_record.id
      and draft.shot_id = shot ->> 'id'
      and draft.input_fingerprint = md5(shot::text)
    order by draft.updated_at desc
    limit 1;
    insert into public.shot_preparation_drafts (episode_id, review_package_id, shot_id, input_fingerprint, audio_mode, video_status, audio_status, confirmation_status, subtitle_text, subtitles_enabled, tts_voice, tts_speaking_rate, current_video_artifact_id, current_video_task_id, current_audio_track_id, current_tts_task_id, selected_material_revision_id, clip_start_seconds, clip_end_seconds, video_duration_seconds, tts_actual_duration_seconds, warning_decision, warning_reason, warning_accepted_at, warning_accepted_by, confirmation_reason, confirmed_at, confirmed_by, skipped_at, skipped_by)
    values (episode_record.id, package_record.id, shot ->> 'id', md5(shot::text), coalesce(previous.audio_mode, 'tts'), case when previous.current_video_artifact_id is not null then 'ready' else 'pending' end, case when coalesce(previous.audio_mode, 'tts') = 'none' or previous.current_audio_track_id is not null then 'ready' else 'pending' end, case when previous.id is not null and previous.confirmation_status in ('confirmed', 'skipped') then previous.confirmation_status else 'pending' end, coalesce(previous.subtitle_text, btrim(shot ->> 'scriptSegment')), coalesce(previous.subtitles_enabled, true), coalesce(previous.tts_voice, nullif(btrim(voice ->> 'name'), '')), coalesce(previous.tts_speaking_rate, case when (voice ->> 'speaking_rate') ~ '^[0-9]+([.][0-9]+)?$' then (voice ->> 'speaking_rate')::numeric else null end), previous.current_video_artifact_id, previous.current_video_task_id, previous.current_audio_track_id, previous.current_tts_task_id, previous.selected_material_revision_id, previous.clip_start_seconds, previous.clip_end_seconds, previous.video_duration_seconds, previous.tts_actual_duration_seconds, coalesce(previous.warning_decision, 'not_required'), previous.warning_reason, previous.warning_accepted_at, previous.warning_accepted_by, previous.confirmation_reason, previous.confirmed_at, previous.confirmed_by, previous.skipped_at, previous.skipped_by)
    on conflict (episode_id, review_package_id, shot_id) do nothing;
  end loop;

  insert into public.audio_tracks (episode_id, source_task_id, source_artifact_id, source_review_package_id, track_kind, cue_id, relative_path, sha256, file_size, start_seconds, duration_seconds)
  select episode_record.id, old_track.source_task_id, old_track.source_artifact_id, package_record.id, old_track.track_kind, old_track.cue_id, old_track.relative_path, old_track.sha256, old_track.file_size, old_track.start_seconds, old_track.duration_seconds
  from public.shot_preparation_drafts current_draft
  join public.shot_preparation_drafts old_draft on old_draft.episode_id = current_draft.episode_id and old_draft.shot_id = current_draft.shot_id and old_draft.input_fingerprint = current_draft.input_fingerprint and old_draft.review_package_id <> current_draft.review_package_id
  join public.audio_tracks old_track on old_track.id = old_draft.current_audio_track_id
  where current_draft.review_package_id = package_record.id
    and not exists (
      select 1 from public.audio_tracks existing
      where existing.episode_id = episode_record.id
        and existing.source_review_package_id = package_record.id
        and existing.track_kind = old_track.track_kind
        and existing.cue_id = old_track.cue_id
        and existing.source_task_id = old_track.source_task_id
        and existing.source_artifact_id = old_track.source_artifact_id
    );

  update public.shot_preparation_drafts current_draft
  set current_audio_track_id = new_track.id, audio_status = 'ready', updated_at = now()
  from public.shot_preparation_drafts old_draft
  join public.audio_tracks old_track on old_track.id = old_draft.current_audio_track_id
  join public.audio_tracks new_track on new_track.episode_id = episode_record.id and new_track.source_review_package_id = package_record.id and new_track.source_task_id = old_track.source_task_id and new_track.cue_id = old_track.cue_id
  where current_draft.review_package_id = package_record.id
    and old_draft.episode_id = current_draft.episode_id
    and old_draft.shot_id = current_draft.shot_id
    and old_draft.input_fingerprint = current_draft.input_fingerprint
    and old_draft.review_package_id <> current_draft.review_package_id;
  return new;
end;
$_$;


--
-- Name: serialize_worker_capacity_configuration(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.serialize_worker_capacity_configuration() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 perform pg_advisory_xact_lock(hashtextextended('loop-worker-global-capacity',0));
 return null;
end $$;


--
-- Name: set_account_archived(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_account_archived(p_account_id uuid, p_archived boolean) RETURNS public.accounts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  membership_role public.member_role;
  updated_account public.accounts;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid()
  for update;
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to archive an account' using errcode = '42501';
  end if;

  update public.accounts
  set archived_at = case when p_archived then now() else null end
  where id = p_account_id
  returning * into updated_account;
  if not found then
    raise exception 'Account does not exist' using errcode = 'P0002';
  end if;

  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (
    p_account_id,
    case when p_archived then 'account_archived' else 'account_restored' end,
    jsonb_build_object('archived_at', updated_account.archived_at),
    auth.uid()
  );
  return updated_account;
end;
$$;


--
-- Name: set_blueprint_archived(uuid, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_blueprint_archived(p_account_id uuid, p_blueprint_version_id uuid, p_archived boolean) RETURNS public.account_blueprint_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  membership_role public.member_role;
  target_blueprint public.account_blueprint_versions;
begin
  select role into membership_role
  from public.account_memberships
  where account_id = p_account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to archive a blueprint version' using errcode = '42501';
  end if;
  select * into target_blueprint
  from public.account_blueprint_versions
  where account_id = p_account_id and id = p_blueprint_version_id
  for update;
  if not found then
    raise exception 'Blueprint version does not belong to this account' using errcode = '22023';
  end if;
  if p_archived and target_blueprint.is_active then
    raise exception 'The active blueprint must be deactivated before it can be archived' using errcode = '22023';
  end if;
  update public.account_blueprint_versions
  set archived_at = case when p_archived then now() else null end
  where id = p_blueprint_version_id
  returning * into target_blueprint;
  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (p_account_id, case when p_archived then 'blueprint_version_archived' else 'blueprint_version_unarchived' end, jsonb_build_object('blueprint_version_id', p_blueprint_version_id, 'version', target_blueprint.version), auth.uid());
  return target_blueprint;
end;
$$;


--
-- Name: set_episode_archived(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_episode_archived(p_episode_id uuid, p_archived boolean) RETURNS public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  updated_episode public.episodes;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
  if not found then
    raise exception 'Owner membership is required to archive an episode' using errcode = '42501';
  end if;

  update public.episodes
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
      updated_at = now()
  where id = p_episode_id
  returning * into updated_episode;

  if current_episode.archived_at is distinct from updated_episode.archived_at then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (
      current_episode.account_id,
      current_episode.id,
      case when p_archived then 'episode_archived' else 'episode_restored' end,
      jsonb_build_object('archived_at', updated_episode.archived_at),
      auth.uid()
    );
  end if;
  return updated_episode;
end;
$$;


--
-- Name: set_episode_audio_source_mode(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_episode_audio_source_mode(p_episode_id uuid, p_audio_source_mode text) RETURNS public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare current_episode public.episodes; updated_episode public.episodes;
begin
  if p_audio_source_mode not in ('source', 'tts') then raise exception 'Audio source mode must be source or tts' using errcode = '22023'; end if;
  select episode.* into current_episode from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to update audio source mode' using errcode = '42501'; end if;
  if current_episode.stage <> 'waiting_input' then raise exception 'Audio source mode can only be changed before production starts' using errcode = '22023'; end if;
  update public.episodes set audio_source_mode = p_audio_source_mode, updated_at = now() where id = p_episode_id returning * into updated_episode;
  if current_episode.audio_source_mode is distinct from updated_episode.audio_source_mode then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, current_episode.id, 'episode_audio_source_mode_updated', jsonb_build_object('previous_mode', current_episode.audio_source_mode, 'audio_source_mode', updated_episode.audio_source_mode), auth.uid());
  end if;
  return updated_episode;
end;
$$;


--
-- Name: set_episode_script_source(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_episode_script_source(p_episode_id uuid, p_script_source text) RETURNS public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  membership_role public.member_role;
begin
  if p_script_source not in ('provided', 'delegated') then
    raise exception 'Script source is invalid' using errcode = '22023';
  end if;
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then
    raise exception 'Owner membership is required to set script source' using errcode = '42501';
  end if;
  if current_episode.stage <> 'waiting_input' or current_episode.main_script_revision_id is not null then
    raise exception 'Script source can only be changed before the main script is fixed' using errcode = '22023';
  end if;
  update public.episodes set script_source = p_script_source, updated_at = now() where id = p_episode_id returning * into current_episode;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'script_source_selected', jsonb_build_object('script_source', p_script_source), auth.uid());
  return current_episode;
end;
$$;


--
-- Name: set_shot_tts_confirmation(uuid, uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_shot_tts_confirmation(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_confirmed boolean) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  draft public.shot_preparation_drafts;
  saved public.shot_preparation_drafts;
  fingerprint text;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found or current_episode.stage <> 'storyboard_approved' then
    raise exception 'Owner shot workbench access is required' using errcode = '42501';
  end if;
  perform public.assert_current_storyboard_shot(p_episode_id, p_review_package_id, p_shot_id);

  select * into draft from public.shot_preparation_drafts
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id)
  for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.audio_mode <> 'tts' then raise exception 'Only TTS shots can confirm narration text' using errcode = '22023'; end if;
  if p_confirmed and coalesce(btrim(draft.tts_text), '') = '' then raise exception '口播内容不能为空' using errcode = '22023'; end if;

  fingerprint := case when p_confirmed then md5(btrim(draft.tts_text)) else null end;
  update public.shot_preparation_drafts
  set tts_text_confirmation_fingerprint = fingerprint,
      tts_text_confirmed_at = case when p_confirmed then now() else null end,
      tts_text_confirmed_by = case when p_confirmed then auth.uid() else null end,
      updated_at = now()
  where id = draft.id
  returning * into saved;
  return saved;
end;
$$;


--
-- Name: shot_composition_playback_duration(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shot_composition_playback_duration(p_clip_segments jsonb, p_composition jsonb) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  segment jsonb;
  slot jsonb;
  segment_index integer;
  segment_duration numeric;
  playback_duration numeric := 0;
begin
  if jsonb_typeof(p_clip_segments) <> 'array' or jsonb_array_length(p_clip_segments) = 0 then
    return 0;
  end if;

  if coalesce(p_composition ->> 'layout', 'full') = 'full' then
    for segment in select value from jsonb_array_elements(p_clip_segments)
    loop
      if jsonb_typeof(segment -> 'start_seconds') = 'number'
        and jsonb_typeof(segment -> 'end_seconds') = 'number'
        and (segment ->> 'end_seconds')::numeric > (segment ->> 'start_seconds')::numeric
      then
        playback_duration := playback_duration + (segment ->> 'end_seconds')::numeric - (segment ->> 'start_seconds')::numeric;
      end if;
    end loop;
    return playback_duration;
  end if;

  playback_duration := null;
  for slot in select value from jsonb_array_elements(coalesce(p_composition -> 'slots', '[]'::jsonb))
  loop
    if jsonb_typeof(slot -> 'clipSegmentIndex') <> 'number' then continue; end if;
    segment_index := (slot ->> 'clipSegmentIndex')::integer;
    segment := p_clip_segments -> segment_index;
    if segment is null
      or jsonb_typeof(segment -> 'start_seconds') <> 'number'
      or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
    then
      continue;
    end if;
    segment_duration := (segment ->> 'end_seconds')::numeric - (segment ->> 'start_seconds')::numeric;
    playback_duration := case when playback_duration is null then segment_duration else least(playback_duration, segment_duration) end;
  end loop;
  return coalesce(playback_duration, 0);
end;
$$;


--
-- Name: FUNCTION shot_composition_playback_duration(p_clip_segments jsonb, p_composition jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.shot_composition_playback_duration(p_clip_segments jsonb, p_composition jsonb) IS 'Full-screen clips play sequentially and sum; multi-slot clips play in parallel and use the shortest active slot as the rendered window.';


--
-- Name: shot_duration_decision(text, numeric, numeric, numeric, numeric, integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shot_duration_decision(p_audio_mode text, p_actual_audio_duration_seconds numeric, p_clip_duration_seconds numeric, p_planned_duration_seconds numeric, p_frame_rate numeric DEFAULT 30, p_allowed_frames integer DEFAULT 2, p_studio_adopted_duration_seconds numeric DEFAULT NULL::numeric) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  actual_audio numeric := case when p_audio_mode = 'none' or p_actual_audio_duration_seconds is null or p_actual_audio_duration_seconds <= 0 then null else p_actual_audio_duration_seconds end;
  clip_duration numeric := case when p_clip_duration_seconds is null or p_clip_duration_seconds <= 0 then null else p_clip_duration_seconds end;
  studio_duration numeric := case when coalesce(p_studio_adopted_duration_seconds, p_clip_duration_seconds) is null or coalesce(p_studio_adopted_duration_seconds, p_clip_duration_seconds) <= 0 then null else coalesce(p_studio_adopted_duration_seconds, p_clip_duration_seconds) end;
  av_delta numeric := case when p_audio_mode = 'none' or clip_duration is null or actual_audio is null then null else actual_audio - clip_duration end;
  plan_delta numeric := case when studio_duration is null then null else studio_duration - p_planned_duration_seconds end;
  tolerance numeric;
  status text;
begin
  if p_audio_mode not in ('none', 'source', 'tts') or p_planned_duration_seconds is null or p_planned_duration_seconds <= 0 or p_frame_rate is null or p_frame_rate <= 0 or p_allowed_frames is null or p_allowed_frames < 0 then
    raise exception 'Invalid shot duration decision inputs' using errcode = '22023';
  end if;
  tolerance := p_allowed_frames / p_frame_rate;
  status := case
    when clip_duration is null then 'pending'
    when p_audio_mode = 'none' then 'not_applicable'
    when actual_audio is null then 'pending'
    when abs(av_delta) <= tolerance then 'synchronized'
    else 'needs_attention'
  end;
  return jsonb_build_object(
    'version', 'shot-duration/v1',
    'audio_mode', p_audio_mode,
    'planned_duration_seconds', p_planned_duration_seconds,
    'clip_duration_seconds', clip_duration,
    'actual_audio_duration_seconds', actual_audio,
    'studio_adopted_duration_seconds', studio_duration,
    'audio_video_delta_seconds', av_delta,
    'plan_delta_seconds', plan_delta,
    'frame_rate', p_frame_rate,
    'allowed_frames', p_allowed_frames,
    'frame_tolerance_seconds', tolerance,
    'status', status
  );
end;
$$;


--
-- Name: shot_duration_settings(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shot_duration_settings(p_episode_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  composition jsonb;
  frame_rate numeric := 30;
  allowed_frames integer := 2;
  candidate numeric;
begin
  select series_version.rules -> 'openchatcut_composition'
    into composition
  from public.episodes episode
  left join public.series_versions series_version on series_version.id = episode.series_version_id
  where episode.id = p_episode_id;

  if jsonb_typeof(composition -> 'frame_rate') = 'number' then
    candidate := (composition ->> 'frame_rate')::numeric;
    if candidate > 0 then frame_rate := candidate; end if;
  end if;
  if jsonb_typeof(composition -> 'allowed_frames') = 'number' then
    candidate := (composition ->> 'allowed_frames')::numeric;
    if candidate >= 0 and candidate = trunc(candidate) then allowed_frames := candidate::integer; end if;
  end if;
  return jsonb_build_object('frame_rate', frame_rate, 'allowed_frames', allowed_frames);
end;
$$;


--
-- Name: shot_tts_configuration_hash(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shot_tts_configuration_hash(p_episode_id uuid, p_draft_id uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  draft public.shot_preparation_drafts;
  episode public.episodes;
  blueprint_policy jsonb;
  narration_config jsonb;
  executor jsonb;
  voice jsonb;
  provider text;
  adapter text;
  model text;
  prompt_version text;
  credential_ref text;
begin
  select * into draft from public.shot_preparation_drafts where id = p_draft_id and episode_id = p_episode_id;
  select * into episode from public.episodes where id = p_episode_id;
  select policy into blueprint_policy from public.account_blueprint_versions where id = episode.blueprint_version_id;
  narration_config := blueprint_policy -> 'narration';
  executor := narration_config -> 'executor';
  provider := executor ->> 'provider';
  adapter := executor ->> 'adapter';
  model := coalesce(nullif(btrim(executor ->> 'model'), ''), 'standard');
  prompt_version := coalesce(nullif(btrim(executor ->> 'prompt_version'), ''), 'narration-v1');
  credential_ref := nullif(btrim(narration_config ->> 'credential_ref'), '');
  voice := jsonb_build_object(
    'language_code', coalesce(nullif(btrim(draft.tts_language_code), ''), nullif(btrim(episode.tts_language_code), ''), 'zh-CN'),
    'name', coalesce(draft.tts_voice, episode.tts_voice),
    'speaking_rate', coalesce(draft.tts_speaking_rate, episode.tts_speaking_rate)
  );
  if coalesce(draft.tts_text, draft.subtitle_text, '') = '' or coalesce(voice ->> 'name', '') = '' or voice ->> 'speaking_rate' is null or provider is null or adapter is null or credential_ref is null then return null; end if;
  return md5(jsonb_build_object('text', coalesce(draft.tts_text, draft.subtitle_text), 'voice', voice, 'provider', provider, 'adapter', adapter, 'model', model, 'prompt_version', prompt_version, 'connection_version_id', credential_ref)::text);
end;
$$;


--
-- Name: skip_shot_preparation(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.skip_shot_preparation(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_reason text) RETURNS public.shot_preparation_drafts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare current_episode public.episodes; draft public.shot_preparation_drafts; saved_draft public.shot_preparation_drafts;
begin
  if coalesce(btrim(p_shot_id), '') = '' or coalesce(btrim(p_reason), '') = '' then raise exception 'Shot skip reason and shot id are required' using errcode = '22023'; end if;
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
  if not found or current_episode.stage <> 'storyboard_approved' then raise exception 'Owner membership and shot workbench stage are required' using errcode = '42501'; end if;
  select * into draft from public.shot_preparation_drafts where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id) for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.confirmation_status = 'skipped' then return draft; end if;
  update public.shot_preparation_drafts
  set confirmation_status = 'skipped', confirmation_reason = btrim(p_reason), skipped_at = now(), skipped_by = auth.uid(), warning_decision = 'not_required', warning_reason = null, warning_accepted_at = null, warning_accepted_by = null, updated_at = now()
  where id = draft.id returning * into saved_draft;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, current_episode.id, 'shot_preparation_skipped', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', draft.shot_id, 'reason', btrim(p_reason)), auth.uid());
  return saved_draft;
end;
$$;


--
-- Name: start_episode_production(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_episode_production(p_episode_id uuid) RETURNS public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare current_episode public.episodes;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;

  if not found then raise exception 'Owner membership is required to start episode production' using errcode = '42501'; end if;
  if current_episode.stage <> 'waiting_input' then raise exception 'Episode production can only start while the episode is waiting for input' using errcode = '22023'; end if;
  if current_episode.main_script_revision_id is null then raise exception 'A confirmed main script is required before starting production' using errcode = '22023'; end if;
  if current_episode.worker_preflight_at is null or current_episode.worker_preflight_at < now() - interval '10 minutes' then raise exception 'A fresh Worker preflight is required before starting episode production' using errcode = '42501'; end if;

  update public.episodes
  set stage = 'script_approved', worker_preflight_at = null, updated_at = now()
  where id = p_episode_id;

  insert into public.state_transitions (episode_id,from_stage,to_stage,reason,actor_id)
  values (p_episode_id,'waiting_input','script_approved','Owner confirmed all production materials are ready; start production.',auth.uid());
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id)
  values (current_episode.account_id,p_episode_id,'episode_production_started',jsonb_build_object('main_script_revision_id',current_episode.main_script_revision_id),auth.uid());

  select episode.* into current_episode from public.episodes episode where episode.id = p_episode_id;
  return current_episode;
end;
$$;


--
-- Name: storyboard_selected_audio_members(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.storyboard_selected_audio_members(p_episode_id uuid, p_review_package_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  selection public.storyboard_audio_selections;
  cue jsonb;
  audio_task public.tasks;
  audio_track public.audio_tracks;
  material public.production_material_revisions;
  episode_duration numeric;
  members jsonb := '[]'::jsonb;
begin
  for selection in
    select candidate.*
    from public.storyboard_audio_selections candidate
    where candidate.episode_id = p_episode_id
      and candidate.review_package_id = p_review_package_id
      and (candidate.cue_id is not null or candidate.material_revision_id is not null)
    order by candidate.target_kind, candidate.target_id, candidate.audio_kind
  loop
    if selection.material_revision_id is not null then
      select candidate.* into material
      from public.production_material_revisions candidate
      join public.material_revision_approvals approval on approval.material_revision_id = candidate.id
      where candidate.id = selection.material_revision_id
        and candidate.episode_id = p_episode_id
        and candidate.material_type = 'audio'
        and candidate.material_purpose = 'background_music';
      if not found then
        raise exception 'Selected background music material is no longer available' using errcode = '22023';
      end if;
      select coalesce(sum((shot ->> 'durationSeconds')::numeric), 0) into episode_duration
      from public.review_packages package,
        jsonb_array_elements(coalesce(package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot
      where package.id = p_review_package_id and package.episode_id = p_episode_id;
      members := members || jsonb_build_array(jsonb_build_object(
        'member_kind', 'soundtrack',
        'member_key', 'bgm:episode',
        'target_kind', 'episode',
        'target_id', p_episode_id::text,
        'cue', jsonb_build_object('id', 'episode-bgm', 'kind', 'bgm', 'startSeconds', 0, 'durationSeconds', episode_duration, 'description', material.source_path),
        'duration_seconds', episode_duration,
        'source_material', jsonb_build_object('id', material.id, 'artifact_type', 'soundtrack_audio', 'relative_path', material.storage_path, 'sha256', material.sha256, 'file_size', material.file_size)
      ));
      continue;
    end if;
    select value into cue
    from public.review_packages package,
      jsonb_array_elements(coalesce(package.context_snapshot #> '{worker_result,storyboard,audioCues}', '[]'::jsonb)) value
    where package.id = p_review_package_id
      and package.episode_id = p_episode_id
      and value ->> 'id' = selection.cue_id
      and value ->> 'kind' = selection.audio_kind;
    if not found then
      raise exception 'Selected storyboard audio cue is no longer available' using errcode = '22023';
    end if;

    select track.* into audio_track
    from public.audio_tracks track
    join public.tasks task on task.id = track.source_task_id
    where track.episode_id = p_episode_id
      and track.source_review_package_id = p_review_package_id
      and track.cue_id = selection.cue_id
      and track.track_kind = selection.audio_kind
      and track.sha256 is not null
      and track.file_size > 0
      and track.duration_seconds > 0
      and task.status = 'completed'
      and task.invalidated_at is null
    order by track.created_at desc
    limit 1;
    if not found then
      raise exception 'Selected BGM and sound effects must be generated before review video creation' using errcode = '22023';
    end if;
    select task.* into audio_task
    from public.tasks task
    where task.id = audio_track.source_task_id;

    members := members || jsonb_build_array(jsonb_build_object(
      'member_kind', 'soundtrack',
      'member_key', format('%s:%s', selection.audio_kind, selection.target_id),
      'target_kind', selection.target_kind,
      'target_id', selection.target_id,
      'cue', cue,
      'task', jsonb_build_object('id', audio_task.id, 'type', audio_task.task_type, 'attempt', audio_task.attempt, 'provider', audio_task.provider, 'model', audio_task.model, 'prompt_version', audio_task.prompt_version),
      'audio_track', jsonb_build_object('id', audio_track.id, 'kind', audio_track.track_kind, 'cue_id', audio_track.cue_id, 'relative_path', audio_track.relative_path, 'sha256', audio_track.sha256, 'file_size', audio_track.file_size, 'start_seconds', audio_track.start_seconds, 'duration_seconds', audio_track.duration_seconds)
    ));
  end loop;
  return members;
end;
$$;


--
-- Name: sync_local_whisperx_alignment_after_task_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_local_whisperx_alignment_after_task_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare draft_id uuid; next_alignment jsonb; next_cues jsonb; has_previous boolean;
begin
  if new.task_type <> 'align_shot_captions' or old.status is not distinct from new.status then return new; end if;
  draft_id:=nullif(new.input_snapshot #>> '{shot_preparation,draft_id}','')::uuid;
  if draft_id is null then return new; end if;
  if new.status='running' then
    update public.shot_preparation_drafts set acoustic_alignment=acoustic_alignment || jsonb_build_object('status','aligning','detail','本地 WhisperX 正在对齐当前音轨；上一版时序仅作历史参考。','generatedAt',now()),updated_at=now() where id=draft_id and pending_alignment_task_id=new.id;
  elsif new.status='completed' then
    next_alignment:=new.last_result -> 'acousticAlignment';
    if public.is_valid_acoustic_alignment(next_alignment) then
      select coalesce(jsonb_agg(jsonb_build_object('id',cue->>'id','text',cue->>'text','start_ms',cue->'startMs','end_ms',cue->'endMs') order by ordinal),'[]'::jsonb) into next_cues from jsonb_array_elements(next_alignment->'cues') with ordinality as aligned(cue,ordinal);
      update public.shot_preparation_drafts set acoustic_alignment=next_alignment,caption_contract=case when next_alignment->>'status' in ('completed','needs_review') and jsonb_array_length(next_cues)>0 then jsonb_set(caption_contract,'{cues}',next_cues) else caption_contract end,pending_alignment_task_id=null,updated_at=now() where id=draft_id and pending_alignment_task_id=new.id;
    else
      update public.shot_preparation_drafts set acoustic_alignment=acoustic_alignment || jsonb_build_object('status',case when jsonb_array_length(coalesce(acoustic_alignment->'cues','[]'::jsonb))>0 then 'stale' else 'failed' end,'detail','Worker 未返回有效的本地 WhisperX 对齐结果。','generatedAt',now()),pending_alignment_task_id=null,updated_at=now() where id=draft_id and pending_alignment_task_id=new.id;
    end if;
  elsif new.status in ('failed','blocked') then
    update public.shot_preparation_drafts set acoustic_alignment=acoustic_alignment || jsonb_build_object('status',case when jsonb_array_length(coalesce(acoustic_alignment->'cues','[]'::jsonb))>0 then 'stale' else 'failed' end,'detail',coalesce(new.last_result #>> '{retry,reason}',new.last_result #>> '{blockers,0,detail}','本地 WhisperX 对齐失败。'),'generatedAt',now()),pending_alignment_task_id=null,updated_at=now() where id=draft_id and pending_alignment_task_id=new.id;
  end if;
  return new;
end;
$$;


--
-- Name: sync_shot_acoustic_alignment_after_task_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_shot_acoustic_alignment_after_task_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  draft public.shot_preparation_drafts;
  track public.audio_tracks;
  created_task public.tasks;
  text_fingerprint text;
  input_version text;
begin
  if new.task_type <> 'generate_narration'
    or old.status is not distinct from new.status
    or new.input_snapshot -> 'acoustic_alignment' is null then
    return new;
  end if;

  select preparation.* into draft
  from public.shot_preparation_drafts preparation
  where preparation.id = nullif(new.input_snapshot #>> '{shot_preparation,draft_id}', '')::uuid
  for update;
  if not found or (
    draft.pending_tts_task_id is distinct from new.id
    and draft.current_tts_task_id is distinct from new.id
  ) then return new; end if;

  if new.status = 'running' then
    update public.shot_preparation_drafts
    set acoustic_alignment = acoustic_alignment || jsonb_build_object(
          'status', 'waiting',
          'detail', '正在生成口播音频；音频可用后再单独执行声学对齐。',
          'generatedAt', now()
        ),
        updated_at = now()
    where id = draft.id;
    return new;
  end if;

  if new.status in ('failed', 'blocked') then
    update public.shot_preparation_drafts
    set acoustic_alignment = acoustic_alignment || jsonb_build_object(
          'status', 'failed', 'method', 'none', 'granularity', 'none',
          'cues', '[]'::jsonb, 'wordCount', 0,
          'detail', coalesce(new.last_result #>> '{retry,reason}', new.last_result #>> '{blockers,0,detail}', '口播音频生成失败。'),
          'generatedAt', now()
        ),
        updated_at = now()
    where id = draft.id;
    return new;
  end if;

  if new.status <> 'completed' then return new; end if;

  select audio.* into track
  from public.audio_tracks audio
  where audio.source_task_id = new.id
    and audio.episode_id = new.episode_id
    and audio.track_kind = 'narration'
    and audio.cue_id is not distinct from draft.shot_id
  order by audio.created_at desc
  limit 1;
  if not found or not draft.subtitles_enabled or btrim(draft.subtitle_text) = '' then return new; end if;

  text_fingerprint := encode(extensions.digest(convert_to(draft.subtitle_text, 'UTF8'), 'sha256'), 'hex');
  input_version := encode(extensions.digest(convert_to(jsonb_build_object(
    'audioSha256', track.sha256,
    'textFingerprint', text_fingerprint,
    'voice', coalesce(draft.tts_voice, ''),
    'speakingRate', coalesce(draft.tts_speaking_rate, 1),
    'provider', 'whisperx',
    'model', 'large-v3',
    'connectionVersionId', null
  )::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.tasks (
    episode_id, task_type, status, input_snapshot, budget_limit_cents,
    max_attempts, provider, model, prompt_version
  ) values (
    new.episode_id, 'align_shot_captions', 'ready', jsonb_build_object(
      'capability', 'acoustic_alignment',
      'shot_preparation', jsonb_build_object(
        'draft_id', draft.id,
        'review_package_id', draft.review_package_id,
        'shot_id', draft.shot_id
      ),
      'executor', jsonb_build_object(
        'provider', 'whisperx', 'adapter', 'whisperx_local',
        'model', 'large-v3', 'prompt_version', 'whisperx-alignment-v1'
      ),
      'acoustic_alignment', jsonb_build_object(
        'confirmed_text', draft.subtitle_text,
        'text_fingerprint', text_fingerprint,
        'audio_relative_path', track.relative_path,
        'audio_sha256', track.sha256,
        'input_version', input_version,
        'voice', coalesce(draft.tts_voice, ''),
        'speaking_rate', coalesce(draft.tts_speaking_rate, 1),
        'strategy', 'auto'
      ),
      'input_artifacts', jsonb_build_array(jsonb_build_object(
        'artifactType', 'audio_track', 'relativePath', track.relative_path,
        'sha256', track.sha256, 'fileSize', track.file_size
      )),
      'output', jsonb_build_object(
        'required_artifact_types', jsonb_build_array('acoustic_alignment_evidence'),
        'content_type', 'application/json',
        'relative_path', format('episodes/%s/alignment/%s-%s.json', new.episode_id, draft.shot_id, input_version),
        'review_stage', 'production_ready'
      ),
      'allowed_tools', jsonb_build_array('read', 'write')
    ), 0, 2, 'whisperx', 'large-v3', 'whisperx-alignment-v1'
  ) returning * into created_task;

  update public.shot_preparation_drafts
  set pending_alignment_task_id = created_task.id,
      acoustic_alignment = jsonb_build_object(
        'version', 'acoustic-alignment/v1', 'status', 'waiting',
        'method', 'none', 'granularity', 'none',
        'inputVersion', input_version, 'audioSha256', track.sha256,
        'textFingerprint', text_fingerprint, 'provider', 'whisperx',
        'model', 'large-v3', 'connectionVersionId', null,
        'wordCount', 0, 'cues', '[]'::jsonb, 'reviewIssues', '[]'::jsonb,
        'attempts', '[]'::jsonb,
        'detail', '口播音频已可试听；声学对齐正在后台排队。',
        'generatedAt', now()
      ),
      updated_at = now()
  where id = draft.id;

  return new;
end;
$$;


--
-- Name: sync_shot_clip_task_after_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_shot_clip_task_after_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  draft_id uuid;
  previous_task_id uuid;
  output_artifact public.artifacts;
begin
  if new.task_type not in ('generate_a_roll', 'generate_b_roll') or new.input_snapshot #>> '{shot_preparation,draft_id}' is null then return new; end if;
  draft_id := (new.input_snapshot #>> '{shot_preparation,draft_id}')::uuid;
  select current_video_task_id into previous_task_id from public.shot_preparation_drafts where id = draft_id;
  if new.status = 'completed' then
    select artifact.* into output_artifact from public.artifacts artifact where artifact.producer_task_id = new.id and artifact.relative_path = new.input_snapshot #>> '{output,relative_path}';
    if not found then raise exception 'Completed shot clip task is missing its output artifact' using errcode = '22023'; end if;
    update public.shot_preparation_drafts
    set current_video_artifact_id = output_artifact.id, current_video_task_id = new.id, pending_video_task_id = null, video_status = 'ready', video_error = null, updated_at = now()
    where id = draft_id and pending_video_task_id = new.id;
    update public.tasks old_task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'A newer validated shot clip became current.'
    where old_task.id = previous_task_id and old_task.id <> new.id and old_task.status = 'completed';
  elsif new.status in ('failed', 'blocked') then
    update public.shot_preparation_drafts
    set video_status = 'failed', pending_video_task_id = null, video_error = coalesce(new.last_result #>> '{retry,reason}', '镜头裁剪任务失败。'), updated_at = now()
    where id = draft_id and pending_video_task_id = new.id;
  end if;
  return new;
end;
$$;


--
-- Name: sync_shot_preview_after_task_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_shot_preview_after_task_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  draft_id uuid;
  proxy public.artifacts;
  project public.artifacts;
begin
  if new.task_type <> 'generate_shot_sync_preview' or new.status not in ('completed', 'failed', 'blocked') then return new; end if;
  draft_id := nullif(new.input_snapshot #>> '{shot_preparation,draft_id}', '')::uuid;
  if draft_id is null then return new; end if;
  if new.status = 'completed' then
    select artifact.* into proxy from public.artifacts artifact where artifact.producer_task_id = new.id and artifact.artifact_type = 'shot_preview_proxy';
    select artifact.* into project from public.artifacts artifact where artifact.producer_task_id = new.id and artifact.artifact_type = 'shot_editable_project';
    if proxy.id is null or project.id is null then return new; end if;
    update public.shot_preparation_drafts target
    set current_preview_artifact_id = proxy.id, current_preview_project_artifact_id = project.id,
        current_preview_task_id = new.id, current_preview_input_fingerprint = new.input_snapshot ->> 'preview_input_fingerprint',
        pending_preview_task_id = null, preview_status = 'ready', preview_error = null, updated_at = now()
    where target.id = draft_id and target.pending_preview_task_id = new.id
      and target.preparation_input_fingerprint = new.input_snapshot ->> 'preview_input_fingerprint';
  else
    update public.shot_preparation_drafts target
    set pending_preview_task_id = null, preview_status = 'failed',
        preview_error = coalesce(new.last_result #>> '{retry,reason}', '同步预览生成失败；上一版可播放代理已保留。'), updated_at = now()
    where target.id = draft_id and target.pending_preview_task_id = new.id;
  end if;
  return new;
end;
$$;


--
-- Name: sync_shot_source_audio_after_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_shot_source_audio_after_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare source_task public.tasks; draft_id uuid;
begin
  select task.* into source_task from public.tasks task where task.id = new.source_task_id;
  if source_task.task_type <> 'extract_embedded_audio' or source_task.input_snapshot #>> '{shot_preparation,draft_id}' is null or new.track_kind <> 'source' then return new; end if;
  draft_id := (source_task.input_snapshot #>> '{shot_preparation,draft_id}')::uuid;
  update public.shot_preparation_drafts
  set current_audio_track_id = new.id, pending_source_audio_task_id = null, audio_status = 'ready', source_audio_duration_seconds = new.duration_seconds, source_audio_error = null, updated_at = now()
  where id = draft_id and audio_mode = 'source' and pending_source_audio_task_id = new.source_task_id
    and current_video_artifact_id = (source_task.input_snapshot #>> '{source_video_artifact,id}')::uuid;
  return new;
end;
$$;


--
-- Name: sync_shot_source_audio_task_after_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_shot_source_audio_task_after_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare draft_id uuid; failure_reason text;
begin
  if new.task_type <> 'extract_embedded_audio' or new.input_snapshot #>> '{shot_preparation,draft_id}' is null then return new; end if;
  draft_id := (new.input_snapshot #>> '{shot_preparation,draft_id}')::uuid;
  failure_reason := coalesce(new.last_result #>> '{blockers,0,detail}', new.last_result #>> '{retry,reason}', '原声提取任务失败，请重试。');
  update public.shot_preparation_drafts
  set audio_status = case when new.status = 'failed' then 'failed' else 'running' end,
      source_audio_error = case when new.status = 'failed' then failure_reason else null end,
      updated_at = now()
  where id = draft_id and pending_source_audio_task_id = new.id and new.status in ('ready', 'running', 'failed');
  return new;
end;
$$;


--
-- Name: sync_shot_tts_audio_after_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_shot_tts_audio_after_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  source_task public.tasks;
begin
  select task.* into source_task
  from public.tasks task
  where task.id = new.source_task_id;
  if not found then return new; end if;

  if source_task.task_type <> 'generate_narration'
    or source_task.status <> 'completed'
    or new.track_kind <> 'narration'
    or source_task.input_snapshot #>> '{shot_preparation,draft_id}' is null then
    return new;
  end if;

  update public.shot_preparation_drafts
  set current_audio_track_id = new.id,
      current_tts_task_id = new.source_task_id,
      pending_tts_task_id = null,
      audio_status = 'ready',
      tts_actual_duration_seconds = new.duration_seconds,
      tts_error = null,
      updated_at = now()
  where id = (source_task.input_snapshot #>> '{shot_preparation,draft_id}')::uuid
    and episode_id = source_task.episode_id
    and audio_mode = 'tts'
    and pending_tts_task_id = new.source_task_id
    and new.episode_id = source_task.episode_id
    and new.source_review_package_id is not distinct from review_package_id
    and new.cue_id is not distinct from shot_id;
  return new;
end;
$$;


--
-- Name: sync_shot_tts_task_after_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_shot_tts_task_after_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  draft_id uuid;
  failure_reason text;
begin
  if new.task_type <> 'generate_narration' then return new; end if;
  draft_id := nullif(new.input_snapshot #>> '{shot_preparation,draft_id}', '')::uuid;
  if draft_id is null then return new; end if;
  failure_reason := coalesce(new.last_result #>> '{blockers,0,detail}', new.last_result #>> '{retry,reason}', 'TTS 任务失败，请重试。');
  update public.shot_preparation_drafts
  set audio_status = case when new.status = 'failed' then 'failed' else 'running' end,
      tts_error = case when new.status = 'failed' then failure_reason else null end,
      updated_at = now()
  where id = draft_id and pending_tts_task_id = new.id and new.status in ('ready', 'running', 'failed');
  return new;
end;
$$;


--
-- Name: transition_episode(uuid, public.episode_stage, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transition_episode(p_episode_id uuid, p_to_stage public.episode_stage, p_reason text) RETURNS public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  current_episode public.episodes;
  previous_stage public.episode_stage;
  membership_role public.member_role;
  owner_approval_stages public.episode_stage[] := array['script_approved','visual_approved','storyboard_approved','render_ready','qc_passed','publish_ready','published']::public.episode_stage[];
  review_stages public.episode_stage[] := array['script_review','visual_review','storyboard_review','production_ready','qc_review','publishing_review']::public.episode_stage[];
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Transition reason is required' using errcode = '22023'; end if;
  select * into current_episode from public.episodes where id = p_episode_id for update;
  if not found then raise exception 'Episode % does not exist', p_episode_id using errcode = 'P0002'; end if;
  if not public.is_allowed_episode_transition(current_episode.stage, p_to_stage) then raise exception 'Invalid transition from % to %', current_episode.stage, p_to_stage using errcode = '22023'; end if;
  select role into membership_role from public.account_memberships where account_id = current_episode.account_id and user_id = auth.uid();
  if membership_role is null then raise exception 'No membership for this account' using errcode = '42501'; end if;
  if (p_to_stage = any(owner_approval_stages) or current_episode.stage = any(review_stages)) and membership_role <> 'owner' then raise exception 'Owner approval is required for this review decision' using errcode = '42501'; end if;
  if p_to_stage = 'qc_passed' and exists (select 1 from public.qc_review_issues issue where issue.review_package_id = (select package.id from public.review_packages package where package.episode_id = p_episode_id and package.stage = 'qc_review' and package.invalidated_at is null order by package.revision_number desc limit 1) and issue.severity = 'blocking' and issue.status = 'open') then raise exception 'Open blocking QC issues must be resolved before approval' using errcode = '22023'; end if; if not public.has_required_artifacts(p_episode_id, p_to_stage) then raise exception 'Required artifacts are missing for %', p_to_stage using errcode = '22023'; end if;
  previous_stage := current_episode.stage;
  update public.episodes set stage = p_to_stage, updated_at = now() where id = p_episode_id returning * into current_episode;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (p_episode_id, previous_stage, p_to_stage, btrim(p_reason), auth.uid());
  if p_to_stage = any(owner_approval_stages) then
    insert into public.approvals (episode_id, stage, decision, reason, actor_id) values (p_episode_id, p_to_stage, 'approved', btrim(p_reason), auth.uid());
  elsif previous_stage = any(review_stages) then
    insert into public.approvals (episode_id, stage, decision, reason, actor_id) values (p_episode_id, previous_stage, 'changes_requested', btrim(p_reason), auth.uid());
  end if;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, p_episode_id, 'stage_transition', jsonb_build_object('to_stage', p_to_stage, 'reason', btrim(p_reason)), auth.uid());
  return current_episode;
end;
$$;


--
-- Name: update_current_blueprint(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_current_blueprint(p_account_id uuid, p_policy jsonb) RETURNS public.account_blueprint_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_account public.accounts;
  snapshot_blueprint public.account_blueprint_versions;
  updated_blueprint public.account_blueprint_versions;
  next_snapshot_version integer;
begin
  if jsonb_typeof(p_policy) <> 'object' then
    raise exception 'Blueprint policy must be a JSON object' using errcode = '22023';
  end if;

  select account.* into current_account
  from public.accounts account
  join public.account_memberships membership
    on membership.account_id = account.id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where account.id = p_account_id
  for update of account;
  if not found then
    raise exception 'Owner membership is required to update a blueprint' using errcode = '42501';
  end if;
  if current_account.current_blueprint_version_id is null then
    raise exception 'The account has no current blueprint' using errcode = '22023';
  end if;

  select blueprint.* into updated_blueprint
  from public.account_blueprint_versions blueprint
  where blueprint.account_id = p_account_id
    and blueprint.id = current_account.current_blueprint_version_id
    and blueprint.is_active
    and blueprint.archived_at is null
  for update;
  if not found then
    raise exception 'The current blueprint is unavailable' using errcode = '22023';
  end if;

  if exists (select 1 from public.episodes where blueprint_version_id = updated_blueprint.id) then
    select coalesce(max(version), 0) + 1 into next_snapshot_version
    from public.account_blueprint_versions
    where account_id = p_account_id;
    insert into public.account_blueprint_versions (account_id, version, policy, is_active, archived_at, is_snapshot)
    values (updated_blueprint.account_id, next_snapshot_version, updated_blueprint.policy, false, now(), true)
    returning * into snapshot_blueprint;
    update public.episodes
    set blueprint_version_id = snapshot_blueprint.id
    where blueprint_version_id = updated_blueprint.id;
  end if;

  update public.account_blueprint_versions
  set policy = p_policy
  where id = updated_blueprint.id
  returning * into updated_blueprint;

  insert into public.audit_events (account_id, event_type, payload, actor_id)
  values (
    p_account_id,
    'blueprint_policy_updated',
    jsonb_build_object('blueprint_version_id', updated_blueprint.id, 'version', updated_blueprint.version),
    auth.uid()
  );
  return updated_blueprint;
end;
$$;


--
-- Name: update_episode_title(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_episode_title(p_episode_id uuid, p_title text) RETURNS public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_episode public.episodes;
  updated_episode public.episodes;
  next_title text := btrim(coalesce(p_title, ''));
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership
    on membership.account_id = episode.account_id
   and membership.user_id = auth.uid()
   and membership.role = 'owner'
  where episode.id = p_episode_id
  for update of episode;
  if not found then
    raise exception 'Owner membership is required to update an episode title' using errcode = '42501';
  end if;

  update public.episodes
  set title = next_title, updated_at = now()
  where id = p_episode_id
  returning * into updated_episode;

  if current_episode.title is distinct from updated_episode.title then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (
      current_episode.account_id,
      current_episode.id,
      'episode_title_updated',
      jsonb_build_object('previous_title', current_episode.title, 'title', updated_episode.title),
      auth.uid()
    );
  end if;
  return updated_episode;
end;
$$;


--
-- Name: update_external_connection(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_external_connection(p_connection_id uuid, p_name text, p_description text) RETURNS public.external_connections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare updated_connection public.external_connections;
begin
  if auth.uid() is null then raise exception 'Owner login is required' using errcode = '42501'; end if;
  if char_length(trim(p_name)) not between 1 and 100 or char_length(coalesce(p_description, '')) > 500 then raise exception 'Connection name or description is invalid' using errcode = '22023'; end if;
  update public.external_connections set name = trim(p_name), description = trim(coalesce(p_description, '')) where id = p_connection_id and created_by = auth.uid() returning * into updated_connection;
  if not found then raise exception 'External connection does not exist' using errcode = 'P0002'; end if;
  return updated_connection;
end;
$$;


--
-- Name: validate_blueprint_external_connections(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_blueprint_external_connections() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare capability_key text; connection_ref text; expected_provider text; expected_adapter text;
begin
  foreach capability_key in array array['b_roll', 'soundtrack', 'narration', 'static_visual'] loop
    connection_ref := nullif(btrim(new.policy #>> array[capability_key, 'credential_ref']), '');
    if connection_ref is null then continue; end if;
    if capability_key in ('static_visual', 'narration') then
      expected_provider := new.policy #>> array[capability_key, 'executor', 'provider'];
      expected_adapter := new.policy #>> array[capability_key, 'executor', 'adapter'];
      if capability_key = 'static_visual' and (expected_provider, expected_adapter) not in (('openai', 'openai_images'), ('cloudflare', 'workers_ai_images')) then
        raise exception 'static_visual blueprint must use a registered image Adapter' using errcode = '22023';
      end if;
      if capability_key = 'narration' and (expected_provider, expected_adapter) not in (('google_tts', 'google_tts'), ('volcengine_tts', 'volcengine_tts')) then
        raise exception 'narration blueprint must use a registered TTS Adapter' using errcode = '22023';
      end if;
    else
      expected_provider := case capability_key when 'b_roll' then 'pexels' else 'freesound' end;
      expected_adapter := case capability_key when 'b_roll' then 'pexels_video' else 'freesound_preview' end;
    end if;
    if connection_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (
      select 1 from public.external_connection_versions version
      join public.external_connections connection on connection.id = version.connection_id
      join public.account_memberships membership on membership.account_id = new.account_id and membership.user_id = connection.created_by and membership.role = 'owner'
      where version.id = connection_ref::uuid and connection.created_by = auth.uid() and connection.current_version_id = version.id and version.revoked_at is null and version.provider = expected_provider and version.adapter = expected_adapter and public.connection_version_is_verified(version.id)
    ) then raise exception '% blueprint must reference this Owner’s current verified % connection version', capability_key, expected_provider using errcode = '22023'; end if;
  end loop;
  return new;
end;
$_$;


--
-- Name: worker_required_tools(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_required_tools(p_capability text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_array('read', 'write');
$$;


--
-- Name: worker_resource_limits(jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_resource_limits(p_input jsonb, p_capacity integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare runtime jsonb:=public.worker_runtime_constraints(p_input,p_capacity);
 provider text:=coalesce(nullif(p_input#>>'{executor,provider}',''),p_input->>'provider','unknown');
 adapter text:=coalesce(nullif(p_input#>>'{executor,adapter}',''),p_input#>>'{media,adapter}','default');
 credential text:=nullif(p_input->>'credential_ref',''); limits jsonb;
begin
 limits:=jsonb_build_array(
  jsonb_build_object('key','provider:'||provider,'limit',least(coalesce((runtime#>>'{source,provider_or_connection_limit}')::integer,(runtime#>>'{source,adapter_safety_limit}')::integer),p_capacity)),
  jsonb_build_object('key','adapter:'||provider||':'||adapter,'limit',(runtime->>'effective_concurrency')::integer),
  jsonb_build_object('key','connection:'||coalesce(credential,provider||':'||adapter||':shared'),'limit',(runtime->>'effective_concurrency')::integer)
 );
 if provider in ('ffmpeg','openchatcut','whisperx') then
  limits:=limits||jsonb_build_array(jsonb_build_object('key','host:cpu','limit',1));
 end if;
 if provider in ('ffmpeg','openchatcut') then
  limits:=limits||jsonb_build_array(jsonb_build_object('key','host:render','limit',1));
 end if;
 if provider in ('pexels','freesound') then
  limits:=limits||jsonb_build_array(jsonb_build_object('key','host:download','limit',least(3,p_capacity)));
 end if;
 select jsonb_agg(jsonb_build_object('key',r.value->>'key','limit',
   least((r.value->>'limit')::integer,coalesce(c.capacity,(r.value->>'limit')::integer))) order by r.value->>'key')
 into limits from jsonb_array_elements(limits) r
 left join public.worker_resource_ceilings c on c.resource_key=r.value->>'key';
 return limits;
end $$;


--
-- Name: worker_retry_backoff(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_retry_backoff() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 if old.status='running' and new.status='ready' then
  new.available_at:=clock_timestamp()+make_interval(secs=>least(30,power(2,least(greatest(new.attempt-1,0),5)))::integer);
 end if;
 return new;
end $$;


--
-- Name: worker_retry_delay_ms(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_retry_delay_ms() RETURNS integer
    LANGUAGE sql
    SET search_path TO ''
    AS $$
 select case when min(available_at) is null then 0 else
   least(30000,greatest(1,ceil(extract(epoch from(min(available_at)-clock_timestamp()))*1000)))::integer end
 from public.tasks
 where status='ready' and invalidated_at is null and attempt<max_attempts
   and provider in ('codex','google_tts','volcengine_tts','pexels','ffmpeg','freesound','openchatcut','openai','cloudflare','whisperx')
   and available_at>clock_timestamp() and available_at<'infinity'::timestamptz;
$$;


--
-- Name: worker_runtime_constraints(jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_runtime_constraints(p_input_snapshot jsonb, p_worker_capacity integer DEFAULT 1) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  provider text := coalesce(nullif(btrim(p_input_snapshot #>> '{executor,provider}'), ''), nullif(btrim(p_input_snapshot ->> 'provider'), ''), 'unknown');
  adapter text := coalesce(nullif(btrim(p_input_snapshot #>> '{executor,adapter}'), ''), nullif(btrim(p_input_snapshot #>> '{media,adapter}'), ''), 'default');
  provider_limit integer;
  adapter_limit integer;
  worker_limit integer := case when p_worker_capacity > 0 then p_worker_capacity else 1 end;
  credential_key text := coalesce(nullif(btrim(p_input_snapshot ->> 'credential_ref'), ''), 'shared');
  group_key text;
begin
  adapter_limit := case adapter
    when 'pexels_video' then 3
    when 'google_tts' then 2
    when 'volcengine_tts' then 2
    when 'freesound_preview' then 1
    when 'openai_images' then 1
    when 'workers_ai_images' then 1
    when 'openchatcut_card_video' then 1
    else 1
  end;
  provider_limit := case
    when provider = 'pexels' and adapter = 'pexels_video' then 3
    when provider = 'google_tts' and adapter = 'google_tts' then 2
    when provider = 'volcengine_tts' and adapter = 'volcengine_tts' then 2
    else null
  end;
  group_key := format('%s:%s:%s', provider, adapter, credential_key);
  return jsonb_build_object(
    'version', 'worker-runtime/v1',
    'concurrency_group', group_key,
    'effective_concurrency', least(coalesce(provider_limit, adapter_limit), adapter_limit, worker_limit),
    'source', jsonb_build_object(
      'provider_or_connection_limit', provider_limit,
      'adapter_safety_limit', adapter_limit,
      'worker_capacity', worker_limit
    )
  );
end;
$$;


--
-- Name: account_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_memberships (
    account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.member_role NOT NULL
);


--
-- Name: approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    stage public.episode_stage NOT NULL,
    decision text NOT NULL,
    reason text NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    review_package_id uuid,
    CONSTRAINT approvals_decision_check CHECK ((decision = ANY (ARRAY['approved'::text, 'changes_requested'::text]))),
    CONSTRAINT approvals_reason_check CHECK ((char_length(TRIM(BOTH FROM reason)) > 0))
);


--
-- Name: asset_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_locks (
    resource_key text NOT NULL,
    episode_id uuid NOT NULL,
    locked_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: audio_tracks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audio_tracks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    source_task_id uuid NOT NULL,
    source_artifact_id uuid NOT NULL,
    source_review_package_id uuid,
    track_kind text NOT NULL,
    cue_id text,
    relative_path text NOT NULL,
    sha256 text NOT NULL,
    file_size bigint NOT NULL,
    start_seconds numeric(12,3) DEFAULT 0 NOT NULL,
    duration_seconds numeric(12,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_material_revision_id uuid,
    CONSTRAINT audio_tracks_duration_seconds_check CHECK ((duration_seconds > (0)::numeric)),
    CONSTRAINT audio_tracks_file_size_check CHECK ((file_size >= 0)),
    CONSTRAINT audio_tracks_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT audio_tracks_start_seconds_check CHECK ((start_seconds >= (0)::numeric)),
    CONSTRAINT audio_tracks_track_kind_check CHECK ((track_kind = ANY (ARRAY['narration'::text, 'source'::text, 'derived'::text, 'bgm'::text, 'sfx'::text])))
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    episode_id uuid,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: episode_read_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.episode_read_revisions (
    episode_id uuid NOT NULL,
    section text NOT NULL,
    item_id text DEFAULT ''::text NOT NULL,
    revision bigint DEFAULT 1 NOT NULL
);


--
-- Name: external_connection_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_connection_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connection_id uuid NOT NULL,
    status text NOT NULL,
    detail text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    connection_version_id uuid NOT NULL,
    CONSTRAINT external_connection_verifications_detail_check CHECK (((char_length(TRIM(BOTH FROM detail)) >= 1) AND (char_length(TRIM(BOTH FROM detail)) <= 500))),
    CONSTRAINT external_connection_verifications_status_check CHECK ((status = ANY (ARRAY['verified'::text, 'invalid'::text, 'retryable'::text])))
);


--
-- Name: material_revision_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_revision_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_revision_id uuid NOT NULL,
    approved_by uuid NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_delivery_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_delivery_events (
    event_id uuid NOT NULL,
    outcome text DEFAULT 'pending'::text NOT NULL,
    delivery_token uuid,
    reserved_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT notification_delivery_events_check CHECK (((outcome = ANY (ARRAY['reserved'::text, 'accepted'::text, 'skipped'::text, 'uncertain'::text])) = (delivery_token IS NOT NULL))),
    CONSTRAINT notification_delivery_events_outcome_check CHECK ((outcome = ANY (ARRAY['pending'::text, 'historical'::text, 'reserved'::text, 'accepted'::text, 'skipped'::text, 'uncertain'::text])))
);


--
-- Name: notification_delivery_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_delivery_state (
    singleton boolean DEFAULT true NOT NULL,
    initialized boolean DEFAULT false NOT NULL,
    CONSTRAINT notification_delivery_state_singleton_check CHECK (singleton)
);


--
-- Name: pre_render_review_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_render_review_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_package_id uuid NOT NULL,
    member_key text NOT NULL,
    member_kind text NOT NULL,
    source_task_id uuid,
    artifact_id uuid,
    audio_track_id uuid,
    evidence_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_material_revision_id uuid,
    CONSTRAINT pre_render_review_members_evidence_snapshot_check CHECK ((jsonb_typeof(evidence_snapshot) = 'object'::text)),
    CONSTRAINT pre_render_review_members_member_key_check CHECK ((btrim(member_key) <> ''::text)),
    CONSTRAINT pre_render_review_members_member_kind_check CHECK ((member_kind = ANY (ARRAY['shot_media'::text, 'narration'::text, 'soundtrack'::text]))),
    CONSTRAINT pre_render_review_members_source_check CHECK ((num_nonnulls(artifact_id, audio_track_id, source_material_revision_id) = 1))
);


--
-- Name: production_dependencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_dependencies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    upstream_kind text NOT NULL,
    upstream_id uuid NOT NULL,
    downstream_kind text NOT NULL,
    downstream_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_dependencies_downstream_kind_check CHECK ((downstream_kind = ANY (ARRAY['task'::text, 'review_package'::text]))),
    CONSTRAINT production_dependencies_upstream_kind_check CHECK ((upstream_kind = ANY (ARRAY['material_revision'::text, 'series_version'::text, 'review_package'::text])))
);


--
-- Name: production_invalidations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_invalidations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    upstream_kind text NOT NULL,
    upstream_id uuid NOT NULL,
    target_kind text NOT NULL,
    target_id uuid NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_invalidations_reason_check CHECK ((btrim(reason) <> ''::text)),
    CONSTRAINT production_invalidations_target_kind_check CHECK ((target_kind = ANY (ARRAY['task'::text, 'review_package'::text, 'approval'::text]))),
    CONSTRAINT production_invalidations_upstream_kind_check CHECK ((upstream_kind = ANY (ARRAY['material_revision'::text, 'series_version'::text, 'review_package'::text])))
);


--
-- Name: review_render_composition_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_render_composition_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    pre_render_review_package_id uuid NOT NULL,
    revision_number integer NOT NULL,
    caption_style text NOT NULL,
    pacing text NOT NULL,
    crop text NOT NULL,
    transition text NOT NULL,
    layout text NOT NULL,
    reason text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    composition_config jsonb DEFAULT '{"crop": "cover", "width": 1080, "height": 1920, "layout": "lower_third", "pacing": "standard", "transition": "fade", "bgm_gain_db": -12, "sfx_gain_db": -6, "aspect_ratio": "9:16", "caption_style": "cinematic", "captions_enabled": true, "narration_gain_db": 0}'::jsonb NOT NULL,
    CONSTRAINT review_render_composition_revisions_caption_style_check CHECK ((caption_style = ANY (ARRAY['cinematic'::text, 'minimal'::text]))),
    CONSTRAINT review_render_composition_revisions_crop_check CHECK ((crop = ANY (ARRAY['cover'::text, 'contain'::text]))),
    CONSTRAINT review_render_composition_revisions_layout_check CHECK ((layout = ANY (ARRAY['lower_third'::text, 'center'::text]))),
    CONSTRAINT review_render_composition_revisions_pacing_check CHECK ((pacing = ANY (ARRAY['gentle'::text, 'standard'::text, 'compact'::text]))),
    CONSTRAINT review_render_composition_revisions_reason_check CHECK ((btrim(reason) <> ''::text)),
    CONSTRAINT review_render_composition_revisions_revision_number_check CHECK ((revision_number > 0)),
    CONSTRAINT review_render_composition_revisions_transition_check CHECK ((transition = ANY (ARRAY['fade'::text, 'cut'::text])))
);


--
-- Name: series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT series_name_check CHECK ((char_length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: state_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_transitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    episode_id uuid NOT NULL,
    from_stage public.episode_stage,
    to_stage public.episode_stage NOT NULL,
    reason text NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: storyboard_review_shots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storyboard_review_shots (
    review_package_id uuid NOT NULL,
    shot_id text NOT NULL,
    CONSTRAINT storyboard_review_shots_shot_id_check CHECK ((char_length(btrim(shot_id)) > 0))
);


--
-- Name: task_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    attempt integer NOT NULL,
    task_package jsonb NOT NULL,
    result jsonb,
    status public.task_status DEFAULT 'running'::public.task_status NOT NULL,
    actual_cost_cents integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    lease_token uuid,
    CONSTRAINT task_runs_actual_cost_cents_check CHECK ((actual_cost_cents >= 0)),
    CONSTRAINT task_runs_attempt_check CHECK ((attempt >= 0))
);


--
-- Name: worker_episode_turns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_episode_turns (
    episode_id uuid NOT NULL,
    last_turn bigint NOT NULL
);


--
-- Name: worker_resource_ceilings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_resource_ceilings (
    resource_key text NOT NULL,
    capacity integer NOT NULL,
    CONSTRAINT worker_resource_ceilings_capacity_check CHECK (((capacity >= 1) AND (capacity <= 64))),
    CONSTRAINT worker_resource_ceilings_resource_key_check CHECK ((resource_key ~ '^(provider|adapter|connection|host):.+$'::text))
);


--
-- Name: worker_scheduler_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_scheduler_settings (
    singleton boolean DEFAULT true NOT NULL,
    capacity integer DEFAULT 2 NOT NULL,
    turn bigint DEFAULT 0 NOT NULL,
    CONSTRAINT worker_scheduler_settings_capacity_check CHECK (((capacity >= 1) AND (capacity <= 64))),
    CONSTRAINT worker_scheduler_settings_singleton_check CHECK (singleton)
);


--
-- Name: schema_migrations; Type: TABLE; Schema: supabase_migrations; Owner: -
--

CREATE TABLE supabase_migrations.schema_migrations (
    version text NOT NULL,
    statements text[],
    name text
);


--
-- Name: account_blueprint_versions account_blueprint_versions_account_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_blueprint_versions
    ADD CONSTRAINT account_blueprint_versions_account_id_id_key UNIQUE (account_id, id);


--
-- Name: account_blueprint_versions account_blueprint_versions_account_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_blueprint_versions
    ADD CONSTRAINT account_blueprint_versions_account_id_version_key UNIQUE (account_id, version);


--
-- Name: account_blueprint_versions account_blueprint_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_blueprint_versions
    ADD CONSTRAINT account_blueprint_versions_pkey PRIMARY KEY (id);


--
-- Name: account_memberships account_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_memberships
    ADD CONSTRAINT account_memberships_pkey PRIMARY KEY (account_id, user_id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_slug_key UNIQUE (slug);


--
-- Name: approvals approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_pkey PRIMARY KEY (id);


--
-- Name: artifacts artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_pkey PRIMARY KEY (id);


--
-- Name: asset_locks asset_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_locks
    ADD CONSTRAINT asset_locks_pkey PRIMARY KEY (resource_key);


--
-- Name: audio_track_annotations audio_track_annotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_track_annotations
    ADD CONSTRAINT audio_track_annotations_pkey PRIMARY KEY (id);


--
-- Name: audio_tracks audio_tracks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: episode_read_revisions episode_read_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.episode_read_revisions
    ADD CONSTRAINT episode_read_revisions_pkey PRIMARY KEY (episode_id, section, item_id);


--
-- Name: episodes episodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.episodes
    ADD CONSTRAINT episodes_pkey PRIMARY KEY (id);


--
-- Name: external_connection_verifications external_connection_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_connection_verifications
    ADD CONSTRAINT external_connection_verifications_pkey PRIMARY KEY (id);


--
-- Name: external_connection_versions external_connection_versions_connection_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_connection_versions
    ADD CONSTRAINT external_connection_versions_connection_id_version_key UNIQUE (connection_id, version);


--
-- Name: external_connection_versions external_connection_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_connection_versions
    ADD CONSTRAINT external_connection_versions_pkey PRIMARY KEY (id);


--
-- Name: external_connections external_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_connections
    ADD CONSTRAINT external_connections_pkey PRIMARY KEY (id);


--
-- Name: material_revision_approvals material_revision_approvals_material_revision_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_revision_approvals
    ADD CONSTRAINT material_revision_approvals_material_revision_id_key UNIQUE (material_revision_id);


--
-- Name: material_revision_approvals material_revision_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_revision_approvals
    ADD CONSTRAINT material_revision_approvals_pkey PRIMARY KEY (id);


--
-- Name: notification_delivery_events notification_delivery_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery_events
    ADD CONSTRAINT notification_delivery_events_pkey PRIMARY KEY (event_id);


--
-- Name: notification_delivery_state notification_delivery_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery_state
    ADD CONSTRAINT notification_delivery_state_pkey PRIMARY KEY (singleton);


--
-- Name: pre_render_review_member_decisions pre_render_review_member_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_render_review_member_decisions
    ADD CONSTRAINT pre_render_review_member_decisions_pkey PRIMARY KEY (review_package_id, member_key);


--
-- Name: pre_render_review_members pre_render_review_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_render_review_members
    ADD CONSTRAINT pre_render_review_members_pkey PRIMARY KEY (id);


--
-- Name: pre_render_review_members pre_render_review_members_review_package_id_member_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_render_review_members
    ADD CONSTRAINT pre_render_review_members_review_package_id_member_key_key UNIQUE (review_package_id, member_key);


--
-- Name: production_dependencies production_dependencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_dependencies
    ADD CONSTRAINT production_dependencies_pkey PRIMARY KEY (id);


--
-- Name: production_dependencies production_dependencies_upstream_kind_upstream_id_downstrea_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_dependencies
    ADD CONSTRAINT production_dependencies_upstream_kind_upstream_id_downstrea_key UNIQUE (upstream_kind, upstream_id, downstream_kind, downstream_id);


--
-- Name: production_invalidations production_invalidations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_invalidations
    ADD CONSTRAINT production_invalidations_pkey PRIMARY KEY (id);


--
-- Name: production_invalidations production_invalidations_upstream_kind_upstream_id_target_k_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_invalidations
    ADD CONSTRAINT production_invalidations_upstream_kind_upstream_id_target_k_key UNIQUE (upstream_kind, upstream_id, target_kind, target_id);


--
-- Name: production_material_revisions production_material_revisions_episode_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_material_revisions
    ADD CONSTRAINT production_material_revisions_episode_id_id_key UNIQUE (episode_id, id);


--
-- Name: production_material_revisions production_material_revisions_episode_id_material_type_revi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_material_revisions
    ADD CONSTRAINT production_material_revisions_episode_id_material_type_revi_key UNIQUE (episode_id, material_type, revision_number);


--
-- Name: production_material_revisions production_material_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_material_revisions
    ADD CONSTRAINT production_material_revisions_pkey PRIMARY KEY (id);


--
-- Name: prompt_versions prompt_versions_account_id_capability_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_account_id_capability_version_key UNIQUE (account_id, capability, version);


--
-- Name: prompt_versions prompt_versions_account_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_account_id_slug_key UNIQUE (account_id, slug);


--
-- Name: prompt_versions prompt_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_pkey PRIMARY KEY (id);


--
-- Name: qc_review_issues qc_review_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_review_issues
    ADD CONSTRAINT qc_review_issues_pkey PRIMARY KEY (id);


--
-- Name: review_annotations review_annotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_annotations
    ADD CONSTRAINT review_annotations_pkey PRIMARY KEY (id);


--
-- Name: review_packages review_packages_episode_id_stage_revision_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_packages
    ADD CONSTRAINT review_packages_episode_id_stage_revision_number_key UNIQUE (episode_id, stage, revision_number);


--
-- Name: review_packages review_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_packages
    ADD CONSTRAINT review_packages_pkey PRIMARY KEY (id);


--
-- Name: review_packages review_packages_task_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_packages
    ADD CONSTRAINT review_packages_task_run_id_key UNIQUE (task_run_id);


--
-- Name: review_render_composition_revisions review_render_composition_rev_pre_render_review_package_id__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_render_composition_revisions
    ADD CONSTRAINT review_render_composition_rev_pre_render_review_package_id__key UNIQUE (pre_render_review_package_id, revision_number);


--
-- Name: review_render_composition_revisions review_render_composition_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_render_composition_revisions
    ADD CONSTRAINT review_render_composition_revisions_pkey PRIMARY KEY (id);


--
-- Name: series series_account_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series
    ADD CONSTRAINT series_account_id_id_key UNIQUE (account_id, id);


--
-- Name: series series_account_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series
    ADD CONSTRAINT series_account_id_name_key UNIQUE (account_id, name);


--
-- Name: series series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series
    ADD CONSTRAINT series_pkey PRIMARY KEY (id);


--
-- Name: series_versions series_versions_account_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series_versions
    ADD CONSTRAINT series_versions_account_id_id_key UNIQUE (account_id, id);


--
-- Name: series_versions series_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series_versions
    ADD CONSTRAINT series_versions_pkey PRIMARY KEY (id);


--
-- Name: series_versions series_versions_series_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series_versions
    ADD CONSTRAINT series_versions_series_id_version_key UNIQUE (series_id, version);


--
-- Name: shot_preparation_drafts shot_preparation_drafts_episode_id_review_package_id_shot_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_episode_id_review_package_id_shot_i_key UNIQUE (episode_id, review_package_id, shot_id);


--
-- Name: shot_preparation_drafts shot_preparation_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_pkey PRIMARY KEY (id);


--
-- Name: state_transitions state_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_transitions
    ADD CONSTRAINT state_transitions_pkey PRIMARY KEY (id);


--
-- Name: storyboard_audio_selections storyboard_audio_selections_episode_id_review_package_id_ta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storyboard_audio_selections
    ADD CONSTRAINT storyboard_audio_selections_episode_id_review_package_id_ta_key UNIQUE (episode_id, review_package_id, target_kind, target_id, audio_kind);


--
-- Name: storyboard_audio_selections storyboard_audio_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storyboard_audio_selections
    ADD CONSTRAINT storyboard_audio_selections_pkey PRIMARY KEY (id);


--
-- Name: storyboard_review_shots storyboard_review_shots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storyboard_review_shots
    ADD CONSTRAINT storyboard_review_shots_pkey PRIMARY KEY (review_package_id, shot_id);


--
-- Name: task_runs task_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_runs
    ADD CONSTRAINT task_runs_pkey PRIMARY KEY (id);


--
-- Name: task_runs task_runs_task_id_attempt_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_runs
    ADD CONSTRAINT task_runs_task_id_attempt_key UNIQUE (task_id, attempt);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: worker_episode_turns worker_episode_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_episode_turns
    ADD CONSTRAINT worker_episode_turns_pkey PRIMARY KEY (episode_id);


--
-- Name: worker_resource_ceilings worker_resource_ceilings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_resource_ceilings
    ADD CONSTRAINT worker_resource_ceilings_pkey PRIMARY KEY (resource_key);


--
-- Name: worker_scheduler_settings worker_scheduler_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_scheduler_settings
    ADD CONSTRAINT worker_scheduler_settings_pkey PRIMARY KEY (singleton);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: supabase_migrations; Owner: -
--

ALTER TABLE ONLY supabase_migrations.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: account_blueprint_versions_account_archived_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_blueprint_versions_account_archived_idx ON public.account_blueprint_versions USING btree (account_id, archived_at, version DESC);


--
-- Name: accounts_archived_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_archived_created_idx ON public.accounts USING btree (archived_at, created_at);


--
-- Name: approvals_review_package_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX approvals_review_package_idx ON public.approvals USING btree (review_package_id) WHERE (review_package_id IS NOT NULL);


--
-- Name: artifacts_episode_id_artifact_type_relative_path_producer_task_; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX artifacts_episode_id_artifact_type_relative_path_producer_task_ ON public.artifacts USING btree (episode_id, artifact_type, relative_path, producer_task_id);


--
-- Name: artifacts_episode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artifacts_episode_idx ON public.artifacts USING btree (episode_id);


--
-- Name: audio_track_annotations_track_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audio_track_annotations_track_time_idx ON public.audio_track_annotations USING btree (audio_track_id, at_seconds, created_at);


--
-- Name: audio_tracks_episode_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audio_tracks_episode_created_idx ON public.audio_tracks USING btree (episode_id, created_at DESC);


--
-- Name: audio_tracks_shot_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audio_tracks_shot_history_idx ON public.audio_tracks USING btree (episode_id, source_review_package_id, cue_id, created_at DESC);


--
-- Name: audio_tracks_source_material_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audio_tracks_source_material_revision_idx ON public.audio_tracks USING btree (source_material_revision_id) WHERE (source_material_revision_id IS NOT NULL);


--
-- Name: audit_events_episode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_episode_idx ON public.audit_events USING btree (episode_id, created_at DESC);


--
-- Name: episodes_account_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX episodes_account_stage_idx ON public.episodes USING btree (account_id, stage, updated_at DESC);


--
-- Name: episodes_active_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX episodes_active_updated_idx ON public.episodes USING btree (updated_at DESC) WHERE (archived_at IS NULL);


--
-- Name: episodes_series_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX episodes_series_version_idx ON public.episodes USING btree (series_version_id, updated_at DESC);


--
-- Name: notification_delivery_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_delivery_pending ON public.notification_delivery_events USING btree (event_id) WHERE (outcome = 'pending'::text);


--
-- Name: pre_render_member_decisions_package_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_render_member_decisions_package_idx ON public.pre_render_review_member_decisions USING btree (review_package_id, decision);


--
-- Name: pre_render_review_members_package_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_render_review_members_package_idx ON public.pre_render_review_members USING btree (review_package_id, member_kind, member_key);


--
-- Name: production_dependencies_upstream_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX production_dependencies_upstream_idx ON public.production_dependencies USING btree (upstream_kind, upstream_id, episode_id);


--
-- Name: production_invalidations_episode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX production_invalidations_episode_idx ON public.production_invalidations USING btree (episode_id, created_at DESC);


--
-- Name: production_material_revisions_episode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX production_material_revisions_episode_idx ON public.production_material_revisions USING btree (episode_id, created_at DESC);


--
-- Name: prompt_versions_account_capability_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prompt_versions_account_capability_idx ON public.prompt_versions USING btree (account_id, capability, version DESC);


--
-- Name: qc_review_issues_package_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX qc_review_issues_package_status_idx ON public.qc_review_issues USING btree (review_package_id, status, created_at, id);


--
-- Name: review_annotations_package_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_annotations_package_created_idx ON public.review_annotations USING btree (review_package_id, created_at, id);


--
-- Name: review_packages_episode_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_packages_episode_created_idx ON public.review_packages USING btree (episode_id, created_at DESC);


--
-- Name: review_render_composition_episode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_render_composition_episode_idx ON public.review_render_composition_revisions USING btree (episode_id, pre_render_review_package_id, revision_number DESC);


--
-- Name: series_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX series_account_idx ON public.series USING btree (account_id, created_at);


--
-- Name: series_versions_series_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX series_versions_series_idx ON public.series_versions USING btree (series_id, version DESC);


--
-- Name: shot_preparation_drafts_current_audio_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shot_preparation_drafts_current_audio_idx ON public.shot_preparation_drafts USING btree (current_audio_track_id);


--
-- Name: shot_preparation_drafts_current_video_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shot_preparation_drafts_current_video_idx ON public.shot_preparation_drafts USING btree (current_video_artifact_id);


--
-- Name: shot_preparation_drafts_episode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shot_preparation_drafts_episode_idx ON public.shot_preparation_drafts USING btree (episode_id, review_package_id, shot_id);


--
-- Name: shot_preparation_drafts_pending_preview_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shot_preparation_drafts_pending_preview_idx ON public.shot_preparation_drafts USING btree (pending_preview_task_id) WHERE (pending_preview_task_id IS NOT NULL);


--
-- Name: task_runs_task_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_runs_task_started_idx ON public.task_runs USING btree (task_id, started_at DESC);


--
-- Name: tasks_episode_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_episode_status_idx ON public.tasks USING btree (episode_id, status);


--
-- Name: tasks_one_a_roll_per_storyboard_shot_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_one_a_roll_per_storyboard_shot_revision_idx ON public.tasks USING btree (episode_id, ((input_snapshot ->> 'storyboard_review_package_id'::text)), ((input_snapshot #>> '{shot,id}'::text[])), COALESCE((input_snapshot ->> 'pre_render_revision'::text), ''::text)) WHERE ((task_type = 'generate_a_roll'::text) AND (status <> 'superseded'::public.task_status));


--
-- Name: tasks_one_active_script_draft_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_one_active_script_draft_idx ON public.tasks USING btree (episode_id) WHERE ((task_type = 'draft_script'::text) AND (status = ANY (ARRAY['ready'::public.task_status, 'running'::public.task_status])));


--
-- Name: tasks_one_active_storyboard_draft_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_one_active_storyboard_draft_idx ON public.tasks USING btree (episode_id) WHERE ((task_type = 'draft_storyboard'::text) AND (status = ANY (ARRAY['ready'::public.task_status, 'running'::public.task_status])));


--
-- Name: tasks_one_active_visual_brief_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_one_active_visual_brief_idx ON public.tasks USING btree (episode_id) WHERE ((task_type = 'prepare_visual_brief'::text) AND (status = ANY (ARRAY['ready'::public.task_status, 'running'::public.task_status])));


--
-- Name: tasks_one_b_roll_per_storyboard_shot_configuration_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_one_b_roll_per_storyboard_shot_configuration_revision_idx ON public.tasks USING btree (episode_id, ((input_snapshot ->> 'storyboard_review_package_id'::text)), ((input_snapshot #>> '{shot,id}'::text[])), ((input_snapshot ->> 'configuration_hash'::text)), COALESCE((input_snapshot ->> 'pre_render_revision'::text), ''::text)) WHERE ((task_type = 'generate_b_roll'::text) AND (status <> 'superseded'::public.task_status));


--
-- Name: tasks_one_derived_audio_per_source_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_one_derived_audio_per_source_material_idx ON public.tasks USING btree (((input_snapshot ->> 'source_material_revision_id'::text))) WHERE (task_type = 'extract_embedded_audio'::text);


--
-- Name: tasks_one_final_render_per_qc_package_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_one_final_render_per_qc_package_idx ON public.tasks USING btree (episode_id, ((input_snapshot #>> '{final_render,source_review_package_id}'::text[]))) WHERE (task_type = 'generate_final_render'::text);


--
-- Name: tasks_one_narration_per_storyboard_cue_configuration_revision_i; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_one_narration_per_storyboard_cue_configuration_revision_i ON public.tasks USING btree (episode_id, ((input_snapshot ->> 'storyboard_review_package_id'::text)), ((input_snapshot #>> '{audio_track,cue_id}'::text[])), ((input_snapshot ->> 'configuration_hash'::text)), COALESCE((input_snapshot ->> 'pre_render_revision'::text), ''::text)) WHERE (task_type = 'generate_narration'::text);


--
-- Name: tasks_one_review_render_composition_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_one_review_render_composition_revision_idx ON public.tasks USING btree (episode_id, ((input_snapshot #>> '{review_render,composition_revision_id}'::text[]))) WHERE (task_type = 'generate_review_render'::text);


--
-- Name: tasks_one_soundtrack_per_storyboard_cue_configuration_revision_; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_one_soundtrack_per_storyboard_cue_configuration_revision_ ON public.tasks USING btree (episode_id, ((input_snapshot ->> 'storyboard_review_package_id'::text)), ((input_snapshot #>> '{audio_track,cue_id}'::text[])), ((input_snapshot ->> 'configuration_hash'::text)), COALESCE((input_snapshot ->> 'pre_render_revision'::text), ''::text)) WHERE (task_type = 'generate_soundtrack'::text);


--
-- Name: tasks_ready_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_ready_queue_idx ON public.tasks USING btree (status, created_at) WHERE (status = 'ready'::public.task_status);


--
-- Name: worker_active_episode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_active_episode_idx ON public.tasks USING btree (episode_id) WHERE (status = 'running'::public.task_status);


--
-- Name: worker_ready_available_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_ready_available_idx ON public.tasks USING btree (available_at, created_at, id) WHERE ((status = 'ready'::public.task_status) AND (invalidated_at IS NULL));


--
-- Name: tasks aa_normalize_worker_task_runtime_constraints; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER aa_normalize_worker_task_runtime_constraints BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.normalize_worker_task_runtime_constraints();


--
-- Name: accounts accounts_seed_prompt_versions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER accounts_seed_prompt_versions AFTER INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.seed_account_prompt_versions();


--
-- Name: tasks advance_qc_only_review_render_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER advance_qc_only_review_render_after_insert AFTER INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.advance_qc_only_review_render();


--
-- Name: qc_review_issues assert_current_qc_review_issue_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER assert_current_qc_review_issue_before_write BEFORE INSERT OR UPDATE OF status ON public.qc_review_issues FOR EACH ROW EXECUTE FUNCTION public.assert_current_qc_review_issue();


--
-- Name: tasks block_exhausted_a_roll_task_after_failure; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER block_exhausted_a_roll_task_after_failure AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.block_exhausted_a_roll_task();


--
-- Name: shot_preparation_drafts copy_clip_segments_to_revised_shot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER copy_clip_segments_to_revised_shot AFTER INSERT ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION public.copy_clip_segments_to_revised_shot();


--
-- Name: shot_preparation_drafts copy_shot_audio_mix_to_revised_draft; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER copy_shot_audio_mix_to_revised_draft AFTER INSERT ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION public.copy_shot_audio_mix_to_revised_draft();


--
-- Name: shot_preparation_drafts copy_shot_composition_to_revised_draft; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER copy_shot_composition_to_revised_draft AFTER INSERT ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION public.copy_shot_composition_to_revised_draft();


--
-- Name: tasks create_script_review_package_after_task_completion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_script_review_package_after_task_completion AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.create_script_review_package();


--
-- Name: approvals create_script_revision_task_after_changes_requested; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_script_revision_task_after_changes_requested AFTER INSERT ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.create_script_revision_task_after_changes_requested();


--
-- Name: tasks create_storyboard_review_package_after_task_completion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_storyboard_review_package_after_task_completion AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.create_storyboard_review_package();


--
-- Name: tasks create_storyboard_revision_review_package_after_task; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_storyboard_revision_review_package_after_task AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.create_storyboard_revision_review_package();


--
-- Name: approvals create_storyboard_revision_task_after_changes_requested; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_storyboard_revision_task_after_changes_requested AFTER INSERT ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.create_storyboard_revision_task_after_changes_requested();


--
-- Name: tasks create_visual_review_package_after_task_completion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_visual_review_package_after_task_completion AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.create_visual_review_package();


--
-- Name: approvals create_visual_revision_task_after_changes_requested; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_visual_revision_task_after_changes_requested AFTER INSERT ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.create_visual_revision_task_after_changes_requested();


--
-- Name: artifacts episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.artifacts FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('artifacts', 'direct');


--
-- Name: audio_track_annotations episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.audio_track_annotations FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('audioTrackAnnotations', 'audio');


--
-- Name: audio_tracks episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.audio_tracks FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('audioTracks', 'direct');


--
-- Name: pre_render_review_member_decisions episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.pre_render_review_member_decisions FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('preRenderReviewMemberDecisions', 'review');


--
-- Name: pre_render_review_members episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.pre_render_review_members FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('preRenderReviewMembers', 'review');


--
-- Name: production_material_revisions episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.production_material_revisions FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('materialRevisions', 'direct');


--
-- Name: qc_review_issues episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.qc_review_issues FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('qcReviewIssues', 'review');


--
-- Name: review_annotations episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.review_annotations FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('reviewAnnotations', 'review');


--
-- Name: review_packages episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.review_packages FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('reviewPackages', 'direct');


--
-- Name: shot_preparation_drafts episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('shotPreparationDrafts', 'direct');


--
-- Name: state_transitions episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.state_transitions FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('transitions', 'direct');


--
-- Name: storyboard_audio_selections episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.storyboard_audio_selections FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('storyboardAudioSelections', 'direct');


--
-- Name: task_runs episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.task_runs FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('taskRuns', 'task');


--
-- Name: tasks episode_read_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episode_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION loop_internal.bump_episode_read_revision('tasks', 'direct');


--
-- Name: episodes episodes_require_production_asset_root; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER episodes_require_production_asset_root BEFORE UPDATE OF stage ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.require_production_asset_root();


--
-- Name: shot_preparation_drafts expire_shot_acoustic_alignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER expire_shot_acoustic_alignment BEFORE UPDATE ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION public.expire_shot_acoustic_alignment();


--
-- Name: pre_render_review_members freeze_manual_clip_on_pre_render_member; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER freeze_manual_clip_on_pre_render_member BEFORE INSERT ON public.pre_render_review_members FOR EACH ROW EXECUTE FUNCTION public.freeze_manual_clip_on_pre_render_member();


--
-- Name: tasks freeze_manual_media_connection_boundary; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER freeze_manual_media_connection_boundary BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.freeze_manual_media_configuration_hash();


--
-- Name: tasks freeze_openai_image_generation_config_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER freeze_openai_image_generation_config_before_insert BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.freeze_openai_image_generation_config();


--
-- Name: tasks freeze_owner_connection_version_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER freeze_owner_connection_version_before_insert BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.freeze_owner_connection_version();


--
-- Name: tasks freeze_prepared_clips_on_review_render_task; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER freeze_prepared_clips_on_review_render_task BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.freeze_prepared_clips_on_review_render_task();


--
-- Name: task_runs freeze_worker_task_run_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER freeze_worker_task_run_before_insert BEFORE INSERT ON public.task_runs FOR EACH ROW EXECUTE FUNCTION public.freeze_worker_task_run();


--
-- Name: series_versions invalidate_changed_series_baseline_dependents_after_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_changed_series_baseline_dependents_after_update AFTER UPDATE OF rules ON public.series_versions FOR EACH ROW EXECUTE FUNCTION public.invalidate_changed_series_baseline_dependents();


--
-- Name: production_material_revisions invalidate_replaced_material_dependents_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_replaced_material_dependents_after_insert AFTER INSERT ON public.production_material_revisions FOR EACH ROW EXECUTE FUNCTION public.invalidate_replaced_material_dependents();


--
-- Name: review_packages invalidate_revised_storyboard_dependents_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_revised_storyboard_dependents_after_insert AFTER INSERT ON public.review_packages FOR EACH ROW EXECUTE FUNCTION public.invalidate_revised_storyboard_dependents();


--
-- Name: shot_preparation_drafts invalidate_shot_source_audio_after_clip_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_shot_source_audio_after_clip_change AFTER UPDATE OF selected_material_revision_id, clip_start_seconds, clip_end_seconds ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION public.invalidate_shot_source_audio_after_clip_change();


--
-- Name: approvals link_review_package_approval_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER link_review_package_approval_before_insert BEFORE INSERT ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.link_review_package_approval();


--
-- Name: approvals materialize_approved_script_revision_after_approval; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER materialize_approved_script_revision_after_approval AFTER INSERT ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.materialize_approved_script_revision();


--
-- Name: audit_events notification_event_enqueued; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notification_event_enqueued AFTER INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION loop_internal.enqueue_notification_event();


--
-- Name: episodes prevent_episode_for_archived_account_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_episode_for_archived_account_before_insert BEFORE INSERT ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.prevent_episode_for_archived_account();


--
-- Name: prompt_versions prompt_versions_freeze_harness; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prompt_versions_freeze_harness BEFORE INSERT OR UPDATE ON public.prompt_versions FOR EACH ROW EXECUTE FUNCTION public.freeze_prompt_harness();


--
-- Name: shot_preparation_drafts protect_frozen_shot_preparation_inputs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER protect_frozen_shot_preparation_inputs BEFORE UPDATE ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION public.protect_frozen_shot_preparation_inputs();


--
-- Name: pre_render_review_members record_pre_render_member_dependencies_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER record_pre_render_member_dependencies_after_insert AFTER INSERT ON public.pre_render_review_members FOR EACH ROW EXECUTE FUNCTION public.record_pre_render_member_dependencies();


--
-- Name: tasks record_shot_video_duration_after_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER record_shot_video_duration_after_update AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.record_shot_video_duration_after_update();


--
-- Name: tasks record_task_production_dependencies_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER record_task_production_dependencies_after_insert AFTER INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.record_task_production_dependencies();


--
-- Name: storyboard_audio_selections refresh_shot_audio_mix_after_selection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER refresh_shot_audio_mix_after_selection AFTER INSERT OR UPDATE OF cue_id, material_revision_id ON public.storyboard_audio_selections FOR EACH ROW EXECUTE FUNCTION public.refresh_shot_audio_mix_after_selection();


--
-- Name: shot_preparation_drafts refresh_shot_preparation_contract; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER refresh_shot_preparation_contract BEFORE INSERT OR UPDATE ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION public.refresh_shot_preparation_contract();


--
-- Name: tasks register_completed_audio_track_after_result; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER register_completed_audio_track_after_result AFTER UPDATE OF status ON public.tasks FOR EACH ROW WHEN (((new.status = 'completed'::public.task_status) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION public.register_completed_audio_track();


--
-- Name: tasks register_completed_review_render_after_result; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER register_completed_review_render_after_result AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.register_completed_review_render();


--
-- Name: tasks release_b_roll_task_lock_after_running; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER release_b_roll_task_lock_after_running AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.release_b_roll_task_lock();


--
-- Name: shot_preparation_drafts reset_shot_preparation_confirmation_after_input_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reset_shot_preparation_confirmation_after_input_change BEFORE UPDATE ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION public.reset_shot_preparation_confirmation_after_input_change();


--
-- Name: shot_preparation_drafts reset_shot_tts_confirmation_after_text_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reset_shot_tts_confirmation_after_text_change BEFORE UPDATE ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION public.reset_shot_tts_confirmation_after_text_change();


--
-- Name: approvals seed_shot_preparation_drafts_after_storyboard_approval; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER seed_shot_preparation_drafts_after_storyboard_approval AFTER INSERT ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.seed_shot_preparation_drafts_after_storyboard_approval();


--
-- Name: worker_scheduler_settings serialize_worker_capacity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER serialize_worker_capacity BEFORE INSERT OR DELETE OR UPDATE ON public.worker_scheduler_settings FOR EACH STATEMENT EXECUTE FUNCTION public.serialize_worker_capacity_configuration();


--
-- Name: worker_resource_ceilings serialize_worker_resources; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER serialize_worker_resources BEFORE INSERT OR DELETE OR UPDATE ON public.worker_resource_ceilings FOR EACH STATEMENT EXECUTE FUNCTION public.serialize_worker_capacity_configuration();


--
-- Name: tasks sync_local_whisperx_alignment_after_task_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_local_whisperx_alignment_after_task_update AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.sync_local_whisperx_alignment_after_task_update();


--
-- Name: tasks sync_shot_acoustic_alignment_after_task_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_shot_acoustic_alignment_after_task_update AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.sync_shot_acoustic_alignment_after_task_update();


--
-- Name: tasks sync_shot_clip_task_after_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_shot_clip_task_after_update AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.sync_shot_clip_task_after_update();


--
-- Name: tasks sync_shot_preview_after_task_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_shot_preview_after_task_update AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.sync_shot_preview_after_task_update();


--
-- Name: audio_tracks sync_shot_source_audio_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_shot_source_audio_after_insert AFTER INSERT ON public.audio_tracks FOR EACH ROW EXECUTE FUNCTION public.sync_shot_source_audio_after_insert();


--
-- Name: tasks sync_shot_source_audio_task_after_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_shot_source_audio_task_after_update AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.sync_shot_source_audio_task_after_update();


--
-- Name: audio_tracks sync_shot_tts_audio_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_shot_tts_audio_after_insert AFTER INSERT ON public.audio_tracks FOR EACH ROW EXECUTE FUNCTION public.sync_shot_tts_audio_after_insert();


--
-- Name: tasks sync_shot_tts_task_after_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_shot_tts_task_after_update AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.sync_shot_tts_task_after_update();


--
-- Name: account_blueprint_versions validate_blueprint_external_connections_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_blueprint_external_connections_before_write BEFORE INSERT OR UPDATE OF policy ON public.account_blueprint_versions FOR EACH ROW EXECUTE FUNCTION public.validate_blueprint_external_connections();


--
-- Name: tasks worker_retry_backoff; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER worker_retry_backoff BEFORE UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.worker_retry_backoff();


--
-- Name: task_runs z_attach_prompt_context_to_worker_task_run_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER z_attach_prompt_context_to_worker_task_run_before_insert BEFORE INSERT ON public.task_runs FOR EACH ROW EXECUTE FUNCTION public.attach_prompt_context_to_worker_task_run();


--
-- Name: tasks zz_auto_advance_disabled_approval_gate_after_task; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_auto_advance_disabled_approval_gate_after_task AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.auto_advance_disabled_approval_gate();


--
-- Name: shot_preparation_drafts zz_expire_shot_sync_preview; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_expire_shot_sync_preview BEFORE UPDATE ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION public.expire_shot_sync_preview();


--
-- Name: approvals zz_reuse_shot_preparation_history_after_storyboard_approval; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_reuse_shot_preparation_history_after_storyboard_approval AFTER INSERT ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.reuse_shot_preparation_history_after_storyboard_approval();


--
-- Name: approvals zzz_invalidate_superseded_storyboard_narration_tasks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zzz_invalidate_superseded_storyboard_narration_tasks AFTER INSERT ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.invalidate_superseded_storyboard_narration_tasks_after_approval();


--
-- Name: account_blueprint_versions account_blueprint_versions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_blueprint_versions
    ADD CONSTRAINT account_blueprint_versions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: account_memberships account_memberships_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_memberships
    ADD CONSTRAINT account_memberships_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: account_memberships account_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_memberships
    ADD CONSTRAINT account_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: accounts accounts_current_blueprint_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_current_blueprint_version_fk FOREIGN KEY (id, current_blueprint_version_id) REFERENCES public.account_blueprint_versions(account_id, id);


--
-- Name: approvals approvals_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: approvals approvals_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: approvals approvals_review_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_review_package_id_fkey FOREIGN KEY (review_package_id) REFERENCES public.review_packages(id) ON DELETE RESTRICT;


--
-- Name: artifacts artifacts_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: artifacts artifacts_producer_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_producer_task_id_fkey FOREIGN KEY (producer_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: asset_locks asset_locks_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_locks
    ADD CONSTRAINT asset_locks_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: audio_track_annotations audio_track_annotations_audio_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_track_annotations
    ADD CONSTRAINT audio_track_annotations_audio_track_id_fkey FOREIGN KEY (audio_track_id) REFERENCES public.audio_tracks(id) ON DELETE CASCADE;


--
-- Name: audio_track_annotations audio_track_annotations_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_track_annotations
    ADD CONSTRAINT audio_track_annotations_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: audio_tracks audio_tracks_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: audio_tracks audio_tracks_source_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_source_artifact_id_fkey FOREIGN KEY (source_artifact_id) REFERENCES public.artifacts(id) ON DELETE RESTRICT;


--
-- Name: audio_tracks audio_tracks_source_material_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_source_material_revision_id_fkey FOREIGN KEY (source_material_revision_id) REFERENCES public.production_material_revisions(id) ON DELETE RESTRICT;


--
-- Name: audio_tracks audio_tracks_source_review_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_source_review_package_id_fkey FOREIGN KEY (source_review_package_id) REFERENCES public.review_packages(id) ON DELETE RESTRICT;


--
-- Name: audio_tracks audio_tracks_source_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_source_task_id_fkey FOREIGN KEY (source_task_id) REFERENCES public.tasks(id) ON DELETE RESTRICT;


--
-- Name: audit_events audit_events_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: audit_events audit_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: audit_events audit_events_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: episode_read_revisions episode_read_revisions_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.episode_read_revisions
    ADD CONSTRAINT episode_read_revisions_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: episodes episodes_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.episodes
    ADD CONSTRAINT episodes_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;


--
-- Name: episodes episodes_blueprint_belongs_to_account_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.episodes
    ADD CONSTRAINT episodes_blueprint_belongs_to_account_fk FOREIGN KEY (account_id, blueprint_version_id) REFERENCES public.account_blueprint_versions(account_id, id) ON DELETE RESTRICT;


--
-- Name: episodes episodes_main_script_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.episodes
    ADD CONSTRAINT episodes_main_script_revision_fk FOREIGN KEY (id, main_script_revision_id) REFERENCES public.production_material_revisions(episode_id, id) ON DELETE RESTRICT;


--
-- Name: episodes episodes_series_version_belongs_to_account_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.episodes
    ADD CONSTRAINT episodes_series_version_belongs_to_account_fk FOREIGN KEY (account_id, series_version_id) REFERENCES public.series_versions(account_id, id) ON DELETE RESTRICT;


--
-- Name: external_connection_verifications external_connection_verifications_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_connection_verifications
    ADD CONSTRAINT external_connection_verifications_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.external_connections(id) ON DELETE CASCADE;


--
-- Name: external_connection_verifications external_connection_verifications_connection_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_connection_verifications
    ADD CONSTRAINT external_connection_verifications_connection_version_id_fkey FOREIGN KEY (connection_version_id) REFERENCES public.external_connection_versions(id) ON DELETE RESTRICT;


--
-- Name: external_connection_versions external_connection_versions_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_connection_versions
    ADD CONSTRAINT external_connection_versions_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.external_connections(id) ON DELETE CASCADE;


--
-- Name: external_connections external_connections_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_connections
    ADD CONSTRAINT external_connections_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: external_connections external_connections_current_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_connections
    ADD CONSTRAINT external_connections_current_version_id_fkey FOREIGN KEY (current_version_id) REFERENCES public.external_connection_versions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: material_revision_approvals material_revision_approvals_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_revision_approvals
    ADD CONSTRAINT material_revision_approvals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: material_revision_approvals material_revision_approvals_material_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_revision_approvals
    ADD CONSTRAINT material_revision_approvals_material_revision_id_fkey FOREIGN KEY (material_revision_id) REFERENCES public.production_material_revisions(id) ON DELETE CASCADE;


--
-- Name: notification_delivery_events notification_delivery_events_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery_events
    ADD CONSTRAINT notification_delivery_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.audit_events(id) ON DELETE CASCADE;


--
-- Name: pre_render_review_member_decisions pre_render_review_member_deci_inherited_from_review_packag_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_render_review_member_decisions
    ADD CONSTRAINT pre_render_review_member_deci_inherited_from_review_packag_fkey FOREIGN KEY (inherited_from_review_package_id) REFERENCES public.review_packages(id) ON DELETE RESTRICT;


--
-- Name: pre_render_review_member_decisions pre_render_review_member_decisions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_render_review_member_decisions
    ADD CONSTRAINT pre_render_review_member_decisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: pre_render_review_member_decisions pre_render_review_member_decisions_review_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_render_review_member_decisions
    ADD CONSTRAINT pre_render_review_member_decisions_review_package_id_fkey FOREIGN KEY (review_package_id) REFERENCES public.review_packages(id) ON DELETE CASCADE;


--
-- Name: pre_render_review_members pre_render_review_members_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_render_review_members
    ADD CONSTRAINT pre_render_review_members_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id) ON DELETE RESTRICT;


--
-- Name: pre_render_review_members pre_render_review_members_audio_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_render_review_members
    ADD CONSTRAINT pre_render_review_members_audio_track_id_fkey FOREIGN KEY (audio_track_id) REFERENCES public.audio_tracks(id) ON DELETE RESTRICT;


--
-- Name: pre_render_review_members pre_render_review_members_review_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_render_review_members
    ADD CONSTRAINT pre_render_review_members_review_package_id_fkey FOREIGN KEY (review_package_id) REFERENCES public.review_packages(id) ON DELETE CASCADE;


--
-- Name: pre_render_review_members pre_render_review_members_source_material_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_render_review_members
    ADD CONSTRAINT pre_render_review_members_source_material_revision_id_fkey FOREIGN KEY (source_material_revision_id) REFERENCES public.production_material_revisions(id) ON DELETE RESTRICT;


--
-- Name: pre_render_review_members pre_render_review_members_source_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_render_review_members
    ADD CONSTRAINT pre_render_review_members_source_task_id_fkey FOREIGN KEY (source_task_id) REFERENCES public.tasks(id) ON DELETE RESTRICT;


--
-- Name: production_dependencies production_dependencies_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_dependencies
    ADD CONSTRAINT production_dependencies_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: production_invalidations production_invalidations_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_invalidations
    ADD CONSTRAINT production_invalidations_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: production_material_revisions production_material_revisions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_material_revisions
    ADD CONSTRAINT production_material_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: production_material_revisions production_material_revisions_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_material_revisions
    ADD CONSTRAINT production_material_revisions_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: prompt_versions prompt_versions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: prompt_versions prompt_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: qc_review_issues qc_review_issues_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_review_issues
    ADD CONSTRAINT qc_review_issues_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: qc_review_issues qc_review_issues_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_review_issues
    ADD CONSTRAINT qc_review_issues_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: qc_review_issues qc_review_issues_review_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_review_issues
    ADD CONSTRAINT qc_review_issues_review_package_id_fkey FOREIGN KEY (review_package_id) REFERENCES public.review_packages(id) ON DELETE CASCADE;


--
-- Name: review_annotations review_annotations_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_annotations
    ADD CONSTRAINT review_annotations_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: review_annotations review_annotations_review_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_annotations
    ADD CONSTRAINT review_annotations_review_package_id_fkey FOREIGN KEY (review_package_id) REFERENCES public.review_packages(id) ON DELETE CASCADE;


--
-- Name: review_packages review_packages_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_packages
    ADD CONSTRAINT review_packages_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id) ON DELETE RESTRICT;


--
-- Name: review_packages review_packages_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_packages
    ADD CONSTRAINT review_packages_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: review_packages review_packages_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_packages
    ADD CONSTRAINT review_packages_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE RESTRICT;


--
-- Name: review_packages review_packages_task_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_packages
    ADD CONSTRAINT review_packages_task_run_id_fkey FOREIGN KEY (task_run_id) REFERENCES public.task_runs(id) ON DELETE RESTRICT;


--
-- Name: review_render_composition_revisions review_render_composition_rev_pre_render_review_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_render_composition_revisions
    ADD CONSTRAINT review_render_composition_rev_pre_render_review_package_id_fkey FOREIGN KEY (pre_render_review_package_id) REFERENCES public.review_packages(id) ON DELETE RESTRICT;


--
-- Name: review_render_composition_revisions review_render_composition_revisions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_render_composition_revisions
    ADD CONSTRAINT review_render_composition_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: review_render_composition_revisions review_render_composition_revisions_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_render_composition_revisions
    ADD CONSTRAINT review_render_composition_revisions_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: series series_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series
    ADD CONSTRAINT series_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: series_versions series_versions_account_id_series_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series_versions
    ADD CONSTRAINT series_versions_account_id_series_id_fkey FOREIGN KEY (account_id, series_id) REFERENCES public.series(account_id, id) ON DELETE CASCADE;


--
-- Name: series_versions series_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series_versions
    ADD CONSTRAINT series_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_current_audio_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_current_audio_track_id_fkey FOREIGN KEY (current_audio_track_id) REFERENCES public.audio_tracks(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_current_preview_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_current_preview_artifact_id_fkey FOREIGN KEY (current_preview_artifact_id) REFERENCES public.artifacts(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_current_preview_project_artifact_i_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_current_preview_project_artifact_i_fkey FOREIGN KEY (current_preview_project_artifact_id) REFERENCES public.artifacts(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_current_preview_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_current_preview_task_id_fkey FOREIGN KEY (current_preview_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_current_tts_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_current_tts_task_id_fkey FOREIGN KEY (current_tts_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_current_video_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_current_video_artifact_id_fkey FOREIGN KEY (current_video_artifact_id) REFERENCES public.artifacts(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_current_video_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_current_video_task_id_fkey FOREIGN KEY (current_video_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_frozen_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_frozen_by_fkey FOREIGN KEY (frozen_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_pending_alignment_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_pending_alignment_task_id_fkey FOREIGN KEY (pending_alignment_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_pending_preview_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_pending_preview_task_id_fkey FOREIGN KEY (pending_preview_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_pending_source_audio_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_pending_source_audio_task_id_fkey FOREIGN KEY (pending_source_audio_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_pending_tts_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_pending_tts_task_id_fkey FOREIGN KEY (pending_tts_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_pending_video_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_pending_video_task_id_fkey FOREIGN KEY (pending_video_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_review_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_review_package_id_fkey FOREIGN KEY (review_package_id) REFERENCES public.review_packages(id) ON DELETE RESTRICT;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_selected_material_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_selected_material_revision_id_fkey FOREIGN KEY (selected_material_revision_id) REFERENCES public.production_material_revisions(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_skipped_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_skipped_by_fkey FOREIGN KEY (skipped_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_tts_text_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_tts_text_confirmed_by_fkey FOREIGN KEY (tts_text_confirmed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: shot_preparation_drafts shot_preparation_drafts_warning_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shot_preparation_drafts
    ADD CONSTRAINT shot_preparation_drafts_warning_accepted_by_fkey FOREIGN KEY (warning_accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: state_transitions state_transitions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_transitions
    ADD CONSTRAINT state_transitions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: state_transitions state_transitions_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_transitions
    ADD CONSTRAINT state_transitions_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: storyboard_audio_selections storyboard_audio_selections_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storyboard_audio_selections
    ADD CONSTRAINT storyboard_audio_selections_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: storyboard_audio_selections storyboard_audio_selections_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storyboard_audio_selections
    ADD CONSTRAINT storyboard_audio_selections_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: storyboard_audio_selections storyboard_audio_selections_material_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storyboard_audio_selections
    ADD CONSTRAINT storyboard_audio_selections_material_revision_id_fkey FOREIGN KEY (material_revision_id) REFERENCES public.production_material_revisions(id);


--
-- Name: storyboard_audio_selections storyboard_audio_selections_review_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storyboard_audio_selections
    ADD CONSTRAINT storyboard_audio_selections_review_package_id_fkey FOREIGN KEY (review_package_id) REFERENCES public.review_packages(id) ON DELETE CASCADE;


--
-- Name: storyboard_review_shots storyboard_review_shots_review_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storyboard_review_shots
    ADD CONSTRAINT storyboard_review_shots_review_package_id_fkey FOREIGN KEY (review_package_id) REFERENCES public.review_packages(id) ON DELETE CASCADE;


--
-- Name: task_runs task_runs_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_runs
    ADD CONSTRAINT task_runs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: worker_episode_turns worker_episode_turns_episode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_episode_turns
    ADD CONSTRAINT worker_episode_turns_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;


--
-- Name: account_blueprint_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_blueprint_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: account_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: artifacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;

--
-- Name: asset_locks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.asset_locks ENABLE ROW LEVEL SECURITY;

--
-- Name: audio_track_annotations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audio_track_annotations ENABLE ROW LEVEL SECURITY;

--
-- Name: audio_tracks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audio_tracks ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: episode_read_revisions episode_read_revision_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY episode_read_revision_owner ON public.episode_read_revisions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.episodes e
     JOIN public.account_memberships m ON ((m.account_id = e.account_id)))
  WHERE ((e.id = episode_read_revisions.episode_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = 'owner'::public.member_role)))));


--
-- Name: episode_read_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.episode_read_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: episodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;

--
-- Name: external_connection_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_connection_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: external_connection_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_connection_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: external_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: material_revision_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.material_revision_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: approvals members can read approvals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read approvals" ON public.approvals FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.episodes
  WHERE ((episodes.id = approvals.episode_id) AND public.is_account_member(episodes.account_id)))));


--
-- Name: artifacts members can read artifacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read artifacts" ON public.artifacts FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.episodes
  WHERE ((episodes.id = artifacts.episode_id) AND public.is_account_member(episodes.account_id)))));


--
-- Name: asset_locks members can read asset locks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read asset locks" ON public.asset_locks FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.episodes
  WHERE ((episodes.id = asset_locks.episode_id) AND public.is_account_member(episodes.account_id)))));


--
-- Name: audio_track_annotations members can read audio track annotations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read audio track annotations" ON public.audio_track_annotations FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.audio_tracks track
     JOIN public.episodes episode ON ((episode.id = track.episode_id)))
  WHERE ((track.id = audio_track_annotations.audio_track_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: audio_tracks members can read audio tracks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read audio tracks" ON public.audio_tracks FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.episodes episode
  WHERE ((episode.id = audio_tracks.episode_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: audit_events members can read audit events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read audit events" ON public.audit_events FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: account_blueprint_versions members can read blueprints; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read blueprints" ON public.account_blueprint_versions FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: episodes members can read episodes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read episodes" ON public.episodes FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: material_revision_approvals members can read material revision approvals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read material revision approvals" ON public.material_revision_approvals FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.production_material_revisions material
     JOIN public.episodes episode ON ((episode.id = material.episode_id)))
  WHERE ((material.id = material_revision_approvals.material_revision_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: account_memberships members can read memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read memberships" ON public.account_memberships FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: pre_render_review_member_decisions members can read pre-render member decisions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read pre-render member decisions" ON public.pre_render_review_member_decisions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.review_packages package
     JOIN public.episodes episode ON ((episode.id = package.episode_id)))
  WHERE ((package.id = pre_render_review_member_decisions.review_package_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: pre_render_review_members members can read pre-render review members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read pre-render review members" ON public.pre_render_review_members FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.review_packages package
     JOIN public.episodes episode ON ((episode.id = package.episode_id)))
  WHERE ((package.id = pre_render_review_members.review_package_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: production_dependencies members can read production dependencies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read production dependencies" ON public.production_dependencies FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.episodes episode
  WHERE ((episode.id = production_dependencies.episode_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: production_invalidations members can read production invalidations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read production invalidations" ON public.production_invalidations FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.episodes episode
  WHERE ((episode.id = production_invalidations.episode_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: production_material_revisions members can read production material revisions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read production material revisions" ON public.production_material_revisions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.episodes
  WHERE ((episodes.id = production_material_revisions.episode_id) AND public.is_account_member(episodes.account_id)))));


--
-- Name: prompt_versions members can read prompt versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read prompt versions" ON public.prompt_versions FOR SELECT TO authenticated USING (public.is_account_member(account_id));


--
-- Name: qc_review_issues members can read qc review issues; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read qc review issues" ON public.qc_review_issues FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.review_packages package
     JOIN public.episodes episode ON ((episode.id = package.episode_id)))
  WHERE ((package.id = qc_review_issues.review_package_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: review_annotations members can read review annotations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read review annotations" ON public.review_annotations FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.review_packages review_package
     JOIN public.episodes episode ON ((episode.id = review_package.episode_id)))
  WHERE ((review_package.id = review_annotations.review_package_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: review_packages members can read review packages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read review packages" ON public.review_packages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.episodes
  WHERE ((episodes.id = review_packages.episode_id) AND public.is_account_member(episodes.account_id)))));


--
-- Name: review_render_composition_revisions members can read review render compositions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read review render compositions" ON public.review_render_composition_revisions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.episodes episode
  WHERE ((episode.id = review_render_composition_revisions.episode_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: series members can read series; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read series" ON public.series FOR SELECT TO authenticated USING (public.is_account_member(account_id));


--
-- Name: series_versions members can read series versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read series versions" ON public.series_versions FOR SELECT TO authenticated USING (public.is_account_member(account_id));


--
-- Name: shot_preparation_drafts members can read shot preparation drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read shot preparation drafts" ON public.shot_preparation_drafts FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.episodes episode
  WHERE ((episode.id = shot_preparation_drafts.episode_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: tasks members can read tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read tasks" ON public.tasks FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.episodes
  WHERE ((episodes.id = tasks.episode_id) AND public.is_account_member(episodes.account_id)))));


--
-- Name: accounts members can read their accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read their accounts" ON public.accounts FOR SELECT USING (public.is_account_member(id));


--
-- Name: state_transitions members can read transitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read transitions" ON public.state_transitions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.episodes
  WHERE ((episodes.id = state_transitions.episode_id) AND public.is_account_member(episodes.account_id)))));


--
-- Name: task_runs members can read worker runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can read worker runs" ON public.task_runs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.tasks task
     JOIN public.episodes episode ON ((episode.id = task.episode_id)))
  WHERE ((task.id = task_runs.task_id) AND public.is_account_member(episode.account_id)))));


--
-- Name: notification_delivery_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_delivery_events ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_delivery_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_delivery_state ENABLE ROW LEVEL SECURITY;

--
-- Name: external_connection_verifications owners can read their connection verifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owners can read their connection verifications" ON public.external_connection_verifications FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.external_connections connection
  WHERE ((connection.id = external_connection_verifications.connection_id) AND (connection.created_by = auth.uid())))));


--
-- Name: external_connections owners can read their external connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owners can read their external connections" ON public.external_connections FOR SELECT TO authenticated USING ((created_by = auth.uid()));


--
-- Name: pre_render_review_member_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_render_review_member_decisions ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_render_review_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_render_review_members ENABLE ROW LEVEL SECURITY;

--
-- Name: production_dependencies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.production_dependencies ENABLE ROW LEVEL SECURITY;

--
-- Name: production_invalidations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.production_invalidations ENABLE ROW LEVEL SECURITY;

--
-- Name: production_material_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.production_material_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: prompt_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: qc_review_issues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qc_review_issues ENABLE ROW LEVEL SECURITY;

--
-- Name: review_annotations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_annotations ENABLE ROW LEVEL SECURITY;

--
-- Name: review_packages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_packages ENABLE ROW LEVEL SECURITY;

--
-- Name: review_render_composition_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_render_composition_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: series; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.series ENABLE ROW LEVEL SECURITY;

--
-- Name: series_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.series_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: shot_preparation_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shot_preparation_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: state_transitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.state_transitions ENABLE ROW LEVEL SECURITY;

--
-- Name: storyboard_audio_selections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.storyboard_audio_selections ENABLE ROW LEVEL SECURITY;

--
-- Name: storyboard_audio_selections storyboard_audio_selections_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY storyboard_audio_selections_owner_read ON public.storyboard_audio_selections FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.episodes episode
     JOIN public.account_memberships membership ON ((membership.account_id = episode.account_id)))
  WHERE ((episode.id = storyboard_audio_selections.episode_id) AND (membership.user_id = auth.uid()) AND (membership.role = 'owner'::public.member_role)))));


--
-- Name: storyboard_review_shots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.storyboard_review_shots ENABLE ROW LEVEL SECURITY;

--
-- Name: task_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_episode_turns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_episode_turns ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_resource_ceilings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_resource_ceilings ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_scheduler_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_scheduler_settings ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


