// T20 database callback-contract tests only. All synthetic queue/callback rows are rolled back.
// This does not execute WhisperX and must never be reported as model-inference acceptance.
import{readFileSync,writeFileSync}from'node:fs';import{root,sql}from'./environment.mjs';
const dir=root+'/state/t20-20261024',f=JSON.parse(readFileSync(dir+'/fixture.json')),a=f.accounts[0];
const label=process.argv[2]??'03';if(!/^[0-9]+$/.test(label))throw Error('Invalid run label');
const query=`BEGIN;
CREATE FUNCTION pg_temp.t20_callback_contract() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $test$
DECLARE d public.shot_preparation_drafts; before_d public.shot_preparation_drafts; original public.tasks; source_task public.tasks; source_track public.audio_tracks; inserted_track public.audio_tracks; alignment_task public.tasks; result jsonb; current_cues jsonb; canonical text:='jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn'; old_version text; narration public.tasks; auto_count integer;
BEGIN
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE episode_id='${a.episodeId}' AND shot_id='shot-1' FOR UPDATE;
 before_d:=d;
 SELECT * INTO source_track FROM public.audio_tracks WHERE id=d.current_audio_track_id;
 IF source_track.id IS NULL THEN RAISE EXCEPTION 'Real extracted baseline audio required'; END IF;
 SELECT * INTO original FROM public.tasks WHERE id=source_track.source_task_id;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version)
 VALUES(d.episode_id,original.task_type,'ready',original.input_snapshot,0,2,original.provider,original.model,original.prompt_version) RETURNING * INTO source_task;
 UPDATE public.shot_preparation_drafts SET current_audio_track_id=NULL,pending_source_audio_task_id=source_task.id,audio_status='running' WHERE id=d.id;
 PERFORM public.save_shot_preparation_draft(d.episode_id,d.review_package_id,d.shot_id,'source',d.subtitle_text||'校时',true,d.tts_text,d.tts_voice,d.tts_speaking_rate);
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE id=d.id;
 IF d.pending_source_audio_task_id IS DISTINCT FROM source_task.id OR d.audio_status<>'running' THEN RAISE EXCEPTION 'Text save lost in-flight extraction'; END IF;
 PERFORM public.save_shot_workbench_composition_draft(d.episode_id,d.review_package_id,d.shot_id,d.selected_material_revision_id,d.clip_segments,d.composition,d.source_video_duration_seconds,'source',d.subtitle_text,true,d.tts_text,d.tts_voice,d.tts_speaking_rate);
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE id=d.id;
 IF d.pending_source_audio_task_id IS DISTINCT FROM source_task.id OR d.audio_status<>'running' THEN RAISE EXCEPTION 'Workbench save lost in-flight extraction'; END IF;
 INSERT INTO public.audio_tracks(episode_id,source_task_id,source_artifact_id,source_review_package_id,cue_id,track_kind,relative_path,sha256,file_size,start_seconds,duration_seconds)
 VALUES(d.episode_id,source_task.id,source_track.source_artifact_id,d.review_package_id,d.shot_id,'source',source_track.relative_path,source_track.sha256,source_track.file_size,0,source_track.duration_seconds) RETURNING * INTO inserted_track;
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE id=d.id;
 IF d.current_audio_track_id IS DISTINCT FROM inserted_track.id OR d.pending_source_audio_task_id IS NOT NULL OR d.audio_status<>'ready' THEN RAISE EXCEPTION 'Extraction completion did not bind after caption save'; END IF;
 alignment_task:=public.request_shot_acoustic_alignment(d.episode_id,d.review_package_id,d.shot_id,true);
 IF alignment_task.model<>canonical THEN RAISE EXCEPTION 'Wrong frozen alignment model'; END IF;
 old_version:=alignment_task.input_snapshot#>>'{acoustic_alignment,input_version}';
 UPDATE public.tasks SET status='running' WHERE id=alignment_task.id;
 PERFORM public.save_shot_preparation_draft(d.episode_id,d.review_package_id,d.shot_id,'source','新正文不得覆盖',true,d.tts_text,d.tts_voice,d.tts_speaking_rate);
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE id=d.id;
 IF d.pending_alignment_task_id IS NOT NULL THEN RAISE EXCEPTION 'Changed text did not release old alignment'; END IF;
 current_cues:=d.caption_contract->'cues';
 result:=before_d.acoustic_alignment||jsonb_build_object('method','local_whisperx','provider','whisperx','model',canonical,'status','completed','inputVersion',old_version,'audioSha256',source_track.sha256,'textFingerprint',alignment_task.input_snapshot#>>'{acoustic_alignment,text_fingerprint}');
 IF NOT public.is_valid_acoustic_alignment(result) THEN RAISE EXCEPTION 'Callback fixture invalid'; END IF;
 UPDATE public.tasks SET status='completed',last_result=jsonb_build_object('acousticAlignment',result) WHERE id=alignment_task.id;
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE id=d.id;
 IF d.subtitle_text<>'新正文不得覆盖' OR d.caption_contract->'cues' IS DISTINCT FROM current_cues OR d.acoustic_alignment->>'status'='completed' THEN RAISE EXCEPTION 'Stale completion changed current captions'; END IF;
 alignment_task:=public.request_shot_acoustic_alignment(d.episode_id,d.review_package_id,d.shot_id,true);
 IF alignment_task.input_snapshot#>>'{acoustic_alignment,input_version}'=old_version THEN RAISE EXCEPTION 'Changed text reused old input identity'; END IF;
 result:=result||jsonb_build_object('inputVersion',alignment_task.input_snapshot#>>'{acoustic_alignment,input_version}','textFingerprint',alignment_task.input_snapshot#>>'{acoustic_alignment,text_fingerprint}','model','unfrozen-wrong-model');
 UPDATE public.tasks SET status='completed',last_result=jsonb_build_object('acousticAlignment',result) WHERE id=alignment_task.id;
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE id=d.id;
 IF d.acoustic_alignment->>'status'='completed' OR d.pending_alignment_task_id IS NOT NULL OR d.caption_contract->'cues' IS DISTINCT FROM current_cues THEN RAISE EXCEPTION 'Wrong-model callback accepted'; END IF;
 -- Synthetic narration completion exercises the real automatic queue trigger, without a Provider call.
 PERFORM public.save_shot_preparation_draft(d.episode_id,d.review_package_id,d.shot_id,'tts','合成口播正文',true,'合成口播正文','offline-manual-fixture',1);
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE id=d.id;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version)
 VALUES(d.episode_id,'generate_narration','ready',jsonb_build_object('shot_preparation',jsonb_build_object('draft_id',d.id),'acoustic_alignment',jsonb_build_object('confirmed_text',d.subtitle_text),'audio_track',jsonb_build_object('kind','narration','cue_id',d.shot_id,'source_review_package_id',d.review_package_id),'output',jsonb_build_object('relative_path','episodes/'||d.episode_id||'/rollback-contract.mp3')),0,2,'manual_upload','manual-upload-v1','manual-upload-v1') RETURNING * INTO narration;
 UPDATE public.shot_preparation_drafts SET pending_tts_task_id=narration.id,current_tts_task_id=narration.id WHERE id=d.id;
 INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size)
 VALUES(d.episode_id,narration.id,'narration_audio','episodes/'||d.episode_id||'/rollback-contract.mp3',source_track.sha256,source_track.file_size);
 UPDATE public.tasks SET status='completed',last_result=jsonb_build_object('audioDurationSeconds',source_track.duration_seconds) WHERE id=narration.id;
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE id=d.id;
 SELECT * INTO alignment_task FROM public.tasks WHERE id=d.pending_alignment_task_id;
 IF alignment_task.id IS NULL OR alignment_task.model<>canonical THEN RAISE EXCEPTION 'Automatic TTS alignment did not freeze canonical model'; END IF;
 SELECT count(*) INTO auto_count FROM public.tasks WHERE episode_id=d.episode_id AND task_type='align_shot_captions' AND status='ready' AND input_snapshot#>>'{acoustic_alignment,input_version}'=alignment_task.input_snapshot#>>'{acoustic_alignment,input_version}';
 IF auto_count<>1 THEN RAISE EXCEPTION 'Automatic alignment duplicated'; END IF;
 source_task:=public.request_shot_acoustic_alignment(d.episode_id,d.review_package_id,d.shot_id,true);
 IF source_task.id<>alignment_task.id THEN RAISE EXCEPTION 'Explicit request did not reuse automatic canonical alignment'; END IF;
END $test$;
SET SESSION AUTHORIZATION loop_app;
SELECT set_config('loop.owner_id','${f.ownerId}',true);
SELECT pg_temp.t20_callback_contract();
RESET SESSION AUTHORIZATION;
ROLLBACK;
SELECT jsonb_build_object('passed',true,'syntheticCallbackContractOnly',true,'rolledBack',true,'realModelInference',false,'sourcePendingRetainedAcrossTextAndWorkbenchSave',true,'sourceCompletionBinds',true,'staleAlignmentCannotOverwrite',true,'wrongModelCannotComplete',true,'changedTextChangesInputIdentity',true,'automaticTtsCanonicalModelAndExplicitReuse',true);
`;
const result=sql(query);writeFileSync(dir+'/callback-contract-'+label+'.txt',result+'\n',{flag:'wx',mode:0o600});console.log(result);
