alter table public.shot_preparation_drafts
  drop constraint if exists shot_preparation_drafts_confirmation_status_check;

alter table public.shot_preparation_drafts
  add column if not exists video_duration_seconds numeric,
  add column if not exists warning_decision text not null default 'not_required' check (warning_decision in ('not_required', 'accepted')),
  add column if not exists warning_reason text,
  add column if not exists warning_accepted_at timestamptz,
  add column if not exists warning_accepted_by uuid references auth.users(id) on delete set null,
  add column if not exists confirmation_reason text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists skipped_at timestamptz,
  add column if not exists skipped_by uuid references auth.users(id) on delete set null,
  add constraint shot_preparation_drafts_confirmation_status_check check (confirmation_status in ('pending', 'confirmed', 'skipped'));

create or replace function public.reset_shot_preparation_confirmation_after_input_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
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

drop trigger if exists reset_shot_preparation_confirmation_after_input_change on public.shot_preparation_drafts;
create trigger reset_shot_preparation_confirmation_after_input_change
before update on public.shot_preparation_drafts
for each row execute function public.reset_shot_preparation_confirmation_after_input_change();

create function public.confirm_shot_preparation(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_reason text,
  p_warning_accepted boolean default false
)
returns public.shot_preparation_drafts
language plpgsql security definer set search_path = ''
as $$
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

  video_delta := video_duration - (selected_shot ->> 'durationSeconds')::numeric;
  audio_delta := case when audio_duration is null then null else audio_duration - (selected_shot ->> 'durationSeconds')::numeric end;
  has_warning := abs(video_delta) > 0.05 or coalesce(abs(audio_delta) > 0.05, false);
  if has_warning and not coalesce(p_warning_accepted, false) then raise exception 'Duration mismatch must be explicitly accepted before confirmation' using errcode = '22023'; end if;
  decision := case when has_warning then 'accepted' else 'not_required' end;

  update public.shot_preparation_drafts
  set confirmation_status = 'confirmed', warning_decision = decision, warning_reason = case when has_warning then btrim(p_reason) else null end,
      warning_accepted_at = case when has_warning then now() else null end, warning_accepted_by = case when has_warning then auth.uid() else null end,
      confirmation_reason = btrim(p_reason), confirmed_at = now(), confirmed_by = auth.uid(), skipped_at = null, skipped_by = null, updated_at = now()
  where id = draft.id returning * into saved_draft;

  if has_warning then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, current_episode.id, 'shot_duration_warning_accepted', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', draft.shot_id, 'video_delta_seconds', video_delta, 'audio_delta_seconds', audio_delta, 'reason', btrim(p_reason)), auth.uid());
  end if;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, current_episode.id, 'shot_preparation_confirmed', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', draft.shot_id, 'video_artifact_id', draft.current_video_artifact_id, 'video_task_id', draft.current_video_task_id, 'audio_mode', draft.audio_mode, 'audio_track_id', draft.current_audio_track_id, 'subtitle_text', draft.subtitle_text, 'subtitles_enabled', draft.subtitles_enabled, 'warning_decision', decision, 'reason', btrim(p_reason)), auth.uid());
  return saved_draft;
end;
$$;

create function public.skip_shot_preparation(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_reason text
)
returns public.shot_preparation_drafts
language plpgsql security definer set search_path = ''
as $$
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

create function public.create_shot_preparation_review_package(p_episode_id uuid, p_storyboard_review_package_id uuid)
returns setof public.review_packages
language plpgsql security definer set search_path = ''
as $$
declare
  episode_record public.episodes;
  storyboard_package public.review_packages;
  existing_package public.review_packages;
  shot jsonb;
  draft public.shot_preparation_drafts;
  media_task public.tasks;
  media_artifact public.artifacts;
  audio_task public.tasks;
  audio_track public.audio_tracks;
  member jsonb;
  members jsonb := '[]'::jsonb;
  package_record public.review_packages;
  next_revision integer;
