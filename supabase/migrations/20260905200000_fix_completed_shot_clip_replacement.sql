do $$
declare
  definition text;
  patched text;
  old_block text := $old$
  update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'A newer shot clip generation was requested.'
  where task.episode_id = p_episode_id and task.task_type = case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
    and task.status in ('ready', 'blocked', 'failed');$old$;
  old_running_block text := $old_running$
  update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'A newer shot clip generation was requested.'
  where task.episode_id = p_episode_id and task.task_type = case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
    and task.status in ('ready', 'running', 'blocked', 'failed');$old_running$;
  new_block text := $new$
  update public.tasks task set status = 'superseded', invalidated_at = now(), invalidated_reason = 'A newer shot clip generation was requested.'
  where task.episode_id = p_episode_id
    and task.task_type = case selected_shot ->> 'shotType' when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end
    and task.input_snapshot ->> 'storyboard_review_package_id' = p_review_package_id::text
    and task.input_snapshot #>> '{shot,id}' = draft.shot_id
    and coalesce(task.input_snapshot ->> 'pre_render_revision', '') = ''
    and task.status <> 'superseded';$new$;
begin
  select pg_get_functiondef('public.generate_shot_clip(uuid,uuid,text,boolean)'::regprocedure) into definition;
  if definition is null then raise exception 'generate_shot_clip is required'; end if;

  if position(new_block in definition) > 0 then return; end if;
  if position(old_block in definition) = 0 and position(old_running_block in definition) = 0 then
    raise exception 'generate_shot_clip replacement update block was neither the old nor new form';
  end if;

  patched := replace(definition, old_block, new_block);
  if patched = definition then patched := replace(definition, old_running_block, new_block); end if;
  if patched = definition then raise exception 'generate_shot_clip replacement update block was not applied'; end if;
  execute patched;
end;
$$;
