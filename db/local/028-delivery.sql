-- T22 native delivery opt-in; no external platform publishing.
ALTER TABLE local_identity.input_episodes ADD COLUMN delivery_enabled boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION local_identity.input_task_allowed(p_episode_id uuid,p_task_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=p_episode_id AND e.enabled AND (p_task_type='prepare_visual_brief' OR (e.storyboard_enabled AND p_task_type IN ('draft_storyboard','draft_storyboard_revision')) OR (e.narration_enabled AND p_task_type='generate_narration') OR (e.media_enabled AND p_task_type IN ('generate_a_roll','generate_b_roll','generate_soundtrack','extract_embedded_audio')) OR (e.alignment_enabled AND p_task_type='align_shot_captions') OR (e.preview_enabled AND p_task_type='generate_shot_sync_preview') OR (e.studio_enabled AND p_task_type='generate_review_render') OR (e.delivery_enabled AND p_task_type='generate_final_render')))
$$;
CREATE FUNCTION local_identity.owned_delivery_episode(p_episode_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN local_identity.lock_owned_input_episode(p_episode_id) AND EXISTS(SELECT 1 FROM local_identity.input_episodes WHERE episode_id=p_episode_id AND delivery_enabled); END $$;
REVOKE ALL ON FUNCTION local_identity.owned_delivery_episode(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.record_publish_input(p_episode_id uuid, p_artifact_type text, p_relative_path text, p_sha256 text, p_file_size bigint)
 RETURNS artifacts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_episode public.episodes; existing public.artifacts; producer public.tasks; expected_path text;
begin
  if local_identity.actor_role() is distinct from 'service_role' and not local_identity.owned_delivery_episode(p_episode_id) then raise exception 'Only the local publish input registrar may record an input' using errcode='42501'; end if;
  if p_artifact_type not in ('cover','metadata') or p_sha256 !~ '^[0-9a-f]{64}$' or p_file_size < 1 then raise exception 'Publish input is invalid' using errcode='22023'; end if;
  select * into selected_episode from public.episodes where id=p_episode_id for update;
  if not found or selected_episode.stage <> 'qc_passed' then raise exception 'Publish inputs require qc_passed' using errcode='22023'; end if;
  if p_artifact_type = 'cover' then
    if p_relative_path !~ ('^episodes/' || p_episode_id::text || '/publish-input/cover-v1\.(jpg|png|webp)$') then raise exception 'Publish input path is invalid' using errcode='22023'; end if;
  else
    expected_path := 'episodes/' || p_episode_id::text || '/publish-input/metadata-v1.json';
    if p_relative_path <> expected_path then raise exception 'Publish input path is invalid' using errcode='22023'; end if;
  end if;
  select * into existing from public.artifacts where episode_id=p_episode_id and artifact_type=p_artifact_type;
  if found then if existing.relative_path<>p_relative_path or existing.sha256<>p_sha256 or existing.file_size<>p_file_size then raise exception 'Publish input is already fixed' using errcode='22023'; end if; return existing; end if;
  insert into public.tasks (episode_id,task_type,status,input_snapshot) values (p_episode_id,'register_publish_input','completed',jsonb_build_object('artifact_type',p_artifact_type,'relative_path',p_relative_path,'sha256',p_sha256,'file_size',p_file_size)) returning * into producer;
  insert into public.artifacts (episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id) values (p_episode_id,p_artifact_type,p_relative_path,p_sha256,p_file_size,producer.id) returning * into existing;
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) values (selected_episode.account_id,p_episode_id,'publish_input_registered',jsonb_build_object('artifact_type',p_artifact_type,'relative_path',p_relative_path,'sha256',p_sha256),local_identity.owner_id());
  return existing;
end; $function$;

CREATE OR REPLACE FUNCTION public.record_publish_package(p_episode_id uuid, p_relative_path text, p_sha256 text, p_file_size bigint)
 RETURNS artifacts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_episode public.episodes; recorded_artifact public.artifacts; publish_task public.tasks; expected_path text;
begin
  if local_identity.actor_role() is distinct from 'service_role' and not local_identity.owned_delivery_episode(p_episode_id) then raise exception 'Only the local publish-prep worker may record a publish package' using errcode = '42501'; end if;
  select * into current_episode from public.episodes where id = p_episode_id for update;
  if not found then raise exception 'Episode % does not exist', p_episode_id using errcode = 'P0002'; end if;
  if current_episode.stage <> 'qc_passed' then raise exception 'Publish package requires qc_passed' using errcode = '22023'; end if;
  expected_path := 'episodes/' || p_episode_id::text || '/publish-package/manifest.json';
  if p_relative_path <> expected_path or p_sha256 !~ '^[0-9a-f]{64}$' or p_file_size < 0 then raise exception 'Publish package index is invalid' using errcode = '22023'; end if;
  if not exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'final_render') or not exists (select 1 from public.artifacts where episode_id = p_episode_id and artifact_type = 'final_qc_report') then raise exception 'Final render and final QC report are required before a publish package' using errcode = '22023'; end if;
  select * into recorded_artifact from public.artifacts where episode_id = p_episode_id and artifact_type = 'publish_package' and relative_path = p_relative_path;
  if found then if recorded_artifact.sha256 <> p_sha256 or recorded_artifact.file_size <> p_file_size then raise exception 'Publish package is already fixed for this episode' using errcode = '22023'; end if; return recorded_artifact; end if;
  insert into public.tasks (episode_id,task_type,status,input_snapshot) values (p_episode_id,'prepare_publish_package','completed',jsonb_build_object('publish_package',jsonb_build_object('relative_path',p_relative_path,'sha256',p_sha256,'file_size',p_file_size))) returning * into publish_task;
  insert into public.artifacts (episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id) values (p_episode_id,'publish_package',p_relative_path,p_sha256,p_file_size,publish_task.id) returning * into recorded_artifact;
  insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) values (current_episode.account_id,p_episode_id,'publish_package_generated',jsonb_build_object('relative_path',p_relative_path,'sha256',p_sha256,'file_size',p_file_size),local_identity.owner_id()); return recorded_artifact;
