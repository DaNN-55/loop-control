CREATE TABLE local_identity.storyboard_planning_defaults (
 owner_id uuid PRIMARY KEY REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 selection jsonb,
 revision integer NOT NULL DEFAULT 0
);

CREATE TABLE local_identity.storyboard_planning_harnesses (
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 version integer NOT NULL,
 slug text NOT NULL,
 name text NOT NULL,
 summary text NOT NULL,
 instructions text NOT NULL,
 content_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,version)
);

ALTER TABLE local_identity.storyboard_planning_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.storyboard_planning_harnesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY storyboard_defaults_owner ON local_identity.storyboard_planning_defaults TO loop_app
 USING (owner_id=local_identity.owner_id()) WITH CHECK (owner_id=local_identity.owner_id());
CREATE POLICY storyboard_harness_owner ON local_identity.storyboard_planning_harnesses TO loop_app
 USING (owner_id=local_identity.owner_id()) WITH CHECK (owner_id=local_identity.owner_id());
GRANT SELECT,INSERT,UPDATE ON local_identity.storyboard_planning_defaults TO loop_app;
GRANT SELECT,INSERT ON local_identity.storyboard_planning_harnesses TO loop_app;

CREATE OR REPLACE FUNCTION local_identity.queue_workspace_planning(p_episode uuid,p_script uuid,p_retry uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes;cfg jsonb;h record;global_selection boolean;script public.production_material_revisions;t public.tasks;inputs jsonb;snapshot jsonb;budget integer;path text;previous_snapshot jsonb;context jsonb;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned input required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF e.main_script_revision_id IS DISTINCT FROM p_script OR e.archived_at IS NOT NULL OR e.stage NOT IN ('script_approved','storyboard_draft','storyboard_review') THEN RAISE EXCEPTION 'Current script preparation required'; END IF;
 SELECT * INTO t FROM public.tasks WHERE episode_id=p_episode AND task_type='draft_storyboard' AND input_snapshot#>>'{workspace_preparation,scriptRevisionId}'=p_script::text AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1;
 IF p_retry IS NOT NULL AND (t.id IS DISTINCT FROM p_retry OR t.status NOT IN ('failed','blocked')) THEN RAISE EXCEPTION 'Current failed planning task required' USING ERRCODE='40001'; END IF;
 IF FOUND AND p_retry IS NULL THEN RETURN t.id; END IF;
 previous_snapshot:=t.input_snapshot;
 path:=format('%s/preparation/planner-%s.json',(SELECT directory_relative_path FROM local_identity.episode_storage_location(e.id)),extensions.gen_random_uuid());
 IF p_retry IS NOT NULL THEN
  -- Copy the original validated executor, Harness content, budget, tools and creative/input evidence.
  snapshot:=jsonb_set(previous_snapshot,'{workspace_preparation,retryOf}',to_jsonb(p_retry));
  snapshot:=jsonb_set(snapshot,'{output,relative_path}',to_jsonb(path));
  budget:=t.budget_limit_cents;
 ELSE
 SELECT selection INTO cfg FROM local_identity.storyboard_planning_defaults WHERE owner_id=local_identity.owner_id();
 global_selection:=cfg IS NOT NULL;
 IF global_selection THEN
  SELECT id,version,instructions,content_hash,slug INTO h FROM local_identity.storyboard_planning_harnesses
   WHERE id=(cfg->>'harnessId')::uuid AND owner_id=local_identity.owner_id();
 ELSE
  SELECT selection INTO cfg FROM local_identity.episode_planning_selections WHERE episode_id=e.id;
  SELECT id,version,instructions,content_hash,slug INTO h FROM public.prompt_versions
   WHERE id=(cfg->>'harnessId')::uuid AND account_id=e.account_id AND capability='storyboard_planning' AND is_active;
 END IF;
 IF NOT FOUND OR btrim(h.instructions)='' OR cfg->>'adapter' IS DISTINCT FROM 'codex' OR coalesce(cfg->>'model','')='' OR jsonb_typeof(cfg->'allowedTools') IS DISTINCT FROM 'array' OR (NOT global_selection AND coalesce(cfg->>'budgetCents','') !~ '^[0-9]+$') THEN RAISE EXCEPTION 'Select the registered planning Harness, model, budget and tools'; END IF;
 SELECT * INTO script FROM public.production_material_revisions WHERE id=p_script AND episode_id=e.id;
 inputs:=jsonb_build_array(jsonb_build_object('artifactType','main_script','relativePath',script.storage_path,'sha256',script.sha256,'fileSize',script.file_size));
 inputs:=inputs||coalesce((SELECT jsonb_agg(jsonb_build_object('artifactType','visual_reference','relativePath',m.storage_path,'sha256',m.sha256,'fileSize',m.file_size)) FROM public.production_material_revisions m WHERE m.episode_id=e.id AND m.material_type IN ('image','video') AND m.material_purpose IN ('visual_reference','a_roll','b_roll')),'[]'::jsonb);
 IF jsonb_array_length(inputs)<2 THEN RAISE EXCEPTION 'Add visual references before running preparation planning' USING ERRCODE='22023'; END IF;
 budget:=CASE WHEN global_selection THEN 0 ELSE (cfg->>'budgetCents')::integer END;path:=format('%s/preparation/planner-%s.json',(SELECT directory_relative_path FROM local_identity.episode_storage_location(e.id)),extensions.gen_random_uuid());
 snapshot:=jsonb_build_object('capability','storyboard_planning','workspace_preparation',jsonb_build_object('scriptRevisionId',p_script,'origin','planner','retryOf',p_retry),'script_revision',jsonb_build_object('id',script.id,'storage_path',script.storage_path,'sha256',script.sha256,'file_size',script.file_size),'harness',jsonb_build_object('id',h.id,'version',h.version,'content',h.instructions,'content_hash',h.content_hash,'adapter','codex','model',cfg->>'model','prompt_version',h.slug),'executor',jsonb_build_object('provider','codex','adapter','codex','model',cfg->>'model','prompt_version',h.slug),'budget',jsonb_build_object('limit_cents',budget,'max_attempts',2),'allowed_tools',cfg->'allowedTools','output',jsonb_build_object('required_artifact_types',jsonb_build_array('storyboard'),'content_type','application/json','relative_path',path,'review_stage','storyboard_review'),'input_artifacts',inputs);
 IF global_selection THEN snapshot:=jsonb_set(snapshot,'{budget,unlimited}','true'::jsonb); END IF;
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
