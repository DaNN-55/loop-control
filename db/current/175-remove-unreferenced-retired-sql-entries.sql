-- ADR-0055: these four rejection-only signatures have no effective SQL, current
-- application or retained runtime-package consumers. Keep the eight interfaces
-- still referenced by old packages, including Worker startup and empty scanning.
-- RESTRICT intentionally aborts on an unexpected catalog dependency.
DROP FUNCTION local_identity.plan_input_tasks_before_workspace_audio(uuid);
DROP FUNCTION public.apply_episode_configuration_repair(uuid,jsonb,text,text);
DROP FUNCTION public.generate_shot_tts(uuid,uuid,text,boolean);
DROP FUNCTION public.generate_confirmed_shot_tts_batch(uuid,uuid);
