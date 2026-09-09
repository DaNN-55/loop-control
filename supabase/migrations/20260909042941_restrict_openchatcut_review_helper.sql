-- The dynamic HyperFrames to OpenChatCut rename creates this helper under a
-- new name, so PostgreSQL applies the default PUBLIC execute privilege again.
-- It is an internal SECURITY DEFINER helper and must only be called by the
-- owner-checked review revision functions that own it.
revoke all on function public.current_openchatcut_review_package(uuid, boolean)
  from public, anon, authenticated;
