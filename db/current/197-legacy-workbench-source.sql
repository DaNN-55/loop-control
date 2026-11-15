-- Owner-scoped historical source snapshot. No old execution or table grant is restored.
CREATE FUNCTION local_identity.read_legacy_workbench_source(p_episode uuid,p_lock boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=local_identity.owner_id(); e public.episodes; b public.review_packages;
BEGIN
 IF session_user<>'loop_app' OR actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.episodes x JOIN public.account_memberships m ON m.account_id=x.account_id WHERE x.id=p_episode AND m.user_id=actor AND m.role='owner') THEN
  RAISE EXCEPTION 'Owned legacy source required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO e FROM public.episodes WHERE id=p_episode;
 SELECT * INTO b FROM public.review_packages WHERE episode_id=p_episode AND stage='storyboard_review' AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1;
 IF b.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.shot_preparation_drafts WHERE episode_id=p_episode AND review_package_id=b.id) THEN RETURN NULL;END IF;
 IF p_lock THEN
  IF NOT local_identity.lock_owned_input_episode(p_episode) OR e.archived_at IS NOT NULL OR e.stage='production_completed' OR local_identity.is_historical_episode(p_episode) THEN
   RAISE EXCEPTION 'Active owned input required' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.review_packages WHERE id=b.id FOR SHARE;
  PERFORM 1 FROM public.shot_preparation_drafts WHERE episode_id=p_episode AND review_package_id=b.id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.tasks WHERE episode_id=p_episode ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.production_material_revisions WHERE episode_id=p_episode ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.audio_tracks WHERE episode_id=p_episode ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.artifacts WHERE episode_id=p_episode ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.storyboard_audio_selections WHERE episode_id=p_episode AND review_package_id=b.id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.approvals WHERE episode_id=p_episode AND review_package_id=b.id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.material_revision_approvals a WHERE EXISTS(SELECT 1 FROM public.production_material_revisions m WHERE m.id=a.material_revision_id AND m.episode_id=p_episode) ORDER BY id FOR SHARE;
 END IF;
 RETURN jsonb_build_object(
  'version','legacy-shot-workbench/v1','episodeId',p_episode,'scriptRevisionId',e.main_script_revision_id,
  'board',(SELECT to_jsonb(p) FROM public.review_packages p WHERE p.id=b.id),
  'drafts',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.shot_id) FROM public.shot_preparation_drafts d WHERE d.episode_id=p_episode AND d.review_package_id=b.id),'[]'::jsonb),
  'tasks',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.tasks t WHERE t.episode_id=p_episode),'[]'::jsonb),
  'materials',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.production_material_revisions m WHERE m.episode_id=p_episode),'[]'::jsonb),
  'tracks',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.audio_tracks t WHERE t.episode_id=p_episode),'[]'::jsonb),
  'artifacts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.artifacts a WHERE a.episode_id=p_episode),'[]'::jsonb),
  'script',(SELECT to_jsonb(m) FROM public.production_material_revisions m WHERE m.id=e.main_script_revision_id AND m.episode_id=p_episode),
  'selections',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.storyboard_audio_selections s WHERE s.episode_id=p_episode AND s.review_package_id=b.id),'[]'::jsonb),
  'approvals',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.approvals a WHERE a.episode_id=p_episode AND a.review_package_id=b.id AND a.stage='storyboard_approved' AND a.decision='approved'),'[]'::jsonb),
  'materialApprovals',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.material_revision_approvals a JOIN public.production_material_revisions m ON m.id=a.material_revision_id AND m.episode_id=p_episode),'[]'::jsonb),
  'series',(SELECT to_jsonb(s) FROM public.series_versions s WHERE s.id=e.series_version_id AND s.account_id=e.account_id),
  'plan',(SELECT to_jsonb(p) FROM local_identity.script_productions p WHERE p.episode_id=p_episode AND p.owner_id=actor)
 );
END $$;
REVOKE ALL ON FUNCTION local_identity.read_legacy_workbench_source(uuid,boolean) FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.read_legacy_workbench_source(uuid,boolean) TO loop_app;
