alter table public.episodes
  alter column script_source set default 'provided';

revoke execute on function public.commission_script(uuid, text, text) from authenticated;
