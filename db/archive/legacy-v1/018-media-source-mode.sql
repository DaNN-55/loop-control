-- T19: retain the original explicit, pre-production source-audio selection.
GRANT EXECUTE ON FUNCTION public.set_episode_audio_source_mode(uuid,text) TO loop_owner;
