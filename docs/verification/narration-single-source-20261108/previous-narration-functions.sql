CREATE OR REPLACE FUNCTION local_identity.save_selected_workspace_narration(p_episode uuid, p_review uuid, p_shot text, p_text text, p_voice text, p_rate numeric, p_language text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE saved public.shot_preparation_drafts;previous public.shot_preparation_drafts;BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501';END IF;
 SELECT * INTO previous FROM public.shot_preparation_drafts WHERE episode_id=p_episode AND review_package_id=p_review AND shot_id=p_shot;
 saved:=public.save_shot_preparation_draft(p_episode,p_review,p_shot,'tts',coalesce(previous.subtitle_text,p_text),coalesce(previous.subtitles_enabled,true),p_text,p_voice,p_rate);
 UPDATE public.shot_preparation_drafts SET subtitle_text=coalesce(previous.subtitle_text,p_text),tts_text=p_text,tts_voice=p_voice,tts_override_voice=p_voice,tts_speaking_rate=p_rate,tts_override_speaking_rate=p_rate,tts_language_code=p_language WHERE id=saved.id;
END $function$

CREATE OR REPLACE FUNCTION local_identity.save_workspace_narration_draft(p_episode uuid, p_review uuid, p_shot text, p_mode text, p_text text, p_voice text, p_rate numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ DECLARE previous public.shot_preparation_drafts; saved public.shot_preparation_drafts; BEGIN
 SELECT * INTO previous FROM public.shot_preparation_drafts WHERE episode_id=p_episode AND review_package_id=p_review AND shot_id=p_shot;
 saved:=public.save_shot_preparation_draft(p_episode,p_review,p_shot,p_mode,coalesce(previous.subtitle_text,p_text),coalesce(previous.subtitles_enabled,true),p_text,p_voice,p_rate);
 IF p_mode='tts' THEN saved:=public.save_shot_tts_override(p_episode,p_review,p_shot,p_voice,p_rate); END IF;
 IF previous.id IS NOT NULL THEN UPDATE public.shot_preparation_drafts SET subtitle_text=previous.subtitle_text WHERE id=saved.id; END IF;
 IF previous.id IS NOT NULL AND (previous.tts_text IS DISTINCT FROM saved.tts_text OR previous.tts_voice IS DISTINCT FROM saved.tts_voice OR previous.tts_speaking_rate IS DISTINCT FROM saved.tts_speaking_rate OR previous.tts_language_code IS DISTINCT FROM saved.tts_language_code) THEN
 UPDATE public.shot_preparation_drafts SET pending_tts_task_id=NULL,current_tts_task_id=NULL,current_audio_track_id=NULL,tts_actual_duration_seconds=NULL,audio_status=CASE WHEN p_mode='tts' THEN 'pending' ELSE 'ready' END WHERE id=saved.id;
 END IF;
END $function$