-- A preparation is an actual immutable input, never a fabricated legacy approval.
CREATE TABLE local_identity.workspace_preparations(
 package_id uuid PRIMARY KEY REFERENCES public.review_packages(id),episode_id uuid NOT NULL REFERENCES public.episodes(id),
 script_revision_id uuid NOT NULL REFERENCES public.production_material_revisions(id),origin text NOT NULL CHECK(origin IN ('script-segment','legacy-board','planner')),
 confirmed_by uuid NOT NULL REFERENCES local_identity.owners(id),confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE local_identity.workspace_shot_inputs(
 workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),preparation_id uuid NOT NULL REFERENCES public.review_packages(id),shot_id text NOT NULL,
 origin text NOT NULL CHECK(origin IN ('script-segment','legacy-board','local-added','planner')),baseline_text text NOT NULL,
 shot_type text CHECK(shot_type IN ('a_roll','b_roll')),snapshot jsonb NOT NULL,PRIMARY KEY(workspace_id,preparation_id,shot_id)
);
ALTER TABLE local_identity.workspace_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.workspace_shot_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY preparation_owner ON local_identity.workspace_preparations TO loop_app USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
CREATE POLICY shot_input_owner ON local_identity.workspace_shot_inputs TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id)) WITH CHECK(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id));
REVOKE ALL ON local_identity.workspace_preparations,local_identity.workspace_shot_inputs FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT ON local_identity.workspace_preparations TO loop_app;
GRANT SELECT,INSERT,UPDATE ON local_identity.workspace_shot_inputs TO loop_app;
CREATE FUNCTION local_identity.register_workspace_preparation(p_episode uuid,p_script uuid,p_id uuid,p_file jsonb,p_board jsonb,p_origin text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes;a uuid;revision integer;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF e.main_script_revision_id IS DISTINCT FROM p_script OR e.stage NOT IN ('script_approved','storyboard_review','storyboard_approved','production_ready','render_ready','qc_review') OR e.archived_at IS NOT NULL OR p_origin NOT IN ('script-segment','planner') THEN RAISE EXCEPTION 'Current confirmed script required' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_board->'shots')<1 OR p_file->>'relativePath' NOT LIKE 'episodes/'||p_episode::text||'/preparation/%' OR p_file->>'sha256' !~ '^[a-f0-9]{64}$' OR (p_file->>'fileSize')::bigint<1 THEN RAISE EXCEPTION 'Verified preparation required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(max(revision_number),0)+1 INTO revision FROM public.review_packages WHERE episode_id=p_episode AND stage='storyboard_review';
 INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size) VALUES(p_episode,'storyboard',p_file->>'relativePath',p_file->>'sha256',(p_file->>'fileSize')::bigint) RETURNING id INTO a;
 INSERT INTO public.review_packages(id,episode_id,artifact_id,stage,revision_number,context_snapshot) VALUES(p_id,p_episode,a,'storyboard_review',revision,jsonb_build_object('worker_result',jsonb_build_object('storyboard',p_board),'workspace_preparation',jsonb_build_object('script_revision_id',p_script,'origin',p_origin)));
 INSERT INTO local_identity.workspace_preparations(package_id,episode_id,script_revision_id,origin,confirmed_by) VALUES(p_id,p_episode,p_script,p_origin,local_identity.owner_id());
 UPDATE local_identity.input_episodes SET enabled=true,storyboard_enabled=true WHERE episode_id=p_episode;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(e.account_id,p_episode,'workspace_preparation_confirmed',jsonb_build_object('package_id',p_id,'script_revision_id',p_script,'sha256',p_file->>'sha256','origin',p_origin),local_identity.owner_id());
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION local_identity.register_workspace_preparation(uuid,uuid,uuid,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.register_workspace_preparation(uuid,uuid,uuid,jsonb,jsonb,text) TO loop_app;
-- This permits input tools; external submission still requires exact current authorization.
CREATE FUNCTION local_identity.workspace_shot_context(p_episode uuid,p_review uuid,p_shot text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s.snapshot||jsonb_strip_nulls(jsonb_build_object('id',s.shot_id,'scriptSegment',CASE WHEN s.origin='local-added' THEN coalesce((SELECT d.tts_text FROM public.shot_preparation_drafts d WHERE d.episode_id=e.id AND d.review_package_id=p.id AND d.shot_id=s.shot_id),(SELECT b->>'text' FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=s.shot_id LIMIT 1),'') ELSE s.baseline_text END,'shotType',s.shot_type))
 FROM local_identity.workspace_shot_inputs s JOIN local_identity.production_workspaces w ON w.id=s.workspace_id JOIN public.episodes e ON e.id=w.episode_id JOIN public.review_packages p ON p.id=w.storyboard_package_id
 WHERE s.preparation_id=w.storyboard_package_id AND w.episode_id=p_episode AND w.storyboard_package_id=p_review AND s.shot_id=p_shot AND e.main_script_revision_id=w.script_revision_id AND p.invalidated_at IS NULL AND e.archived_at IS NULL AND e.stage<>'production_completed'
 AND EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.bindings) b WHERE b->>'shotId'=p_shot)
 AND (EXISTS(SELECT 1 FROM local_identity.workspace_preparations b WHERE b.package_id=p.id AND b.script_revision_id=w.script_revision_id) OR EXISTS(SELECT 1 FROM public.approvals a WHERE a.review_package_id=p.id AND a.stage='storyboard_approved' AND a.decision='approved'))
