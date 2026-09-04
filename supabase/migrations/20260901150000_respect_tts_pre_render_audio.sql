do $$
declare
  definition text;
  qc_invalidation text := 'update public.review_packages set invalidated_at = now(), invalidated_reason = ''Studio structural revision requested'' where id = selected_qc_package.id;';
begin
  select pg_get_functiondef('public.request_studio_storyboard_revision(uuid, text)'::regprocedure) into definition;
  if definition is null or position(qc_invalidation in definition) = 0 then
    raise exception 'Unable to invalidate the stale pre-render package during Studio structural revision';
  end if;
  execute replace(
    definition,
    qc_invalidation,
    qc_invalidation || ' update public.review_packages set invalidated_at = now(), invalidated_reason = ''Studio structural revision requested'' where id = selected_pre_render_package.id;'
  );
end;
$$;
