-- ADR-0068 / B1: editable caption inputs no longer write historical shot drafts.
ALTER TABLE local_identity.production_workspaces ADD CONSTRAINT production_workspace_episode_identity UNIQUE(episode_id,id);
ALTER TABLE public.shot_preparation_drafts ADD CONSTRAINT caption_import_source_identity UNIQUE(episode_id,review_package_id,shot_id,id);
CREATE TABLE local_identity.workspace_caption_inputs (
 workspace_id uuid NOT NULL,
 episode_id uuid NOT NULL,
 preparation_revision_id uuid NOT NULL,
 shot_id text NOT NULL,
 contract jsonb NOT NULL CHECK(coalesce(public.is_valid_shot_caption_contract(contract),false)),
 imported_from_draft_id uuid,
 imported_from_package_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,preparation_revision_id,shot_id),
 CHECK((imported_from_draft_id IS NULL)=(imported_from_package_id IS NULL)),
 FOREIGN KEY(episode_id,imported_from_package_id,shot_id,imported_from_draft_id) REFERENCES public.shot_preparation_drafts(episode_id,review_package_id,shot_id,id),
 FOREIGN KEY(episode_id,workspace_id) REFERENCES local_identity.production_workspaces(episode_id,id),
 FOREIGN KEY(episode_id,preparation_revision_id) REFERENCES local_identity.production_preparation_revisions(episode_id,id),
 FOREIGN KEY(preparation_revision_id,shot_id) REFERENCES local_identity.production_shot_versions(preparation_revision_id,shot_id)
);
CREATE INDEX workspace_caption_input_episode ON local_identity.workspace_caption_inputs(episode_id);
CREATE INDEX workspace_caption_input_preparation ON local_identity.workspace_caption_inputs(preparation_revision_id);
CREATE INDEX workspace_caption_input_source ON local_identity.workspace_caption_inputs(imported_from_draft_id);
ALTER TABLE local_identity.workspace_caption_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_caption_input_owner ON local_identity.workspace_caption_inputs FOR SELECT TO loop_app
 USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id
  WHERE e.id=episode_id AND m.user_id=(SELECT local_identity.owner_id()) AND m.role='owner'));
REVOKE ALL ON local_identity.workspace_caption_inputs FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT ON local_identity.workspace_caption_inputs TO loop_app;

-- Import only proven workspace/preparation coordinates; leave every original draft untouched.
WITH caption_sources AS (
 SELECT id workspace_id,episode_id,preparation_revision_id FROM local_identity.production_workspaces
 UNION SELECT workspace_id,episode_id,preparation_revision_id FROM local_identity.production_workspace_versions
)
INSERT INTO local_identity.workspace_caption_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,contract,imported_from_draft_id,imported_from_package_id,created_at,updated_at)
 SELECT r.workspace_id,r.episode_id,p.id,d.shot_id,d.caption_contract,d.id,d.review_package_id,d.created_at,d.updated_at
 FROM caption_sources r JOIN local_identity.production_preparation_revisions p ON p.id=r.preparation_revision_id AND p.episode_id=r.episode_id AND p.source_format='storyboard/v1'
 JOIN public.shot_preparation_drafts d ON d.episode_id=r.episode_id AND d.review_package_id=p.source_reference_id
 JOIN local_identity.production_shot_versions s ON s.preparation_revision_id=p.id AND s.episode_id=r.episode_id AND s.shot_id=d.shot_id;

