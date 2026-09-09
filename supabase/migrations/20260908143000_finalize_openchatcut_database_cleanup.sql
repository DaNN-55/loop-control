-- Finish the database-side OpenChatCut rename after the initial provider switch.
-- Function discovery must be case-insensitive, and replacing a function definition
-- does not remove the original function when its name itself changes.
do $migration$
declare
  function_oid oid;
  definition text;
  updated text;
begin
  for function_oid in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and pg_get_functiondef(p.oid) ilike '%hyperframes%'
  loop
    definition := pg_get_functiondef(function_oid);
    updated := replace(definition, 'hyperframes_card_video', 'openchatcut_card_video');
    updated := replace(updated, 'hyperframes@0.7.109', 'openchatcut@0.2.14');
    updated := replace(updated, 'hyperframes_composition', 'openchatcut_composition');
    updated := replace(updated, 'hyperframes_review_render', 'openchatcut_review_render');
    updated := replace(updated, 'HyperFrames', 'OpenChatCut');
    updated := replace(updated, 'hyperframes', 'openchatcut');
    if updated <> definition then execute updated; end if;
  end loop;
end;
$migration$;

drop function if exists public.current_hyperframes_review_package(uuid, boolean);
