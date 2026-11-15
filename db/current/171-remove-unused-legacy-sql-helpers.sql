-- ADR-0051: remove only audited unused routines; keep all historical rows and current producers.
DROP TRIGGER zz_auto_advance_disabled_approval_gate_after_task ON public.tasks;
DROP FUNCTION public.auto_advance_disabled_approval_gate();
DROP FUNCTION public.approval_gate_enabled(uuid, text);
DROP FUNCTION public.set_generation_budget(uuid, integer, integer, boolean);
DROP FUNCTION public.orchestrate_provided_script_tasks();
DROP FUNCTION public.orchestrate_provided_script_tasks_for_episode(uuid);
DROP FUNCTION public.orchestrate_embedded_audio_tasks(uuid);
