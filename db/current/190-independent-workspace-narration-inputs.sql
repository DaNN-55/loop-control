-- ADR-0068 / B1: current voice inputs and new audio provenance no longer use review drafts.
ALTER TABLE public.audio_tracks ADD COLUMN preparation_revision_id uuid;
ALTER TABLE public.audio_tracks ADD CONSTRAINT audio_track_episode_identity UNIQUE(episode_id,id);
ALTER TABLE public.audio_tracks ADD CONSTRAINT audio_track_preparation FOREIGN KEY(episode_id,preparation_revision_id)
 REFERENCES local_identity.production_preparation_revisions(episode_id,id);
CREATE INDEX audio_track_preparation ON public.audio_tracks(preparation_revision_id);

CREATE TABLE local_identity.workspace_narration_inputs (
 workspace_id uuid NOT NULL,
 episode_id uuid NOT NULL,
 preparation_revision_id uuid NOT NULL,
 shot_id text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('tts','manual','none')),
 -- Preserve recorded historical values. Current writes enforce current service bounds below.
 narration_text text,
 voice text,
 speaking_rate numeric CHECK(speaking_rate IS NULL OR speaking_rate>0),
 language_code text,
 voice_override boolean NOT NULL DEFAULT false,
 audio_track_id uuid,
 imported_from_draft_id uuid,
 imported_from_package_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,preparation_revision_id,shot_id),
 CHECK((imported_from_draft_id IS NULL)=(imported_from_package_id IS NULL)),
 FOREIGN KEY(episode_id,workspace_id) REFERENCES local_identity.production_workspaces(episode_id,id),
 FOREIGN KEY(episode_id,preparation_revision_id) REFERENCES local_identity.production_preparation_revisions(episode_id,id),
 FOREIGN KEY(preparation_revision_id,shot_id) REFERENCES local_identity.production_shot_versions(preparation_revision_id,shot_id),
 FOREIGN KEY(episode_id,audio_track_id) REFERENCES public.audio_tracks(episode_id,id),
 FOREIGN KEY(episode_id,imported_from_package_id,shot_id,imported_from_draft_id) REFERENCES public.shot_preparation_drafts(episode_id,review_package_id,shot_id,id)
);
CREATE INDEX workspace_narration_input_episode ON local_identity.workspace_narration_inputs(episode_id);
CREATE INDEX workspace_narration_input_preparation ON local_identity.workspace_narration_inputs(preparation_revision_id);
CREATE INDEX workspace_narration_input_audio ON local_identity.workspace_narration_inputs(audio_track_id);
CREATE INDEX workspace_narration_input_source ON local_identity.workspace_narration_inputs(imported_from_draft_id);
ALTER TABLE local_identity.workspace_narration_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_narration_input_owner ON local_identity.workspace_narration_inputs FOR SELECT TO loop_app
 USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id
  WHERE e.id=episode_id AND m.user_id=(SELECT local_identity.owner_id()) AND m.role='owner'));
REVOKE ALL ON local_identity.workspace_narration_inputs FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT ON local_identity.workspace_narration_inputs TO loop_app;

WITH voice_sources AS (
 SELECT id workspace_id,episode_id,preparation_revision_id FROM local_identity.production_workspaces
 UNION SELECT workspace_id,episode_id,preparation_revision_id FROM local_identity.production_workspace_versions
)
INSERT INTO local_identity.workspace_narration_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,mode,narration_text,voice,speaking_rate,language_code,voice_override,audio_track_id,imported_from_draft_id,imported_from_package_id,created_at,updated_at)
 SELECT r.workspace_id,r.episode_id,p.id,d.shot_id,CASE d.audio_mode WHEN 'source' THEN 'manual' ELSE d.audio_mode END,
  d.tts_text,d.tts_voice,d.tts_speaking_rate,d.tts_language_code,coalesce(length(d.tts_override_voice),0)>0,d.current_audio_track_id,d.id,d.review_package_id,d.created_at,d.updated_at
 FROM voice_sources r JOIN local_identity.production_preparation_revisions p ON p.id=r.preparation_revision_id AND p.episode_id=r.episode_id AND p.source_format='storyboard/v1'
 JOIN public.shot_preparation_drafts d ON d.episode_id=r.episode_id AND d.review_package_id=p.source_reference_id
 JOIN local_identity.production_shot_versions s ON s.preparation_revision_id=p.id AND s.episode_id=r.episode_id AND s.shot_id=d.shot_id;

-- The existing Owner/current-preparation fence is shared by caption and voice operations below.

CREATE OR REPLACE FUNCTION local_identity.lock_current_production_workspace(p_workspace uuid)
 RETURNS local_identity.production_workspaces
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces; e public.episodes;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Current Owner workspace required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id;
 IF e.archived_at IS NOT NULL OR e.stage='production_completed' OR local_identity.is_historical_episode(e.id)
  OR e.main_script_revision_id IS DISTINCT FROM w.script_revision_id OR NOT EXISTS(
   SELECT 1 FROM local_identity.production_preparation_revisions p WHERE p.id=w.preparation_revision_id AND p.episode_id=e.id
    AND p.script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id)) THEN
  RAISE EXCEPTION 'Current confirmed workspace preparation required' USING ERRCODE='40001';
 END IF;
 RETURN w;
