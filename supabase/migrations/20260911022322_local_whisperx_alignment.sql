alter table public.tasks drop constraint tasks_task_type_check;
alter table public.tasks add constraint tasks_task_type_check check (task_type in (
  'draft_brief','draft_script','prepare_visual_brief','draft_storyboard','draft_storyboard_revision',
  'generate_a_roll','generate_b_roll','generate_narration','align_shot_captions','extract_embedded_audio','generate_soundtrack',
  'generate_review_render','generate_final_render','prepare_publish_package','verify_publish_package','register_publish_input'
));

alter table public.shot_preparation_drafts
  add column pending_alignment_task_id uuid references public.tasks(id) on delete set null;

create or replace function public.is_valid_acoustic_alignment(p_alignment jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare cue jsonb; issue jsonb; issues jsonb := coalesce(p_alignment -> 'reviewIssues', '[]'::jsonb);
begin
  if coalesce(jsonb_typeof(p_alignment), 'null') <> 'object'
    or p_alignment ->> 'version' <> 'acoustic-alignment/v1'
    or p_alignment ->> 'status' not in ('waiting','aligning','completed','needs_review','stale','failed')
    or p_alignment ->> 'method' not in ('none','tts_native','external_text_audio','local_whisperx','manual')
    or p_alignment ->> 'granularity' not in ('none','character','word','phrase')
    or coalesce(p_alignment ->> 'inputVersion','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_alignment ->> 'textFingerprint','') !~ '^[0-9a-f]{64}$'
    or coalesce(jsonb_typeof(p_alignment -> 'wordCount'),'null') <> 'number'
    or coalesce(jsonb_typeof(p_alignment -> 'cues'),'null') <> 'array'
    or jsonb_typeof(issues) <> 'array'
    or coalesce(jsonb_typeof(p_alignment -> 'attempts'),'null') <> 'array' then return false;
  end if;
  if p_alignment ->> 'status' in ('completed','needs_review') and (p_alignment ->> 'method' = 'none' or p_alignment ->> 'granularity' = 'none') then return false; end if;
  if p_alignment ->> 'status' = 'completed' and (jsonb_array_length(p_alignment -> 'cues') = 0 or jsonb_array_length(issues) > 0) then return false; end if;
  if p_alignment ->> 'status' = 'needs_review' and jsonb_array_length(issues) = 0 then return false; end if;
  if p_alignment ->> 'status' = 'failed' and jsonb_array_length(p_alignment -> 'cues') > 0 then return false; end if;
  if jsonb_array_length(p_alignment -> 'cues') <> (p_alignment ->> 'wordCount')::integer then return false; end if;
  for cue in select value from jsonb_array_elements(p_alignment -> 'cues') loop
    if coalesce(cue ->> 'id','') = '' or coalesce(cue ->> 'text','') = '' or coalesce(jsonb_typeof(cue -> 'startMs'),'null') <> 'number' or coalesce(jsonb_typeof(cue -> 'endMs'),'null') <> 'number' or (cue ->> 'startMs')::numeric < 0 or (cue ->> 'endMs')::numeric <= (cue ->> 'startMs')::numeric then return false; end if;
  end loop;
  for issue in select value from jsonb_array_elements(issues) loop
    if issue ->> 'kind' not in ('low_confidence','unmatched_text') or coalesce(issue ->> 'id','') = '' or jsonb_typeof(issue -> 'cueIds') <> 'array' then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

alter table public.shot_preparation_drafts drop constraint shot_preparation_drafts_acoustic_alignment_check;
alter table public.shot_preparation_drafts add constraint shot_preparation_drafts_acoustic_alignment_check check (acoustic_alignment is null or public.is_valid_acoustic_alignment(acoustic_alignment));

create or replace function public.expire_shot_acoustic_alignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.acoustic_alignment is not null and new.acoustic_alignment is not distinct from old.acoustic_alignment and (
    old.current_audio_track_id is distinct from new.current_audio_track_id or old.subtitle_text is distinct from new.subtitle_text or old.tts_text is distinct from new.tts_text or old.tts_voice is distinct from new.tts_voice or old.tts_speaking_rate is distinct from new.tts_speaking_rate
  ) then
    new.acoustic_alignment := old.acoustic_alignment || jsonb_build_object('status','stale','detail','音频、字幕正文、音色或语速已变化；上一版成功时序仅作历史参考，不能用于当前确认。','generatedAt',now());
    if new.caption_contract is not null then new.caption_contract := jsonb_set(new.caption_contract, '{cues}', '[]'::jsonb); end if;
  end if;
  return new;
end;
$$;

create or replace function public.request_shot_acoustic_alignment(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_local_only boolean default false)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare draft public.shot_preparation_drafts; track public.audio_tracks; episode public.episodes; created_task public.tasks; text_fingerprint text; input_version text;
begin
  select * into episode from public.episodes where id = p_episode_id and public.is_account_member(account_id) for update;
  if not found then raise exception 'Episode is not accessible' using errcode='42501'; end if;
  select * into draft from public.shot_preparation_drafts where episode_id=p_episode_id and review_package_id=p_review_package_id and shot_id=p_shot_id for update;
  if not found or not draft.subtitles_enabled or btrim(draft.subtitle_text)='' then raise exception '当前镜头没有可对齐的已确认字幕' using errcode='22023'; end if;
  select * into track from public.audio_tracks where id=draft.current_audio_track_id and episode_id=p_episode_id;
  if not found then raise exception '当前镜头没有可复用的成功音轨' using errcode='22023'; end if;
  text_fingerprint := encode(extensions.digest(convert_to(draft.subtitle_text,'UTF8'),'sha256'),'hex');
  input_version := encode(extensions.digest(convert_to(jsonb_build_object('audioSha256',track.sha256,'textFingerprint',text_fingerprint,'voice',coalesce(draft.tts_voice,''),'speakingRate',coalesce(draft.tts_speaking_rate,1),'provider','whisperx','model','large-v3','connectionVersionId',null)::text,'UTF8'),'sha256'),'hex');
  select task.* into created_task from public.tasks task where task.episode_id=p_episode_id and task.task_type='align_shot_captions' and task.input_snapshot #>> '{shot_preparation,draft_id}'=draft.id::text and task.input_snapshot #>> '{acoustic_alignment,input_version}'=input_version and task.status in ('ready','running') order by task.created_at desc limit 1;
  if found then return created_task; end if;
  insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version)
  values (p_episode_id,'align_shot_captions','ready',jsonb_build_object(
    'capability','acoustic_alignment','shot_preparation',jsonb_build_object('draft_id',draft.id,'review_package_id',p_review_package_id,'shot_id',p_shot_id),
    'executor',jsonb_build_object('provider','whisperx','adapter','whisperx_local','model','large-v3','prompt_version','whisperx-alignment-v1'),
    'acoustic_alignment',jsonb_build_object('confirmed_text',draft.subtitle_text,'text_fingerprint',text_fingerprint,'audio_relative_path',track.relative_path,'audio_sha256',track.sha256,'input_version',input_version,'voice',coalesce(draft.tts_voice,''),'speaking_rate',coalesce(draft.tts_speaking_rate,1),'strategy',case when p_local_only then 'local' else 'auto' end),
    'input_artifacts',jsonb_build_array(jsonb_build_object('artifactType','audio_track','relativePath',track.relative_path,'sha256',track.sha256,'fileSize',track.file_size)),
    'output',jsonb_build_object('required_artifact_types',jsonb_build_array('acoustic_alignment_evidence'),'content_type','application/json','relative_path',format('episodes/%s/alignment/%s-%s.json',p_episode_id,p_shot_id,input_version),'review_stage','production_ready'),
    'allowed_tools',jsonb_build_array('read','write')
  ),0,2,'whisperx','large-v3','whisperx-alignment-v1') returning * into created_task;
  update public.shot_preparation_drafts set pending_alignment_task_id=created_task.id, acoustic_alignment=coalesce(acoustic_alignment,jsonb_build_object('version','acoustic-alignment/v1','method','none','granularity','none','inputVersion',input_version,'audioSha256',track.sha256,'textFingerprint',text_fingerprint,'provider','whisperx','model','large-v3','connectionVersionId',null,'wordCount',0,'cues','[]'::jsonb,'reviewIssues','[]'::jsonb,'attempts','[]'::jsonb)) || jsonb_build_object('status','waiting','detail','本地 WhisperX 对齐任务等待 Worker。','generatedAt',now()) where id=draft.id;
  insert into public.audit_events(account_id,episode_id,event_type,payload,actor_id) values(episode.account_id,p_episode_id,'shot_acoustic_alignment_requested',jsonb_build_object('task_id',created_task.id,'shot_id',p_shot_id,'local_only',p_local_only),auth.uid());
  return created_task;
end;
$$;

create or replace function public.save_shot_manual_alignment(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_cues jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare draft public.shot_preparation_drafts; track public.audio_tracks; normalized jsonb; cue_text text; text_fingerprint text; input_version text; cue jsonb; previous_end numeric := -1;
begin
  select * into draft from public.shot_preparation_drafts where episode_id=p_episode_id and review_package_id=p_review_package_id and shot_id=p_shot_id and public.is_account_member((select account_id from public.episodes where id=p_episode_id)) for update;
  if not found or jsonb_typeof(p_cues)<>'array' or jsonb_array_length(p_cues)=0 then raise exception '人工时序输入无效' using errcode='22023'; end if;
  select * into track from public.audio_tracks where id=draft.current_audio_track_id;
  if not found then raise exception '当前镜头没有可复用的成功音轨' using errcode='22023'; end if;
  for cue in select value from jsonb_array_elements(p_cues) loop
    if jsonb_typeof(cue)<>'object' or coalesce(cue->>'id','')='' or coalesce(cue->>'text','')='' or jsonb_typeof(cue->'start_ms')<>'number' or jsonb_typeof(cue->'end_ms')<>'number' or (cue->>'start_ms')::numeric < 0 or (cue->>'end_ms')::numeric <= (cue->>'start_ms')::numeric or (cue->>'start_ms')::numeric < previous_end then
      raise exception '人工时序区间无效或发生重叠' using errcode='22023';
    end if;
    previous_end := (cue->>'end_ms')::numeric;
  end loop;
  select jsonb_agg(jsonb_build_object('id',value->>'id','text',value->>'text','startMs',value->'start_ms','endMs',value->'end_ms') order by ordinal), jsonb_agg(value order by ordinal), string_agg(value->>'text','' order by ordinal) into normalized,p_cues,cue_text from jsonb_array_elements(p_cues) with ordinality;
  if regexp_replace(cue_text,'[[:space:]，。！？；：,.!?;:、]','','g') <> regexp_replace(draft.subtitle_text,'[[:space:]，。！？；：,.!?;:、]','','g') then raise exception '人工时序只能调整时间，不能替换 Owner 字幕正文' using errcode='22023'; end if;
  text_fingerprint:=encode(extensions.digest(convert_to(draft.subtitle_text,'UTF8'),'sha256'),'hex'); input_version:=encode(extensions.digest(convert_to(jsonb_build_object('audioSha256',track.sha256,'textFingerprint',text_fingerprint,'method','manual')::text,'UTF8'),'sha256'),'hex');
  update public.shot_preparation_drafts set caption_contract=jsonb_set(caption_contract,'{cues}',p_cues), pending_alignment_task_id=null, acoustic_alignment=jsonb_build_object('version','acoustic-alignment/v1','status','completed','method','manual','granularity','phrase','inputVersion',input_version,'audioSha256',track.sha256,'textFingerprint',text_fingerprint,'provider','owner','model','manual','connectionVersionId',null,'wordCount',jsonb_array_length(normalized),'cues',normalized,'reviewIssues','[]'::jsonb,'attempts','[]'::jsonb,'detail','Owner 已保存人工字幕时序。','generatedAt',now()) where id=draft.id;
end;
$$;

create function public.sync_local_whisperx_alignment_after_task_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare draft_id uuid; next_alignment jsonb; next_cues jsonb; has_previous boolean;
begin
  if new.task_type <> 'align_shot_captions' or old.status is not distinct from new.status then return new; end if;
  draft_id:=nullif(new.input_snapshot #>> '{shot_preparation,draft_id}','')::uuid;
  if draft_id is null then return new; end if;
  if new.status='running' then
    update public.shot_preparation_drafts set acoustic_alignment=acoustic_alignment || jsonb_build_object('status','aligning','detail','本地 WhisperX 正在对齐当前音轨；上一版时序仅作历史参考。','generatedAt',now()),updated_at=now() where id=draft_id and pending_alignment_task_id=new.id;
  elsif new.status='completed' then
    next_alignment:=new.last_result -> 'acousticAlignment';
    if public.is_valid_acoustic_alignment(next_alignment) then
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
$$;

create trigger sync_local_whisperx_alignment_after_task_update after update of status on public.tasks for each row execute function public.sync_local_whisperx_alignment_after_task_update();

do $migration$ declare definition text; updated text; begin
  select pg_get_functiondef('public.sync_shot_acoustic_alignment_after_task_update()'::regprocedure) into definition;
  updated:=replace(definition,$$next_alignment ->> 'status' = 'completed'$$,$$next_alignment ->> 'status' in ('completed','needs_review')$$);
  if updated=definition then raise exception 'TTS alignment review-state patch target missing'; end if;
  execute updated;
end $migration$;

do $migration$ declare definition text; updated text; begin
  select pg_get_functiondef('public.normalize_worker_task_runtime_constraints()'::regprocedure) into definition;
  updated:=replace(definition,$$'cloudflare')$$,$$'cloudflare', 'whisperx')$$); if updated=definition then raise exception 'provider normalization patch target missing'; end if; execute updated;
  select pg_get_functiondef('public.claim_next_worker_task(uuid,integer)'::regprocedure) into definition;
  updated:=replace(definition,$$'cloudflare')$$,$$'cloudflare','whisperx')$$); if updated=definition then raise exception 'worker claim patch target missing'; end if; execute updated;
  select pg_get_functiondef('public.claim_next_worker_task_legacy(uuid)'::regprocedure) into definition;
  updated:=replace(definition,$$'cloudflare')$$,$$'cloudflare','whisperx')$$); if updated=definition then raise exception 'legacy worker claim patch target missing'; end if; execute updated;
end $migration$;

revoke all on function public.request_shot_acoustic_alignment(uuid,uuid,text,boolean) from public,anon;
grant execute on function public.request_shot_acoustic_alignment(uuid,uuid,text,boolean) to authenticated;
revoke all on function public.save_shot_manual_alignment(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.save_shot_manual_alignment(uuid,uuid,text,jsonb) to authenticated;
revoke all on function public.sync_local_whisperx_alignment_after_task_update() from public,anon,authenticated;