CREATE FUNCTION local_identity.lock_current_caption_workspace(p_workspace uuid) RETURNS local_identity.production_workspaces
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
END $$;
REVOKE ALL ON FUNCTION local_identity.lock_current_caption_workspace(uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;

CREATE FUNCTION local_identity.sync_workspace_caption_inputs(p_workspace uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces; p local_identity.production_preparation_revisions;
BEGIN
 w:=local_identity.lock_current_caption_workspace(p_workspace);
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
END $$;
REVOKE ALL ON FUNCTION local_identity.sync_workspace_caption_inputs(uuid) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.sync_workspace_caption_inputs(uuid) TO loop_app;

CREATE FUNCTION local_identity.save_production_caption_input(p_workspace uuid,p_clip uuid,p_contract jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces; b jsonb; voice public.shot_preparation_drafts;
BEGIN
 w:=local_identity.lock_current_caption_workspace(p_workspace);
 SELECT value INTO b FROM jsonb_array_elements(w.bindings) WHERE value->>'id'=p_clip::text;
 IF b IS NULL OR NOT coalesce(public.is_valid_shot_caption_contract(p_contract),false) THEN RAISE EXCEPTION 'Workspace caption input invalid' USING ERRCODE='22023';END IF;
 -- Narration storage migrates next. Reading that voice input does not mutate its old caption fields.
 IF p_contract->>'content_mode'='follow_tts' THEN
  SELECT * INTO voice FROM public.shot_preparation_drafts WHERE episode_id=w.episode_id AND review_package_id=w.storyboard_package_id AND shot_id=b->>'shotId';
  IF voice.audio_mode IS DISTINCT FROM 'tts' OR p_contract->>'text' IS DISTINCT FROM voice.tts_text THEN RAISE EXCEPTION 'Captions must follow current narration text' USING ERRCODE='40001';END IF;
 END IF;
 INSERT INTO local_identity.workspace_caption_inputs(workspace_id,episode_id,preparation_revision_id,shot_id,contract)
  VALUES(w.id,w.episode_id,w.preparation_revision_id,b->>'shotId',p_contract)
  ON CONFLICT(workspace_id,preparation_revision_id,shot_id) DO UPDATE SET contract=excluded.contract,updated_at=clock_timestamp()
   WHERE workspace_caption_inputs.contract IS DISTINCT FROM excluded.contract;
END $$;
REVOKE ALL ON FUNCTION local_identity.save_production_caption_input(uuid,uuid,jsonb) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.save_production_caption_input(uuid,uuid,jsonb) TO loop_app;

CREATE FUNCTION local_identity.request_production_caption_alignment(p_workspace uuid,p_clip uuid,p_audio uuid,p_text text,p_local_only boolean DEFAULT false) RETURNS public.tasks
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w local_identity.production_workspaces; b jsonb; input local_identity.workspace_caption_inputs; track public.audio_tracks;
 created_task public.tasks; text_fingerprint text; input_version text; task_id uuid:=extensions.gen_random_uuid(); directory text;
BEGIN
 w:=local_identity.lock_current_caption_workspace(p_workspace);
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
END $$;
REVOKE ALL ON FUNCTION local_identity.request_production_caption_alignment(uuid,uuid,uuid,text,boolean) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.request_production_caption_alignment(uuid,uuid,uuid,text,boolean) TO loop_app;

-- Canonical pointers are authoritative. The old formatting adapter installs its child explicitly.
CREATE OR REPLACE FUNCTION local_identity.sync_production_workspace_shots(p_workspace uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces; p local_identity.production_preparation_revisions; shot record; position integer;
BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned workspace required' USING ERRCODE='42501';END IF;
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 SELECT * INTO p FROM local_identity.production_preparation_revisions WHERE id=coalesce(w.preparation_revision_id,w.storyboard_package_id) AND episode_id=w.episode_id AND script_revision_id=w.script_revision_id;
 IF p.id IS NULL OR NOT local_identity.preparation_source_current(p.id) OR NOT EXISTS(SELECT 1 FROM public.episodes e WHERE e.id=w.episode_id AND e.main_script_revision_id=w.script_revision_id AND e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_historical_episode(e.id)) THEN
  RAISE EXCEPTION 'Imported current preparation required before editing' USING ERRCODE='40001';
 END IF;
 UPDATE local_identity.production_workspaces SET preparation_revision_id=p.id WHERE id=w.id AND preparation_revision_id IS DISTINCT FROM p.id;
 SELECT coalesce(max(v.position),0) INTO position FROM local_identity.production_shot_versions v WHERE v.preparation_revision_id=p.id;
 FOR shot IN SELECT b->>'shotId' id FROM jsonb_array_elements(w.bindings) WITH ORDINALITY a(b,ordinal) GROUP BY b->>'shotId' ORDER BY min(ordinal) LOOP
  IF shot.id IS NULL OR btrim(shot.id)='' THEN RAISE EXCEPTION 'Stable shot identity required' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT 1 FROM local_identity.production_shot_versions v WHERE v.preparation_revision_id=p.id AND v.shot_id=shot.id) THEN
   position:=position+1;
   INSERT INTO local_identity.production_shots(episode_id,shot_id) VALUES(w.episode_id,shot.id) ON CONFLICT DO NOTHING;
   INSERT INTO local_identity.production_shot_versions(preparation_revision_id,episode_id,shot_id,position,origin,baseline_text,snapshot) VALUES(p.id,w.episode_id,shot.id,position,'local','',jsonb_build_object('id',shot.id));
  END IF;
 END LOOP;
END $function$
;

CREATE OR REPLACE FUNCTION local_identity.resume_workspace_formatting_revision(p_workspace uuid, p_revision bigint, p_script uuid, p_project_sha text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces;e public.episodes;old public.review_packages;next_package uuid:=extensions.gen_random_uuid();next_revision integer;BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned workspace required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id FOR UPDATE;
 IF e.archived_at IS NOT NULL OR local_identity.is_historical_episode(e.id) OR e.stage<>'waiting_input' OR e.main_script_revision_id IS DISTINCT FROM p_script OR w.script_revision_id=p_script OR w.revision<>p_revision OR w.project_sha256<>p_project_sha THEN RAISE EXCEPTION 'Current pending script and workspace required' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=e.id AND status IN ('ready','running')) THEN RAISE EXCEPTION 'Finish current tasks before resuming editing';END IF;
 SELECT * INTO old FROM public.review_packages WHERE id=w.storyboard_package_id AND episode_id=e.id AND stage='storyboard_review';
 IF NOT FOUND OR w.preparation_revision_id IS DISTINCT FROM old.id OR NOT EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id=p_script AND episode_id=e.id AND is_main_script) THEN RAISE EXCEPTION 'Verified source preparation required';END IF;
 SELECT coalesce(max(revision_number),0)+1 INTO next_revision FROM public.review_packages WHERE episode_id=e.id AND stage='storyboard_review';
 INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,context_snapshot) VALUES(next_package,e.id,'storyboard_review',next_revision,old.artifact_id,old.context_snapshot||jsonb_build_object('workspace_preparation',jsonb_build_object('scriptRevisionId',p_script,'script_revision_id',p_script,'origin','legacy-board','sourceReviewPackageId',old.id,'formattingOnly',true),'continued_project',jsonb_build_object('workspaceId',w.id,'sha256',w.project_sha256,'previousScriptRevisionId',w.script_revision_id)));
 INSERT INTO local_identity.workspace_preparations(package_id,episode_id,script_revision_id,origin,confirmed_by) VALUES(next_package,e.id,p_script,'legacy-board',local_identity.owner_id());
 UPDATE local_identity.production_workspaces SET script_revision_id=p_script,storyboard_package_id=next_package,revision=revision+1,updated_at=clock_timestamp() WHERE id=w.id;
 PERFORM local_identity.import_preparation_source(e.id,p_script,next_package);
 UPDATE local_identity.production_workspaces SET preparation_revision_id=next_package WHERE id=w.id;
 UPDATE public.episodes SET stage='storyboard_review',updated_at=clock_timestamp() WHERE id=e.id;
 UPDATE local_identity.script_productions SET enabled=false,authorized_at=NULL,last_status='排版修订已确认，沿用原工程；在线制作未授权',updated_at=clock_timestamp() WHERE episode_id=e.id;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,e.id,'workspace_formatting_revision_confirmed',jsonb_build_object('workspace_id',w.id,'source_package_id',old.id,'package_id',next_package,'previous_script_revision_id',w.script_revision_id,'script_revision_id',p_script,'project_sha256',w.project_sha256,'reason','确认脚本排版修订，沿用现有工程继续编辑'),local_identity.owner_id());
