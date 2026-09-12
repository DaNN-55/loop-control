begin;
select plan(11);

select ok(public.is_valid_shot_composition(
  '{"version":"shot-composition/v1","layout":"2up-vertical","slots":[{"id":"top","clipSegmentIndex":0,"fit":"cover","focalPoint":{"x":0.5,"y":0}},{"id":"bottom","clipSegmentIndex":0,"fit":"contain","focalPoint":{"x":0.5,"y":1}}]}'::jsonb,
  1
), 'stacked composition accepts the same prepared clip in both stable slots');

select ok(public.is_valid_shot_composition(
  '{"version":"shot-composition/v1","layout":"grid-4","slots":[{"id":"top-left","clipSegmentIndex":0,"fit":"cover","focalPoint":{"x":0.5,"y":0.5}},{"id":"top-right","clipSegmentIndex":1,"fit":"cover","focalPoint":{"x":0.5,"y":0.5}},{"id":"bottom-left","clipSegmentIndex":0,"fit":"contain","focalPoint":{"x":0,"y":1}},{"id":"bottom-right","clipSegmentIndex":1,"fit":"cover","focalPoint":{"x":1,"y":1}}]}'::jsonb,
  2
), 'four-grid composition accepts prepared clip references, fit, and focal points');

select ok(not public.is_valid_shot_composition(
  '{"version":"shot-composition/v1","layout":"2up-vertical","slots":[{"id":"top","clipSegmentIndex":0,"fit":"cover","focalPoint":{"x":0.5,"y":0.5}}]}'::jsonb,
  1
), 'stacked composition rejects a missing bottom slot');

select ok(not public.is_valid_shot_composition(
  '{"version":"shot-composition/v1","layout":"full","slots":[{"id":"full","clipSegmentIndex":1,"fit":"cover","focalPoint":{"x":0.5,"y":0.5}}]}'::jsonb,
  1
), 'composition rejects an unknown prepared clip reference');

select ok(not public.is_valid_shot_composition(
  '{"version":"shot-composition/v1","layout":"full","slots":[{"id":"full","clipSegmentIndex":0,"fit":"stretch","focalPoint":{"x":0.5,"y":0.5}}]}'::jsonb,
  1
), 'composition rejects unsupported fit modes');

select ok(not public.is_valid_shot_composition(
  '{"version":"shot-composition/v1","layout":"full","slots":[{"id":"full","clipSegmentIndex":0,"focalPoint":{"x":0.5,"y":0.5}}]}'::jsonb,
  1
), 'composition rejects missing required slot fields');

select ok(not public.is_valid_shot_composition(
  '{"version":"shot-composition/v1","layout":"full","slots":[{"id":"full","clipSegmentIndex":"first","fit":"cover","focalPoint":{"x":0.5,"y":0.5}}]}'::jsonb,
  1
), 'composition rejects malformed clip references without leaking cast errors');

select has_column('public', 'shot_preparation_drafts', 'composition', 'shot drafts persist structured composition');

select ok(
  position('''composition'', draft.composition' in pg_get_functiondef('public.create_shot_preparation_review_package(uuid,uuid)'::regprocedure)) > 0,
  'confirmed shot package freezes structured composition'
);

select ok(
  position('''composition'', member.evidence_snapshot -> ''composition''' in pg_get_functiondef('public.orchestrate_review_render_tasks(uuid)'::regprocedure)) > 0,
  'review render task receives structured composition without parsing production instructions'
);

select ok(
  has_function_privilege('authenticated', 'public.save_shot_workbench_composition_draft(uuid,uuid,text,uuid,jsonb,jsonb,text,text,boolean,text,text,numeric)', 'execute')
    and not has_function_privilege('anon', 'public.save_shot_workbench_composition_draft(uuid,uuid,text,uuid,jsonb,jsonb,text,text,boolean,text,text,numeric)', 'execute'),
  'only authenticated clients can call the owner-checked composition save RPC'
);

select * from finish();
rollback;
