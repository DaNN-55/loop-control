CREATE TABLE local_identity.production_copy_intents (
 owner_id uuid NOT NULL,
 copy_id uuid NOT NULL,
 source_episode_id uuid NOT NULL,
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,copy_id)
);
CREATE TABLE local_identity.production_copy_sources (
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 artifact_id uuid PRIMARY KEY REFERENCES public.artifacts(id) ON DELETE CASCADE,
 source_episode_id uuid NOT NULL,
 source_artifact_id uuid NOT NULL
);
ALTER TABLE public.audio_tracks ADD COLUMN copied_from_track_id uuid;
ALTER TABLE public.audio_tracks DROP CONSTRAINT audio_tracks_registered_local_source;
ALTER TABLE public.audio_tracks ADD CONSTRAINT audio_tracks_registered_local_source CHECK(
 source_task_id IS NOT NULL OR track_kind='source' AND source_material_revision_id IS NOT NULL AND source_artifact_id IS NOT NULL
 OR copied_from_track_id IS NOT NULL AND source_artifact_id IS NOT NULL
);
CREATE FUNCTION local_identity.verify_copied_audio_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.copied_from_track_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM local_identity.production_copy_sources proof JOIN public.audio_tracks original ON original.id=NEW.copied_from_track_id AND original.episode_id=proof.source_episode_id
  JOIN public.artifacts owned ON owned.id=proof.artifact_id AND owned.episode_id=NEW.episode_id
  WHERE proof.episode_id=NEW.episode_id AND proof.artifact_id=NEW.source_artifact_id AND original.source_artifact_id=proof.source_artifact_id
   AND NEW.source_task_id IS NULL AND owned.producer_task_id IS NULL AND original.sha256=NEW.sha256 AND original.file_size=NEW.file_size AND original.track_kind=NEW.track_kind
   AND owned.relative_path=NEW.relative_path AND owned.sha256=NEW.sha256 AND owned.file_size=NEW.file_size
 ) THEN RAISE EXCEPTION 'Verified independent audio copy required' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION local_identity.verify_copied_audio_source() FROM PUBLIC;
CREATE TRIGGER verify_copied_audio_source BEFORE INSERT OR UPDATE OF copied_from_track_id,episode_id,source_artifact_id,source_task_id,relative_path,sha256,file_size,track_kind ON public.audio_tracks FOR EACH ROW EXECUTE FUNCTION local_identity.verify_copied_audio_source();
ALTER TABLE local_identity.production_copy_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.production_copy_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY production_copy_intent_owner ON local_identity.production_copy_intents TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
CREATE POLICY production_copy_source_owner ON local_identity.production_copy_sources TO loop_app USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
REVOKE ALL ON local_identity.production_copy_intents,local_identity.production_copy_sources FROM PUBLIC,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT,DELETE ON local_identity.production_copy_intents TO loop_app;
GRANT SELECT ON local_identity.production_copy_sources TO loop_app;

