-- Forced alignment describes timing; only an explicit Owner action reviews content.
ALTER TABLE public.shot_preparation_drafts ADD COLUMN caption_text_confirmation jsonb;
ALTER TABLE public.shot_preparation_drafts ADD CONSTRAINT caption_text_confirmation_shape CHECK (
 caption_text_confirmation IS NULL OR coalesce((
  jsonb_typeof(caption_text_confirmation)='object'
  AND caption_text_confirmation->>'version'='caption-text-confirmation/v1'
  AND coalesce(caption_text_confirmation->>'audioTrackId','')~'^[0-9a-f-]{36}$'
  AND coalesce(caption_text_confirmation->>'audioSha256','')~'^[0-9a-f]{64}$'
  AND coalesce(caption_text_confirmation->>'textFingerprint','')~'^[0-9a-f]{64}$'
  AND coalesce(caption_text_confirmation->>'alignmentInputVersion','')~'^[0-9a-f]{64}$'
  AND jsonb_typeof(caption_text_confirmation->'confirmedText')='string'
  AND coalesce(caption_text_confirmation->>'confirmedBy','')~'^[0-9a-f-]{36}$'
  AND jsonb_typeof(caption_text_confirmation->'confirmedAt')='string'
  AND coalesce(caption_text_confirmation->>'confirmedAt','')<>''
 ),false));
CREATE FUNCTION local_identity.caption_text_is_confirmed(p_draft_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.shot_preparation_drafts d
  JOIN public.episodes e ON e.id=d.episode_id
  JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner'
  JOIN public.audio_tracks a ON a.id=d.current_audio_track_id AND a.episode_id=d.episode_id
  WHERE d.id=p_draft_id AND d.caption_text_confirmation->>'version'='caption-text-confirmation/v1'
   AND d.caption_text_confirmation->>'audioTrackId'=a.id::text
   AND d.caption_text_confirmation->>'audioSha256'=a.sha256
   AND d.caption_text_confirmation->>'confirmedText'=d.subtitle_text
   AND d.caption_text_confirmation->>'textFingerprint'=encode(extensions.digest(d.subtitle_text,'sha256'),'hex')
   AND d.caption_text_confirmation->>'textFingerprint'=d.acoustic_alignment->>'textFingerprint'
   AND d.caption_text_confirmation->>'alignmentInputVersion'=d.acoustic_alignment->>'inputVersion'
   AND d.acoustic_alignment->>'audioSha256'=a.sha256);
$$;
CREATE FUNCTION local_identity.confirm_caption_text(p_episode_id uuid,p_review_package_id uuid,p_shot_id text,p_audio_track_id uuid,p_audio_sha256 text,p_text_fingerprint text,p_alignment_input_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.shot_preparation_drafts; a public.audio_tracks; reviewer uuid:=local_identity.owner_id(); BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'authenticated' OR NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RAISE EXCEPTION 'Owner input Episode required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN local_identity.input_episodes i ON i.episode_id=e.id WHERE e.id=p_episode_id AND i.storyboard_enabled AND e.stage IN ('storyboard_approved','production_ready','render_ready','qc_review')) THEN RAISE EXCEPTION 'Current editable storyboard required' USING ERRCODE='40001'; END IF;
 SELECT s.* INTO d FROM public.shot_preparation_drafts s JOIN public.review_packages r ON r.id=s.review_package_id
 WHERE s.episode_id=p_episode_id AND s.review_package_id=p_review_package_id AND s.shot_id=p_shot_id
  AND r.stage='storyboard_review' AND r.invalidated_at IS NULL
  AND r.id=(SELECT id FROM public.review_packages WHERE episode_id=p_episode_id AND stage='storyboard_review' AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1)
 FOR UPDATE OF s;
 SELECT * INTO a FROM public.audio_tracks WHERE id=d.current_audio_track_id AND episode_id=p_episode_id;
 IF d.id IS NULL OR a.id IS NULL OR d.audio_mode='none' OR NOT d.subtitles_enabled OR btrim(d.subtitle_text)=''
  OR d.current_audio_track_id IS DISTINCT FROM p_audio_track_id OR a.sha256 IS DISTINCT FROM p_audio_sha256
  OR encode(extensions.digest(d.subtitle_text,'sha256'),'hex') IS DISTINCT FROM p_text_fingerprint
  OR d.acoustic_alignment->>'inputVersion' IS DISTINCT FROM p_alignment_input_version
  OR d.acoustic_alignment->>'textFingerprint' IS DISTINCT FROM p_text_fingerprint
  OR d.acoustic_alignment->>'audioSha256' IS DISTINCT FROM p_audio_sha256
 THEN RAISE EXCEPTION 'Caption text review identity changed' USING ERRCODE='40001'; END IF;
 UPDATE public.shot_preparation_drafts SET caption_text_confirmation=jsonb_build_object(
  'version','caption-text-confirmation/v1','audioTrackId',a.id,'audioSha256',a.sha256,
  'textFingerprint',p_text_fingerprint,'alignmentInputVersion',p_alignment_input_version,
  'confirmedText',d.subtitle_text,'confirmedBy',reviewer,'confirmedAt',clock_timestamp()),updated_at=clock_timestamp()
 WHERE id=d.id;
 RETURN jsonb_build_object('saved',true);
END $$;
CREATE FUNCTION local_identity.invalidate_caption_text_confirmation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF OLD.caption_text_confirmation IS NOT NULL AND (
  OLD.subtitle_text IS DISTINCT FROM NEW.subtitle_text OR OLD.current_audio_track_id IS DISTINCT FROM NEW.current_audio_track_id
  OR OLD.audio_mode IS DISTINCT FROM NEW.audio_mode
  OR OLD.acoustic_alignment->>'inputVersion' IS DISTINCT FROM NEW.acoustic_alignment->>'inputVersion'
  OR OLD.acoustic_alignment->>'audioSha256' IS DISTINCT FROM NEW.acoustic_alignment->>'audioSha256'
  OR OLD.acoustic_alignment->>'textFingerprint' IS DISTINCT FROM NEW.acoustic_alignment->>'textFingerprint') THEN
  NEW.caption_text_confirmation:=NULL;
  NEW.confirmation_status:='pending';NEW.confirmed_at:=NULL;NEW.confirmed_by:=NULL;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER invalidate_caption_text_confirmation BEFORE UPDATE ON public.shot_preparation_drafts FOR EACH ROW EXECUTE FUNCTION local_identity.invalidate_caption_text_confirmation();
REVOKE ALL ON FUNCTION local_identity.caption_text_is_confirmed(uuid),local_identity.confirm_caption_text(uuid,uuid,text,uuid,text,text,text),local_identity.invalidate_caption_text_confirmation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.caption_text_is_confirmed(uuid),local_identity.confirm_caption_text(uuid,uuid,text,uuid,text,text,text) TO loop_owner;
