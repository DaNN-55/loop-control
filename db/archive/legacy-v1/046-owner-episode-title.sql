-- Reuse the existing Owner-checked title command for the local workspace table.
GRANT EXECUTE ON FUNCTION public.update_episode_title(uuid,text) TO loop_owner;
