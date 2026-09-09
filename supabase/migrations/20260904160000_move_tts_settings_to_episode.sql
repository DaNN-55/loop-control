alter table public.episodes
  add column if not exists tts_language_code text,
  add column if not exists tts_voice text,
  add column if not exists tts_speaking_rate numeric(5,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'episodes_tts_speaking_rate_positive') then
    alter table public.episodes add constraint episodes_tts_speaking_rate_positive check (tts_speaking_rate is null or tts_speaking_rate > 0);
  end if;
end;
$$;

create or replace function public.save_episode_tts_settings(
  p_episode_id uuid,
  p_tts_language_code text,
  p_tts_voice text,
  p_tts_speaking_rate numeric
)
returns public.episodes
language plpgsql
security definer set search_path = ''
as $$
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
  if current_episode.stage <> 'storyboard_approved' then raise exception '本期 TTS 设置只能在镜头工作台保存' using errcode = '22023'; end if;

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
    set tts_language_code = btrim(p_tts_language_code), tts_voice = btrim(p_tts_voice), tts_speaking_rate = p_tts_speaking_rate,
        current_audio_track_id = null, current_tts_task_id = null, pending_tts_task_id = null,
        tts_actual_duration_seconds = null, tts_error = null, audio_status = case when draft.audio_mode = 'tts' then 'pending' else draft.audio_status end,
        confirmation_status = 'pending', confirmed_at = null, confirmed_by = null, updated_at = now()
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

do $$
declare
  definition text;
  patched_definition text;
begin
  select pg_get_functiondef('public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean,text,text,numeric)'::regprocedure) into definition;
  if definition is null then raise exception 'save_shot_preparation_draft is required'; end if;
  patched_definition := replace(definition,
    $old$next_tts_voice := coalesce(nullif(btrim(p_tts_voice), ''), existing_draft.tts_voice, nullif(btrim(blueprint_policy #>> '{narration,voice,name}'), ''));$old$,
    $new$next_tts_voice := coalesce(current_episode.tts_voice, nullif(btrim(p_tts_voice), ''), existing_draft.tts_voice, nullif(btrim(blueprint_policy #>> '{narration,voice,name}'), ''));$new$);
  patched_definition := replace(patched_definition,
    $old$next_tts_rate := coalesce(p_tts_speaking_rate, existing_draft.tts_speaking_rate,$old$,
    $new$next_tts_rate := coalesce(current_episode.tts_speaking_rate, p_tts_speaking_rate, existing_draft.tts_speaking_rate,$new$);
  patched_definition := replace(patched_definition,
    $old$next_language_code := coalesce(existing_draft.tts_language_code,$old$,
    $new$next_language_code := coalesce(current_episode.tts_language_code, existing_draft.tts_language_code,$new$);
  if patched_definition = definition then raise exception 'save_shot_preparation_draft TTS ownership clauses were not found'; end if;
  execute patched_definition;
end;
$$;

create or replace function public.shot_tts_configuration_hash(p_episode_id uuid, p_draft_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
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
    'language_code', coalesce(nullif(btrim(draft.tts_language_code), ''), nullif(btrim(episode.tts_language_code), ''), nullif(btrim(narration_config #>> '{voice,language_code}'), ''), 'zh-CN'),
    'name', coalesce(draft.tts_voice, episode.tts_voice, narration_config #>> '{voice,name}'),
    'speaking_rate', coalesce(draft.tts_speaking_rate, episode.tts_speaking_rate,
      case when (narration_config #>> '{voice,speaking_rate}') ~ '^[0-9]+([.][0-9]+)?$' then (narration_config #>> '{voice,speaking_rate}')::numeric else null end)
  );
  if coalesce(draft.tts_text, draft.subtitle_text, '') = '' or coalesce(voice ->> 'name', '') = '' or voice ->> 'speaking_rate' is null or provider is null or adapter is null or credential_ref is null then return null; end if;
  return md5(jsonb_build_object('text', coalesce(draft.tts_text, draft.subtitle_text), 'voice', voice, 'provider', provider, 'adapter', adapter, 'model', model, 'prompt_version', prompt_version, 'connection_version_id', credential_ref)::text);
end;
$$;

do $$
declare
  definition text;
  patched_definition text;
begin
  foreach definition in array array[
    pg_get_functiondef('public.has_current_shot_preparation_snapshot(uuid,uuid)'::regprocedure),
    pg_get_functiondef('public.freeze_shot_preparation_batch(uuid,uuid)'::regprocedure)
  ] loop
    if definition is null then raise exception 'Shot preparation function is required'; end if;
    patched_definition := replace(definition,
      $old$and task.input_snapshot #>> '{media,narration,text}' = draft.tts_text$old$,
      $new$and task.input_snapshot #>> '{media,narration,text}' = draft.tts_text
        and task.input_snapshot ->> 'configuration_hash' = public.shot_tts_configuration_hash(p_episode_id, draft.id)$new$);
    if patched_definition = definition then raise exception 'TTS configuration fingerprint guard was not found'; end if;
    execute patched_definition;
  end loop;
end;
$$;

revoke all on function public.save_episode_tts_settings(uuid, text, text, numeric) from public, anon;
grant execute on function public.save_episode_tts_settings(uuid, text, text, numeric) to authenticated;
revoke all on function public.shot_tts_configuration_hash(uuid, uuid) from public, anon, authenticated;
