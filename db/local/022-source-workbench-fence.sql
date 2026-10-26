-- T20: retain pending extraction when saving unchanged media ranges; reject retry against a replaced source.
CREATE OR REPLACE FUNCTION public.save_shot_workbench_draft(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_material_revision_id uuid, p_clip_segments jsonb, p_audio_mode text, p_subtitle_text text, p_subtitles_enabled boolean, p_tts_text text, p_tts_voice text, p_tts_speaking_rate numeric)
 RETURNS shot_preparation_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  draft public.shot_preparation_drafts;
  selected_package public.review_packages;
  selected_shot jsonb;
  segment jsonb;
  total_duration numeric := 0;
  changed boolean;
begin
  select current_draft.* into draft
  from public.shot_preparation_drafts current_draft
  where current_draft.episode_id = p_episode_id and current_draft.review_package_id = p_review_package_id and current_draft.shot_id = btrim(p_shot_id)
  for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.frozen_at is not null and not exists (select 1 from public.episodes episode where episode.id = p_episode_id and episode.stage in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review')) then raise exception 'Frozen shot drafts cannot be edited' using errcode = '22023'; end if;
  if p_clip_segments is null or jsonb_typeof(p_clip_segments) <> 'array' or jsonb_array_length(p_clip_segments) = 0 then raise exception 'At least one clip segment is required' using errcode = '22023'; end if;
  for segment in select value from jsonb_array_elements(p_clip_segments) loop
    if jsonb_typeof(segment) <> 'object' or jsonb_typeof(segment -> 'start_seconds') <> 'number' or jsonb_typeof(segment -> 'end_seconds') <> 'number'
      or (segment ->> 'start_seconds')::numeric < 0 or (segment ->> 'end_seconds')::numeric <= (segment ->> 'start_seconds')::numeric
      or (segment ->> 'end_seconds')::numeric > 86400 then
      raise exception 'Clip segment is invalid' using errcode = '22023';
    end if;
    total_duration := public.clip_segment_union_duration(p_clip_segments);
  end loop;

  select package.* into selected_package from public.review_packages package
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null;
  select shot.value into selected_shot from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the current storyboard' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    where material.id = p_material_revision_id and material.episode_id = p_episode_id and material.material_type = 'video'
      and material.material_purpose = case selected_shot ->> 'shotType' when 'a_roll' then 'a_roll' else 'b_roll' end
  ) then raise exception 'Approved video material for this shot is required' using errcode = '22023'; end if;

  perform public.save_shot_preparation_draft(p_episode_id, p_review_package_id, p_shot_id, p_audio_mode, p_subtitle_text, p_subtitles_enabled, p_tts_text, p_tts_voice, p_tts_speaking_rate);
  changed := draft.selected_material_revision_id is distinct from p_material_revision_id or draft.clip_segments is distinct from p_clip_segments;
  update public.shot_preparation_drafts
  set input_fingerprint = md5(selected_shot::text),
      selected_material_revision_id = p_material_revision_id,
      clip_segments = p_clip_segments,
      clip_start_seconds = null,
      clip_end_seconds = null,
      video_duration_seconds = total_duration,
      current_video_artifact_id = current_video_artifact_id,
      current_video_task_id = current_video_task_id,
      pending_video_task_id = null,
      video_status = case when changed then 'pending' else video_status end,
      video_error = case when changed then null else video_error end,
      current_audio_track_id = case when changed and audio_mode = 'source' then null else current_audio_track_id end,
      pending_source_audio_task_id = case when changed then null else pending_source_audio_task_id end,
      audio_status = case when not changed and audio_mode='source' and pending_source_audio_task_id is not null then audio_status when audio_mode in ('none','source') then 'ready' else audio_status end,
      source_audio_error = null,
      source_audio_duration_seconds = case when changed then null else source_audio_duration_seconds end,
      updated_at = now()
  where id = draft.id returning * into draft;
  return draft;
end;
$function$;

