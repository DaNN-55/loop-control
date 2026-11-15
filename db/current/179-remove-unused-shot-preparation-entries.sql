-- ADR-0059: no current SQL/source or saved-runtime consumers of these old entries.
-- Preserve historical drafts, audio tracks, frozen evidence and all protection triggers.
-- Default RESTRICT rejects unexpected dependencies; never cascade or rewrite history.
DROP FUNCTION public.confirm_shot_preparation(uuid,uuid,text,text,boolean);
DROP FUNCTION public.freeze_shot_preparation_batch(uuid,uuid);
DROP FUNCTION public.replace_manual_shot_media(uuid,uuid,text,uuid,text);
DROP FUNCTION public.save_shot_clip_draft(uuid,uuid,text,uuid,numeric,numeric);
DROP FUNCTION public.set_shot_tts_confirmation(uuid,uuid,text,boolean);
DROP FUNCTION public.skip_shot_preparation(uuid,uuid,text,text);
DROP FUNCTION public.restore_completed_shot_tts_track(uuid,uuid);
