-- ADR-0060: no current SQL/source, saved-runtime or recovery consumers.
-- Preserve all accounts, rule versions, frozen bindings, script/task history and guards.
-- Default RESTRICT rejects unexpected dependencies; never cascade or rewrite data.
DROP FUNCTION public.bootstrap_platform(text,text,text,jsonb);
DROP FUNCTION public.commission_script(uuid,text,text);
DROP FUNCTION public.set_episode_script_source(uuid,text);
DROP FUNCTION public.apply_blueprint_to_episode(uuid,uuid,text,text);
DROP FUNCTION public.deactivate_blueprint_version(uuid,uuid);
