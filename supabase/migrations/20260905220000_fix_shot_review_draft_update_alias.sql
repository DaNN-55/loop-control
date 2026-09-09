do $$
declare
  definition text;
  patched text;
  old_update_block constant text := 'update public.shot_preparation_drafts draft
  set frozen_at = now(),';
  new_update_block constant text := 'update public.shot_preparation_drafts as target
  set frozen_at = now(),';
  old_where_block constant text := '  where draft.episode_id = p_episode_id
    and draft.review_package_id = p_review_package_id;';
  new_where_block constant text := '  where target.episode_id = p_episode_id
    and target.review_package_id = p_review_package_id;';
  has_old_update boolean;
  has_new_update boolean;
  has_old_where boolean;
  has_new_where boolean;
begin
  select pg_get_functiondef('public.generate_shot_review_video(uuid, uuid, jsonb, boolean, text)'::regprocedure) into definition;
  has_old_update := position(old_update_block in definition) > 0;
  has_new_update := position(new_update_block in definition) > 0;
  has_old_where := position(old_where_block in definition) > 0;
  has_new_where := position(new_where_block in definition) > 0;

  if has_old_update = has_new_update or has_old_where = has_new_where then
    raise exception 'generate_shot_review_video draft update alias patch target has unknown state';
  end if;
  if has_old_update and has_old_where then
    patched := replace(definition, old_update_block, new_update_block);
    patched := replace(patched, old_where_block, new_where_block);
    if position(new_update_block in patched) = 0
      or position(new_where_block in patched) = 0
      or position(old_update_block in patched) > 0
      or position(old_where_block in patched) > 0 then
      raise exception 'generate_shot_review_video draft update alias patch produced an invalid state';
    end if;
    execute patched;
  elsif not has_old_update and not has_old_where and has_new_update and has_new_where then
    null;
  else
    raise exception 'generate_shot_review_video draft update alias patch target has partial state';
  end if;
end;
$$;
