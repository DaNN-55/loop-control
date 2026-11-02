-- Owner-readable projection only. Lease tokens and private receipts stay Worker-only.
CREATE FUNCTION local_identity.workspace_publication_holds(p_episode uuid) RETURNS TABLE(task_id uuid,attempt integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT h.task_id,h.attempt FROM local_identity.native_output_publications h
 JOIN public.tasks t ON t.id=h.task_id
 JOIN public.episodes e ON e.id=t.episode_id
 JOIN public.account_memberships m ON m.account_id=e.account_id
 WHERE e.id=p_episode AND m.user_id=local_identity.owner_id() AND m.role='owner';
$$;
REVOKE ALL ON FUNCTION local_identity.workspace_publication_holds(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.workspace_publication_holds(uuid) TO loop_app;
