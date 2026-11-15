-- ADR-0052: these retired rejection shells have no effective consumers.
-- Keep orchestrate_storyboard_tasks_for_episode(uuid): the historical Studio
-- revision function still relies on its explicit rejection and transaction rollback.
-- RESTRICT is deliberate: an unexpected catalog dependency must abort migration.
DROP FUNCTION public.orchestrate_a_roll_tasks();
DROP FUNCTION public.orchestrate_a_roll_tasks_for_episode(uuid);
DROP FUNCTION public.orchestrate_a_roll_tasks_for_episode_without_card_adapter(uuid);
DROP FUNCTION public.orchestrate_a_roll_tasks_without_card_adapter();
DROP FUNCTION public.orchestrate_a_roll_tasks_without_manual_path();
DROP FUNCTION public.orchestrate_b_roll_tasks(uuid);
DROP FUNCTION public.orchestrate_b_roll_tasks_all();
DROP FUNCTION public.orchestrate_b_roll_tasks_configured(uuid);
DROP FUNCTION public.orchestrate_b_roll_tasks_legacy(uuid);
DROP FUNCTION public.orchestrate_b_roll_tasks_legacy_all();
DROP FUNCTION public.orchestrate_b_roll_tasks_with_connection_ref(uuid);
DROP FUNCTION public.orchestrate_b_roll_tasks_without_connection_ref(uuid);
DROP FUNCTION public.orchestrate_narration_tasks(uuid);
DROP FUNCTION public.orchestrate_narration_tasks_all();
DROP FUNCTION public.orchestrate_narration_tasks_configured(uuid);
DROP FUNCTION public.orchestrate_narration_tasks_without_connection_ref(uuid);
DROP FUNCTION public.orchestrate_soundtrack_tasks(uuid);
DROP FUNCTION public.orchestrate_soundtrack_tasks_without_manual_path(uuid);
DROP FUNCTION public.orchestrate_storyboard_tasks();
