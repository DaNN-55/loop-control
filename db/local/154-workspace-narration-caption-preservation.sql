-- Narration drafts do not edit subtitles. Only explicit adoption updates following native lanes.
-- Existing independent/disabled caption inputs remain unchanged; new narration inputs follow by default.
CREATE OR REPLACE FUNCTION local_identity.save_workspace_narration_draft(p_episode uuid,p_review uuid,p_shot text,p_mode text,p_text text,p_voice text,p_rate numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE previous public.shot_preparation_drafts; saved public.shot_preparation_drafts; caption_text text; BEGIN
 SELECT * INTO previous FROM public.shot_preparation_drafts WHERE episode_id=p_episode AND review_package_id=p_review AND shot_id=p_shot;
 caption_text:=coalesce(previous.subtitle_text,(SELECT s->>'scriptSegment' FROM public.review_packages r CROSS JOIN LATERAL jsonb_array_elements(r.context_snapshot#>'{worker_result,storyboard,shots}') s WHERE r.id=p_review AND s->>'id'=p_shot),p_text);
 saved:=public.save_shot_preparation_draft(p_episode,p_review,p_shot,p_mode,caption_text,coalesce(previous.subtitles_enabled,true),p_text,p_voice,p_rate);
 IF p_mode='tts' THEN saved:=public.save_shot_tts_override(p_episode,p_review,p_shot,p_voice,p_rate); END IF;
 IF previous.id IS NOT NULL AND (previous.tts_text IS DISTINCT FROM saved.tts_text OR previous.tts_voice IS DISTINCT FROM saved.tts_voice OR previous.tts_speaking_rate IS DISTINCT FROM saved.tts_speaking_rate OR previous.tts_language_code IS DISTINCT FROM saved.tts_language_code) THEN
 UPDATE public.shot_preparation_drafts SET pending_tts_task_id=NULL,current_tts_task_id=NULL,current_audio_track_id=NULL,tts_actual_duration_seconds=NULL,audio_status=CASE WHEN p_mode='tts' THEN 'pending' ELSE 'ready' END WHERE id=saved.id;
 END IF;

 UPDATE public.shot_preparation_drafts SET
  subtitle_text=caption_text,
  subtitles_enabled=coalesce(previous.subtitles_enabled,saved.subtitles_enabled),
  caption_contract=CASE WHEN previous.id IS NOT NULL THEN previous.caption_contract ELSE jsonb_set(jsonb_set(saved.caption_contract,'{content_mode}','"follow_tts"'::jsonb),'{text}',to_jsonb(caption_text)) END
 WHERE id=saved.id;
END $$;

CREATE OR REPLACE FUNCTION local_identity.save_selected_workspace_narration(p_episode uuid,p_review uuid,p_shot text,p_text text,p_voice text,p_rate numeric,p_language text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.shot_preparation_drafts;previous public.shot_preparation_drafts;caption_text text;BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501';END IF;
 SELECT * INTO previous FROM public.shot_preparation_drafts WHERE episode_id=p_episode AND review_package_id=p_review AND shot_id=p_shot;
 caption_text:=coalesce(previous.subtitle_text,(SELECT s->>'scriptSegment' FROM public.review_packages r CROSS JOIN LATERAL jsonb_array_elements(r.context_snapshot#>'{worker_result,storyboard,shots}') s WHERE r.id=p_review AND s->>'id'=p_shot),p_text);
 saved:=public.save_shot_preparation_draft(p_episode,p_review,p_shot,'tts',caption_text,coalesce(previous.subtitles_enabled,true),p_text,p_voice,p_rate);
 UPDATE public.shot_preparation_drafts SET subtitle_text=caption_text,tts_text=p_text,tts_voice=p_voice,tts_override_voice=p_voice,tts_speaking_rate=p_rate,tts_override_speaking_rate=p_rate,tts_language_code=p_language WHERE id=saved.id;

 UPDATE public.shot_preparation_drafts SET
  subtitle_text=caption_text,
  subtitles_enabled=coalesce(previous.subtitles_enabled,saved.subtitles_enabled),
  caption_contract=CASE WHEN previous.id IS NOT NULL THEN previous.caption_contract ELSE jsonb_set(jsonb_set(saved.caption_contract,'{content_mode}','"follow_tts"'::jsonb),'{text}',to_jsonb(caption_text)) END
 WHERE id=saved.id;
END $$;
