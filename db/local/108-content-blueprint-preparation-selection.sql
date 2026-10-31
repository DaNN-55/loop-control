-- Only new/current writes are projected. Existing policy/task/review bytes remain immutable evidence.
CREATE FUNCTION public.creative_account_rules(p_policy jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_policy - ARRAY['asset_root','static_visual','a_roll','b_roll','narration','soundtrack','review','approval_gates','allowed_tools','budgets','executors','capabilities']::text[]
$$;
CREATE FUNCTION public.project_blueprint_creative_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- update_current_blueprint copies an exact old version before repointing its Episodes.
 IF TG_OP='INSERT' AND NEW.is_snapshot AND EXISTS(SELECT 1 FROM public.account_blueprint_versions b WHERE b.account_id=NEW.account_id AND b.policy=NEW.policy) THEN RETURN NEW; END IF;
 NEW.policy:=public.creative_account_rules(NEW.policy);RETURN NEW;
END $$;
CREATE TRIGGER a_blueprint_creative_write BEFORE INSERT OR UPDATE OF policy ON public.account_blueprint_versions FOR EACH ROW EXECUTE FUNCTION public.project_blueprint_creative_write();
-- Preservation snapshots do not require a formerly verified connection to be current now.
DO $$DECLARE d text;BEGIN
 d:=pg_get_functiondef('public.validate_blueprint_external_connections()'::regprocedure);
 d:=replace(d,'begin', 'begin'||chr(10)||' IF TG_OP=''INSERT'' AND NEW.is_snapshot AND EXISTS(SELECT 1 FROM public.account_blueprint_versions b WHERE b.account_id=NEW.account_id AND b.policy=NEW.policy) THEN RETURN NEW; END IF;');
 EXECUTE d;
END $$;

-- Draft planning inputs belong to the owned Episode, before a workspace exists.
CREATE TABLE local_identity.episode_planning_selections(
 episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
 selection jsonb,revision integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.episode_planning_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY planning_selection_owner ON local_identity.episode_planning_selections TO loop_app USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
GRANT SELECT ON local_identity.episode_planning_selections TO loop_app;
-- Historical executors may initialize a draft once. Empty rows prevent later policy fallback.
CREATE FUNCTION local_identity.legacy_planning_prefill(p_policy jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_policy#>>'{executors,storyboard_planning,harness_id}' IS NOT NULL THEN jsonb_build_object('provider','codex','adapter','codex','model',p_policy#>>'{executors,storyboard_planning,model}','harnessId',p_policy#>>'{executors,storyboard_planning,harness_id}','budgetCents',coalesce(p_policy#>'{budgets,storyboard_planning_cents}','0'::jsonb),'allowedTools',coalesce(p_policy->'allowed_tools','["read","write"]'::jsonb)) END
$$;
INSERT INTO local_identity.episode_planning_selections(episode_id,selection) SELECT e.id,local_identity.legacy_planning_prefill(b.policy) FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id;
CREATE FUNCTION local_identity.initialize_planning_selection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 INSERT INTO local_identity.episode_planning_selections(episode_id,selection) SELECT NEW.id,local_identity.legacy_planning_prefill(b.policy) FROM public.account_blueprint_versions b WHERE b.id=NEW.blueprint_version_id;RETURN NEW;
END $$;
CREATE TRIGGER initialize_planning_selection AFTER INSERT ON public.episodes FOR EACH ROW EXECUTE FUNCTION local_identity.initialize_planning_selection();
CREATE FUNCTION local_identity.save_planning_selection(p_episode uuid,p_selection jsonb,p_revision integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes;r local_identity.episode_planning_selections;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF e.archived_at IS NOT NULL OR e.stage='production_completed' OR local_identity.is_historical_episode(e.id) THEN RAISE EXCEPTION 'Read-only Episode' USING ERRCODE='55000';END IF;
 IF jsonb_typeof(p_selection) IS DISTINCT FROM 'object' OR p_selection->>'provider' IS DISTINCT FROM 'codex' OR p_selection->>'adapter' IS DISTINCT FROM 'codex' OR coalesce(p_selection->>'model','') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$' OR coalesce(p_selection->>'harnessId','') !~ '^[a-f0-9-]{36}$' OR jsonb_typeof(p_selection->'budgetCents') IS DISTINCT FROM 'number' OR p_selection->>'budgetCents' !~ '^[0-9]{1,9}$' OR jsonb_typeof(p_selection->'allowedTools') IS DISTINCT FROM 'array' OR NOT p_selection->'allowedTools' <@ '["read","write"]'::jsonb OR jsonb_array_length(p_selection->'allowedTools')<1 OR p_selection-ARRAY['provider','adapter','model','harnessId','budgetCents','allowedTools']::text[]<>'{}'::jsonb THEN RAISE EXCEPTION 'Select planning model, Harness, nonnegative budget and file tools' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.prompt_versions h WHERE h.id=(p_selection->>'harnessId')::uuid AND h.account_id=e.account_id AND h.capability='storyboard_planning' AND h.is_active AND btrim(h.instructions)<>'') THEN RAISE EXCEPTION 'Select this account active planning Harness' USING ERRCODE='22023';END IF;
 UPDATE local_identity.episode_planning_selections SET selection=p_selection,revision=revision+1,updated_at=clock_timestamp() WHERE episode_id=p_episode AND revision=p_revision RETURNING * INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'Planning draft changed' USING ERRCODE='40001';END IF;
 RETURN jsonb_build_object('selection',r.selection,'revision',r.revision);
END $$;
REVOKE ALL ON FUNCTION local_identity.save_planning_selection(uuid,jsonb,integer),local_identity.initialize_planning_selection(),local_identity.legacy_planning_prefill(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.save_planning_selection(uuid,jsonb,integer) TO loop_app;

CREATE OR REPLACE FUNCTION local_identity.queue_workspace_planning(p_episode uuid,p_script uuid,p_retry uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes;cfg jsonb;h public.prompt_versions;script public.production_material_revisions;t public.tasks;inputs jsonb;snapshot jsonb;budget integer;path text;previous_snapshot jsonb;context jsonb;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF e.main_script_revision_id IS DISTINCT FROM p_script OR e.archived_at IS NOT NULL OR e.stage NOT IN ('script_approved','storyboard_draft','storyboard_review') THEN RAISE EXCEPTION 'Current script preparation required'; END IF;
 SELECT * INTO t FROM public.tasks WHERE episode_id=p_episode AND task_type='draft_storyboard' AND input_snapshot#>>'{workspace_preparation,scriptRevisionId}'=p_script::text AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1;
 IF p_retry IS NOT NULL AND (t.id IS DISTINCT FROM p_retry OR t.status NOT IN ('failed','blocked')) THEN RAISE EXCEPTION 'Current failed planning task required' USING ERRCODE='40001'; END IF;
 IF FOUND AND p_retry IS NULL THEN RETURN t.id; END IF;
 previous_snapshot:=t.input_snapshot;
 path:=format('episodes/%s/preparation/planner-%s.json',e.id,extensions.gen_random_uuid());
 IF p_retry IS NOT NULL THEN
  -- Copy the original validated executor, Harness content, budget, tools and creative/input evidence.
  snapshot:=jsonb_set(previous_snapshot,'{workspace_preparation,retryOf}',to_jsonb(p_retry));
  snapshot:=jsonb_set(snapshot,'{output,relative_path}',to_jsonb(path));
  budget:=t.budget_limit_cents;
 ELSE
 SELECT selection INTO cfg FROM local_identity.episode_planning_selections WHERE episode_id=e.id;
 SELECT * INTO h FROM public.prompt_versions WHERE id=(cfg->>'harnessId')::uuid AND account_id=e.account_id AND capability='storyboard_planning' AND is_active;
 IF NOT FOUND OR btrim(h.instructions)='' OR cfg->>'adapter' IS DISTINCT FROM 'codex' OR coalesce(cfg->>'model','')='' OR jsonb_typeof(cfg->'allowedTools') IS DISTINCT FROM 'array' OR coalesce(cfg->>'budgetCents','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Select the registered planning Harness, model, budget and tools'; END IF;
 SELECT * INTO script FROM public.production_material_revisions WHERE id=p_script AND episode_id=e.id;
 inputs:=jsonb_build_array(jsonb_build_object('artifactType','main_script','relativePath',script.storage_path,'sha256',script.sha256,'fileSize',script.file_size));
 inputs:=inputs||coalesce((SELECT jsonb_agg(jsonb_build_object('artifactType','visual_reference','relativePath',m.storage_path,'sha256',m.sha256,'fileSize',m.file_size)) FROM public.production_material_revisions m WHERE m.episode_id=e.id AND m.material_type IN ('image','video') AND m.material_purpose IN ('visual_reference','a_roll','b_roll')),'[]'::jsonb);
 IF jsonb_array_length(inputs)<2 THEN RAISE EXCEPTION 'Add visual references before running preparation planning' USING ERRCODE='22023'; END IF;
 budget:=(cfg->>'budgetCents')::integer;path:=format('episodes/%s/preparation/planner-%s.json',e.id,extensions.gen_random_uuid());
 snapshot:=jsonb_build_object('capability','storyboard_planning','workspace_preparation',jsonb_build_object('scriptRevisionId',p_script,'origin','planner','retryOf',p_retry),'script_revision',jsonb_build_object('id',script.id,'storage_path',script.storage_path,'sha256',script.sha256,'file_size',script.file_size),'harness',jsonb_build_object('id',h.id,'version',h.version,'content',h.instructions,'content_hash',h.content_hash,'adapter','codex','model',cfg->>'model','prompt_version',h.slug),'executor',jsonb_build_object('provider','codex','adapter','codex','model',cfg->>'model','prompt_version',h.slug),'budget',jsonb_build_object('limit_cents',budget,'max_attempts',2),'allowed_tools',cfg->'allowedTools','output',jsonb_build_object('required_artifact_types',jsonb_build_array('storyboard'),'content_type','application/json','relative_path',path,'review_stage','storyboard_review'),'input_artifacts',inputs);
 context:=public.build_prompt_context(e.id,snapshot);
 context:=jsonb_set(context,'{account_hard_constraints}',public.creative_account_rules(context->'account_hard_constraints'));
 context:=jsonb_set(context,'{account_defaults}',(SELECT public.creative_account_rules(policy) FROM public.account_blueprint_versions WHERE id=e.blueprint_version_id));
 context:=(context-'hash')||jsonb_build_object('hash',md5((context-'hash')::text));
 snapshot:=snapshot||jsonb_build_object('prompt_context',context);
 END IF;
 INSERT INTO public.tasks(episode_id,task_type,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES(e.id,'draft_storyboard',snapshot,budget,2,'codex',snapshot#>>'{executor,model}',snapshot#>>'{executor,prompt_version}') RETURNING * INTO t;
 UPDATE local_identity.input_episodes SET enabled=true,storyboard_enabled=true WHERE episode_id=e.id;
 UPDATE public.episodes SET stage='storyboard_draft',updated_at=clock_timestamp() WHERE id=e.id;
 INSERT INTO public.state_transitions(episode_id,from_stage,to_stage,reason,actor_id) VALUES(e.id,e.stage,'storyboard_draft','Owner requested preparation planning.',local_identity.owner_id());RETURN t.id;
END $$;

-- A frozen blueprint ID must always resolve to its original policy/version.
CREATE OR REPLACE FUNCTION public.update_current_blueprint(p_account_id uuid,p_policy jsonb) RETURNS public.account_blueprint_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.accounts;b public.account_blueprint_versions;next_version integer;
BEGIN
 IF jsonb_typeof(p_policy) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Blueprint policy must be a JSON object' USING ERRCODE='22023';END IF;
 SELECT account.* INTO a FROM public.accounts account JOIN public.account_memberships m ON m.account_id=account.id AND m.user_id=local_identity.owner_id() AND m.role='owner' WHERE account.id=p_account_id FOR UPDATE OF account;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner membership is required to update a blueprint' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.account_blueprint_versions WHERE id=a.current_blueprint_version_id AND account_id=a.id AND is_active AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The current blueprint is unavailable' USING ERRCODE='22023';END IF;
 p_policy:=public.creative_account_rules(p_policy);
 IF b.policy IS DISTINCT FROM p_policy AND EXISTS(SELECT 1 FROM public.episodes WHERE blueprint_version_id=b.id) THEN
  SELECT coalesce(max(version),0)+1 INTO next_version FROM public.account_blueprint_versions WHERE account_id=a.id;
  UPDATE public.account_blueprint_versions SET is_active=false,archived_at=now(),is_snapshot=true WHERE id=b.id;
  INSERT INTO public.account_blueprint_versions(account_id,version,policy,is_active) VALUES(a.id,next_version,p_policy,true) RETURNING * INTO b;
  UPDATE public.accounts SET current_blueprint_version_id=b.id WHERE id=a.id;
 ELSIF b.policy IS DISTINCT FROM p_policy THEN
  UPDATE public.account_blueprint_versions SET policy=p_policy WHERE id=b.id RETURNING * INTO b;
 END IF;
 INSERT INTO public.audit_events(account_id,event_type,payload,actor_id) VALUES(a.id,'blueprint_policy_updated',jsonb_build_object('blueprint_version_id',b.id,'version',b.version),local_identity.owner_id());RETURN b;
END $$;

-- Explicit replan uses the saved draft. Retry above always keeps the original snapshot.
CREATE FUNCTION local_identity.replan_workspace_planning(p_episode uuid,p_script uuid,p_previous uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tasks;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM public.tasks WHERE episode_id=p_episode AND task_type='draft_storyboard' AND input_snapshot#>>'{workspace_preparation,scriptRevisionId}'=p_script::text AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR t.id IS DISTINCT FROM p_previous OR t.status NOT IN ('failed','blocked') THEN RAISE EXCEPTION 'Current failed planning task required' USING ERRCODE='40001';END IF;
 UPDATE public.tasks SET invalidated_at=clock_timestamp(),invalidated_reason='Owner explicitly requested planning with the current selection.' WHERE episode_id=p_episode AND task_type='draft_storyboard' AND input_snapshot#>>'{workspace_preparation,scriptRevisionId}'=p_script::text AND invalidated_at IS NULL AND status IN ('failed','blocked');
 RETURN local_identity.queue_workspace_planning(p_episode,p_script,NULL);
END $$;
REVOKE ALL ON FUNCTION local_identity.replan_workspace_planning(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.replan_workspace_planning(uuid,uuid,uuid) TO loop_app;
