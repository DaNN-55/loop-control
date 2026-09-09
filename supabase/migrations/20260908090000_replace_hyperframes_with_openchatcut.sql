-- Active production work now runs through OpenChatCut. Completed rows remain
-- immutable history; only queued/running work and active blueprint policy are
-- migrated so old production orders can still be audited from their snapshots.
-- Existing active blueprints may reference an older verified connection version;
-- this provider-only rewrite must not revalidate unrelated frozen configuration.
alter table public.account_blueprint_versions
  disable trigger validate_blueprint_external_connections_before_write;

update public.account_blueprint_versions
set policy = replace(
  replace(
    replace(
      replace(policy::text, '"hyperframes_composition"', '"openchatcut_composition"'),
      '"hyperframes_card_video"', '"openchatcut_card_video"'
    ),
    '"hyperframes@0.7.109"', '"openchatcut@0.2.14"'
  ),
  '"hyperframes"', '"openchatcut"'
)::jsonb
where is_active
  and policy::text like '%hyperframes%';

alter table public.account_blueprint_versions
  enable trigger validate_blueprint_external_connections_before_write;

update public.tasks
set provider = 'openchatcut',
    model = 'openchatcut@0.2.14',
    input_snapshot = replace(
      replace(
        replace(
          replace(input_snapshot::text, '"hyperframes_review_render"', '"openchatcut_review_render"'),
          '"hyperframes_card_video"', '"openchatcut_card_video"'
        ),
        '"hyperframes@0.7.109"', '"openchatcut@0.2.14"'
      ),
      '"hyperframes"', '"openchatcut"'
    )::jsonb
where provider = 'hyperframes'
  and status in ('ready', 'running');

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
      and pg_get_functiondef(p.oid) like '%hyperframes%'
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