-- Host verifies and copies actual bytes first. This private boundary can initialize
-- only a same-account, still-unpublished creation intent; it never edits the original.
CREATE FUNCTION local_identity.initialize_production_copy(p_source uuid,p_target uuid,p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source public.episodes;target public.episodes;entry jsonb;item_data jsonb;old_id uuid;script_id uuid;
BEGIN
 SELECT e.* INTO source FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=p_source AND m.user_id=local_identity.owner_id() AND m.role='owner' AND e.stage='production_completed' FOR SHARE OF e;
 SELECT e.* INTO target FROM public.episodes e JOIN local_identity.episode_creation_intents i ON i.episode_id=e.id AND i.owner_id=local_identity.owner_id() AND i.result IS NULL WHERE e.id=p_target AND e.stage='waiting_input' FOR UPDATE OF e;
 IF source.id IS NULL OR target.id IS NULL OR source.account_id<>target.account_id OR target.id=source.id OR target.blueprint_version_id<>source.blueprint_version_id OR target.series_version_id IS DISTINCT FROM source.series_version_id THEN RAISE EXCEPTION 'Owned completed source and fresh same-baseline target required' USING ERRCODE='42501';END IF;
 FOR entry IN SELECT jsonb_array_elements(p_data->'materials') LOOP
  old_id:=(entry->>'sourceId')::uuid;item_data:=entry->'value';
  IF NOT EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id=old_id AND episode_id=source.id) THEN RAISE EXCEPTION 'Owned copy material required' USING ERRCODE='42501';END IF;
  INSERT INTO public.production_material_revisions SELECT (jsonb_populate_record(NULL::public.production_material_revisions,item_data||jsonb_build_object('episode_id',target.id,'created_by',local_identity.owner_id(),'created_at',clock_timestamp()))).*;
  INSERT INTO local_identity.material_import_origins(material_id,provenance) VALUES((item_data->>'id')::uuid,jsonb_build_object('version','production-copy-source/v1','sourceEpisodeId',source.id,'sourceMaterialId',old_id));
  IF old_id=source.main_script_revision_id OR EXISTS(SELECT 1 FROM public.material_revision_approvals WHERE material_revision_id=old_id) THEN INSERT INTO public.material_revision_approvals(material_revision_id,approved_by) VALUES((item_data->>'id')::uuid,local_identity.owner_id());END IF;
 END LOOP;
 FOR entry IN SELECT jsonb_array_elements(p_data->'artifacts') LOOP
  old_id:=(entry->>'sourceId')::uuid;item_data:=entry->'value';
  IF NOT EXISTS(SELECT 1 FROM public.artifacts WHERE id=old_id AND episode_id=source.id AND sha256=item_data->>'sha256' AND file_size=(item_data->>'file_size')::bigint AND artifact_type IN ('narration_audio','soundtrack_audio','source_audio','shot_source_audio','shot_video','a_roll_video','b_roll_asset','render','shot_clip','generated_video','generated_image','legacy_recovered_media')) THEN RAISE EXCEPTION 'Verified copy source required' USING ERRCODE='42501';END IF;
  INSERT INTO public.artifacts SELECT (jsonb_populate_record(NULL::public.artifacts,item_data||jsonb_build_object('episode_id',target.id,'producer_task_id',NULL,'created_at',clock_timestamp()))).*;
  INSERT INTO local_identity.production_copy_sources VALUES(target.id,(item_data->>'id')::uuid,source.id,old_id);
 END LOOP;
 script_id:=(p_data->>'scriptId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id=script_id AND episode_id=target.id AND is_main_script) THEN RAISE EXCEPTION 'Copied main script required' USING ERRCODE='42501';END IF;
 UPDATE public.episodes SET main_script_revision_id=script_id,stage='production_ready',updated_at=clock_timestamp() WHERE id=target.id;
 UPDATE local_identity.input_episodes SET enabled=true,storyboard_enabled=true,studio_enabled=true,script_template_version=(SELECT script_template_version FROM local_identity.input_episodes WHERE episode_id=source.id) WHERE episode_id=target.id;
 INSERT INTO local_identity.production_preparation_revisions SELECT (jsonb_populate_record(NULL::local_identity.production_preparation_revisions,p_data->'preparation'||jsonb_build_object('episode_id',target.id,'created_by',local_identity.owner_id(),'created_at',clock_timestamp(),'parent_preparation_revision_id',NULL,'invalidated_at',NULL))).*;
 INSERT INTO local_identity.production_shots(episode_id,shot_id) SELECT target.id,value->>'shot_id' FROM jsonb_array_elements(p_data->'shots');
 INSERT INTO local_identity.production_shot_versions SELECT (jsonb_populate_record(NULL::local_identity.production_shot_versions,value||jsonb_build_object('episode_id',target.id))).* FROM jsonb_array_elements(p_data->'shots');
 FOR entry IN SELECT jsonb_array_elements(p_data->'audio') LOOP
  old_id:=(entry->>'sourceId')::uuid;item_data:=entry->'value';
  IF NOT EXISTS(SELECT 1 FROM public.audio_tracks WHERE id=old_id AND episode_id=source.id AND sha256=item_data->>'sha256') THEN RAISE EXCEPTION 'Owned copy audio required' USING ERRCODE='42501';END IF;
  INSERT INTO public.audio_tracks SELECT (jsonb_populate_record(NULL::public.audio_tracks,item_data||jsonb_build_object('episode_id',target.id,'preparation_revision_id',p_data#>>'{preparation,id}','copied_from_track_id',old_id,'source_task_id',NULL,'source_review_package_id',NULL,'created_at',clock_timestamp()))).*;
 END LOOP;
 INSERT INTO local_identity.production_workspaces SELECT (jsonb_populate_record(NULL::local_identity.production_workspaces,p_data->'workspace'||jsonb_build_object('episode_id',target.id,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
 INSERT INTO local_identity.workspace_narration_inputs SELECT (jsonb_populate_record(NULL::local_identity.workspace_narration_inputs,value||jsonb_build_object('episode_id',target.id,'imported_from_draft_id',NULL,'imported_from_package_id',NULL,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).* FROM jsonb_array_elements(p_data->'narrationInputs');
 INSERT INTO local_identity.workspace_caption_inputs SELECT (jsonb_populate_record(NULL::local_identity.workspace_caption_inputs,value||jsonb_build_object('episode_id',target.id,'imported_from_draft_id',NULL,'imported_from_package_id',NULL,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).* FROM jsonb_array_elements(p_data->'captionInputs');
 INSERT INTO local_identity.workspace_candidate_decisions SELECT (jsonb_populate_record(NULL::local_identity.workspace_candidate_decisions,value||jsonb_build_object('created_at',clock_timestamp()))).* FROM jsonb_array_elements(p_data->'decisions');
 INSERT INTO local_identity.workspace_narrations SELECT (jsonb_populate_record(NULL::local_identity.workspace_narrations,value||jsonb_build_object('episode_id',target.id))).* FROM jsonb_array_elements(p_data->'narrations');
 INSERT INTO local_identity.workspace_audio_preparations SELECT (jsonb_populate_record(NULL::local_identity.workspace_audio_preparations,value||jsonb_build_object('episode_id',target.id,'created_at',clock_timestamp()))).* FROM jsonb_array_elements(p_data->'audioPreparations');
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) VALUES(target.account_id,target.id,'completed_production_copied',jsonb_build_object('sourceEpisodeId',source.id,'sourceWorkspaceId',p_data->>'sourceWorkspaceId'),local_identity.owner_id());
END $$;
REVOKE ALL ON FUNCTION local_identity.initialize_production_copy(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.initialize_production_copy(uuid,uuid,jsonb) TO loop_app;

-- Adoption decisions remain immutable after publication of the new production order.
CREATE FUNCTION local_identity.rebase_production_copy_adoptions(p_workspace uuid,p_fingerprints jsonb,p_project_sha text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_project_sha !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_fingerprints)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each_text(p_fingerprints) pair WHERE pair.value !~ '^[a-f0-9]{64}$')
 OR NOT EXISTS(SELECT 1 FROM local_identity.production_workspaces w JOIN local_identity.episode_creation_intents i ON i.episode_id=w.episode_id AND i.owner_id=local_identity.owner_id() AND i.result IS NULL WHERE w.id=p_workspace) THEN RAISE EXCEPTION 'Unpublished owned production copy required' USING ERRCODE='42501';END IF;
 UPDATE local_identity.workspace_candidate_decisions SET input_fingerprint=coalesce(p_fingerprints->>candidate_id::text,input_fingerprint),project_sha256=p_project_sha WHERE workspace_id=p_workspace;
END $$;
REVOKE ALL ON FUNCTION local_identity.rebase_production_copy_adoptions(uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.rebase_production_copy_adoptions(uuid,jsonb,text) TO loop_app;
