-- ADR-0058: no mounted triggers, current SQL/source callers or saved-runtime consumers.
-- Preserve current render/approval, frozen evidence, history and recovery protections.
-- Default RESTRICT fails closed on an unexpected dependency; never cascade.
DROP FUNCTION public.confirm_frozen_shot_when_ready();
DROP FUNCTION public.queue_source_audio_after_frozen_clip();
DROP FUNCTION public.guard_b_roll_task_claim();
DROP FUNCTION public.create_pre_render_review_packages();
DROP FUNCTION public.create_pre_render_review_packages_for_episode(uuid);
DROP FUNCTION public.advance_production_ready_episodes(uuid);
DROP FUNCTION public.recover_duration_decision_review_render_tasks();
