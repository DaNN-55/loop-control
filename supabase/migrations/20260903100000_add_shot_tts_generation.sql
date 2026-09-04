alter table public.shot_preparation_drafts
  add column if not exists tts_text text,
  add column if not exists tts_language_code text,
  add column if not exists current_audio_track_id uuid references public.audio_tracks(id) on delete set null,
  add column if not exists current_tts_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists pending_tts_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists tts_actual_duration_seconds numeric,
  add column if not exists tts_error text;

update public.shot_preparation_drafts
set tts_text = subtitle_text
where tts_text is null;

create index if not exists shot_preparation_drafts_current_audio_idx
on public.shot_preparation_drafts (current_audio_track_id);

create or replace function public.save_shot_preparation_draft(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_audio_mode text,
  p_subtitle_text text,
  p_subtitles_enabled boolean,
  p_tts_text text,
  p_tts_voice text,
  p_tts_speaking_rate numeric
)
returns public.shot_preparation_drafts
language plpgsql
security definer set search_path = ''
as $$
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
  changed boolean;
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

  select blueprint.policy into blueprint_policy
  from public.account_blueprint_versions blueprint
  where blueprint.id = current_episode.blueprint_version_id;
  next_tts_text := coalesce(nullif(btrim(p_tts_text), ''), nullif(btrim(p_subtitle_text), ''), nullif(btrim(selected_shot ->> 'scriptSegment'), ''));
  next_tts_voice := coalesce(nullif(btrim(p_tts_voice), ''), existing_draft.tts_voice, nullif(btrim(blueprint_policy #>> '{narration,voice,name}'), ''));
  next_tts_rate := coalesce(p_tts_speaking_rate, existing_draft.tts_speaking_rate,
    case when (blueprint_policy #>> '{narration,voice,speaking_rate}') ~ '^[0-9]+([.][0-9]+)?$'
      then (blueprint_policy #>> '{narration,voice,speaking_rate}')::numeric
      else null end);
  next_language_code := coalesce(existing_draft.tts_language_code, nullif(btrim(blueprint_policy #>> '{narration,voice,language_code}'), ''), 'zh-CN');
  if p_audio_mode = 'tts' and (coalesce(next_tts_text, '') = '' or coalesce(next_tts_voice, '') = '' or next_tts_rate is null or next_tts_rate <= 0) then
    raise exception 'TTS 草稿必须包含口播内容、声音和有效语速' using errcode = '22023';
  end if;
  changed := existing_draft.id is null
    or existing_draft.audio_mode is distinct from p_audio_mode
    or existing_draft.subtitle_text is distinct from btrim(p_subtitle_text)
    or existing_draft.subtitles_enabled is distinct from p_subtitles_enabled
    or existing_draft.tts_text is distinct from next_tts_text
    or existing_draft.tts_voice is distinct from next_tts_voice
    or existing_draft.tts_speaking_rate is distinct from next_tts_rate;

  insert into public.shot_preparation_drafts (
    episode_id, review_package_id, shot_id, audio_mode, subtitle_text, subtitles_enabled,
    tts_text, tts_voice, tts_speaking_rate, tts_language_code, audio_status, tts_error
  ) values (
    p_episode_id, p_review_package_id, btrim(p_shot_id), p_audio_mode,
    case when p_audio_mode = 'tts' then next_tts_text else btrim(p_subtitle_text) end,
    p_subtitles_enabled, next_tts_text, next_tts_voice, next_tts_rate, next_language_code,
    case when changed then 'pending' else coalesce(existing_draft.audio_status, 'pending') end,
    case when changed then null else existing_draft.tts_error end
  )
  on conflict (episode_id, review_package_id, shot_id) do update set
    audio_mode = excluded.audio_mode,
    subtitle_text = excluded.subtitle_text,
    subtitles_enabled = excluded.subtitles_enabled,
    tts_text = excluded.tts_text,
    tts_voice = excluded.tts_voice,
    tts_speaking_rate = excluded.tts_speaking_rate,
    tts_language_code = excluded.tts_language_code,
    audio_status = case when excluded.tts_text is distinct from shot_preparation_drafts.tts_text
      or excluded.tts_voice is distinct from shot_preparation_drafts.tts_voice
      or excluded.tts_speaking_rate is distinct from shot_preparation_drafts.tts_speaking_rate
      or excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode
      or excluded.subtitle_text is distinct from shot_preparation_drafts.subtitle_text
      then 'pending' else shot_preparation_drafts.audio_status end,
    tts_error = case when excluded.tts_text is distinct from shot_preparation_drafts.tts_text
      or excluded.tts_voice is distinct from shot_preparation_drafts.tts_voice
      or excluded.tts_speaking_rate is distinct from shot_preparation_drafts.tts_speaking_rate
      or excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode
      or excluded.subtitle_text is distinct from shot_preparation_drafts.subtitle_text
      then null else shot_preparation_drafts.tts_error end,
    updated_at = now()
  returning * into saved_draft;

  if changed then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, current_episode.id, 'shot_preparation_draft_saved', jsonb_build_object(
      'review_package_id', p_review_package_id, 'shot_id', btrim(p_shot_id), 'audio_mode', p_audio_mode,
      'tts_text_changed', existing_draft.tts_text is distinct from next_tts_text,
      'subtitles_enabled', p_subtitles_enabled
    ), auth.uid());
  end if;
  return saved_draft;
end;
$$;

create function public.generate_shot_tts(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_retry boolean default false
)
returns public.tasks
language plpgsql
security definer set search_path = ''
as $$
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
  if current_episode.stage <> 'storyboard_approved' then raise exception 'Shot narration can only be generated in the shot workbench' using errcode = '22023'; end if;

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
    where version.id = credential_ref::uuid and connection.account_id = current_episode.account_id
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
  if found and existing_task.status in ('ready', 'running', 'completed') then return existing_task; end if;
  if found and existing_task.status = 'failed' and not p_retry then return existing_task; end if;

  budget_limit := case when (narration_config ->> 'budget_cents') ~ '^[0-9]+$' then (narration_config ->> 'budget_cents')::integer else 0 end;
  max_attempts := case when (narration_config ->> 'max_attempts') ~ '^[1-9][0-9]*$' then (narration_config ->> 'max_attempts')::integer else 1 end;
  task_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'capability', 'narration_generation', 'storyboard_review_package_id', p_review_package_id,
    'configuration_hash', config_hash, 'credential_ref', credential_ref,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', p_episode_id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
    'executor', jsonb_build_object('provider', provider, 'adapter', adapter, 'model', model, 'prompt_version', prompt_version),
    'media', jsonb_build_object('adapter', adapter, 'narration', jsonb_build_object('text', coalesce(draft.tts_text, draft.subtitle_text), 'voice', voice)),
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
  set audio_status = 'running', pending_tts_task_id = created_task.id, tts_error = null, updated_at = now()
  where id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_tts_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'configuration_hash', config_hash, 'retry', p_retry), auth.uid());
  return created_task;
end;
$$;

create or replace function public.sync_shot_tts_audio_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  source_task public.tasks;
begin
  select task.* into source_task from public.tasks task where task.id = new.source_task_id;
  if source_task.task_type <> 'generate_narration' or source_task.input_snapshot #>> '{shot_preparation,draft_id}' is null then return new; end if;
  update public.shot_preparation_drafts
  set current_audio_track_id = new.id, current_tts_task_id = new.source_task_id,
      pending_tts_task_id = null, audio_status = 'ready',
      tts_actual_duration_seconds = new.duration_seconds, tts_error = null, updated_at = now()
  where id = (source_task.input_snapshot #>> '{shot_preparation,draft_id}')::uuid
    and pending_tts_task_id = new.source_task_id;
  return new;
end;
$$;

drop trigger if exists sync_shot_tts_audio_after_insert on public.audio_tracks;
create trigger sync_shot_tts_audio_after_insert
after insert on public.audio_tracks
for each row execute function public.sync_shot_tts_audio_after_insert();

create or replace function public.sync_shot_tts_task_after_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
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

drop trigger if exists sync_shot_tts_task_after_update on public.tasks;
create trigger sync_shot_tts_task_after_update
after update of status on public.tasks
for each row execute function public.sync_shot_tts_task_after_update();

revoke all on function public.save_shot_preparation_draft(uuid, uuid, text, text, text, boolean, text, text, numeric) from public, anon;
grant execute on function public.save_shot_preparation_draft(uuid, uuid, text, text, text, boolean, text, text, numeric) to authenticated;
revoke all on function public.generate_shot_tts(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.generate_shot_tts(uuid, uuid, text, boolean) to authenticated;
revoke all on function public.sync_shot_tts_audio_after_insert() from public, anon, authenticated;
revoke all on function public.sync_shot_tts_task_after_update() from public, anon, authenticated;
