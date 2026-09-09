do $$
declare
  definition text;
  patched text;
begin
  update public.shot_preparation_drafts draft
  set input_fingerprint = md5(shot.value::text)
  from public.review_packages package,
    lateral jsonb_array_elements(coalesce(package.context_snapshot #> '{worker_result,storyboard,shots}', '[]'::jsonb)) shot(value)
  where draft.review_package_id = package.id
    and draft.episode_id = package.episode_id
    and draft.shot_id = shot.value ->> 'id'
    and draft.input_fingerprint is null;

  select pg_get_functiondef('public.save_shot_workbench_draft(uuid, uuid, text, uuid, jsonb, text, text, boolean, text, text, numeric)'::regprocedure) into definition;
  if position('set selected_material_revision_id = p_material_revision_id,
      clip_segments = p_clip_segments,' in definition) > 0 then
    patched := replace(
      definition,
      'set selected_material_revision_id = p_material_revision_id,
      clip_segments = p_clip_segments,',
      'set input_fingerprint = md5(selected_shot::text),
      selected_material_revision_id = p_material_revision_id,
      clip_segments = p_clip_segments,'
    );
    execute patched;
  elsif position('set input_fingerprint = md5(selected_shot::text),
      selected_material_revision_id = p_material_revision_id,' in definition) = 0 then
    raise exception 'save_shot_workbench_draft input fingerprint patch target has unknown state';
  end if;
end;
$$;