$$;
REVOKE ALL ON FUNCTION local_identity.workspace_shot_context(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.workspace_shot_context(uuid,uuid,text) TO loop_app,loop_owner;
-- Extend input eligibility once, while retaining legacy ownership, invalidation,
-- connection, budgeting and immutable task construction in their original bodies.
DO $adapt$
DECLARE sig text; definition text; changed text; context_call text:='local_identity.workspace_shot_context(p_episode_id,p_review_package_id,p_shot_id)'; old_join text:='join public.approvals approval on approval.review_package_id = package.id and approval.stage = ''storyboard_approved'' and approval.decision = ''approved''';
BEGIN
 FOREACH sig IN ARRAY ARRAY[
 'public.save_shot_preparation_draft(uuid,uuid,text,text,text,boolean,text,text,numeric)',
 'public.assert_current_storyboard_shot(uuid,uuid,text)',
 'public.save_shot_tts_override(uuid,uuid,text,text,numeric)',
 'public.save_shot_caption_contract(uuid,uuid,text,jsonb)',
 'public.save_shot_manual_alignment(uuid,uuid,text,jsonb)',
 'local_identity.generate_input_shot_tts(uuid,uuid,text,boolean)',
 'local_identity.confirm_caption_text(uuid,uuid,text,uuid,text,text,text)'
 ] LOOP
  definition:=pg_get_functiondef(sig::regprocedure);changed:=definition;
  changed:=replace(changed,'current_episode.stage not in (',context_call||' IS NULL and current_episode.stage not in (');
  changed:=replace(changed,'current_episode.stage <> ''storyboard_approved''',context_call||' IS NULL and current_episode.stage <> ''storyboard_approved''');
  changed:=replace(changed,old_join,'join lateral (select 1 where '||context_call||' IS NOT NULL OR EXISTS(select 1 from public.approvals approval where approval.review_package_id=package.id and approval.stage=''storyboard_approved'' and approval.decision=''approved'')) approval on true');
  changed:=replace(changed,'coalesce(selected_package.context_snapshot #> ''{worker_result,storyboard,shots}'', ''[]''::jsonb)','CASE WHEN '||context_call||' IS NOT NULL THEN jsonb_build_array('||context_call||') ELSE coalesce(selected_package.context_snapshot #> ''{worker_result,storyboard,shots}'', ''[]''::jsonb) END');
  changed:=replace(changed,'e.stage IN (''storyboard_approved'',''production_ready'',''render_ready'',''qc_review'')','(e.stage IN (''storyboard_approved'',''production_ready'',''render_ready'',''qc_review'') OR '||context_call||' IS NOT NULL)');
  IF changed<>definition THEN EXECUTE changed; END IF;
 END LOOP;
END $adapt$;
-- The private T09 Provider clones were made in 091; never rename or alter their
-- legacy originals before 091 installs. They now accept the same real shot input.
DO $visual$
DECLARE sig text;definition text;changed text;
BEGIN
 FOREACH sig IN ARRAY ARRAY['local_identity.request_workspace_official_visual(uuid,uuid,text,uuid,text,integer,uuid,integer)','local_identity.request_workspace_wan_visual(uuid,uuid,text,uuid,text,integer,uuid)'] LOOP
  definition:=pg_get_functiondef(sig::regprocedure);changed:=definition;
  changed:=replace(changed,$old$if not found or not exists(select 1 from public.approvals where review_package_id=rp.id and stage='storyboard_approved' and decision='approved') then$old$, $new$if not found or (local_identity.workspace_shot_context(p_episode_id,p_review_package_id,p_shot_id) IS NULL and not exists(select 1 from public.approvals where review_package_id=rp.id and stage='storyboard_approved' and decision='approved')) then$new$);
  changed:=replace(changed,'select value into s from jsonb_array_elements(rp.context_snapshot#>''{worker_result,storyboard,shots}'') where value->>''id''=p_shot_id;', 'select coalesce(local_identity.workspace_shot_context(p_episode_id,p_review_package_id,p_shot_id),value) into s from jsonb_array_elements(coalesce(rp.context_snapshot#>''{worker_result,storyboard,shots}'',''[]''::jsonb)) where value->>''id''=p_shot_id; s:=coalesce(s,local_identity.workspace_shot_context(p_episode_id,p_review_package_id,p_shot_id));');
  EXECUTE changed;
 END LOOP;
END $visual$;
-- Ordinary scripts keep the selected real planning Adapter/Harness. The task is
-- explicitly requested from preparation; it is not an approval or an auto-plan.
CREATE FUNCTION local_identity.queue_workspace_planning(p_episode uuid,p_script uuid,p_retry uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes;cfg jsonb;h public.prompt_versions;script public.production_material_revisions;t public.tasks;inputs jsonb;snapshot jsonb;budget integer;path text;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF e.main_script_revision_id IS DISTINCT FROM p_script OR e.archived_at IS NOT NULL OR e.stage NOT IN ('script_approved','storyboard_draft','storyboard_review') THEN RAISE EXCEPTION 'Current script preparation required'; END IF;
 SELECT * INTO t FROM public.tasks WHERE episode_id=p_episode AND task_type='draft_storyboard' AND input_snapshot#>>'{workspace_preparation,scriptRevisionId}'=p_script::text AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1;
 IF p_retry IS NOT NULL AND (t.id IS DISTINCT FROM p_retry OR t.status NOT IN ('failed','blocked')) THEN RAISE EXCEPTION 'Current failed planning task required' USING ERRCODE='40001'; END IF;
 IF FOUND AND p_retry IS NULL THEN RETURN t.id; END IF;
 SELECT policy INTO cfg FROM public.account_blueprint_versions WHERE id=e.blueprint_version_id;
 SELECT * INTO h FROM public.prompt_versions WHERE id=(cfg#>>'{executors,storyboard_planning,harness_id}')::uuid AND account_id=e.account_id AND capability='storyboard_planning' AND is_active;
 IF NOT FOUND OR btrim(h.instructions)='' OR cfg#>>'{executors,storyboard_planning,adapter}' IS DISTINCT FROM 'codex' OR coalesce(cfg#>>'{executors,storyboard_planning,model}','')='' OR jsonb_typeof(cfg->'allowed_tools') IS DISTINCT FROM 'array' OR coalesce(cfg#>>'{budgets,storyboard_planning_cents}','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Select the registered planning Harness, model, budget and tools'; END IF;
 SELECT * INTO script FROM public.production_material_revisions WHERE id=p_script AND episode_id=e.id;
 inputs:=jsonb_build_array(jsonb_build_object('artifactType','main_script','relativePath',script.storage_path,'sha256',script.sha256,'fileSize',script.file_size));
 inputs:=inputs||coalesce((SELECT jsonb_agg(jsonb_build_object('artifactType','visual_reference','relativePath',m.storage_path,'sha256',m.sha256,'fileSize',m.file_size)) FROM public.production_material_revisions m WHERE m.episode_id=e.id AND m.material_type IN ('image','video') AND m.material_purpose IN ('visual_reference','a_roll','b_roll')),'[]'::jsonb);
 IF jsonb_array_length(inputs)<2 THEN RAISE EXCEPTION 'Add visual references before running preparation planning' USING ERRCODE='22023'; END IF;
 budget:=(cfg#>>'{budgets,storyboard_planning_cents}')::integer;path:=format('episodes/%s/preparation/planner-%s.json',e.id,extensions.gen_random_uuid());
 snapshot:=jsonb_build_object('capability','storyboard_planning','workspace_preparation',jsonb_build_object('scriptRevisionId',p_script,'origin','planner','retryOf',p_retry),'script_revision',jsonb_build_object('id',script.id,'storage_path',script.storage_path,'sha256',script.sha256,'file_size',script.file_size),'harness',jsonb_build_object('id',h.id,'version',h.version,'content',h.instructions,'content_hash',h.content_hash,'adapter','codex','model',cfg#>>'{executors,storyboard_planning,model}','prompt_version',h.slug),'executor',jsonb_build_object('provider','codex','adapter','codex','model',cfg#>>'{executors,storyboard_planning,model}','prompt_version',h.slug),'budget',jsonb_build_object('limit_cents',budget,'max_attempts',2),'allowed_tools',cfg->'allowed_tools','output',jsonb_build_object('required_artifact_types',jsonb_build_array('storyboard'),'content_type','application/json','relative_path',path,'review_stage','storyboard_review'),'input_artifacts',inputs);
 snapshot:=snapshot||jsonb_build_object('prompt_context',public.build_prompt_context(e.id,snapshot));
 INSERT INTO public.tasks(episode_id,task_type,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(e.id,'draft_storyboard',snapshot,budget,2,'codex',cfg#>>'{executors,storyboard_planning,model}',h.slug) RETURNING * INTO t;
 UPDATE local_identity.input_episodes SET enabled=true,storyboard_enabled=true WHERE episode_id=e.id;
 UPDATE public.episodes SET stage='storyboard_draft',updated_at=clock_timestamp() WHERE id=e.id;
 INSERT INTO public.state_transitions(episode_id,from_stage,to_stage,reason,actor_id) VALUES(e.id,e.stage,'storyboard_draft','Owner requested preparation planning.',local_identity.owner_id());RETURN t.id;
END $$;
CREATE FUNCTION local_identity.confirm_workspace_plan(p_episode uuid,p_script uuid,p_package uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) OR NOT EXISTS(SELECT 1 FROM public.review_packages p JOIN public.tasks t ON t.id=p.task_id JOIN public.episodes e ON e.id=p.episode_id WHERE p.id=p_package AND e.id=p_episode AND p.invalidated_at IS NULL AND t.status='completed' AND t.input_snapshot#>>'{workspace_preparation,scriptRevisionId}'=p_script::text AND e.main_script_revision_id=p_script AND e.stage='storyboard_review' AND e.archived_at IS NULL) THEN RAISE EXCEPTION 'Current validated preparation plan required'; END IF;
 INSERT INTO local_identity.workspace_preparations(package_id,episode_id,script_revision_id,origin,confirmed_by) VALUES(p_package,p_episode,p_script,'planner',local_identity.owner_id()) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION local_identity.queue_workspace_planning(uuid,uuid,uuid),local_identity.confirm_workspace_plan(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.queue_workspace_planning(uuid,uuid,uuid),local_identity.confirm_workspace_plan(uuid,uuid,uuid) TO loop_app;
-- A workspace preparation task never inherits a disabled legacy approval gate.
DO $$DECLARE d text;BEGIN d:=pg_get_functiondef('public.auto_advance_disabled_approval_gate()'::regprocedure);d:=replace(d,'begin','begin'||chr(10)||'  IF NEW.input_snapshot ? ''workspace_preparation'' THEN RETURN NEW; END IF;');EXECUTE d;END$$;
CREATE TABLE local_identity.workspace_legacy_recoveries(
 workspace_id uuid PRIMARY KEY REFERENCES local_identity.production_workspaces(id),decision text NOT NULL CHECK(decision IN ('preserve','fresh')),
 relative_path text NOT NULL,sha256 text NOT NULL,file_size bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.workspace_legacy_recoveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY recovery_owner ON local_identity.workspace_legacy_recoveries TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id)) WITH CHECK(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id));
GRANT SELECT,INSERT ON local_identity.workspace_legacy_recoveries TO loop_app;
CREATE FUNCTION local_identity.register_workspace_recovery_source(p_episode uuid,p_source jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid;producer uuid;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) OR NOT EXISTS(SELECT 1 FROM public.tasks t CROSS JOIN LATERAL jsonb_array_elements(coalesce(t.input_snapshot->'input_artifacts','[]'::jsonb)) f WHERE t.episode_id=p_episode AND f->>'relativePath'=p_source->>'relativePath' AND f->>'sha256'=p_source->>'sha256' AND f->>'fileSize'=p_source->>'fileSize') THEN RAISE EXCEPTION 'Frozen legacy source required' USING ERRCODE='42501'; END IF;
 SELECT t.id INTO producer FROM public.tasks t CROSS JOIN LATERAL jsonb_array_elements(coalesce(t.input_snapshot->'input_artifacts','[]'::jsonb)) f WHERE t.episode_id=p_episode AND t.status='completed' AND f->>'relativePath'=p_source->>'relativePath' AND f->>'sha256'=p_source->>'sha256' LIMIT 1;
 IF producer IS NULL THEN RAISE EXCEPTION 'Completed frozen legacy source required'; END IF;
 SELECT id INTO result FROM public.artifacts WHERE episode_id=p_episode AND relative_path=p_source->>'relativePath' AND sha256=p_source->>'sha256' AND file_size=(p_source->>'fileSize')::bigint LIMIT 1;
 IF result IS NULL THEN INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id) VALUES(p_episode,'legacy_recovered_media',p_source->>'relativePath',p_source->>'sha256',(p_source->>'fileSize')::bigint,producer) RETURNING id INTO result; END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION local_identity.register_workspace_recovery_source(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.register_workspace_recovery_source(uuid,jsonb) TO loop_app;
-- Late legacy results keep task/artifact accounting, but their old approval and
-- lifecycle triggers cannot mutate an Episode that adopted a native workspace.
DO $fence$
DECLARE sig text;d text;guard text:=' IF EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.episode_id=NEW.episode_id) AND NOT (NEW.input_snapshot ? ''workspace_preparation'' OR EXISTS(SELECT 1 FROM local_identity.workspace_deliveries x WHERE x.task_id=NEW.id)) THEN RETURN NEW; END IF;';
BEGIN
 FOREACH sig IN ARRAY ARRAY['public.register_completed_review_render()','public.auto_advance_disabled_approval_gate()','public.create_visual_review_package()','public.create_storyboard_review_package()','public.create_storyboard_revision_review_package()','public.create_script_review_package()'] LOOP
  d:=pg_get_functiondef(sig::regprocedure);d:=regexp_replace(d,'\mbegin\M','begin'||chr(10)||guard,'i');EXECUTE d;
 END LOOP;
END $fence$;
ALTER FUNCTION public.record_publish_package_verification(uuid,text,bigint) RENAME TO record_publish_package_verification_before_workspace;
REVOKE ALL ON FUNCTION public.record_publish_package_verification_before_workspace(uuid,text,bigint) FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
CREATE FUNCTION public.record_publish_package_verification(p_episode_id uuid,p_sha256 text,p_file_size bigint) RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM local_identity.production_workspaces WHERE episode_id=p_episode_id) THEN RAISE EXCEPTION 'Use exact confirmed workspace delivery for this Episode' USING ERRCODE='22023'; END IF;
 RETURN public.record_publish_package_verification_before_workspace(p_episode_id,p_sha256,p_file_size);
END $$;
GRANT EXECUTE ON FUNCTION public.record_publish_package_verification(uuid,text,bigint) TO loop_owner;

-- A source-only new shot has no TTS draft to borrow; create a disabled independent
-- caption draft rather than an empty required subtitle or invented transcript.
DO $$DECLARE d text;BEGIN d:=pg_get_functiondef('local_identity.use_workspace_source_track(uuid,uuid,text,uuid)'::regprocedure);d:=replace(d,$old$PERFORM public.save_shot_preparation_draft(p_episode,p_review,p_shot,'source','',true,NULL,NULL,NULL);$old$,$new$PERFORM public.save_shot_preparation_draft(p_episode,p_review,p_shot,'source',coalesce(local_identity.workspace_shot_context(p_episode,p_review,p_shot)->>'scriptSegment',''),false,NULL,NULL,NULL);$new$);EXECUTE d;END$$;

-- Episode voice defaults remain available in preparation, with unchanged input
-- validation, override propagation and pending-request invalidation semantics.
DO $$DECLARE d text;BEGIN d:=pg_get_functiondef('public.save_episode_tts_settings(uuid,text,text,numeric)'::regprocedure);d:=replace(d,$old$if current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then$old$,$new$if current_episode.archived_at IS NOT NULL OR current_episode.stage='production_completed' OR (current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') AND NOT EXISTS(SELECT 1 FROM local_identity.production_workspaces w JOIN public.review_packages p ON p.id=w.storyboard_package_id WHERE w.episode_id=p_episode_id AND w.script_revision_id=current_episode.main_script_revision_id AND p.invalidated_at IS NULL)) then$new$);EXECUTE d;END$$;
-- Reuse the installed alignment task protocol for the native selected track.
-- The draft is request/history input only: an unadopted TTS completion may move
-- its pointer, so native captions never move that pointer or rely on its result.
DO $caption_queue$
DECLARE definition text; cut integer; finish integer;
BEGIN
 definition:=pg_get_functiondef('public.request_shot_acoustic_alignment(uuid,uuid,text,boolean)'::regprocedure);
 definition:=replace(definition,'public.request_shot_acoustic_alignment(', 'local_identity.request_workspace_caption_alignment(');
 definition:=replace(definition,'p_local_only boolean DEFAULT false)', 'p_local_only boolean DEFAULT false, p_native_audio uuid DEFAULT NULL, p_native_text text DEFAULT NULL, p_workspace uuid DEFAULT NULL)');
 definition:=replace(definition,E'begin\n',E'begin\n IF NOT EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=p_workspace AND w.episode_id=p_episode_id AND w.storyboard_package_id=p_review_package_id AND local_identity.workspace_shot_context(p_episode_id,p_review_package_id,p_shot_id) IS NOT NULL) OR p_native_text IS NULL OR btrim(p_native_text)=\'\' THEN RAISE EXCEPTION \'Current native caption input required\' USING ERRCODE=\'42501\'; END IF;\n');
 definition:=replace(definition,'where id=draft.current_audio_track_id and episode_id=p_episode_id','where id=p_native_audio and episode_id=p_episode_id');
 definition:=replace(definition,'text_fingerprint :=', 'draft.subtitle_text:=p_native_text; draft.tts_voice:=NULL; draft.tts_speaking_rate:=1; text_fingerprint :=');
 definition:=replace(definition,'''capability'',''acoustic_alignment'',''shot_preparation''','''workspace_caption'',jsonb_build_object(''workspace_id'',p_workspace,''shot_id'',p_shot_id),''capability'',''acoustic_alignment'',''shot_preparation''');
 cut:=strpos(definition,'  update public.shot_preparation_drafts set pending_alignment_task_id=');
 finish:=strpos(definition,'  insert into public.audit_events');
 IF cut=0 OR finish<=cut OR definition NOT LIKE '%p_native_audio uuid%' THEN RAISE EXCEPTION 'Native caption alignment protocol changed'; END IF;
 definition:=substr(definition,1,cut-1)||substr(definition,finish);
 EXECUTE definition;
END $caption_queue$;
REVOKE ALL ON FUNCTION local_identity.request_workspace_caption_alignment(uuid,uuid,text,boolean,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.request_workspace_caption_alignment(uuid,uuid,text,boolean,uuid,text,uuid) TO loop_app;
