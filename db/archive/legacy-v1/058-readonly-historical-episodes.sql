CREATE TABLE local_identity.historical_episodes(episode_id uuid PRIMARY KEY);
REVOKE ALL ON local_identity.historical_episodes FROM PUBLIC;
INSERT INTO local_identity.historical_episodes SELECT DISTINCT (row_key->>'id')::uuid FROM local_identity.history_projection_results WHERE table_name='public.episodes' AND(status='inserted' OR status='history-only:23514') ON CONFLICT DO NOTHING;
CREATE FUNCTION local_identity.is_historical_episode(p_id uuid)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM local_identity.historical_episodes WHERE episode_id=p_id)$$;
REVOKE ALL ON FUNCTION local_identity.is_historical_episode(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.is_historical_episode(uuid) TO loop_owner;
ALTER TABLE public.episodes DROP CONSTRAINT episodes_active_stage_check;
ALTER TABLE public.episodes ADD CONSTRAINT episodes_active_stage_check CHECK(stage<>ALL(ARRAY['publish_ready'::public.episode_stage,'publishing_review'::public.episode_stage,'published'::public.episode_stage,'metrics_collecting'::public.episode_stage,'learning_recorded'::public.episode_stage])OR local_identity.is_historical_episode(id));
