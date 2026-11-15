-- ADR-0066: current v5 execution and explicit source adoption replace these contracts.
-- Historical rows, original packages, input hashes and migration ledgers are untouched.
-- No CASCADE: unexpected consumers must block the entire forward transaction.
DROP FUNCTION IF EXISTS local_identity.generate_input_shot_tts(uuid,uuid,text,boolean);
DROP FUNCTION IF EXISTS local_identity.plan_input_tasks(uuid);
DROP FUNCTION IF EXISTS public.apply_episode_configuration_repair_v2(uuid,jsonb,text,text);
DROP FUNCTION IF EXISTS public.apply_external_connection_repair(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS local_identity.queue_workspace_planning(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS local_identity.replan_workspace_planning(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS local_identity.save_planning_selection(uuid,jsonb,integer);
DROP FUNCTION IF EXISTS local_identity.script_production_scopes();
DROP FUNCTION IF EXISTS public.record_episode_worker_preflight(uuid,uuid);