END $function$
;

-- Current speech freezes the independent caption input; its historical cache is never rewritten.
CREATE OR REPLACE FUNCTION local_identity.queue_selected_workspace_narration(p_workspace uuid, p_shot text, p_snapshot jsonb, p_retry boolean)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE w local_identity.production_workspaces;n local_identity.workspace_narrations;d public.shot_preparation_drafts;a local_identity.script_productions;e public.episodes;t public.tasks;cfg jsonb;frozen jsonb;amount integer;hash text;caption_text text;BEGIN
 SELECT * INTO w FROM local_identity.production_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND OR NOT local_identity.lock_owned_input_episode(w.episode_id) THEN RAISE EXCEPTION 'Owned speech workspace required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(w.id::text||p_shot,0));
 SELECT * INTO e FROM public.episodes WHERE id=w.episode_id;
 SELECT * INTO a FROM local_identity.workspace_production_authorizations WHERE episode_id=e.id AND enabled AND authorized_at IS NOT NULL AND script_revision_id=w.script_revision_id AND authorization_hash=local_identity.current_workspace_call_hash(w.id);
 SELECT * INTO n FROM local_identity.workspace_narrations WHERE workspace_id=w.id AND shot_id=p_shot;
 SELECT * INTO d FROM public.shot_preparation_drafts WHERE episode_id=e.id AND review_package_id=w.storyboard_package_id AND shot_id=p_shot;
 SELECT contract->>'text' INTO caption_text FROM local_identity.workspace_caption_inputs WHERE workspace_id=w.id AND preparation_revision_id=w.preparation_revision_id AND shot_id=p_shot;
 IF btrim(coalesce(caption_text,''))<>'' THEN d.subtitle_text:=caption_text;END IF;
 IF e.archived_at IS NOT NULL OR e.stage='production_completed' OR e.main_script_revision_id<>w.script_revision_id OR a.authorization_hash IS NULL OR a.authorization_hash IS DISTINCT FROM p_snapshot->>'authorizationHash' OR n.mode<>'tts' OR n.confirmed_fingerprint IS DISTINCT FROM n.input_fingerprint OR n.input_fingerprint IS DISTINCT FROM p_snapshot->>'inputFingerprint' OR n.selection IS DISTINCT FROM p_snapshot->'selection' OR NOT EXISTS(SELECT 1 FROM public.review_packages WHERE id=w.storyboard_package_id AND invalidated_at IS NULL) THEN RAISE EXCEPTION 'Current authorized speech input required';END IF;
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
 
 IF amount IS NULL OR amount<greatest(1,char_length(d.tts_text)) OR amount>100000 THEN RAISE EXCEPTION 'Invalid per-request narration reservation' USING ERRCODE='22023';END IF;
 frozen:=jsonb_build_object('selectionVersion',1,'production_selection',n.selection,'production_context',p_snapshot->'context','workspace_target',p_snapshot->'target','cost_basis',p_snapshot->'costBasis','capability','narration_generation','storyboard_review_package_id',w.storyboard_package_id,'configuration_hash',hash,'native_tts_retry_id',gen_random_uuid(),'credential_ref',cfg->>'credential_ref','executor',cfg->'executor','shot_preparation',jsonb_build_object('draft_id',d.id,'episode_id',e.id,'review_package_id',w.storyboard_package_id,'shot_id',p_shot),'media',jsonb_build_object('adapter','volcengine_tts','narration',jsonb_build_object('text',d.tts_text,'voice',jsonb_build_object('name',d.tts_voice,'language_code',d.tts_language_code,'speaking_rate',d.tts_speaking_rate))),'acoustic_alignment',jsonb_build_object('confirmed_text',d.subtitle_text,'text_fingerprint',encode(extensions.digest(convert_to(d.subtitle_text,'UTF8'),'sha256'),'hex')),'audio_track',jsonb_build_object('kind','narration','cue_id',p_shot,'source_review_package_id',w.storyboard_package_id,'start_seconds',0,'duration_seconds',0.001),'budget',jsonb_build_object('limit_cents',amount,'max_attempts',1),'allowed_tools',jsonb_build_array('read','write'),'input_artifacts',jsonb_build_array(),'output',jsonb_build_object('required_artifact_types',jsonb_build_array('narration_audio'),'content_type','audio/mpeg','relative_path',format('%s/audio/shot-narration-%s-%s.mp3',(SELECT directory_relative_path FROM local_identity.episode_storage_location(e.id)),p_shot,gen_random_uuid()),'review_stage','production_ready'));
 UPDATE local_identity.input_episodes SET narration_enabled=true WHERE episode_id=e.id;
 INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(e.id,'generate_narration','ready',frozen,amount,1,'volcengine_tts','seed-tts-2.0','production-request-v1') RETURNING * INTO t;
 INSERT INTO local_identity.workspace_narration_requests(task_id,workspace_id,episode_id,clip_id,shot_id,input_fingerprint,authorization_hash,request_snapshot) VALUES(t.id,w.id,e.id,n.clip_id,p_shot,hash,a.authorization_hash,p_snapshot);
 RETURN t;
END $function$
;

-- Extend only the original protected purge, before any referenced historical drafts.
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
DELETE FROM local_identity.production_shot_versions WHERE episode_id=p_episode_id;
DELETE FROM local_identity.production_preparation_revisions WHERE episode_id=p_episode_id;
DELETE FROM local_identity.production_shots WHERE episode_id=p_episode_id;


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