end; $function$;

CREATE OR REPLACE FUNCTION public.record_publish_package_verification(p_episode_id uuid, p_sha256 text, p_file_size bigint)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_episode public.episodes; publish_package public.artifacts; verification_task public.tasks;
begin
  if local_identity.actor_role() is distinct from 'service_role' and not local_identity.owned_delivery_episode(p_episode_id) then raise exception 'Only the local publish verification command may record a result' using errcode = '42501'; end if;
  select * into current_episode from public.episodes where id = p_episode_id for update;
  if not found then raise exception 'Episode % does not exist', p_episode_id using errcode = 'P0002'; end if;
  if current_episode.stage = 'production_completed' then
    select * into verification_task from public.tasks
    where episode_id = p_episode_id and task_type = 'verify_publish_package' and status = 'completed'
      and input_snapshot #>> '{publish_package,sha256}' = p_sha256
      and (input_snapshot #>> '{publish_package,file_size}')::bigint = p_file_size
    order by completed_at desc nulls last, created_at desc limit 1;
    if found then return verification_task; end if;
  end if;
  if current_episode.stage <> 'qc_passed' then raise exception 'Publish package verification requires qc_passed' using errcode = '22023'; end if;
  select * into publish_package from public.artifacts where episode_id = p_episode_id and artifact_type = 'publish_package';
  if not found or publish_package.sha256 <> p_sha256 or publish_package.file_size <> p_file_size then raise exception 'Publish package verification does not match the fixed package' using errcode = '22023'; end if;
  insert into public.tasks (episode_id, task_type, status, input_snapshot) values (p_episode_id, 'verify_publish_package', 'completed', jsonb_build_object('publish_package', jsonb_build_object('sha256', p_sha256, 'file_size', p_file_size))) returning * into verification_task;
  update public.episodes set stage = 'production_completed', updated_at = now() where id = p_episode_id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (p_episode_id, 'qc_passed', 'production_completed', 'Publish package validation passed; production completed.', null);
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (current_episode.account_id, p_episode_id, 'publish_package_verified', jsonb_build_object('sha256', p_sha256, 'file_size', p_file_size, 'to_stage', 'production_completed'), local_identity.owner_id());
  return verification_task;
end;
$function$;
CREATE FUNCTION local_identity.queue_owned_final_render(p_episode_id uuid) RETURNS SETOF public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE t public.tasks; prefix text; BEGIN
 IF NOT local_identity.owned_delivery_episode(p_episode_id) THEN RAISE EXCEPTION 'Owned delivery Episode required' USING ERRCODE='42501'; END IF;
 FOR t IN SELECT * FROM public.orchestrate_final_render_tasks(p_episode_id) LOOP
  IF t.status<>'ready' OR t.attempt<>0 OR t.created_at<>transaction_timestamp() THEN RAISE EXCEPTION 'Fresh final task required' USING ERRCODE='42501'; END IF;
  prefix:=format('episodes/%s/final-render/%s',p_episode_id,t.id);
  UPDATE public.tasks SET input_snapshot=jsonb_set(jsonb_set(input_snapshot,'{output,relative_path}',to_jsonb(prefix||'/final-render.mp4')),'{final_render,project_relative_path}',to_jsonb(prefix||'/index.html')) WHERE id=t.id RETURNING * INTO t; RETURN NEXT t;
 END LOOP;
END $$;
CREATE FUNCTION local_identity.input_final_reuse_source(p_task_id uuid,p_attempt integer,p_lease_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE result jsonb; BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' OR NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task_id AND t.task_type='generate_final_render' AND local_identity.input_task_allowed(t.episode_id,t.task_type)) THEN RAISE EXCEPTION 'Managed final Worker required' USING ERRCODE='42501'; END IF;
 result:=public.final_render_reuse_source(p_task_id,p_attempt,p_lease_token); IF result IS NULL THEN RAISE EXCEPTION 'Current approved final source and live attempt required' USING ERRCODE='42501'; END IF; RETURN result;
END $$;
CREATE FUNCTION local_identity.complete_owned_publish(p_episode_id uuid,p_cover jsonb,p_metadata jsonb,p_package jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE a public.artifacts; BEGIN
 IF NOT local_identity.owned_delivery_episode(p_episode_id) THEN RAISE EXCEPTION 'Owned delivery Episode required' USING ERRCODE='42501'; END IF;
 PERFORM public.record_publish_input(p_episode_id,'cover',p_cover->>'relativePath',p_cover->>'sha256',(p_cover->>'fileSize')::bigint);
 PERFORM public.record_publish_input(p_episode_id,'metadata',p_metadata->>'relativePath',p_metadata->>'sha256',(p_metadata->>'fileSize')::bigint);
 a:=public.record_publish_package(p_episode_id,p_package->>'relativePath',p_package->>'sha256',(p_package->>'fileSize')::bigint);
 PERFORM public.record_publish_package_verification(p_episode_id,a.sha256,a.file_size); RETURN to_jsonb(a);
END $$;
CREATE FUNCTION local_identity.lock_owned_episode_deletion(p_episode_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode_id) THEN RETURN false; END IF;
 PERFORM id FROM public.tasks WHERE episode_id=p_episode_id ORDER BY id FOR UPDATE NOWAIT;
 IF NOT EXISTS(SELECT 1 FROM public.episodes WHERE id=p_episode_id AND is_test AND archived_at IS NOT NULL) OR EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode_id AND status='running') OR EXISTS(SELECT 1 FROM public.asset_locks WHERE episode_id=p_episode_id AND expires_at>now()) THEN RAISE EXCEPTION 'Archived test Episode without active work required' USING ERRCODE='55000'; END IF; RETURN true;
END $$;
CREATE FUNCTION local_identity.delete_owned_input_episode(p_episode_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF NOT local_identity.lock_owned_episode_deletion(p_episode_id) THEN RAISE EXCEPTION 'Owned test Episode required' USING ERRCODE='42501'; END IF; RETURN public.delete_episode(p_episode_id,local_identity.owner_id()); END $$;
CREATE FUNCTION local_identity.archive_owned_input_episode(p_episode_id uuid,p_archived boolean) RETURNS public.episodes LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF NOT local_identity.lock_owned_input_episode(p_episode_id) OR p_archived IS NULL THEN RAISE EXCEPTION 'Owned input Episode required' USING ERRCODE='42501'; END IF; RETURN public.set_episode_archived(p_episode_id,p_archived); END $$;
REVOKE ALL ON FUNCTION local_identity.queue_owned_final_render(uuid),local_identity.input_final_reuse_source(uuid,integer,uuid),local_identity.complete_owned_publish(uuid,jsonb,jsonb,jsonb),local_identity.lock_owned_episode_deletion(uuid),local_identity.delete_owned_input_episode(uuid),local_identity.archive_owned_input_episode(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.queue_owned_final_render(uuid),local_identity.complete_owned_publish(uuid,jsonb,jsonb,jsonb),local_identity.lock_owned_episode_deletion(uuid),local_identity.delete_owned_input_episode(uuid),local_identity.archive_owned_input_episode(uuid,boolean),public.create_qc_review_issue(uuid,text,numeric,text,text),public.resolve_qc_review_issue(uuid,text),public.retry_failed_final_render(uuid,text) TO loop_owner;
GRANT EXECUTE ON FUNCTION local_identity.input_final_reuse_source(uuid,integer,uuid) TO loop_worker;
