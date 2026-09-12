do $$
declare
  definition text;
  patched text;
  source text := $source$)) order by member.member_key), '[]'::jsonb),$source$;
  replacement text := $replacement$))
      || case
        when member.evidence_snapshot -> 'preparation_contract' is null then '{}'::jsonb
        else jsonb_build_object('preparation_contract', member.evidence_snapshot -> 'preparation_contract')
      end
      order by member.member_key), '[]'::jsonb),$replacement$;
begin
  definition := pg_get_functiondef('public.orchestrate_review_render_tasks(uuid)'::regprocedure);
  patched := replace(definition, source, replacement);

  if patched = definition or position(replacement in patched) = 0 then
    raise exception 'orchestrate_review_render_tasks nested preparation contract patch target is unknown';
  end if;

  execute patched;
end;
$$;

comment on function public.orchestrate_review_render_tasks(uuid) is
  'Creates immutable review-render tasks while preserving explicit null fields inside nested shot preparation contracts.';
