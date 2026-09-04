do $migration$
declare definition text; updated text;
begin
  select pg_get_functiondef('public.orchestrate_narration_tasks_without_connection_ref(uuid)'::regprocedure) into definition;
  updated := replace(definition,
    $$executor ->> 'provider' <> 'google_tts' or executor ->> 'adapter' <> 'google_tts'$$,
    $$not ((executor ->> 'provider' = 'google_tts' and executor ->> 'adapter' = 'google_tts') or (executor ->> 'provider' = 'volcengine_tts' and executor ->> 'adapter' = 'volcengine_tts'))$$);
  updated := replace(updated,
    $$旁白配置必须精确声明 google_tts 适配器、模型与提示版本。$$,
    $$旁白配置必须精确声明已登记的 TTS 适配器、模型与提示版本。$$);
  updated := replace(updated,
    $$jsonb_build_object('adapter','google_tts','narration'$$,
    $$jsonb_build_object('adapter',executor ->> 'adapter','narration'$$);
  if updated = definition then raise exception 'Narration orchestration definition did not match the expected version'; end if;
  execute updated;

  select pg_get_functiondef('public.claim_next_worker_task(uuid)'::regprocedure) into definition;
  updated := replace(definition,
    $$task.provider in ('codex','google_tts','pexels','ffmpeg','freesound','hyperframes')$$,
    $$task.provider in ('codex','google_tts','volcengine_tts','pexels','ffmpeg','freesound','hyperframes')$$);
  if updated = definition then raise exception 'Worker claim definition did not match the expected version'; end if;
  execute updated;

  select pg_get_functiondef('public.apply_external_connection_repair(uuid,uuid,text,text)'::regprocedure) into definition;
  updated := replace(definition,
    $$expected_provider := case blocked_task.task_type when 'prepare_visual_brief' then 'openai' when 'generate_b_roll' then 'pexels' when 'generate_narration' then 'google_tts' when 'generate_soundtrack' then 'freesound' else null end;$$,
    $$expected_provider := case blocked_task.task_type when 'prepare_visual_brief' then 'openai' when 'generate_b_roll' then 'pexels' when 'generate_narration' then blocked_task.provider when 'generate_soundtrack' then 'freesound' else null end;$$);
  updated := replace(updated,
    $$expected_adapter := case blocked_task.task_type when 'prepare_visual_brief' then 'openai_images' when 'generate_b_roll' then 'pexels_video' when 'generate_narration' then 'google_tts' when 'generate_soundtrack' then 'freesound_preview' else null end;$$,
    $$expected_adapter := case blocked_task.task_type when 'prepare_visual_brief' then 'openai_images' when 'generate_b_roll' then 'pexels_video' when 'generate_narration' then blocked_task.input_snapshot #>> '{executor,adapter}' when 'generate_soundtrack' then 'freesound_preview' else null end;$$);
  if updated = definition then raise exception 'External connection repair definition did not match the expected version'; end if;
  execute updated;
end;
$migration$;
