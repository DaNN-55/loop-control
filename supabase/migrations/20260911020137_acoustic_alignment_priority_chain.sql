create function public.is_valid_acoustic_alignment(p_alignment jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  cue jsonb;
begin
  if coalesce(jsonb_typeof(p_alignment), 'null') <> 'object'
    or p_alignment ->> 'version' <> 'acoustic-alignment/v1'
    or p_alignment ->> 'status' not in ('waiting', 'aligning', 'completed', 'stale', 'failed')
    or p_alignment ->> 'method' not in ('none', 'tts_native', 'external_text_audio')
    or p_alignment ->> 'granularity' not in ('none', 'character', 'word', 'phrase')
    or coalesce(p_alignment ->> 'inputVersion', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_alignment ->> 'textFingerprint', '') !~ '^[0-9a-f]{64}$'
    or coalesce(jsonb_typeof(p_alignment -> 'wordCount'), 'null') <> 'number'
    or (p_alignment ->> 'wordCount')::numeric <> trunc((p_alignment ->> 'wordCount')::numeric)
    or (p_alignment ->> 'wordCount')::integer < 0
    or coalesce(jsonb_typeof(p_alignment -> 'cues'), 'null') <> 'array'
    or coalesce(jsonb_typeof(p_alignment -> 'attempts'), 'null') <> 'array'
    or coalesce(jsonb_typeof(p_alignment -> 'detail'), 'null') <> 'string' then return false;
  end if;
  if p_alignment ->> 'status' = 'completed' and (
    p_alignment ->> 'method' = 'none'
    or p_alignment ->> 'granularity' = 'none'
    or jsonb_array_length(p_alignment -> 'cues') = 0
    or jsonb_array_length(p_alignment -> 'cues') <> (p_alignment ->> 'wordCount')::integer
    or coalesce(p_alignment ->> 'audioSha256', '') !~ '^[0-9a-f]{64}$'
  ) then return false; end if;
  if p_alignment ->> 'status' <> 'completed' and jsonb_array_length(p_alignment -> 'cues') > 0 then return false; end if;
  for cue in select value from jsonb_array_elements(p_alignment -> 'cues') loop
    if coalesce(cue ->> 'id', '') = '' or coalesce(cue ->> 'text', '') = ''
      or coalesce(jsonb_typeof(cue -> 'startMs'), 'null') <> 'number'
      or coalesce(jsonb_typeof(cue -> 'endMs'), 'null') <> 'number'
      or (cue ->> 'startMs')::numeric < 0
      or (cue ->> 'endMs')::numeric <= (cue ->> 'startMs')::numeric then return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

alter table public.shot_preparation_drafts
  add column acoustic_alignment jsonb,
  add constraint shot_preparation_drafts_acoustic_alignment_check
    check (acoustic_alignment is null or public.is_valid_acoustic_alignment(acoustic_alignment));

create function public.expire_shot_acoustic_alignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.acoustic_alignment is not null
    and new.acoustic_alignment is not distinct from old.acoustic_alignment
    and (
      old.current_audio_track_id is distinct from new.current_audio_track_id
      or old.subtitle_text is distinct from new.subtitle_text
      or old.tts_text is distinct from new.tts_text
      or old.tts_voice is distinct from new.tts_voice
      or old.tts_speaking_rate is distinct from new.tts_speaking_rate
    ) then
    new.acoustic_alignment := old.acoustic_alignment || jsonb_build_object(
      'status', 'stale', 'cues', '[]'::jsonb, 'wordCount', 0,
      'detail', '音频、字幕正文、音色或语速已变化，旧声学对齐不可继续使用。',
      'generatedAt', now()
    );
    if new.caption_contract is not null then
      new.caption_contract := jsonb_set(new.caption_contract, '{cues}', '[]'::jsonb);
    end if;
  end if;
  return new;
end;
$$;

create trigger expire_shot_acoustic_alignment
before update on public.shot_preparation_drafts
for each row execute function public.expire_shot_acoustic_alignment();

do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef('public.build_shot_preparation_contract(public.shot_preparation_drafts)'::regprocedure);
  patched := replace(definition,
    '''captions'', p_draft.caption_contract',
    '''captions'', p_draft.caption_contract, ''acoustic_alignment'', p_draft.acoustic_alignment');
  if patched = definition then raise exception 'build_shot_preparation_contract acoustic alignment patch target is unknown'; end if;
  execute patched;

  definition := pg_get_functiondef('public.generate_shot_tts(uuid,uuid,text,boolean)'::regprocedure);
  patched := replace(definition,
    '''media'', jsonb_build_object(''adapter'', adapter, ''narration'', jsonb_build_object(''text'', coalesce(draft.tts_text, draft.subtitle_text), ''voice'', voice)),',
    '''media'', jsonb_build_object(''adapter'', adapter, ''narration'', jsonb_build_object(''text'', coalesce(draft.tts_text, draft.subtitle_text), ''voice'', voice)), ''acoustic_alignment'', jsonb_build_object(''confirmed_text'', draft.subtitle_text, ''text_fingerprint'', encode(extensions.digest(convert_to(draft.subtitle_text, ''UTF8''), ''sha256''), ''hex'')),');
  patched := replace(patched,
    'set audio_status = ''running'', pending_tts_task_id = created_task.id, tts_error = null, updated_at = now()',
    'set audio_status = ''running'', pending_tts_task_id = created_task.id, tts_error = null, acoustic_alignment = jsonb_build_object(''version'',''acoustic-alignment/v1'',''status'',''waiting'',''method'',''none'',''granularity'',''none'',''inputVersion'',encode(extensions.digest(convert_to(jsonb_build_object(''text'',draft.subtitle_text,''voice'',voice,''connectionVersionId'',credential_ref)::text,''UTF8''),''sha256''),''hex''),''audioSha256'','''',''textFingerprint'',encode(extensions.digest(convert_to(draft.subtitle_text,''UTF8''),''sha256''),''hex''),''provider'',provider,''model'',model,''connectionVersionId'',credential_ref,''wordCount'',0,''cues'',''[]''::jsonb,''attempts'',''[]''::jsonb,''detail'',''等待 TTS Worker 生成音频并执行声学对齐。'',''generatedAt'',now()), updated_at = now()');
  if patched = definition or position('''acoustic_alignment'', jsonb_build_object(''confirmed_text''' in patched) = 0 then
    raise exception 'generate_shot_tts acoustic alignment patch target is unknown or partial';
  end if;
  execute patched;
end;
$$;

create function public.sync_shot_acoustic_alignment_after_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_id uuid;
  next_alignment jsonb;
  next_cues jsonb;
begin
  if new.task_type <> 'generate_narration' or new.input_snapshot -> 'acoustic_alignment' is null then return new; end if;
  draft_id := nullif(new.input_snapshot #>> '{shot_preparation,draft_id}', '')::uuid;
  if draft_id is null then return new; end if;
  if new.status = 'running' then
    update public.shot_preparation_drafts
    set acoustic_alignment = acoustic_alignment || jsonb_build_object('status','aligning','detail','TTS Worker 正在生成音频并执行声学对齐。','generatedAt',now()), updated_at = now()
    where id = draft_id and pending_tts_task_id = new.id;
  elsif new.status in ('failed', 'blocked') then
    update public.shot_preparation_drafts
    set acoustic_alignment = acoustic_alignment || jsonb_build_object('status','failed','method','none','granularity','none','cues','[]'::jsonb,'wordCount',0,'detail',coalesce(new.last_result #>> '{retry,reason}', new.last_result #>> '{blockers,0,detail}', 'TTS 或声学对齐任务失败。'),'generatedAt',now()), updated_at = now()
    where id = draft_id and pending_tts_task_id = new.id;
  elsif new.status = 'completed' then
    next_alignment := new.last_result -> 'acousticAlignment';
    if public.is_valid_acoustic_alignment(next_alignment) then
      if next_alignment ->> 'status' = 'completed' then
        select coalesce(jsonb_agg(jsonb_build_object('id', cue ->> 'id', 'text', cue ->> 'text', 'start_ms', cue -> 'startMs', 'end_ms', cue -> 'endMs') order by ordinal), '[]'::jsonb)
        into next_cues
        from jsonb_array_elements(next_alignment -> 'cues') with ordinality as aligned(cue, ordinal);
      end if;
      update public.shot_preparation_drafts
      set acoustic_alignment = next_alignment,
          caption_contract = case when next_alignment ->> 'status' = 'completed' then jsonb_set(caption_contract, '{cues}', next_cues) else caption_contract end,
          updated_at = now()
      where id = draft_id and pending_tts_task_id = new.id;
    else
      update public.shot_preparation_drafts
      set acoustic_alignment = acoustic_alignment || jsonb_build_object('status','failed','method','none','granularity','none','cues','[]'::jsonb,'wordCount',0,'detail','Worker 未返回有效的声学对齐结果。','generatedAt',now()), updated_at = now()
      where id = draft_id and pending_tts_task_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger sync_shot_acoustic_alignment_after_task_update
after update of status on public.tasks
for each row execute function public.sync_shot_acoustic_alignment_after_task_update();

revoke all on function public.is_valid_acoustic_alignment(jsonb) from public, anon, authenticated;
revoke all on function public.expire_shot_acoustic_alignment() from public, anon, authenticated;
revoke all on function public.sync_shot_acoustic_alignment_after_task_update() from public, anon, authenticated;
grant execute on function public.sync_shot_acoustic_alignment_after_task_update() to service_role;
