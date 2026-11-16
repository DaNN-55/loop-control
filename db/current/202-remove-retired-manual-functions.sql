-- Remove the closed manual execution functions after 201 and dependency review.
-- Keep historical rows, frozen identities, result reconciliation and shared tasks.
-- Detect body references that PostgreSQL does not record in pg_depend; unexpected
-- consumers abort the complete transaction. Each deletion also uses RESTRICT.
DO $retired_dependency_check$
DECLARE targets text[] := ARRAY[
 'public.request_official_shot_video(uuid,uuid,text,uuid,text,integer,uuid,integer)',
 'public.request_wan_shot_video(uuid,uuid,text,uuid,text,integer,uuid)',
 'public.resume_wan_video_task(uuid)',
 'public.generate_shot_review_video(uuid,uuid,jsonb,boolean,text)',
 'public.request_review_render_revision(uuid,jsonb,text)',
 'local_identity.register_owned_studio_freeze(uuid,uuid,jsonb)',
 'local_identity.queue_owned_studio_render(uuid)',
 'local_identity.scope_input_studio_task(uuid,text,jsonb)',
 'public.create_qc_review_issue(uuid,text,numeric,text,text)',
 'public.resolve_qc_review_issue(uuid,text)',
 'public.request_qc_member_revision(uuid)',
 'local_identity.retry_owned_final_render(uuid,text)',
 'local_identity.queue_owned_final_render(uuid)',
 'local_identity.complete_owned_publish(uuid,jsonb,jsonb,jsonb)',
 'public.generate_shot_clip(uuid,uuid,text,boolean)',
 'public.save_manual_shot_clip(uuid,uuid,text,uuid,text,numeric,numeric)',
 'public.generate_shot_source_audio(uuid,uuid,text,boolean)',
 'public.request_shot_acoustic_alignment(uuid,uuid,text,boolean)',
 'public.generate_shot_sync_preview(uuid,uuid,text)',
 'public.confirm_shot_sync_preview(uuid,uuid,text,text,text)',
 'public.save_shot_manual_alignment(uuid,uuid,text,jsonb)',
 'local_identity.retry_input_media(uuid,uuid)',
 'local_identity.scope_input_post_task(uuid)',
 'public.register_manual_audio(uuid,uuid,text,uuid)',
 'public.register_manual_episode_narration(uuid,uuid,uuid)',
 'public.save_storyboard_audio_selection(uuid,uuid,text,text,text,text,uuid)',
 'public.save_shot_workbench_composition_draft(uuid,uuid,text,uuid,jsonb,jsonb,numeric,text,text,boolean,text,text,numeric)',
 'public.save_shot_workbench_draft(uuid,uuid,text,uuid,jsonb,text,text,boolean,text,text,numeric)',
 'public.set_episode_audio_source_mode(uuid,text)',
 'public.save_episode_tts_settings(uuid,text,text,numeric)',
 'public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean)',
 'public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean,text,text,numeric)',
 'public.save_shot_caption_contract(uuid,uuid,text,jsonb)',
 'public.save_shot_tts_override(uuid,uuid,text,text,numeric)',
 'public.save_shot_audio_mix(uuid,uuid,text,text)',
 'public.save_shot_transition_mode(uuid,uuid,text,text)',
 'public.create_audio_track_annotation(uuid,numeric,text)',
 'local_identity.confirm_caption_text(uuid,uuid,text,uuid,text,text,text)',
 'public.retry_failed_final_render(uuid,text)',
 'public.transition_episode(uuid,public.episode_stage,text)',
 'public.record_publish_package_verification(uuid,text,bigint)',
 'local_identity.save_selected_workspace_narration(uuid,uuid,text,text,text,numeric,text)',
 'local_identity.save_workspace_narration_draft(uuid,uuid,text,text,text,text,numeric)',
 'local_identity.use_workspace_source_track(uuid,uuid,text,uuid)'
]; blockers text;
BEGIN
 SELECT string_agg(p.oid::regprocedure::text||' -> '||t.signature,E'\n' ORDER BY p.oid::regprocedure::text,t.signature)
 INTO blockers
 FROM unnest(targets) AS t(signature)
 JOIN pg_proc target ON target.oid=to_regprocedure(t.signature)
 CROSS JOIN pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','local_identity','loop_internal') AND p.prokind='f'
 AND NOT EXISTS(SELECT 1 FROM unnest(targets) own(signature) WHERE to_regprocedure(own.signature)=p.oid)
 AND p.prosrc ~ ('\m'||target.proname||'\s*\(');
 IF blockers IS NOT NULL THEN RAISE EXCEPTION 'Retired execution functions still have consumers: %',blockers USING ERRCODE='2BP01'; END IF;
