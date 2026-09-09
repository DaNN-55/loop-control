alter table public.shot_preparation_drafts
  add column if not exists tts_override_voice text,
  add column if not exists tts_override_speaking_rate numeric(5,2),
  add column if not exists tts_text_confirmation_fingerprint text,
  add column if not exists tts_text_confirmed_at timestamptz,
  add column if not exists tts_text_confirmed_by uuid references auth.users(id) on delete set null;

create or replace function public.reset_shot_tts_confirmation_after_text_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if old.tts_text is distinct from new.tts_text or old.audio_mode is distinct from new.audio_mode then
    new.tts_text_confirmation_fingerprint := null;
    new.tts_text_confirmed_at := null;
    new.tts_text_confirmed_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reset_shot_tts_confirmation_after_text_change on public.shot_preparation_drafts;
create trigger reset_shot_tts_confirmation_after_text_change
before update on public.shot_preparation_drafts
for each row execute function public.reset_shot_tts_confirmation_after_text_change();

create or replace function public.assert_current_storyboard_shot(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text
)
returns void
language plpgsql
security definer set search_path = ''
as $$
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

create or replace function public.set_shot_tts_confirmation(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_confirmed boolean
)
returns public.shot_preparation_drafts
language plpgsql
security definer set search_path = ''
as $$
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

create or replace function public.save_shot_tts_override(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_tts_voice text,
  p_tts_speaking_rate numeric
)
returns public.shot_preparation_drafts
language plpgsql
security definer set search_path = ''
as $$
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
  if not found or current_episode.stage <> 'storyboard_approved' then
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
  if draft.frozen_at is not null then raise exception 'Frozen shot drafts cannot be edited' using errcode = '22023'; end if;

  select policy into blueprint_policy from public.account_blueprint_versions where id = current_episode.blueprint_version_id;
  default_voice := coalesce(current_episode.tts_voice, nullif(btrim(blueprint_policy #>> '{narration,voice,name}'), ''));
  default_rate := coalesce(current_episode.tts_speaking_rate,
    case when (blueprint_policy #>> '{narration,voice,speaking_rate}') ~ '^[0-9]+([.][0-9]+)?$' then (blueprint_policy #>> '{narration,voice,speaking_rate}')::numeric else null end);
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

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.save_episode_tts_settings(uuid,text,text,numeric)'::regprocedure) into definition;
  if definition is null then raise exception 'save_episode_tts_settings is required'; end if;
  patched := replace(definition,
    'set tts_language_code = btrim(p_tts_language_code), tts_voice = btrim(p_tts_voice), tts_speaking_rate = p_tts_speaking_rate,
        current_audio_track_id = null',
    'set tts_language_code = btrim(p_tts_language_code), tts_voice = coalesce(draft.tts_override_voice, btrim(p_tts_voice)), tts_speaking_rate = coalesce(draft.tts_override_speaking_rate, p_tts_speaking_rate),
        current_audio_track_id = null');
  if patched = definition then raise exception 'Episode TTS settings must preserve shot overrides'; end if;
  execute patched;
end $$;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean,text,text,numeric)'::regprocedure) into definition;
  if definition is null then raise exception 'save_shot_preparation_draft is required'; end if;
  patched := replace(definition,
    'next_tts_voice := coalesce(current_episode.tts_voice, nullif(btrim(p_tts_voice), ''''), existing_draft.tts_voice, nullif(btrim(blueprint_policy #>> ''{narration,voice,name}''), ''''));',
    'next_tts_voice := coalesce(existing_draft.tts_override_voice, current_episode.tts_voice, nullif(btrim(p_tts_voice), ''''), existing_draft.tts_voice, nullif(btrim(blueprint_policy #>> ''{narration,voice,name}''), ''''));');
  patched := replace(patched,
    'next_tts_rate := coalesce(current_episode.tts_speaking_rate, p_tts_speaking_rate, existing_draft.tts_speaking_rate,',
    'next_tts_rate := coalesce(existing_draft.tts_override_speaking_rate, current_episode.tts_speaking_rate, p_tts_speaking_rate, existing_draft.tts_speaking_rate,');
  if patched = definition then raise exception 'shot TTS override preservation clauses were not found'; end if;
  execute patched;
end $$;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.generate_shot_tts(uuid,uuid,text,boolean)'::regprocedure) into definition;
  if definition is null then raise exception 'generate_shot_tts is required'; end if;
  patched := replace(definition,
    'if draft.audio_mode <> ''tts'' then raise exception ''Only TTS shots can generate narration'' using errcode = ''22023''; end if;',
    'if draft.audio_mode <> ''tts'' then raise exception ''Only TTS shots can generate narration'' using errcode = ''22023''; end if;
  if draft.tts_text_confirmation_fingerprint is distinct from md5(btrim(coalesce(draft.tts_text, draft.subtitle_text))) then raise exception ''口播内容必须先保存并确认'' using errcode = ''22023''; end if;');
  patched := replace(patched,
    'set audio_status = ''running'', pending_tts_task_id = created_task.id, tts_error = null, updated_at = now()',
    'set current_audio_track_id = null, current_tts_task_id = null, tts_actual_duration_seconds = null, audio_status = ''running'', pending_tts_task_id = created_task.id, tts_error = null, updated_at = now()');
  if patched = definition then raise exception 'shot TTS confirmation guard was not found'; end if;
  execute patched;
end $$;

revoke all on function public.set_shot_tts_confirmation(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.set_shot_tts_confirmation(uuid, uuid, text, boolean) to authenticated;
revoke all on function public.save_shot_tts_override(uuid, uuid, text, text, numeric) from public, anon;
grant execute on function public.save_shot_tts_override(uuid, uuid, text, text, numeric) to authenticated;
revoke all on function public.assert_current_storyboard_shot(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reset_shot_tts_confirmation_after_text_change() from public, anon, authenticated;
