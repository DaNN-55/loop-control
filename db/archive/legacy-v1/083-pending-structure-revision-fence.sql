-- Pending structural edits must finish before old inputs can render or claim media work.
CREATE OR REPLACE FUNCTION local_identity.input_task_allowed(p_episode_id uuid,p_task_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM local_identity.input_episodes e WHERE e.episode_id=p_episode_id AND e.enabled AND (p_task_type='draft_storyboard_revision' OR NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.episode_id=p_episode_id AND t.task_type='draft_storyboard_revision' AND t.invalidated_at IS NULL AND t.status IN ('ready','running'))) AND (p_task_type='prepare_visual_brief' OR (e.storyboard_enabled AND p_task_type IN ('draft_storyboard','draft_storyboard_revision')) OR (e.narration_enabled AND p_task_type='generate_narration') OR (e.media_enabled AND p_task_type IN ('generate_a_roll','generate_b_roll','generate_soundtrack','extract_embedded_audio')) OR (e.alignment_enabled AND p_task_type='align_shot_captions') OR (e.preview_enabled AND p_task_type='generate_shot_sync_preview') OR (e.studio_enabled AND p_task_type='generate_review_render') OR (e.delivery_enabled AND p_task_type='generate_final_render')))
$$;

CREATE OR REPLACE FUNCTION public.advance_production_ready_episodes(p_episode_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.episodes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare candidate record; advanced_episode public.episodes;
begin
  for candidate in
    select episode.id, episode.account_id, blueprint.policy as blueprint_policy, package.id as storyboard_review_package_id, package.context_snapshot as storyboard_context
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    join lateral (
      select review_package.* from public.review_packages review_package
      join public.approvals approval on approval.review_package_id = review_package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
      where review_package.episode_id = episode.id and review_package.stage = 'storyboard_review' and review_package.invalidated_at is null
      order by review_package.revision_number desc limit 1
    ) package on true
    where episode.stage = 'storyboard_approved' and (p_episode_id is null or episode.id = p_episode_id)
      and not exists(select 1 from public.tasks revision where revision.episode_id=episode.id and revision.task_type='draft_storyboard_revision' and revision.invalidated_at is null and revision.status in ('ready','running'))
    order by episode.updated_at, episode.id for update of episode skip locked
  loop
    if exists (select 1 from public.shot_preparation_drafts draft where draft.episode_id = candidate.id and draft.review_package_id = candidate.storyboard_review_package_id) then
      if not public.has_current_shot_preparation_snapshot(candidate.id, candidate.storyboard_review_package_id) then continue; end if;
      if not exists (select 1 from public.create_shot_preparation_review_package(candidate.id, candidate.storyboard_review_package_id)) then continue; end if;
      update public.episodes set stage = 'production_ready', updated_at = now() where id = candidate.id returning * into advanced_episode;
      insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'storyboard_approved', 'production_ready', '逐镜头准备片段、音频模式、字幕与警告决定均已确认。', null);
      insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'stage_transition', jsonb_build_object('from_stage', 'storyboard_approved', 'to_stage', 'production_ready', 'reason', '逐镜头确认完成。'), null);
      return next advanced_episode;
    end if;
    if jsonb_typeof(candidate.storyboard_context #> '{worker_result,storyboard,shots}') <> 'array' or jsonb_array_length(candidate.storyboard_context #> '{worker_result,storyboard,shots}') = 0 then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') shot
      where shot ->> 'shotType' not in ('a_roll', 'b_roll') or coalesce(btrim(shot ->> 'id'), '') = '' or not exists (
        select 1 from public.tasks task join public.artifacts artifact on artifact.producer_task_id = task.id and artifact.relative_path = task.input_snapshot #>> '{output,relative_path}' and artifact.artifact_type = any (array(select jsonb_array_elements_text(task.input_snapshot #> '{output,required_artifact_types}')))
        where task.episode_id = candidate.id and task.status = 'completed' and task.input_snapshot ->> 'storyboard_review_package_id' = candidate.storyboard_review_package_id::text and task.input_snapshot #>> '{shot,id}' = shot ->> 'id' and task.task_type = case shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
      )
    ) then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') shot
      where not exists (
        select 1 from public.audio_tracks track where track.episode_id = candidate.id and track.track_kind = 'narration' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = shot ->> 'id'
      )
    ) and exists (
      select 1 from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where material.episode_id = candidate.id and material.material_type = 'video' and material.storage_path ~* '[.](mp4|mov|webm)$'
    ) and not exists (
      select 1 from public.audio_tracks track join public.production_material_revisions material on material.id = track.source_material_revision_id join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where track.episode_id = candidate.id and track.track_kind = 'derived'
    ) then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(candidate.storyboard_context #> '{worker_result,storyboard,shots}') shot
      where not exists (select 1 from public.audio_tracks track where track.episode_id = candidate.id and track.track_kind = 'narration' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = shot ->> 'id')
    ) and not exists (
      select 1 from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id
      where material.episode_id = candidate.id and material.material_type = 'video' and material.storage_path ~* '[.](mp4|mov|webm)$'
    ) then continue; end if;
    if (candidate.blueprint_policy -> 'soundtrack') is not null and jsonb_typeof(candidate.blueprint_policy -> 'soundtrack') <> 'null' and exists (
      select 1 from jsonb_array_elements(coalesce(candidate.storyboard_context #> '{worker_result,storyboard,audioCues}', '[]'::jsonb)) cue
      where cue ->> 'kind' not in ('bgm', 'sfx') or coalesce(btrim(cue ->> 'id'), '') = '' or not exists (
        select 1 from public.audio_tracks track where track.episode_id = candidate.id and track.track_kind = cue ->> 'kind' and track.source_review_package_id = candidate.storyboard_review_package_id and track.cue_id = cue ->> 'id'
      )
    ) then continue; end if;
    update public.episodes set stage = 'production_ready', updated_at = now() where id = candidate.id returning * into advanced_episode;
    insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (candidate.id, 'storyboard_approved', 'production_ready', '所有已启用能力的冻结镜头与音频均已验证完成。', null);
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id) values (candidate.account_id, candidate.id, 'stage_transition', jsonb_build_object('from_stage', 'storyboard_approved', 'to_stage', 'production_ready', 'reason', '所有已启用能力的冻结镜头与音频均已验证完成。'), null);
    return next advanced_episode;
  end loop;
end;
$_$;

CREATE OR REPLACE FUNCTION local_identity.request_shot_revision(p_episode uuid,p_package uuid,p_operation jsonb,p_reason text)
RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.episodes; t public.tasks;
BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned production required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 IF e.archived_at IS NOT NULL OR e.stage NOT IN ('storyboard_approved','production_ready','render_ready','qc_review') THEN RAISE EXCEPTION '当前阶段不能修订分镜。' USING ERRCODE='22023'; END IF;
 PERFORM id FROM public.tasks WHERE episode_id=p_episode FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.tasks WHERE episode_id=p_episode AND status='running') THEN RAISE EXCEPTION '制作任务正在运行，请完成或停止后修订分镜。' USING ERRCODE='22023'; END IF;
 UPDATE public.episodes SET stage='storyboard_approved',updated_at=now() WHERE id=p_episode;
 -- Reuse the canonical operation validator, immutable base and task receipt.
 SELECT * INTO t FROM public.request_shot_structure_revision(p_episode,p_package,p_operation,p_reason);
 UPDATE public.tasks old_task SET invalidated_at=now(),invalidated_reason=p_reason WHERE old_task.episode_id=p_episode AND old_task.invalidated_at IS NULL AND old_task.id<>t.id AND (status IN ('ready','blocked','failed') OR task_type IN ('generate_review_render','generate_final_render','prepare_publish_package','verify_publish_package','register_publish_input'));
 UPDATE public.review_packages SET invalidated_at=now(),invalidated_reason=p_reason WHERE episode_id=p_episode AND invalidated_at IS NULL AND stage IN ('production_ready','qc_review');
 UPDATE local_identity.script_productions SET enabled=false,authorized_at=NULL,last_status='分镜已修订，请重新确认制作计划',updated_at=clock_timestamp() WHERE episode_id=p_episode;
 IF e.stage<>'storyboard_approved' THEN INSERT INTO public.state_transitions(episode_id,from_stage,to_stage,reason,actor_id) VALUES(p_episode,e.stage,'storyboard_approved',p_reason,local_identity.owner_id()); END IF;
 RETURN t;
END $$;