END $function$
;
REVOKE ALL ON FUNCTION local_identity.lock_current_production_workspace(uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;

CREATE OR REPLACE FUNCTION local_identity.request_production_caption_alignment(p_workspace uuid, p_clip uuid, p_audio uuid, p_text text, p_local_only boolean DEFAULT false)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces; b jsonb; input local_identity.workspace_caption_inputs; track public.audio_tracks;
 created_task public.tasks; text_fingerprint text; input_version text; task_id uuid:=extensions.gen_random_uuid(); directory text;
BEGIN
 w:=local_identity.lock_current_production_workspace(p_workspace);
 SELECT value INTO b FROM jsonb_array_elements(w.bindings) WHERE value->>'id'=p_clip::text;
 SELECT * INTO input FROM local_identity.workspace_caption_inputs WHERE workspace_id=w.id AND preparation_revision_id=w.preparation_revision_id AND shot_id=b->>'shotId';
 IF b IS NULL OR input.shot_id IS NULL OR p_local_only IS NULL OR p_text IS NULL OR btrim(p_text)='' OR input.contract->>'text' IS DISTINCT FROM p_text OR input.contract->>'enabled' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Current confirmed caption input required' USING ERRCODE='22023';
 END IF;
 SELECT * INTO track FROM public.audio_tracks WHERE id=p_audio AND episode_id=w.episode_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current registered audio track required' USING ERRCODE='22023';END IF;
 text_fingerprint:=encode(extensions.digest(convert_to(p_text,'UTF8'),'sha256'),'hex');
 input_version:=encode(extensions.digest(convert_to(jsonb_build_object('audioSha256',track.sha256,'textFingerprint',text_fingerprint,'voice','','speakingRate',1,'provider','whisperx','model','jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn','connectionVersionId',null)::text,'UTF8'),'sha256'),'hex');
 SELECT * INTO created_task FROM public.tasks t WHERE t.episode_id=w.episode_id AND t.task_type='align_shot_captions'
  AND t.input_snapshot#>>'{workspace_caption,version}'='workspace-caption/v2' AND t.input_snapshot#>>'{workspace_caption,workspace_id}'=w.id::text
  AND t.input_snapshot#>>'{workspace_caption,preparation_revision_id}'=w.preparation_revision_id::text AND t.input_snapshot#>>'{workspace_caption,shot_id}'=b->>'shotId'
  AND t.input_snapshot#>>'{acoustic_alignment,input_version}'=input_version AND t.status IN ('ready','running') AND t.invalidated_at IS NULL
  ORDER BY t.created_at DESC LIMIT 1;
 IF FOUND THEN RETURN created_task;END IF;
 SELECT directory_relative_path INTO directory FROM local_identity.episode_storage_location(w.episode_id);
 IF directory IS NULL THEN RAISE EXCEPTION 'Current episode storage required' USING ERRCODE='55000';END IF;
 INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version)
 VALUES(task_id,w.episode_id,'align_shot_captions','ready',jsonb_build_object(
  'capability','acoustic_alignment','workspace_caption',jsonb_build_object('version','workspace-caption/v2','workspace_id',w.id,'preparation_revision_id',w.preparation_revision_id,'shot_id',b->>'shotId','project_sha256',w.project_sha256),
  'executor',jsonb_build_object('provider','whisperx','adapter','whisperx_local','model','jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn','prompt_version','whisperx-alignment-v1'),
  'acoustic_alignment',jsonb_build_object('confirmed_text',p_text,'text_fingerprint',text_fingerprint,'audio_relative_path',track.relative_path,'audio_sha256',track.sha256,'input_version',input_version,'voice','','speaking_rate',1,'strategy',CASE WHEN p_local_only THEN 'local' ELSE 'auto' END),
  'input_artifacts',jsonb_build_array(jsonb_build_object('artifactType','audio_track','relativePath',track.relative_path,'sha256',track.sha256,'fileSize',track.file_size)),
  'output',jsonb_build_object('required_artifact_types',jsonb_build_array('acoustic_alignment_evidence'),'content_type','application/json','relative_path',directory||'/caption-alignments/'||task_id::text||'/alignment.json','review_stage','production_ready'),
  'allowed_tools',jsonb_build_array('read','write')
 ),0,2,'whisperx','jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn','whisperx-alignment-v1') RETURNING * INTO created_task;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id)
  SELECT e.account_id,e.id,'production_caption_alignment_requested',jsonb_build_object('task_id',created_task.id,'preparation_revision_id',w.preparation_revision_id,'shot_id',b->>'shotId','local_only',p_local_only),local_identity.owner_id() FROM public.episodes e WHERE e.id=w.episode_id;
 RETURN created_task;
END $function$
;

CREATE OR REPLACE FUNCTION local_identity.save_production_caption_input(p_workspace uuid, p_clip uuid, p_contract jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces; b jsonb; voice local_identity.workspace_narration_inputs;
BEGIN
 w:=local_identity.lock_current_production_workspace(p_workspace);
 SELECT value INTO b FROM jsonb_array_elements(w.bindings) WHERE value->>'id'=p_clip::text;
 IF b IS NULL OR NOT coalesce(public.is_valid_shot_caption_contract(p_contract),false) THEN RAISE EXCEPTION 'Workspace caption input invalid' USING ERRCODE='22023';END IF;
 -- Follow the current versioned voice input; historical draft evidence stays immutable.
 IF p_contract->>'content_mode'='follow_tts' THEN
  SELECT * INTO voice FROM local_identity.workspace_narration_inputs WHERE workspace_id=w.id AND preparation_revision_id=w.preparation_revision_id AND shot_id=b->>'shotId';
  IF voice.mode IS DISTINCT FROM 'tts' OR p_contract->>'text' IS DISTINCT FROM voice.narration_text THEN RAISE EXCEPTION 'Captions must follow current narration text' USING ERRCODE='40001';END IF;
 END IF;
 INSERT INTO local_identity.workspace_caption_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,contract)
  VALUES(w.id,w.episode_id,w.preparation_revision_id,b->>'shotId',p_contract)
  ON CONFLICT(workspace_id,preparation_revision_id,shot_id) DO UPDATE SET contract=excluded.contract,updated_at=clock_timestamp()
   WHERE workspace_caption_inputs.contract IS DISTINCT FROM excluded.contract;
END $function$
;

CREATE OR REPLACE FUNCTION local_identity.sync_workspace_caption_inputs(p_workspace uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces; p local_identity.production_preparation_revisions;
BEGIN
 w:=local_identity.lock_current_production_workspace(p_workspace);
 SELECT * INTO p FROM local_identity.production_preparation_revisions WHERE id=w.preparation_revision_id;
 -- Formatting-only children inherit editable inputs without relabeling or rewriting their parent.
 INSERT INTO local_identity.workspace_caption_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,contract,imported_from_draft_id,imported_from_package_id)
  SELECT w.id,w.episode_id,p.id,i.shot_id,i.contract,i.imported_from_draft_id,i.imported_from_package_id
  FROM local_identity.workspace_caption_inputs i JOIN local_identity.production_shot_versions s ON s.preparation_revision_id=p.id AND s.shot_id=i.shot_id
  WHERE i.workspace_id=w.id AND i.preparation_revision_id=p.parent_preparation_revision_id
  ON CONFLICT DO NOTHING;
 IF p.source_format='storyboard/v1' THEN
  INSERT INTO local_identity.workspace_caption_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,contract,imported_from_draft_id,imported_from_package_id,created_at,updated_at)
   SELECT w.id,w.episode_id,p.id,d.shot_id,d.caption_contract,d.id,d.review_package_id,d.created_at,d.updated_at
   FROM public.shot_preparation_drafts d JOIN local_identity.production_shot_versions s ON s.preparation_revision_id=p.id AND s.shot_id=d.shot_id
   WHERE d.episode_id=w.episode_id AND d.review_package_id=p.source_reference_id
   ON CONFLICT DO NOTHING;
 END IF;
