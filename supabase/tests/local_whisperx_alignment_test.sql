begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(10);

select has_column('public','shot_preparation_drafts','pending_alignment_task_id','draft tracks its shot-scoped alignment task');
select has_function('public','request_shot_acoustic_alignment',array['uuid','uuid','text','boolean'],'Owner can request a safe alignment-only retry');
select has_function('public','save_shot_manual_alignment',array['uuid','uuid','text','jsonb'],'Owner can save manual timing');

select ok(public.is_valid_acoustic_alignment('{"version":"acoustic-alignment/v1","status":"needs_review","method":"local_whisperx","granularity":"phrase","inputVersion":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","audioSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","textFingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","provider":"whisperx","model":"fixture","connectionVersionId":null,"wordCount":0,"cues":[],"reviewIssues":[{"id":"unmatched-1","kind":"unmatched_text","text":"Owner 正文","cueIds":[],"detail":"未匹配"}],"attempts":[],"detail":"待检查","generatedAt":"2026-09-11T02:30:00.000Z"}'::jsonb),'unmatched WhisperX text is a valid explicit review state');

select ok(position('''whisperx''' in pg_get_functiondef('public.claim_next_worker_task(uuid,integer)'::regprocedure))>0,'platform worker can claim local WhisperX tasks');
select ok(position('''align_shot_captions''' in pg_get_constraintdef((select oid from pg_constraint where conname='tasks_task_type_check' and conrelid='public.tasks'::regclass)))>0,'task constraint admits alignment-only work');
select ok(position('budget_limit_cents,max_attempts,provider,model,prompt_version' in replace(pg_get_functiondef('public.request_shot_acoustic_alignment(uuid,uuid,text,boolean)'::regprocedure),' ',''))>0 and position($$0,2,'whisperx','large-v3'$$ in replace(pg_get_functiondef('public.request_shot_acoustic_alignment(uuid,uuid,text,boolean)'::regprocedure),' ',''))>0,'local retry is a zero-cost Worker task and does not regenerate TTS');
select ok(position('subtitle_text=' in replace(lower(pg_get_functiondef('public.save_shot_manual_alignment(uuid,uuid,text,jsonb)'::regprocedure)),' ',''))=0 and position('caption_contract=jsonb_set' in replace(lower(pg_get_functiondef('public.save_shot_manual_alignment(uuid,uuid,text,jsonb)'::regprocedure)),' ',''))>0,'manual timing updates cues without replacing Owner text');
select ok(position('人工时序区间无效或发生重叠' in pg_get_functiondef('public.save_shot_manual_alignment(uuid,uuid,text,jsonb)'::regprocedure))>0,'manual timing rejects malformed or overlapping cue ranges');
select ok(position($$then 'stale' else 'failed'$$ in lower(pg_get_functiondef('public.sync_local_whisperx_alignment_after_task_update()'::regprocedure)))>0,'failed retry preserves a previous successful result as stale');

select * from finish();
rollback;
