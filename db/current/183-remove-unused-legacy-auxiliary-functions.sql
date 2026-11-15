-- ADR-0063: remove the unused history plan before its private fingerprint helper.
-- Preserve history rows, frozen source audio, current account locks and receipt recovery.
DROP FUNCTION local_identity.history_episode_delete_plan(text,text);
DROP FUNCTION local_identity.history_episode_business_revision(text);
DROP FUNCTION local_identity.lock_owned_account(uuid);
DROP FUNCTION public.queue_frozen_shot_source_audio(uuid,boolean);