END $function$
;

DROP FUNCTION local_identity.lock_current_caption_workspace(uuid) RESTRICT;

CREATE FUNCTION local_identity.sync_workspace_narration_inputs(p_workspace uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces; p local_identity.production_preparation_revisions;
BEGIN
 w:=local_identity.lock_current_production_workspace(p_workspace);
 SELECT * INTO p FROM local_identity.production_preparation_revisions WHERE id=w.preparation_revision_id;
 INSERT INTO local_identity.workspace_narration_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,mode,narration_text,voice,speaking_rate,language_code,voice_override,audio_track_id,imported_from_draft_id,imported_from_package_id)
  SELECT w.id,w.episode_id,p.id,i.shot_id,i.mode,i.narration_text,i.voice,i.speaking_rate,i.language_code,i.voice_override,i.audio_track_id,i.imported_from_draft_id,i.imported_from_package_id
  FROM local_identity.workspace_narration_inputs i JOIN local_identity.production_shot_versions s ON s.preparation_revision_id=p.id AND s.shot_id=i.shot_id
  WHERE i.workspace_id=w.id AND i.preparation_revision_id=p.parent_preparation_revision_id ON CONFLICT DO NOTHING;
 IF p.source_format='storyboard/v1' THEN
  INSERT INTO local_identity.workspace_narration_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,mode,narration_text,voice,speaking_rate,language_code,voice_override,audio_track_id,imported_from_draft_id,imported_from_package_id,created_at,updated_at)
   SELECT w.id,w.episode_id,p.id,d.shot_id,CASE d.audio_mode WHEN 'source' THEN 'manual' ELSE d.audio_mode END,d.tts_text,d.tts_voice,d.tts_speaking_rate,d.tts_language_code,coalesce(length(d.tts_override_voice),0)>0,d.current_audio_track_id,d.id,d.review_package_id,d.created_at,d.updated_at
   FROM public.shot_preparation_drafts d JOIN local_identity.production_shot_versions s ON s.preparation_revision_id=p.id AND s.shot_id=d.shot_id
   WHERE d.episode_id=w.episode_id AND d.review_package_id=p.source_reference_id ON CONFLICT DO NOTHING;
 END IF;