END
$retired_dependency_check$;

DROP FUNCTION IF EXISTS public.request_official_shot_video(uuid,uuid,text,uuid,text,integer,uuid,integer) RESTRICT;
DROP FUNCTION IF EXISTS public.request_wan_shot_video(uuid,uuid,text,uuid,text,integer,uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.resume_wan_video_task(uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.generate_shot_review_video(uuid,uuid,jsonb,boolean,text) RESTRICT;
DROP FUNCTION IF EXISTS public.request_review_render_revision(uuid,jsonb,text) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.register_owned_studio_freeze(uuid,uuid,jsonb) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.queue_owned_studio_render(uuid) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.scope_input_studio_task(uuid,text,jsonb) RESTRICT;
DROP FUNCTION IF EXISTS public.create_qc_review_issue(uuid,text,numeric,text,text) RESTRICT;
DROP FUNCTION IF EXISTS public.resolve_qc_review_issue(uuid,text) RESTRICT;
DROP FUNCTION IF EXISTS public.request_qc_member_revision(uuid) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.retry_owned_final_render(uuid,text) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.queue_owned_final_render(uuid) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.complete_owned_publish(uuid,jsonb,jsonb,jsonb) RESTRICT;
DROP FUNCTION IF EXISTS public.generate_shot_clip(uuid,uuid,text,boolean) RESTRICT;
DROP FUNCTION IF EXISTS public.save_manual_shot_clip(uuid,uuid,text,uuid,text,numeric,numeric) RESTRICT;
DROP FUNCTION IF EXISTS public.generate_shot_source_audio(uuid,uuid,text,boolean) RESTRICT;
DROP FUNCTION IF EXISTS public.request_shot_acoustic_alignment(uuid,uuid,text,boolean) RESTRICT;
DROP FUNCTION IF EXISTS public.generate_shot_sync_preview(uuid,uuid,text) RESTRICT;
DROP FUNCTION IF EXISTS public.confirm_shot_sync_preview(uuid,uuid,text,text,text) RESTRICT;
DROP FUNCTION IF EXISTS public.save_shot_manual_alignment(uuid,uuid,text,jsonb) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.retry_input_media(uuid,uuid) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.scope_input_post_task(uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.register_manual_audio(uuid,uuid,text,uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.register_manual_episode_narration(uuid,uuid,uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.save_storyboard_audio_selection(uuid,uuid,text,text,text,text,uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.save_shot_workbench_composition_draft(uuid,uuid,text,uuid,jsonb,jsonb,numeric,text,text,boolean,text,text,numeric) RESTRICT;
DROP FUNCTION IF EXISTS public.save_shot_workbench_draft(uuid,uuid,text,uuid,jsonb,text,text,boolean,text,text,numeric) RESTRICT;
DROP FUNCTION IF EXISTS public.set_episode_audio_source_mode(uuid,text) RESTRICT;
DROP FUNCTION IF EXISTS public.save_episode_tts_settings(uuid,text,text,numeric) RESTRICT;
DROP FUNCTION IF EXISTS public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean) RESTRICT;
DROP FUNCTION IF EXISTS public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean,text,text,numeric) RESTRICT;
DROP FUNCTION IF EXISTS public.save_shot_caption_contract(uuid,uuid,text,jsonb) RESTRICT;
DROP FUNCTION IF EXISTS public.save_shot_tts_override(uuid,uuid,text,text,numeric) RESTRICT;
DROP FUNCTION IF EXISTS public.save_shot_audio_mix(uuid,uuid,text,text) RESTRICT;
DROP FUNCTION IF EXISTS public.save_shot_transition_mode(uuid,uuid,text,text) RESTRICT;
DROP FUNCTION IF EXISTS public.create_audio_track_annotation(uuid,numeric,text) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.confirm_caption_text(uuid,uuid,text,uuid,text,text,text) RESTRICT;
DROP FUNCTION IF EXISTS public.retry_failed_final_render(uuid,text) RESTRICT;
DROP FUNCTION IF EXISTS public.transition_episode(uuid,public.episode_stage,text) RESTRICT;
DROP FUNCTION IF EXISTS public.record_publish_package_verification(uuid,text,bigint) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.save_selected_workspace_narration(uuid,uuid,text,text,text,numeric,text) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.save_workspace_narration_draft(uuid,uuid,text,text,text,text,numeric) RESTRICT;
DROP FUNCTION IF EXISTS local_identity.use_workspace_source_track(uuid,uuid,text,uuid) RESTRICT;
