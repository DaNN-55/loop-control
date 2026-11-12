-- T20: fence edited alignment inputs and retain in-flight source extraction; freeze the actual cache-only aligner identity.
CREATE OR REPLACE FUNCTION public.save_shot_preparation_draft(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_audio_mode text, p_subtitle_text text, p_subtitles_enabled boolean, p_tts_text text, p_tts_voice text, p_tts_speaking_rate numeric)
 RETURNS shot_preparation_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_episode public.episodes;
  selected_package public.review_packages;
  existing_draft public.shot_preparation_drafts;
  saved_draft public.shot_preparation_drafts;
  blueprint_policy jsonb;
  selected_shot jsonb;
  next_tts_text text;
  next_tts_voice text;
  next_tts_rate numeric;
  next_language_code text;
  mode_changed boolean;
  audio_changed boolean;
begin
  if p_audio_mode not in ('tts', 'source', 'none') or coalesce(btrim(p_shot_id), '') = '' or (p_subtitles_enabled and coalesce(btrim(p_subtitle_text), '') = '') or p_subtitles_enabled is null then
    raise exception 'Shot preparation draft is invalid' using errcode = '22023';
  end if;
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = local_identity.owner_id() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to save a shot preparation draft' using errcode = '42501'; end if;
  if current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then raise exception 'Shot preparation drafts can only be saved after storyboard approval' using errcode = '22023'; end if;
  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;
  select shot.value into selected_shot
  from jsonb_array_elements(coalesce(selected_package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where shot.value ->> 'id' = btrim(p_shot_id);
  if not found then raise exception 'The shot does not belong to the approved storyboard' using errcode = '22023'; end if;
  select draft.* into existing_draft from public.shot_preparation_drafts draft
  where draft.episode_id = p_episode_id and draft.review_package_id = p_review_package_id and draft.shot_id = btrim(p_shot_id)
  for update;
  select blueprint.policy into blueprint_policy from public.account_blueprint_versions blueprint where blueprint.id = current_episode.blueprint_version_id;
  next_tts_text := coalesce(nullif(btrim(p_tts_text), ''), nullif(btrim(p_subtitle_text), ''), nullif(btrim(selected_shot ->> 'scriptSegment'), ''));
  next_tts_voice := coalesce(existing_draft.tts_override_voice, current_episode.tts_voice, nullif(btrim(p_tts_voice), ''), existing_draft.tts_voice);
  next_tts_rate := coalesce(existing_draft.tts_override_speaking_rate, current_episode.tts_speaking_rate, p_tts_speaking_rate, existing_draft.tts_speaking_rate);
  next_language_code := coalesce(current_episode.tts_language_code, existing_draft.tts_language_code, 'zh-CN');
  if p_audio_mode = 'tts' and (coalesce(next_tts_text, '') = '' or coalesce(next_tts_voice, '') = '' or next_tts_rate is null or next_tts_rate <= 0) then
    raise exception 'TTS 草稿必须包含口播内容、声音和有效语速' using errcode = '22023';
  end if;
  mode_changed := existing_draft.id is null or existing_draft.audio_mode is distinct from p_audio_mode;
  audio_changed := mode_changed or (p_audio_mode = 'tts' and (existing_draft.tts_text is distinct from next_tts_text or existing_draft.tts_voice is distinct from next_tts_voice or existing_draft.tts_speaking_rate is distinct from next_tts_rate));
  if mode_changed and existing_draft.id is not null then
    update public.tasks task
    set status = 'superseded', invalidated_at = now(), invalidated_reason = 'Owner switched this shot to another audio mode.'
    where task.input_snapshot #>> '{shot_preparation,draft_id}' = existing_draft.id::text and task.status in ('ready', 'running', 'blocked', 'failed');
  end if;
  insert into public.shot_preparation_drafts (
    episode_id, review_package_id, shot_id, audio_mode, subtitle_text, subtitles_enabled,
    tts_text, tts_voice, tts_speaking_rate, tts_language_code, audio_status, tts_error, source_audio_error
  ) values (
    p_episode_id, p_review_package_id, btrim(p_shot_id), p_audio_mode,
    case when p_audio_mode = 'tts' then next_tts_text else btrim(p_subtitle_text) end,
    p_subtitles_enabled, next_tts_text, next_tts_voice, next_tts_rate, next_language_code,
    case when p_audio_mode in ('none', 'source') then 'ready' when audio_changed then 'pending' else coalesce(existing_draft.audio_status, 'pending') end,
    case when audio_changed then null else existing_draft.tts_error end,
    case when p_audio_mode = 'source' then null else existing_draft.source_audio_error end
  )
  on conflict (episode_id, review_package_id, shot_id) do update set
    audio_mode = excluded.audio_mode,
    subtitle_text = excluded.subtitle_text,
    subtitles_enabled = excluded.subtitles_enabled,
    tts_text = excluded.tts_text,
    tts_voice = excluded.tts_voice,
    tts_speaking_rate = excluded.tts_speaking_rate,
    tts_language_code = excluded.tts_language_code,
    audio_status = case when excluded.audio_mode='source' and shot_preparation_drafts.audio_mode='source' and shot_preparation_drafts.pending_source_audio_task_id is not null then shot_preparation_drafts.audio_status else excluded.audio_status end,
    tts_error = excluded.tts_error,
    source_audio_error = null,
    source_audio_duration_seconds = case when excluded.audio_mode = 'source' and shot_preparation_drafts.audio_mode = 'source' then shot_preparation_drafts.source_audio_duration_seconds else null end,
    confirmation_status = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode
      or excluded.subtitle_text is distinct from shot_preparation_drafts.subtitle_text
      or excluded.tts_text is distinct from shot_preparation_drafts.tts_text
      or excluded.tts_voice is distinct from shot_preparation_drafts.tts_voice
      or excluded.tts_speaking_rate is distinct from shot_preparation_drafts.tts_speaking_rate
      then 'pending' else shot_preparation_drafts.confirmation_status end,
    current_audio_track_id = case when excluded.audio_mode = 'none' or excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.current_audio_track_id end,
    current_tts_task_id = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.current_tts_task_id end,
    pending_tts_task_id = case when excluded.audio_mode is distinct from shot_preparation_drafts.audio_mode then null else shot_preparation_drafts.pending_tts_task_id end,
    pending_source_audio_task_id = case when excluded.audio_mode='source' and shot_preparation_drafts.audio_mode='source' then shot_preparation_drafts.pending_source_audio_task_id else null end,
    updated_at = now()
  returning * into saved_draft;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, current_episode.id, 'shot_audio_mode_saved', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', btrim(p_shot_id), 'audio_mode', p_audio_mode, 'subtitles_enabled', p_subtitles_enabled, 'audio_changed', audio_changed), local_identity.owner_id());
  return saved_draft;
end;
$function$;

CREATE OR REPLACE FUNCTION public.expire_shot_acoustic_alignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.acoustic_alignment is not null and new.acoustic_alignment is not distinct from old.acoustic_alignment and (
    old.current_audio_track_id is distinct from new.current_audio_track_id or old.subtitle_text is distinct from new.subtitle_text or old.tts_text is distinct from new.tts_text or old.tts_voice is distinct from new.tts_voice or old.tts_speaking_rate is distinct from new.tts_speaking_rate
  ) then
    new.pending_alignment_task_id := null;
    new.acoustic_alignment := old.acoustic_alignment || jsonb_build_object('status','stale','detail','音频、字幕正文、音色或语速已变化；上一版成功时序仅作历史参考，不能用于当前确认。','generatedAt',now());
    if new.caption_contract is not null then new.caption_contract := jsonb_set(new.caption_contract, '{cues}', '[]'::jsonb); end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_local_whisperx_alignment_after_task_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare draft_id uuid; matches_input boolean; next_alignment jsonb; next_cues jsonb; has_previous boolean;
begin
  if new.task_type <> 'align_shot_captions' or old.status is not distinct from new.status then return new; end if;
  draft_id:=nullif(new.input_snapshot #>> '{shot_preparation,draft_id}','')::uuid;
  if draft_id is null then return new; end if;
  select exists(select 1 from public.shot_preparation_drafts d join public.audio_tracks t on t.id=d.current_audio_track_id and t.episode_id=d.episode_id where d.id=draft_id and d.episode_id=new.episode_id and d.pending_alignment_task_id=new.id and d.subtitles_enabled
    and d.subtitle_text=new.input_snapshot#>>'{acoustic_alignment,confirmed_text}' and t.sha256=new.input_snapshot#>>'{acoustic_alignment,audio_sha256}'
    and coalesce(d.tts_voice,'')=coalesce(new.input_snapshot#>>'{acoustic_alignment,voice}','') and coalesce(d.tts_speaking_rate,1)=coalesce((new.input_snapshot#>>'{acoustic_alignment,speaking_rate}')::numeric,1)) into matches_input;
  if not matches_input then
    update public.shot_preparation_drafts set pending_alignment_task_id=null, acoustic_alignment=acoustic_alignment||jsonb_build_object('status','stale','detail','当前正文或音频已变化；忽略旧对齐回写。'),updated_at=now() where id=draft_id and pending_alignment_task_id=new.id;
    return new;
  end if;
  if new.status='running' then
    update public.shot_preparation_drafts set acoustic_alignment=acoustic_alignment || jsonb_build_object('status','aligning','detail','本地 WhisperX 正在对齐当前音轨；上一版时序仅作历史参考。','generatedAt',now()),updated_at=now() where id=draft_id and pending_alignment_task_id=new.id;
  elsif new.status='completed' then
    next_alignment:=new.last_result -> 'acousticAlignment';
    if public.is_valid_acoustic_alignment(next_alignment)
      and next_alignment->>'inputVersion'=new.input_snapshot#>>'{acoustic_alignment,input_version}'
      and next_alignment->>'audioSha256'=new.input_snapshot#>>'{acoustic_alignment,audio_sha256}'
      and next_alignment->>'textFingerprint'=new.input_snapshot#>>'{acoustic_alignment,text_fingerprint}'
      and next_alignment->>'model'=new.model then
      select coalesce(jsonb_agg(jsonb_build_object('id',cue->>'id','text',cue->>'text','start_ms',cue->'startMs','end_ms',cue->'endMs') order by ordinal),'[]'::jsonb) into next_cues from jsonb_array_elements(next_alignment->'cues') with ordinality as aligned(cue,ordinal);
      update public.shot_preparation_drafts set acoustic_alignment=next_alignment,caption_contract=case when next_alignment->>'status' in ('completed','needs_review') and jsonb_array_length(next_cues)>0 then jsonb_set(caption_contract,'{cues}',next_cues) else caption_contract end,pending_alignment_task_id=null,updated_at=now() where id=draft_id and pending_alignment_task_id=new.id;
    else
      update public.shot_preparation_drafts set acoustic_alignment=acoustic_alignment || jsonb_build_object('status',case when jsonb_array_length(coalesce(acoustic_alignment->'cues','[]'::jsonb))>0 then 'stale' else 'failed' end,'detail','Worker 未返回有效的本地 WhisperX 对齐结果。','generatedAt',now()),pending_alignment_task_id=null,updated_at=now() where id=draft_id and pending_alignment_task_id=new.id;
    end if;
  elsif new.status in ('failed','blocked') then
    update public.shot_preparation_drafts set acoustic_alignment=acoustic_alignment || jsonb_build_object('status',case when jsonb_array_length(coalesce(acoustic_alignment->'cues','[]'::jsonb))>0 then 'stale' else 'failed' end,'detail',coalesce(new.last_result #>> '{retry,reason}',new.last_result #>> '{blockers,0,detail}','本地 WhisperX 对齐失败。'),'generatedAt',now()),pending_alignment_task_id=null,updated_at=now() where id=draft_id and pending_alignment_task_id=new.id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_shot_source_audio_task_after_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare draft_id uuid; failure_reason text;
begin
  if new.task_type <> 'extract_embedded_audio' or new.input_snapshot #>> '{shot_preparation,draft_id}' is null then return new; end if;
  draft_id := (new.input_snapshot #>> '{shot_preparation,draft_id}')::uuid;
  failure_reason := coalesce(new.last_result #>> '{blockers,0,detail}', new.last_result #>> '{retry,reason}', '原声提取任务失败，请重试。');
  update public.shot_preparation_drafts
  set audio_status = case when new.status in ('failed','blocked') then 'failed' else 'running' end,
      source_audio_error = case when new.status in ('failed','blocked') then failure_reason else null end,
      updated_at = now()
  where id = draft_id and pending_source_audio_task_id = new.id and new.status in ('ready', 'running', 'failed','blocked');
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_shot_acoustic_alignment(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_local_only boolean DEFAULT false)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare draft public.shot_preparation_drafts; track public.audio_tracks; episode public.episodes; created_task public.tasks; text_fingerprint text; input_version text;
begin
  select * into episode from public.episodes where id = p_episode_id and public.is_account_member(account_id) for update;
  if not found then raise exception 'Episode is not accessible' using errcode='42501'; end if;
  select * into draft from public.shot_preparation_drafts where episode_id=p_episode_id and review_package_id=p_review_package_id and shot_id=p_shot_id for update;
  if not found or not draft.subtitles_enabled or btrim(draft.subtitle_text)='' then raise exception '当前镜头没有可对齐的已确认字幕' using errcode='22023'; end if;
  select * into track from public.audio_tracks where id=draft.current_audio_track_id and episode_id=p_episode_id;
  if not found then raise exception '当前镜头没有可复用的成功音轨' using errcode='22023'; end if;
  text_fingerprint := encode(extensions.digest(convert_to(draft.subtitle_text,'UTF8'),'sha256'),'hex');
  input_version := encode(extensions.digest(convert_to(jsonb_build_object('audioSha256',track.sha256,'textFingerprint',text_fingerprint,'voice',coalesce(draft.tts_voice,''),'speakingRate',coalesce(draft.tts_speaking_rate,1),'provider','whisperx','model','jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn','connectionVersionId',null)::text,'UTF8'),'sha256'),'hex');
  select task.* into created_task from public.tasks task where task.episode_id=p_episode_id and task.task_type='align_shot_captions' and task.input_snapshot #>> '{shot_preparation,draft_id}'=draft.id::text and task.input_snapshot #>> '{acoustic_alignment,input_version}'=input_version and task.status in ('ready','running') order by task.created_at desc limit 1;
  if found then return created_task; end if;
  insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version)
  values (p_episode_id,'align_shot_captions','ready',jsonb_build_object(
    'capability','acoustic_alignment','shot_preparation',jsonb_build_object('draft_id',draft.id,'review_package_id',p_review_package_id,'shot_id',p_shot_id),
    'executor',jsonb_build_object('provider','whisperx','adapter','whisperx_local','model','jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn','prompt_version','whisperx-alignment-v1'),
    'acoustic_alignment',jsonb_build_object('confirmed_text',draft.subtitle_text,'text_fingerprint',text_fingerprint,'audio_relative_path',track.relative_path,'audio_sha256',track.sha256,'input_version',input_version,'voice',coalesce(draft.tts_voice,''),'speaking_rate',coalesce(draft.tts_speaking_rate,1),'strategy',case when p_local_only then 'local' else 'auto' end),
    'input_artifacts',jsonb_build_array(jsonb_build_object('artifactType','audio_track','relativePath',track.relative_path,'sha256',track.sha256,'fileSize',track.file_size)),
    'output',jsonb_build_object('required_artifact_types',jsonb_build_array('acoustic_alignment_evidence'),'content_type','application/json','relative_path',format('episodes/%s/alignment/%s-%s.json',p_episode_id,p_shot_id,input_version),'review_stage','production_ready'),
    'allowed_tools',jsonb_build_array('read','write')
  ),0,2,'whisperx','jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn','whisperx-alignment-v1') returning * into created_task;
  update public.shot_preparation_drafts set pending_alignment_task_id=created_task.id, acoustic_alignment=coalesce(acoustic_alignment,jsonb_build_object('version','acoustic-alignment/v1','method','none','granularity','none','inputVersion',input_version,'audioSha256',track.sha256,'textFingerprint',text_fingerprint,'provider','whisperx','model','jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn','connectionVersionId',null,'wordCount',0,'cues','[]'::jsonb,'reviewIssues','[]'::jsonb,'attempts','[]'::jsonb)) || jsonb_build_object('status','waiting','detail','本地 WhisperX 对齐任务等待 Worker。','generatedAt',now()) where id=draft.id;
  insert into public.audit_events(account_id,episode_id,event_type,payload,actor_id) values(episode.account_id,p_episode_id,'shot_acoustic_alignment_requested',jsonb_build_object('task_id',created_task.id,'shot_id',p_shot_id,'local_only',p_local_only),local_identity.owner_id());
  return created_task;
end;
$function$;