END $$;
REVOKE ALL ON FUNCTION local_identity.sync_workspace_narration_inputs(uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.sync_workspace_narration_inputs(uuid) TO loop_app;

CREATE FUNCTION local_identity.save_production_narration_input(p_workspace uuid,p_shot text,p_mode text,p_text text,p_voice text,p_rate numeric,p_language text,p_audio uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces;
BEGIN
 w:=local_identity.lock_current_production_workspace(p_workspace);
 IF p_mode IS NULL OR p_mode NOT IN ('tts','manual','none') OR p_text IS NULL OR length(p_text)>100000
  OR p_voice IS NOT NULL AND length(btrim(p_voice)) NOT BETWEEN 1 AND 200
  OR p_rate IS NOT NULL AND p_rate NOT BETWEEN 0.5 AND 2
  OR p_mode='tts' AND (btrim(p_text)='' OR p_voice IS NULL OR p_rate IS NULL OR coalesce(btrim(p_language),'')='' OR length(p_language)>30)
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot) THEN
  RAISE EXCEPTION 'Valid current narration input required' USING ERRCODE='22023';
 END IF;
 IF p_mode='manual' AND NOT EXISTS(SELECT 1 FROM public.audio_tracks a WHERE a.id=p_audio AND a.episode_id=w.episode_id AND a.track_kind='narration')
  OR p_mode<>'manual' AND p_audio IS NOT NULL THEN RAISE EXCEPTION 'Owned registered narration track required' USING ERRCODE='22023';END IF;
 INSERT INTO local_identity.workspace_narration_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,mode,narration_text,voice,speaking_rate,language_code,voice_override,audio_track_id)
 VALUES(w.id,w.episode_id,w.preparation_revision_id,p_shot,p_mode,p_text,p_voice,p_rate,p_language,p_mode='tts' AND p_voice IS NOT NULL,p_audio)
 ON CONFLICT(workspace_id,preparation_revision_id,shot_id) DO UPDATE SET mode=excluded.mode,narration_text=excluded.narration_text,voice=excluded.voice,speaking_rate=excluded.speaking_rate,language_code=excluded.language_code,voice_override=excluded.voice_override,audio_track_id=excluded.audio_track_id,updated_at=clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION local_identity.save_production_narration_input(uuid,text,text,text,text,numeric,text,uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.save_production_narration_input(uuid,text,text,text,text,numeric,text,uuid) TO loop_app;

CREATE FUNCTION local_identity.use_production_source_track(p_workspace uuid,p_shot text,p_track uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces; track public.audio_tracks;
BEGIN
 w:=local_identity.lock_current_production_workspace(p_workspace);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot) THEN RAISE EXCEPTION 'Current workspace shot required' USING ERRCODE='22023';END IF;
 WITH RECURSIVE basis AS(
  SELECT p.id,p.parent_preparation_revision_id,p.source_format,p.source_reference_id FROM local_identity.production_preparation_revisions p WHERE p.id=w.preparation_revision_id AND p.episode_id=w.episode_id
  UNION SELECT p.id,p.parent_preparation_revision_id,p.source_format,p.source_reference_id FROM local_identity.production_preparation_revisions p JOIN basis b ON p.id=b.parent_preparation_revision_id WHERE p.episode_id=w.episode_id
 ) SELECT a.* INTO track FROM public.audio_tracks a WHERE a.id=p_track AND a.episode_id=w.episode_id AND a.track_kind='source' AND EXISTS(
  SELECT 1 FROM basis p WHERE a.preparation_revision_id=p.id OR a.preparation_revision_id IS NULL AND p.source_format='storyboard/v1' AND a.source_review_package_id=p.source_reference_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Registered preparation-bound source track required' USING ERRCODE='22023';END IF;
 INSERT INTO local_identity.workspace_narration_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,mode,audio_track_id)
  VALUES(w.id,w.episode_id,w.preparation_revision_id,p_shot,'manual',track.id)
  ON CONFLICT(workspace_id,preparation_revision_id,shot_id) DO UPDATE SET mode=CASE WHEN workspace_narration_inputs.mode='none' THEN 'manual' ELSE workspace_narration_inputs.mode END,audio_track_id=excluded.audio_track_id,updated_at=clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION local_identity.use_production_source_track(uuid,text,uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.use_production_source_track(uuid,text,uuid) TO loop_app;

CREATE OR REPLACE FUNCTION local_identity.register_production_manual_narration(p_workspace uuid, p_shot text, p_material uuid, p_duration numeric, p_text text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces;e public.episodes;m public.production_material_revisions;t public.tasks;a public.artifacts;track_id uuid;
BEGIN
 w:=local_identity.lock_current_production_workspace(p_workspace);
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id;
 IF e.archived_at IS NOT NULL OR e.stage='production_completed' OR e.main_script_revision_id IS DISTINCT FROM w.script_revision_id OR NOT local_identity.preparation_source_current(w.preparation_revision_id) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot) THEN RAISE EXCEPTION 'Current workspace shot required' USING ERRCODE='22023';END IF;
 SELECT * INTO m FROM public.production_material_revisions WHERE id=p_material AND episode_id=e.id AND material_type='audio' AND material_purpose IN ('narration','general_reference');
 IF NOT FOUND OR p_duration IS NULL OR p_duration<=0 OR p_duration>7200 OR p_text IS NULL OR length(p_text)>100000 THEN RAISE EXCEPTION 'Verified narration material required' USING ERRCODE='22023';END IF;
 SELECT existing_audio.id INTO track_id FROM public.audio_tracks existing_audio JOIN public.tasks existing_task ON existing_task.id=existing_audio.source_task_id WHERE existing_audio.episode_id=e.id AND existing_audio.source_material_revision_id=m.id AND existing_audio.track_kind='narration' AND existing_audio.cue_id=p_shot AND (existing_task.input_snapshot#>>'{workspace_narration,version}'='workspace-narration/v2' AND existing_task.input_snapshot#>>'{workspace_narration,workspace_id}'=w.id::text AND existing_task.input_snapshot#>>'{workspace_narration,preparation_revision_id}'=w.preparation_revision_id::text OR existing_task.input_snapshot#>>'{workspace_manual_narration,workspace_id}'=w.id::text AND EXISTS(SELECT 1 FROM local_identity.production_preparation_revisions p WHERE p.id=w.preparation_revision_id AND p.source_format='storyboard/v1' AND p.source_reference_id::text=existing_task.input_snapshot->>'storyboard_review_package_id')) AND existing_task.input_snapshot#>>'{media,narration,text}'=p_text;
 IF FOUND THEN RETURN track_id;END IF;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version,actual_cost_cents,completed_at,last_result)
 VALUES(e.id,'generate_narration','completed',jsonb_build_object('capability','narration_manual_upload','workspace_narration',jsonb_build_object('version','workspace-narration/v2','workspace_id',w.id,'shot_id',p_shot,'preparation_revision_id',w.preparation_revision_id),'media',jsonb_build_object('narration',jsonb_build_object('text',p_text)),'manual_source',jsonb_build_object('material_revision_id',m.id),'audio_track',jsonb_build_object('kind','narration','cue_id',p_shot,'preparation_revision_id',w.preparation_revision_id,'source_material_revision_id',m.id,'start_seconds',0,'duration_seconds',p_duration)),0,1,'manual_upload','owner-provided-audio','workspace-manual-narration-v2',0,clock_timestamp(),jsonb_build_object('version','manual-result/v1','status','completed','actualCostCents',0,'validation',jsonb_build_object('passed',true),'artifacts',jsonb_build_array(jsonb_build_object('artifactType','narration_audio','relativePath',m.storage_path,'sha256',m.sha256,'fileSize',m.file_size)))) RETURNING * INTO t;
 SELECT * INTO a FROM public.artifacts WHERE episode_id=e.id AND relative_path=m.storage_path;
 IF FOUND THEN
  IF a.sha256<>m.sha256 OR a.file_size<>m.file_size THEN RAISE EXCEPTION 'Registered audio identity differs' USING ERRCODE='22023';END IF;
 ELSE
  INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id) VALUES(e.id,'narration_audio',m.storage_path,m.sha256,m.file_size,t.id) RETURNING * INTO a;
 END IF;
 INSERT INTO public.audio_tracks(episode_id,source_task_id,source_artifact_id,preparation_revision_id,source_material_revision_id,track_kind,cue_id,relative_path,sha256,file_size,start_seconds,duration_seconds) VALUES(e.id,t.id,a.id,w.preparation_revision_id,m.id,'narration',p_shot,m.storage_path,m.sha256,m.file_size,0,p_duration) RETURNING id INTO track_id;
 INSERT INTO public.production_dependencies(episode_id,upstream_kind,upstream_id,downstream_kind,downstream_id) VALUES(e.id,'material_revision',m.id,'task',t.id) ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,e.id,'workspace_manual_narration_registered',jsonb_build_object('workspace_id',w.id,'shot_id',p_shot,'material_revision_id',m.id,'task_id',t.id,'audio_track_id',track_id),local_identity.owner_id());
 RETURN track_id;
END $function$
;
REVOKE ALL ON FUNCTION local_identity.register_production_manual_narration(uuid,text,uuid,numeric,text) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.register_production_manual_narration(uuid,text,uuid,numeric,text) TO loop_app;

