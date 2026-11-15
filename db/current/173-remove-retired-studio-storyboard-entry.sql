-- ADR-0053: HTTP already rejects the retired structural planning command.
-- Remove the unused caller before its last rejection shell. Keep all history,
-- current native edits, composition revisions and authorization boundaries.
-- RESTRICT intentionally aborts on an unexpected catalog dependency.
DROP FUNCTION public.request_studio_storyboard_revision(uuid,text);
DROP FUNCTION public.orchestrate_storyboard_tasks_for_episode(uuid);
