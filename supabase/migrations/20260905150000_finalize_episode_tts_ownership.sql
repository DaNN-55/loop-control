update public.episodes episode
set tts_language_code = coalesce(episode.tts_language_code, nullif(btrim(blueprint.policy #>> '{narration,voice,language_code}'), ''), 'zh-CN'),
    tts_voice = coalesce(episode.tts_voice, nullif(btrim(blueprint.policy #>> '{narration,voice,name}'), '')),
    tts_speaking_rate = coalesce(episode.tts_speaking_rate,
      case when (blueprint.policy #>> '{narration,voice,speaking_rate}') ~ '^[0-9]+([.][0-9]+)?$'
        then (blueprint.policy #>> '{narration,voice,speaking_rate}')::numeric
        else null
      end)
from public.account_blueprint_versions blueprint
where blueprint.id = episode.blueprint_version_id
  and (episode.tts_language_code is null or episode.tts_voice is null or episode.tts_speaking_rate is null);

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.save_episode_tts_settings(uuid,text,text,numeric)'::regprocedure) into definition;
  if definition is null then raise exception 'save_episode_tts_settings is required'; end if;
  patched := replace(definition,
    $old$confirmation_status = 'pending', confirmed_at = null, confirmed_by = null, updated_at = now()$old$,
    $new$updated_at = now()$new$);
  if patched = definition then raise exception 'Episode TTS settings must preserve shot confirmation'; end if;
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
    $old$next_tts_voice := coalesce(existing_draft.tts_override_voice, current_episode.tts_voice, nullif(btrim(p_tts_voice), ''), existing_draft.tts_voice, nullif(btrim(blueprint_policy #>> '{narration,voice,name}'), ''));$old$,
    $new$next_tts_voice := coalesce(existing_draft.tts_override_voice, current_episode.tts_voice, nullif(btrim(p_tts_voice), ''), existing_draft.tts_voice);$new$);
  patched := replace(patched,
    $old$next_tts_rate := coalesce(existing_draft.tts_override_speaking_rate, current_episode.tts_speaking_rate, p_tts_speaking_rate, existing_draft.tts_speaking_rate, case when (blueprint_policy #>> '{narration,voice,speaking_rate}') ~ '^[0-9]+([.][0-9]+)?$' then (blueprint_policy #>> '{narration,voice,speaking_rate}')::numeric else null end);$old$,
    $new$next_tts_rate := coalesce(existing_draft.tts_override_speaking_rate, current_episode.tts_speaking_rate, p_tts_speaking_rate, existing_draft.tts_speaking_rate);$new$);
  patched := replace(patched,
    $old$next_language_code := coalesce(current_episode.tts_language_code, existing_draft.tts_language_code, nullif(btrim(blueprint_policy #>> '{narration,voice,language_code}'), ''), 'zh-CN');$old$,
    $new$next_language_code := coalesce(current_episode.tts_language_code, existing_draft.tts_language_code, 'zh-CN');$new$);
  if patched = definition or position('blueprint_policy #>> ''{narration,voice' in patched) > 0 then raise exception 'New Episode TTS defaults must not read blueprint voice fields'; end if;
  execute patched;
end $$;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.save_shot_tts_override(uuid,uuid,text,text,numeric)'::regprocedure) into definition;
  if definition is null then raise exception 'save_shot_tts_override is required'; end if;
  patched := replace(definition,
    $old$default_voice := coalesce(current_episode.tts_voice, nullif(btrim(blueprint_policy #>> '{narration,voice,name}'), ''));$old$,
    $new$default_voice := current_episode.tts_voice;$new$);
  patched := replace(patched,
    $old$default_rate := coalesce(current_episode.tts_speaking_rate,
    case when (blueprint_policy #>> '{narration,voice,speaking_rate}') ~ '^[0-9]+([.][0-9]+)?$' then (blueprint_policy #>> '{narration,voice,speaking_rate}')::numeric else null end);$old$,
    $new$default_rate := current_episode.tts_speaking_rate;$new$);
  if patched = definition or position('blueprint_policy #>> ''{narration,voice' in patched) > 0 then raise exception 'Shot TTS overrides must use Episode settings'; end if;
  execute patched;
end $$;

do $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.shot_tts_configuration_hash(uuid,uuid)'::regprocedure) into definition;
  if definition is null then raise exception 'shot_tts_configuration_hash is required'; end if;
  patched := replace(definition,
    $old$coalesce(nullif(btrim(draft.tts_language_code), ''), nullif(btrim(episode.tts_language_code), ''), nullif(btrim(narration_config #>> '{voice,language_code}'), ''), 'zh-CN')$old$,
    $new$coalesce(nullif(btrim(draft.tts_language_code), ''), nullif(btrim(episode.tts_language_code), ''), 'zh-CN')$new$);
  patched := replace(patched,
    $old$coalesce(draft.tts_voice, episode.tts_voice, narration_config #>> '{voice,name}')$old$,
    $new$coalesce(draft.tts_voice, episode.tts_voice)$new$);
  patched := replace(patched,
    $old$coalesce(draft.tts_speaking_rate, episode.tts_speaking_rate,
      case when (narration_config #>> '{voice,speaking_rate}') ~ '^[0-9]+([.][0-9]+)?$' then (narration_config #>> '{voice,speaking_rate}')::numeric else null end)$old$,
    $new$coalesce(draft.tts_speaking_rate, episode.tts_speaking_rate)$new$);
  if patched = definition or position('narration_config #>> ''{voice' in patched) > 0 then raise exception 'TTS configuration hash must use Episode settings'; end if;
  execute patched;
end $$;