-- Retain the original archive/ownership/file gates; remove current references before their targets.
CREATE OR REPLACE FUNCTION public.delete_episode(p_episode_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_episode public.episodes;
  membership_role public.member_role;
  deleted_at timestamptz := now();
  task_count bigint;
  artifact_count bigint;
  approval_count bigint;
  transition_count bigint;
  audit_event_count bigint;
  material_count bigint;
  review_package_count bigint;
  audio_track_count bigint;
  audio_annotation_count bigint;
  composition_revision_count bigint;
  review_annotation_count bigint;
  pre_render_member_count bigint;
  pre_render_decision_count bigint;
  dependency_count bigint;
  invalidation_count bigint;
  experiment_count bigint;
  metric_snapshot_count bigint;
  asset_lock_count bigint;
begin
  select episode.* into current_episode
  from public.episodes episode
  where episode.id = p_episode_id
  for update;
  if not found then
    raise exception 'Episode % does not exist', p_episode_id using errcode = 'P0002';
  end if;

  select role into membership_role
  from public.account_memberships
  where account_id = current_episode.account_id and user_id = p_actor_id;
  if membership_role is distinct from 'owner' then
    raise exception 'Owner membership is required to delete an episode' using errcode = '42501';
  end if;
  if current_episode.archived_at is null then
    raise exception 'Episode must be archived before it can be permanently deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.tasks where episode_id = p_episode_id and status = 'running') then
    raise exception 'Episode has a running Worker task; wait for it to finish before deleting' using errcode = '55000';
  end if;
  if exists (select 1 from public.asset_locks where episode_id = p_episode_id and expires_at > now()) then
    raise exception 'Episode has an active asset lock; wait for it to expire before deleting' using errcode = '55000';
  end if;

  select count(*) into task_count from public.tasks where episode_id = p_episode_id;
  select count(*) into artifact_count from public.artifacts where episode_id = p_episode_id;
  select count(*) into approval_count from public.approvals where episode_id = p_episode_id;
  select count(*) into transition_count from public.state_transitions where episode_id = p_episode_id;
  select count(*) into audit_event_count from public.audit_events where episode_id = p_episode_id;
  select count(*) into material_count from public.production_material_revisions where episode_id = p_episode_id;
  select count(*) into review_package_count from public.review_packages where episode_id = p_episode_id;
  select count(*) into audio_track_count from public.audio_tracks where episode_id = p_episode_id;
  select count(*) into audio_annotation_count from public.audio_track_annotations where audio_track_id in (select id from public.audio_tracks where episode_id = p_episode_id);
  select count(*) into composition_revision_count from public.review_render_composition_revisions where episode_id = p_episode_id;
  select count(*) into review_annotation_count from public.review_annotations where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into pre_render_member_count from public.pre_render_review_members where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into pre_render_decision_count from public.pre_render_review_member_decisions where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  select count(*) into dependency_count from public.production_dependencies where episode_id = p_episode_id;
  select count(*) into invalidation_count from public.production_invalidations where episode_id = p_episode_id;
  if to_regclass('public.experiments') is null then experiment_count:=0; else execute 'select count(*) from public.experiments where episode_id=$1' into experiment_count using p_episode_id; end if;
  if to_regclass('public.metric_snapshots') is null then metric_snapshot_count:=0; else execute 'select count(*) from public.metric_snapshots where episode_id=$1' into metric_snapshot_count using p_episode_id; end if;
  select count(*) into asset_lock_count from public.asset_locks where episode_id = p_episode_id;


DELETE FROM local_identity.workspace_narration_submissions
 WHERE task_id IN (SELECT id FROM public.tasks WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_visual_submissions
 WHERE task_id IN (SELECT id FROM public.tasks WHERE episode_id=p_episode_id);

DELETE FROM local_identity.workspace_audio_requests
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_deliveries
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_export_issues
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);

DELETE FROM local_identity.workspace_narration_inputs WHERE episode_id = p_episode_id;

DELETE FROM local_identity.workspace_caption_inputs WHERE episode_id = p_episode_id;

DELETE FROM local_identity.workspace_caption_evidence
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_candidate_adoptions
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_candidate_decisions
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_image_requests
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_narration_requests
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_narrations
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_visual_candidates
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_audio_preparations
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_exports
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_shot_inputs
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.workspace_legacy_recoveries
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.production_workspace_versions
 WHERE workspace_id IN (SELECT id FROM local_identity.production_workspaces WHERE episode_id=p_episode_id);
DELETE FROM local_identity.production_workspaces WHERE episode_id=p_episode_id;
DELETE FROM local_identity.workspace_preparations WHERE episode_id=p_episode_id;


DELETE FROM public.paid_generation_reservations
 WHERE task_id IN (SELECT id FROM public.tasks WHERE episode_id=p_episode_id);
  delete from public.shot_preparation_drafts where episode_id = p_episode_id;

  delete from public.pre_render_review_member_decisions
  where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  delete from public.pre_render_review_members
  where review_package_id in (select id from public.review_packages where episode_id = p_episode_id);
  delete from public.audio_track_annotations
  where audio_track_id in (select id from public.audio_tracks where episode_id = p_episode_id);
  delete from public.audio_tracks where episode_id = p_episode_id;
DELETE FROM local_identity.production_shot_versions WHERE episode_id=p_episode_id;
DELETE FROM local_identity.production_preparation_revisions WHERE episode_id=p_episode_id;
DELETE FROM local_identity.production_shots WHERE episode_id=p_episode_id;
  delete from public.review_render_composition_revisions where episode_id = p_episode_id;
  delete from public.approvals where episode_id = p_episode_id;
  delete from public.review_packages where episode_id = p_episode_id;

  update public.episodes
  set main_script_revision_id = null
  where id = p_episode_id;
  delete from public.episodes where id = p_episode_id;

  return jsonb_build_object(
    'episode_id', p_episode_id,
    'account_id', current_episode.account_id,
    'title', current_episode.title,
    'deleted_at', deleted_at,
    'counts', jsonb_build_object(
      'tasks', task_count,
      'artifacts', artifact_count,
      'approvals', approval_count,
      'state_transitions', transition_count,
      'audit_events', audit_event_count,
      'production_material_revisions', material_count,
      'review_packages', review_package_count,
      'audio_tracks', audio_track_count,
      'audio_track_annotations', audio_annotation_count,
      'review_render_composition_revisions', composition_revision_count,
      'review_annotations', review_annotation_count,
      'pre_render_review_members', pre_render_member_count,
      'pre_render_review_member_decisions', pre_render_decision_count,
      'production_dependencies', dependency_count,
      'production_invalidations', invalidation_count,
      'experiments', experiment_count,
      'metric_snapshots', metric_snapshot_count,
      'asset_locks', asset_lock_count
    )
  );
end;
$function$
;

-- Keep the original confirmation/selection/unknown-submission/budget protocol; change its input model.
CREATE OR REPLACE FUNCTION local_identity.queue_selected_workspace_narration(p_workspace uuid, p_shot text, p_snapshot jsonb, p_retry boolean)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces;n local_identity.workspace_narrations;d local_identity.workspace_narration_inputs;a local_identity.script_productions;e public.episodes;t public.tasks;cfg jsonb;frozen jsonb;amount integer;hash text;caption_text text;BEGIN
 w:=local_identity.lock_current_production_workspace(p_workspace);
 PERFORM pg_advisory_xact_lock(hashtextextended(w.id::text||p_shot,0));
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id;
 SELECT * INTO a FROM local_identity.workspace_production_authorizations WHERE episode_id=e.id AND enabled AND authorized_at IS NOT NULL AND script_revision_id=w.script_revision_id AND authorization_hash=local_identity.current_workspace_call_hash(w.id);
 SELECT * INTO n FROM local_identity.workspace_narrations WHERE workspace_id=w.id AND shot_id=p_shot;
 SELECT * INTO d FROM local_identity.workspace_narration_inputs WHERE workspace_id=w.id AND preparation_revision_id=w.preparation_revision_id AND shot_id=p_shot;
 SELECT contract->>'text' INTO caption_text FROM local_identity.workspace_caption_inputs WHERE workspace_id=w.id AND preparation_revision_id=w.preparation_revision_id AND shot_id=p_shot;
 IF btrim(coalesce(caption_text,''))='' THEN caption_text:=d.narration_text;END IF;
 IF e.archived_at IS NOT NULL OR e.stage='production_completed' OR e.main_script_revision_id<>w.script_revision_id OR a.authorization_hash IS NULL OR a.authorization_hash IS DISTINCT FROM p_snapshot->>'authorizationHash' OR n.mode<>'tts' OR n.confirmed_fingerprint IS DISTINCT FROM n.input_fingerprint OR n.input_fingerprint IS DISTINCT FROM p_snapshot->>'inputFingerprint' OR n.selection IS DISTINCT FROM p_snapshot->'selection' OR NOT local_identity.preparation_source_current(w.preparation_revision_id) THEN RAISE EXCEPTION 'Current authorized speech input required';END IF;
 IF d.workspace_id IS NULL OR d.mode<>'tts' OR p_snapshot#>>'{target,preparationRevisionId}' IS DISTINCT FROM w.preparation_revision_id::text OR p_snapshot#>>'{target,workspaceId}' IS DISTINCT FROM w.id::text OR p_snapshot#>>'{target,shotId}' IS DISTINCT FROM p_shot OR p_snapshot#>>'{target,scriptRevisionId}' IS DISTINCT FROM w.script_revision_id::text OR p_snapshot#>>'{target,projectSha256}' IS DISTINCT FROM w.project_sha256 OR p_snapshot#>>'{context,text}' IS DISTINCT FROM d.narration_text THEN RAISE EXCEPTION 'Current preparation-bound speech input required' USING ERRCODE='40001';END IF;
 cfg:=p_snapshot->'execution';amount:=(p_snapshot->>'reservationCents')::integer;hash:=p_snapshot->>'inputFingerprint';
 IF p_snapshot->>'selectionVersion'<>'1' OR cfg#>>'{executor,provider}'<>'volcengine_tts' OR cfg#>>'{executor,adapter}'<>'volcengine_tts' OR cfg#>>'{executor,model}'<>'seed-tts-2.0' OR cfg->>'credential_ref' IS DISTINCT FROM n.selection->>'connectionVersionId' OR NOT EXISTS(SELECT 1 FROM public.external_connection_versions v JOIN public.external_connections cn ON cn.id=v.connection_id AND cn.created_by=local_identity.owner_id() AND cn.current_version_id=v.id JOIN local_identity.connection_bindings cb ON cb.version_id=v.id AND cb.owner_id=cn.created_by AND cb.store_mode='keychain' JOIN local_identity.connection_qualifications cq ON cq.version_id=v.id AND cq.owner_id=cn.created_by AND cq.qualified WHERE v.id::text=cfg->>'credential_ref' AND v.provider='volcengine_tts' AND v.adapter='volcengine_tts' AND v.revoked_at IS NULL AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified')) THEN RAISE EXCEPTION 'Verified owned speech connection required';END IF;
 SELECT task.* INTO t FROM public.tasks task JOIN local_identity.workspace_narration_requests r ON r.task_id=task.id WHERE r.workspace_id=w.id AND r.shot_id=p_shot AND r.input_fingerprint=hash ORDER BY task.created_at DESC LIMIT 1;
 IF FOUND AND (t.status IN ('ready','running','completed') OR t.status IN ('failed','blocked') AND NOT p_retry) THEN RETURN t;END IF;

 IF EXISTS(
  WITH prior AS(
   SELECT task.id,task.status,s.outcome,
    EXISTS(SELECT 1 FROM local_identity.native_output_publications h WHERE h.task_id=task.id) held,
    EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests child WHERE child.workspace_id=w.id AND child.shot_id=p_shot AND child.request_snapshot->>'retryOfTaskId'=task.id::text) retried
   FROM local_identity.workspace_narration_requests r JOIN public.tasks task ON task.id=r.task_id
   LEFT JOIN local_identity.workspace_narration_submissions s ON s.task_id=task.id
   WHERE r.workspace_id=w.id AND r.shot_id=p_shot
  ), unresolved AS(
   SELECT * FROM prior WHERE status IN ('ready','running') OR held OR(outcome IN ('started','received') AND status<>'completed' AND NOT retried AND NOT local_identity.provider_request_not_sent(id))
  ), approved AS(
   SELECT u.id FROM unresolved u JOIN local_identity.workspace_call_confirmations c ON c.authorization_hash=local_identity.current_workspace_call_hash(w.id)
   WHERE u.status IN ('failed','blocked') AND (u.outcome='started' OR(u.outcome='received' AND NOT EXISTS(SELECT 1 FROM local_identity.provider_dispatch_facts f WHERE f.task_id=u.id))) AND NOT u.held AND NOT u.retried
    AND u.id::text=p_snapshot->>'retryOfTaskId' AND c.command='generateWorkspaceNarration'
    AND c.payload->>'retryOfTaskId'=u.id::text AND c.payload->>'clipId'=n.clip_id::text
  )
  SELECT 1 FROM unresolved u WHERE NOT EXISTS(SELECT 1 FROM approved x WHERE x.id=u.id)
  UNION ALL SELECT 1 WHERE p_snapshot ? 'retryOfTaskId' AND NOT EXISTS(SELECT 1 FROM approved)
 ) THEN RAISE EXCEPTION 'Previous speech submission pending or unknown' USING ERRCODE='55000';END IF;
 
 IF amount IS NULL OR amount<greatest(1,char_length(d.narration_text)) OR amount>100000 THEN RAISE EXCEPTION 'Invalid per-request narration reservation' USING ERRCODE='22023';END IF;
 frozen:=jsonb_build_object('selectionVersion',1,'production_selection',n.selection,'production_context',p_snapshot->'context','workspace_target',p_snapshot->'target','cost_basis',p_snapshot->'costBasis','capability','narration_generation','workspace_narration',jsonb_build_object('version','workspace-narration/v2','workspace_id',w.id,'preparation_revision_id',w.preparation_revision_id,'shot_id',p_shot,'mode','tts'),'configuration_hash',hash,'native_tts_retry_id',gen_random_uuid(),'credential_ref',cfg->>'credential_ref','executor',cfg->'executor','media',jsonb_build_object('adapter','volcengine_tts','narration',jsonb_build_object('text',d.narration_text,'voice',jsonb_build_object('name',d.voice,'language_code',d.language_code,'speaking_rate',d.speaking_rate))),'acoustic_alignment',jsonb_build_object('confirmed_text',caption_text,'text_fingerprint',encode(extensions.digest(convert_to(caption_text,'UTF8'),'sha256'),'hex')),'audio_track',jsonb_build_object('kind','narration','cue_id',p_shot,'preparation_revision_id',w.preparation_revision_id,'start_seconds',0,'duration_seconds',0.001),'budget',jsonb_build_object('limit_cents',amount,'max_attempts',1),'allowed_tools',jsonb_build_array('read','write'),'input_artifacts',jsonb_build_array(),'output',jsonb_build_object('required_artifact_types',jsonb_build_array('narration_audio'),'content_type','audio/mpeg','relative_path',format('%s/audio/narration-%s.mp3',(SELECT directory_relative_path FROM local_identity.episode_storage_location(e.id)),gen_random_uuid()),'review_stage','production_ready'));
 UPDATE local_identity.input_episodes SET narration_enabled=true WHERE episode_id=e.id;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(e.id,'generate_narration','ready',frozen,amount,1,'volcengine_tts','seed-tts-2.0','production-request-v1') RETURNING * INTO t;
 INSERT INTO local_identity.workspace_narration_requests(task_id,workspace_id,episode_id,clip_id,shot_id,input_fingerprint,authorization_hash,request_snapshot) VALUES(t.id,w.id,e.id,n.clip_id,p_shot,hash,a.authorization_hash,p_snapshot);
 RETURN t;