begin
  select episode.* into episode_record from public.episodes episode where episode.id = p_episode_id;
  select package.* into storyboard_package from public.review_packages package where package.id = p_storyboard_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  if not found then return; end if;
  select package.* into existing_package from public.review_packages package where package.episode_id = p_episode_id and package.stage = 'production_ready' and package.invalidated_at is null order by package.revision_number desc limit 1;
  if found then return next existing_package; return; end if;

  for shot in select value from jsonb_array_elements(coalesce(storyboard_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) loop
    select * into draft from public.shot_preparation_drafts where episode_id = p_episode_id and review_package_id = p_storyboard_review_package_id and shot_id = shot ->> 'id';
    if not found or draft.confirmation_status <> 'confirmed' then return; end if;
    select task.* into media_task from public.tasks task where task.id = draft.current_video_task_id and task.status = 'completed' and task.invalidated_at is null;
    select artifact.* into media_artifact from public.artifacts artifact where artifact.id = draft.current_video_artifact_id and artifact.producer_task_id = draft.current_video_task_id and artifact.sha256 is not null and artifact.file_size > 0;
    if not found or media_task.id is null then return; end if;
    member := jsonb_build_object('member_kind', 'shot_media', 'member_key', format('shot:%s', shot ->> 'id'), 'shot', shot, 'task', jsonb_build_object('id', media_task.id, 'type', media_task.task_type, 'attempt', media_task.attempt, 'provider', media_task.provider, 'model', media_task.model, 'prompt_version', media_task.prompt_version, 'actual_cost_cents', media_task.actual_cost_cents, 'result', media_task.last_result), 'artifact', jsonb_build_object('id', media_artifact.id, 'artifact_type', media_artifact.artifact_type, 'relative_path', media_artifact.relative_path, 'sha256', media_artifact.sha256, 'file_size', media_artifact.file_size));
    members := members || jsonb_build_array(member);
    if draft.audio_mode <> 'none' then
      select track.* into audio_track from public.audio_tracks track where track.id = draft.current_audio_track_id and track.episode_id = p_episode_id and track.cue_id = draft.shot_id and track.source_review_package_id = p_storyboard_review_package_id;
      select task.* into audio_task from public.tasks task where task.id = audio_track.source_task_id and task.status = 'completed' and task.invalidated_at is null;
      if not found or audio_track.id is null then return; end if;
      member := jsonb_build_object('member_kind', 'narration', 'member_key', format('narration:%s', shot ->> 'id'), 'task', jsonb_build_object('id', audio_task.id, 'type', audio_task.task_type, 'attempt', audio_task.attempt, 'provider', audio_task.provider, 'model', audio_task.model, 'prompt_version', audio_task.prompt_version, 'actual_cost_cents', audio_task.actual_cost_cents, 'result', audio_task.last_result), 'audio_track', jsonb_build_object('id', audio_track.id, 'kind', audio_track.track_kind, 'cue_id', audio_track.cue_id, 'relative_path', audio_track.relative_path, 'sha256', audio_track.sha256, 'file_size', audio_track.file_size, 'duration_seconds', audio_track.duration_seconds));
      members := members || jsonb_build_array(member);
    end if;
  end loop;

  select coalesce(max(revision_number), 0) + 1 into next_revision from public.review_packages where episode_id = p_episode_id and stage = 'production_ready';
  insert into public.review_packages (episode_id, stage, revision_number, context_snapshot)
  values (p_episode_id, 'production_ready', next_revision, jsonb_build_object('review_kind', 'pre_render', 'storyboard_review_package_id', p_storyboard_review_package_id, 'storyboard', storyboard_package.context_snapshot #> '{worker_result,storyboard}', 'members', members))
  returning * into package_record;
  insert into public.pre_render_review_members (review_package_id, member_key, member_kind, source_task_id, artifact_id, audio_track_id, evidence_snapshot)
  select package_record.id, evidence ->> 'member_key', evidence ->> 'member_kind', (evidence #>> '{task,id}')::uuid, case when evidence ? 'artifact' then (evidence #>> '{artifact,id}')::uuid else null end, case when evidence ? 'audio_track' then (evidence #>> '{audio_track,id}')::uuid else null end, evidence
  from jsonb_array_elements(members) evidence;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (episode_record.account_id, p_episode_id, 'pre_render_review_package_created', jsonb_build_object('review_package_id', package_record.id, 'storyboard_review_package_id', p_storyboard_review_package_id, 'member_count', jsonb_array_length(members), 'source', 'shot_preparation_confirmations'), null);
  return next package_record;
end;
$$;

create or replace function public.record_shot_video_duration_after_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.task_type in ('generate_a_roll', 'generate_b_roll') and new.status = 'completed' and new.input_snapshot #>> '{shot_preparation,draft_id}' is not null then
    update public.shot_preparation_drafts
    set video_duration_seconds = coalesce((new.last_result #>> '{validation,videoDurationSeconds}')::numeric, (new.input_snapshot #>> '{clip_selection,duration_seconds}')::numeric), updated_at = now()
    where id = (new.input_snapshot #>> '{shot_preparation,draft_id}')::uuid and current_video_task_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists record_shot_video_duration_after_update on public.tasks;
create trigger record_shot_video_duration_after_update after update of status on public.tasks for each row execute function public.record_shot_video_duration_after_update();

create or replace function public.has_required_artifacts(p_episode_id uuid, p_to_stage public.episode_stage)
returns boolean language sql stable set search_path = public as $$
  select case p_to_stage
    when 'script_approved'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'script')
    when 'visual_approved'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'visual_brief')
    when 'storyboard_approved'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'storyboard')
    when 'production_ready'::public.episode_stage then not exists (
      select 1
      from public.review_packages package
      where package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null
        and exists (select 1 from public.shot_preparation_drafts draft where draft.episode_id = p_episode_id and draft.review_package_id = package.id)
        and exists (
          select 1 from jsonb_array_elements(coalesce(package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot
          where not exists (select 1 from public.shot_preparation_drafts draft where draft.episode_id = p_episode_id and draft.review_package_id = package.id and draft.shot_id = shot ->> 'id' and draft.confirmation_status = 'confirmed')
        )
    )
    when 'render_ready'::public.episode_stage then exists (
      select 1 from public.review_packages package where package.episode_id = p_episode_id and package.stage = 'production_ready' and package.invalidated_at is null and not exists (
        select 1 from public.pre_render_review_members member where member.review_package_id = package.id and not exists (select 1 from public.pre_render_review_member_decisions decision where decision.review_package_id = member.review_package_id and decision.member_key = member.member_key and decision.decision = 'approved')
      )
    )
    when 'qc_passed'::public.episode_stage then exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'render')
    else true
  end;
$$;

do $$
declare definition text; needle text := '    if jsonb_typeof(candidate.storyboard_context #> ''{worker_result,storyboard,shots}'') <> ''array'''; guard text := $guard$    if exists (select 1 from public.shot_preparation_drafts draft where draft.episode_id = candidate.id and draft.review_package_id = candidate.storyboard_review_package_id) then
      if exists (select 1 from jsonb_array_elements(coalesce(candidate.storyboard_context #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot where not exists (select 1 from public.shot_preparation_drafts draft where draft.episode_id = candidate.id and draft.review_package_id = candidate.storyboard_review_package_id and draft.shot_id = shot ->> 'id' and draft.confirmation_status = 'confirmed')) then continue; end if;
      update public.episodes set stage = 'production_ready', updated_at = now() where id = candidate.id returning * into advanced_episode;
      perform public.create_shot_preparation_review_package(candidate.id, candidate.storyboard_review_package_id);
      insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'storyboard_approved', 'production_ready', '逐镜头准备片段、音频模式、字幕与警告决定均已确认。', null);
      insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'stage_transition', jsonb_build_object('from_stage', 'storyboard_approved', 'to_stage', 'production_ready', 'reason', '逐镜头确认完成。'), null);
      return next advanced_episode;
    end if;
$guard$; begin
  select pg_get_functiondef('public.advance_production_ready_episodes(uuid)'::regprocedure) into definition;
  if definition is null or position(needle in definition) = 0 then raise exception 'Unable to extend production gate'; end if;
  execute replace(definition, needle, guard || needle);
end $$;

do $$
declare definition text; source_name text; needle text := '  loop
    members := ''[]''::jsonb;'; replacement text := '  loop
    if exists (select 1 from public.shot_preparation_drafts draft where draft.episode_id = candidate.episode_id and draft.review_package_id = candidate.storyboard_review_package_id) then
      select * into created_package from public.create_shot_preparation_review_package(candidate.episode_id, candidate.storyboard_review_package_id);
      if found then return next created_package; end if;
      continue;
    end if;
    members := ''[]''::jsonb;';
begin
  foreach source_name in array array['public.create_pre_render_review_packages()', 'public.create_pre_render_review_packages_for_episode(uuid)'] loop
    select pg_get_functiondef(to_regprocedure(source_name)) into definition;
    if definition is null or position(needle in definition) = 0 then raise exception 'Unable to extend pre-render package builder'; end if;
    execute replace(definition, needle, replacement);
  end loop;
end $$;

revoke all on function public.confirm_shot_preparation(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.confirm_shot_preparation(uuid, uuid, text, text, boolean) to authenticated;
revoke all on function public.skip_shot_preparation(uuid, uuid, text, text) from public, anon;
grant execute on function public.skip_shot_preparation(uuid, uuid, text, text) to authenticated;
revoke all on function public.create_shot_preparation_review_package(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_shot_video_duration_after_update() from public, anon, authenticated;
revoke all on function public.reset_shot_preparation_confirmation_after_input_change() from public, anon, authenticated;
