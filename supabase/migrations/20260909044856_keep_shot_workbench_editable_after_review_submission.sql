do $$
declare
  definition text;
  patched text;
  old_guard constant text := 'where draft.frozen_at is not null and draft.confirmation_status = ''confirmed''
    and draft.input_fingerprint';
  new_guard constant text := 'where draft.input_fingerprint';
begin
  select pg_get_functiondef('public.has_current_shot_preparation_snapshot(uuid, uuid)'::regprocedure)
    into definition;
  if position(new_guard in definition) > 0 and position(old_guard in definition) = 0 then
    return;
  end if;
  if position(old_guard in definition) = 0 or position(new_guard in definition) > 0 then
    raise exception 'current shot snapshot editable-draft patch has unknown or partial state';
  end if;
  patched := replace(definition, old_guard, new_guard);
  if position(new_guard in patched) = 0 or position(old_guard in patched) > 0 then
    raise exception 'current shot snapshot editable-draft patch produced an invalid state';
  end if;
  execute patched;
end;
$$;

do $$
declare
  signature regprocedure;
  definition text;
  patched text;
  old_guard constant text := 'current_episode.stage <> ''storyboard_approved''';
  new_guard constant text := 'current_episode.stage not in (''storyboard_approved'', ''render_ready'', ''qc_review'')';
begin
  foreach signature in array array[
    'public.save_shot_preparation_draft(uuid, uuid, text, text, text, boolean, text, text, numeric)'::regprocedure,
    'public.save_shot_tts_override(uuid, uuid, text, text, numeric)'::regprocedure,
    'public.save_episode_tts_settings(uuid, text, text, numeric)'::regprocedure,
    'public.generate_shot_tts(uuid, uuid, text, boolean)'::regprocedure,
    'public.generate_confirmed_shot_tts_batch(uuid, uuid)'::regprocedure,
    'public.generate_shot_review_video(uuid, uuid, jsonb, boolean, text)'::regprocedure
  ] loop
    definition := pg_get_functiondef(signature);
    if position(new_guard in definition) > 0 and position(old_guard in definition) = 0 then
      continue;
    end if;
    if position(old_guard in definition) = 0 or position(new_guard in definition) > 0 then
      raise exception '% editable-stage patch has unknown or partial state', signature;
    end if;
    patched := replace(definition, old_guard, new_guard);
    if position(new_guard in patched) = 0 or position(old_guard in patched) > 0 then
      raise exception '% editable-stage patch produced an invalid state', signature;
    end if;
    execute patched;
  end loop;
end;
$$;

do $$
declare
  signature regprocedure;
  definition text;
  patched text;
  old_guard constant text := 'episode.stage = ''storyboard_approved''';
  new_guard constant text := 'episode.stage in (''storyboard_approved'', ''render_ready'', ''qc_review'')';
begin
  foreach signature in array array[
    'public.save_shot_workbench_draft(uuid, uuid, text, uuid, jsonb, text, text, boolean, text, text, numeric)'::regprocedure,
    'public.save_shot_tts_override(uuid, uuid, text, text, numeric)'::regprocedure
  ] loop
    definition := pg_get_functiondef(signature);
    if position(new_guard in definition) > 0 and position(old_guard in definition) = 0 then
      continue;
    end if;
    if position(old_guard in definition) = 0 or position(new_guard in definition) > 0 then
      raise exception '% frozen-draft guard patch has unknown or partial state', signature;
    end if;
    patched := replace(definition, old_guard, new_guard);
    if position(new_guard in patched) = 0 or position(old_guard in patched) > 0 then
      raise exception '% frozen-draft guard patch produced an invalid state', signature;
    end if;
    execute patched;
  end loop;
end;
$$;

do $$
declare
  definition text;
  patched text;
  old_guard constant text := 'current_stage is distinct from ''storyboard_approved''';
  new_guard constant text := 'current_stage not in (''storyboard_approved'', ''render_ready'', ''qc_review'')';
begin
  select pg_get_functiondef('public.protect_frozen_shot_preparation_inputs()'::regprocedure)
    into definition;
  if position(new_guard in definition) > 0 and position(old_guard in definition) = 0 then
    return;
  end if;
  if position(old_guard in definition) = 0 or position(new_guard in definition) > 0 then
    raise exception 'frozen shot trigger editable-stage patch has unknown or partial state';
  end if;
  patched := replace(definition, old_guard, new_guard);
  if position(new_guard in patched) = 0 or position(old_guard in patched) > 0 then
    raise exception 'frozen shot trigger editable-stage patch produced an invalid state';
  end if;
  execute patched;
end;
$$;

do $$
declare
  definition text;
  patched text;
  old_stage_check constant text := '  if not found or current_episode.stage not in (''storyboard_approved'', ''render_ready'', ''qc_review'') then
    raise exception ''Owner shot workbench access is required'' using errcode = ''42501'';
  end if;';
  new_stage_check constant text := old_stage_check || '

  if exists (
    select 1 from public.tasks task
    where task.episode_id = p_episode_id
      and task.task_type = ''generate_review_render''
      and task.status in (''ready'', ''running'')
      and task.invalidated_at is null
  ) then
    raise exception ''A review render is already queued or running for this Episode'' using errcode = ''55000'';
  end if;';
  old_draft_update constant text := '  update public.shot_preparation_drafts as target
  set frozen_at = now(),
      frozen_by = auth.uid(),
      confirmation_status = ''confirmed'',
      confirmation_reason = ''Owner explicitly generated the review video from this snapshot.'',
      confirmed_at = now(),
      confirmed_by = auth.uid(),
      video_status = ''ready'',
      audio_status = ''ready'',
      warning_decision = case when risk_count > 0 then ''accepted'' else ''not_required'' end,
      warning_reason = case when risk_count > 0 then risk_reason else null end,
      warning_accepted_at = case when risk_count > 0 then now() else null end,
      warning_accepted_by = case when risk_count > 0 then auth.uid() else null end,
      updated_at = now()
  where target.episode_id = p_episode_id
    and target.review_package_id = p_review_package_id;

';
  old_transition constant text := 'values (p_episode_id, ''storyboard_approved'', ''production_ready'', ''Owner 明确生成审核视频，冻结整单镜头快照。'', auth.uid());';
  new_transition constant text := 'values (p_episode_id, current_episode.stage, ''production_ready'', ''Owner 明确生成审核视频，冻结整单镜头快照。'', auth.uid());';
begin
  select pg_get_functiondef('public.generate_shot_review_video(uuid, uuid, jsonb, boolean, text)'::regprocedure)
    into definition;
  if position(new_stage_check in definition) > 0
    and position(old_draft_update in definition) = 0
    and position(new_transition in definition) > 0
    and position(old_transition in definition) = 0 then
    return;
  end if;
  if position(old_stage_check in definition) = 0 or position(new_stage_check in definition) > 0
    or position(old_draft_update in definition) = 0
    or position(old_transition in definition) = 0 or position(new_transition in definition) > 0 then
    raise exception 'generate_shot_review_video editable-workbench patch has unknown or partial state';
  end if;
  patched := replace(definition, old_stage_check, new_stage_check);
  patched := replace(patched, old_draft_update, '');
  patched := replace(patched, old_transition, new_transition);
  if position(new_stage_check in patched) = 0 or position(old_draft_update in patched) > 0
    or position(new_transition in patched) = 0 or position(old_transition in patched) > 0 then
    raise exception 'generate_shot_review_video editable-workbench patch produced an invalid state';
  end if;
  execute patched;
end;
$$;
