-- Internal approvals and annotations belong to their parent episode; an explicit foreign episode always wins.
CREATE OR REPLACE FUNCTION local_identity.history_episode_row_matches(p_table text,p_row jsonb,p_episode text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE
 WHEN p_episode IS NULL THEN false
 WHEN p_row->>'episode_id' IS NOT NULL THEN p_row->>'episode_id'=p_episode
 WHEN p_table='episodes' THEN p_row->>'id'=p_episode
 WHEN p_row->>'task_id' IS NOT NULL THEN EXISTS(SELECT 1 FROM public.tasks WHERE id::text=p_row->>'task_id' AND episode_id=p_episode::uuid)
 WHEN p_row->>'review_package_id' IS NOT NULL THEN EXISTS(SELECT 1 FROM public.review_packages WHERE id::text=p_row->>'review_package_id' AND episode_id=p_episode::uuid)
 WHEN p_row->>'audio_track_id' IS NOT NULL THEN EXISTS(SELECT 1 FROM public.audio_tracks WHERE id::text=p_row->>'audio_track_id' AND episode_id=p_episode::uuid)
 WHEN p_table='material_revision_approvals' THEN EXISTS(SELECT 1 FROM public.production_material_revisions WHERE id::text=p_row->>'material_revision_id' AND episode_id=p_episode::uuid)
 ELSE false END
$$;