END $function$
;

-- Historical snapshots keep their original review reference. New tracks bind the independent preparation.
CREATE OR REPLACE FUNCTION public.register_completed_audio_track()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_artifact public.artifacts; track_snapshot jsonb; actual_duration numeric; source_material public.production_material_revisions;
begin
  if new.status <> 'completed' or new.task_type not in ('generate_narration', 'extract_embedded_audio', 'generate_soundtrack') then return new; end if;
  track_snapshot := new.input_snapshot -> 'audio_track';
  if jsonb_typeof(track_snapshot) <> 'object' then raise exception 'Completed audio task is missing its frozen audio track snapshot' using errcode = '22023'; end if;
  IF new.input_snapshot ? 'workspace_narration' AND (new.input_snapshot#>>'{workspace_narration,version}' IS DISTINCT FROM 'workspace-narration/v2' OR new.input_snapshot#>>'{workspace_narration,preparation_revision_id}' IS DISTINCT FROM track_snapshot->>'preparation_revision_id' OR NOT EXISTS(SELECT 1 FROM local_identity.production_shot_versions v WHERE v.episode_id=new.episode_id AND v.preparation_revision_id::text=track_snapshot->>'preparation_revision_id' AND v.shot_id=new.input_snapshot#>>'{workspace_narration,shot_id}')) THEN RAISE EXCEPTION 'Frozen narration preparation differs from audio provenance' USING ERRCODE='22023';END IF;
  if coalesce(new.last_result ->> 'audioDurationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$' or (new.last_result ->> 'audioDurationSeconds')::numeric <= 0 then raise exception 'Completed audio task is missing its probed duration' using errcode = '22023'; end if;
  actual_duration := (new.last_result ->> 'audioDurationSeconds')::numeric;
  if track_snapshot ? 'source_material_revision_id' then
    select material.* into source_material from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id where material.id = (track_snapshot ->> 'source_material_revision_id')::uuid and material.episode_id = new.episode_id;
    if not found then raise exception 'Completed audio task source material approval is invalid' using errcode = '22023'; end if;
  end if;
  select * into selected_artifact from public.artifacts artifact where artifact.producer_task_id = new.id and artifact.relative_path = new.input_snapshot #>> '{output,relative_path}';
  if not found then raise exception 'Completed audio task is missing its frozen output artifact' using errcode = '22023'; end if;
  insert into public.audio_tracks (episode_id,source_task_id,source_artifact_id,source_review_package_id,preparation_revision_id,source_material_revision_id,track_kind,cue_id,relative_path,sha256,file_size,start_seconds,duration_seconds)
  values (new.episode_id,new.id,selected_artifact.id,nullif(track_snapshot ->> 'source_review_package_id','')::uuid,nullif(track_snapshot ->> 'preparation_revision_id','')::uuid,source_material.id,track_snapshot ->> 'kind',nullif(track_snapshot ->> 'cue_id',''),selected_artifact.relative_path,selected_artifact.sha256,selected_artifact.file_size,coalesce((track_snapshot ->> 'start_seconds')::numeric,0),actual_duration);
  return new;
end;
$function$
;

-- Preserve authorization, current project, lease, unresolved-call and reservation fences.
CREATE OR REPLACE FUNCTION local_identity.provider_dispatch_context_current(p_task uuid, p_kind text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(
  SELECT 1 FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id
  JOIN local_identity.production_workspaces w ON w.episode_id=e.id
  JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.episode_id=e.id AND p.script_revision_id=w.script_revision_id
  WHERE t.id=p_task AND t.invalidated_at IS NULL AND e.archived_at IS NULL
   AND e.stage<>'production_completed' AND NOT local_identity.is_recycled_episode(e.id)
   AND e.main_script_revision_id=w.script_revision_id AND local_identity.preparation_source_current(p.id)
   AND CASE WHEN p_kind='speech' THEN
    t.task_type='generate_narration' AND EXISTS(
     SELECT 1 FROM local_identity.workspace_narration_requests r
     JOIN local_identity.workspace_production_authorizations a ON a.episode_id=r.episode_id
     WHERE r.task_id=t.id AND r.workspace_id=w.id AND a.enabled AND a.authorized_at IS NOT NULL
      AND a.script_revision_id=w.script_revision_id AND a.authorization_hash=r.authorization_hash
      AND CASE WHEN t.input_snapshot ? 'workspace_narration' THEN
       t.input_snapshot#>>'{workspace_narration,version}'='workspace-narration/v2'
       AND t.input_snapshot#>>'{workspace_narration,workspace_id}'=w.id::text
       AND t.input_snapshot#>>'{workspace_narration,shot_id}'=r.shot_id
       AND t.input_snapshot#>>'{workspace_narration,preparation_revision_id}'=p.id::text
       AND r.request_snapshot#>>'{target,preparationRevisionId}'=p.id::text
       AND r.request_snapshot#>>'{target,workspaceId}'=w.id::text
       AND r.request_snapshot#>>'{target,shotId}'=r.shot_id
       AND r.request_snapshot#>>'{target,scriptRevisionId}'=w.script_revision_id::text
      ELSE p.source_format='storyboard/v1'
       AND t.input_snapshot->>'storyboard_review_package_id'=p.source_reference_id::text
      END
      AND CASE WHEN r.request_snapshot->>'selectionVersion'='1'
       THEN w.project_sha256=r.request_snapshot#>>'{target,projectSha256}'
       ELSE EXISTS(SELECT 1 FROM local_identity.workspace_narrations n WHERE n.workspace_id=w.id AND n.shot_id=r.shot_id AND n.mode='tts' AND n.task_id=t.id AND n.input_fingerprint=r.input_fingerprint AND n.confirmed_fingerprint=r.input_fingerprint) END)
   ELSE p_kind='image' AND t.task_type='generate_static_visual' AND t.provider='openai'
    AND EXISTS(SELECT 1 FROM public.review_packages rp WHERE rp.id=w.storyboard_package_id AND rp.invalidated_at IS NULL) AND EXISTS(
    SELECT 1 FROM local_identity.workspace_visual_candidates v
    JOIN local_identity.workspace_production_authorizations a ON a.episode_id=v.episode_id
    WHERE v.task_id=t.id AND v.workspace_id=w.id AND a.enabled AND a.authorized_at IS NOT NULL
     AND a.script_revision_id=w.script_revision_id AND a.authorization_hash=v.request_snapshot->>'authorizationHash'
     AND (v.request_snapshot#>>'{target,projectSha256}' IS NULL OR w.project_sha256=v.request_snapshot#>>'{target,projectSha256}')) END
 )
$function$
;
CREATE OR REPLACE FUNCTION local_identity.reserve_workspace_narration_submission(p_task_id uuid, p_attempt integer, p_lease_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r local_identity.workspace_narration_requests;t public.tasks;aid uuid;BEGIN
 SELECT * INTO r FROM local_identity.workspace_narration_requests WHERE task_id=p_task_id;
 IF r.request_snapshot->>'selectionVersion' IS DISTINCT FROM '1' THEN RETURN local_identity.reserve_workspace_narration_submission_legacy(p_task_id,p_attempt,p_lease_token);END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 PERFORM pg_advisory_xact_lock(hashtextextended(r.workspace_id::text||r.shot_id,0));
 IF NOT local_identity.provider_dispatch_context_current(p_task_id,'speech') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests x JOIN local_identity.workspace_narration_submissions s ON s.task_id=x.task_id JOIN public.tasks other_task ON other_task.id=x.task_id WHERE x.workspace_id=r.workspace_id AND x.shot_id=r.shot_id AND x.task_id<>p_task_id AND s.outcome IN ('started','received') AND other_task.status<>'completed'
  AND NOT local_identity.provider_request_not_sent(x.task_id)
  AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests child
   WHERE child.workspace_id=x.workspace_id AND child.shot_id=x.shot_id AND child.request_snapshot->>'retryOfTaskId'=x.task_id::text)) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM local_identity.workspace_narration_submissions WHERE task_id=p_task_id) THEN RETURN false;END IF;
 SELECT * INTO t FROM public.tasks WHERE id=p_task_id;SELECT account_id INTO aid FROM public.episodes WHERE id=t.episode_id;
 INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents) VALUES(t.id,aid,'narration',t.budget_limit_cents); 
 INSERT INTO local_identity.workspace_narration_submissions(task_id,attempt,outcome) VALUES(p_task_id,p_attempt,'started') ON CONFLICT DO NOTHING;RETURN FOUND;
END $function$
;
CREATE OR REPLACE FUNCTION local_identity.workspace_shot_context(p_episode uuid, p_review uuid, p_shot text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT s.snapshot||jsonb_strip_nulls(jsonb_build_object('id',s.shot_id,'scriptSegment',CASE WHEN s.origin='local' THEN coalesce(
  (SELECT d.narration_text FROM local_identity.workspace_narration_inputs d WHERE d.workspace_id=w.id AND d.preparation_revision_id=p.id AND d.shot_id=s.shot_id),
  (SELECT b->>'text' FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=s.shot_id LIMIT 1),'') ELSE s.baseline_text END,
  'shotType',local_identity.historical_preparation_shot_classification(p.id,s.shot_id)))
 FROM local_identity.production_shot_versions s JOIN local_identity.production_workspaces w ON w.preparation_revision_id=s.preparation_revision_id AND w.episode_id=s.episode_id
 JOIN public.episodes e ON e.id=w.episode_id JOIN local_identity.production_preparation_revisions p ON p.id=w.preparation_revision_id AND p.script_revision_id=w.script_revision_id
 WHERE w.episode_id=p_episode AND p.id=p_review AND s.shot_id=p_shot AND e.main_script_revision_id=w.script_revision_id
  AND local_identity.preparation_source_current(p.id) AND e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_historical_episode(e.id) AND NOT local_identity.is_recycled_episode(e.id)
  AND EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot)
$function$
;
