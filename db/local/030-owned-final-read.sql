-- Keep approval rows private; expose only the current managed final task.
CREATE FUNCTION local_identity.current_owned_final_render(p_episode_id uuid,p_review_package_id uuid) RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE t public.tasks; BEGIN
 IF NOT local_identity.owned_delivery_episode(p_episode_id) THEN RAISE EXCEPTION 'Owned delivery Episode required' USING ERRCODE='42501'; END IF;
 SELECT task.* INTO t FROM public.tasks task JOIN public.review_packages p ON p.id=p_review_package_id AND p.episode_id=task.episode_id AND p.stage='qc_review' AND p.invalidated_at IS NULL JOIN public.approvals a ON a.review_package_id=p.id AND a.episode_id=task.episode_id AND a.stage='qc_passed' AND a.decision='approved' JOIN public.episodes e ON e.id=task.episode_id JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=a.actor_id AND m.role='owner' WHERE task.episode_id=p_episode_id AND task.task_type='generate_final_render' AND task.invalidated_at IS NULL AND task.input_snapshot#>>'{final_render,source_review_package_id}'=p.id::text AND NOT EXISTS(SELECT 1 FROM public.review_packages newer WHERE newer.episode_id=p_episode_id AND newer.stage='qc_review' AND newer.invalidated_at IS NULL AND newer.revision_number>p.revision_number) ORDER BY task.created_at DESC LIMIT 1;
 RETURN t;
END $$;
REVOKE ALL ON FUNCTION local_identity.current_owned_final_render(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.current_owned_final_render(uuid,uuid) TO loop_owner;