CREATE OR REPLACE FUNCTION local_identity.retry_input_media(p_episode_id uuid, p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE previous public.tasks; created public.tasks; frozen jsonb; nonce text:=gen_random_uuid()::text; path text; BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RAISE EXCEPTION 'Owner managed Episode required' USING ERRCODE='42501'; END IF;
 SELECT t.* INTO previous FROM public.tasks t JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.media_enabled JOIN public.episodes e ON e.id=t.episode_id AND e.stage='storyboard_approved' WHERE t.id=p_task_id AND t.episode_id=p_episode_id AND t.task_type IN ('generate_a_roll','generate_b_roll','generate_soundtrack','extract_embedded_audio') AND t.status IN ('failed','blocked') AND t.invalidated_at IS NULL FOR UPDATE OF t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current failed media task required' USING ERRCODE='22023'; END IF;
 IF previous.task_type='extract_embedded_audio' AND previous.input_snapshot#>>'{shot_preparation,draft_id}' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.shot_preparation_drafts d JOIN public.review_packages p ON p.id=d.review_package_id WHERE d.id::text=previous.input_snapshot#>>'{shot_preparation,draft_id}' AND d.episode_id=p_episode_id AND p.invalidated_at IS NULL AND d.current_video_artifact_id::text=previous.input_snapshot#>>'{source_video_artifact,id}') THEN RAISE EXCEPTION 'Current source-video draft required' USING ERRCODE='22023'; END IF;
 IF previous.task_type <> 'extract_embedded_audio' AND NOT EXISTS(SELECT 1 FROM public.review_packages p JOIN public.approvals a ON a.review_package_id=p.id AND a.stage='storyboard_approved' AND a.decision='approved' WHERE p.id::text=previous.input_snapshot->>'storyboard_review_package_id' AND p.episode_id=p_episode_id AND p.stage='storyboard_review' AND p.invalidated_at IS NULL AND p.revision_number=(SELECT max(q.revision_number) FROM public.review_packages q WHERE q.episode_id=p_episode_id AND q.stage='storyboard_review' AND q.invalidated_at IS NULL)) THEN RAISE EXCEPTION 'Current approved media package required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.tasks t WHERE t.episode_id=p_episode_id AND t.input_snapshot->>'native_media_retry_of'=p_task_id::text AND t.status IN ('ready','running','completed')) THEN SELECT * INTO created FROM public.tasks t WHERE t.episode_id=p_episode_id AND t.input_snapshot->>'native_media_retry_of'=p_task_id::text AND t.status IN ('ready','running','completed') ORDER BY created_at DESC LIMIT 1; RETURN created; END IF;
 frozen:=previous.input_snapshot-'runtime_constraints';path:=frozen#>>'{output,relative_path}';
 frozen:=frozen||jsonb_build_object('native_media_retry_of',p_task_id,'configuration_hash',coalesce(frozen->>'configuration_hash','')||'-retry-'||nonce);
 frozen:=jsonb_set(frozen,'{output,relative_path}',to_jsonb(regexp_replace(path,'(\.[^/.]+)$','-retry-'||nonce||'\1')));
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(p_episode_id,previous.task_type,'ready',frozen,previous.budget_limit_cents,previous.max_attempts,previous.provider,previous.model,previous.prompt_version) RETURNING * INTO created;
 IF previous.task_type='extract_embedded_audio' AND previous.input_snapshot#>>'{shot_preparation,draft_id}' IS NOT NULL THEN UPDATE public.shot_preparation_drafts SET audio_status='running',pending_source_audio_task_id=created.id,source_audio_error=NULL,updated_at=now() WHERE id::text=previous.input_snapshot#>>'{shot_preparation,draft_id}' AND episode_id=p_episode_id; ELSIF previous.input_snapshot#>>'{shot_preparation,draft_id}' IS NOT NULL THEN UPDATE public.shot_preparation_drafts SET video_status='running',pending_video_task_id=created.id,video_error=NULL,updated_at=now() WHERE id::text=previous.input_snapshot#>>'{shot_preparation,draft_id}' AND episode_id=p_episode_id; END IF;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) SELECT e.account_id,e.id,'native_media_retry_requested',jsonb_build_object('previous_task_id',previous.id,'task_id',created.id),local_identity.owner_id() FROM public.episodes e WHERE e.id=p_episode_id;
 RETURN created;
END $function$;
