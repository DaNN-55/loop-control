begin;
select plan(4);

select is(
  public.shot_composition_playback_duration(
    '[{"start_seconds":0,"end_seconds":2},{"start_seconds":3,"end_seconds":4.8}]'::jsonb,
    '{"version":"shot-composition/v1","layout":"full","slots":[{"id":"full","clipSegmentIndex":0}]}'::jsonb
  ),
  3.8::numeric,
  'full-screen prepared segments are sequential and additive'
);

select is(
  public.shot_composition_playback_duration(
    '[{"start_seconds":0,"end_seconds":3.8},{"start_seconds":10,"end_seconds":13.8}]'::jsonb,
    '{"version":"shot-composition/v1","layout":"2up-vertical","slots":[{"id":"top","clipSegmentIndex":0},{"id":"bottom","clipSegmentIndex":1}]}'::jsonb
  ),
  3.8::numeric,
  'split-screen prepared segments play in parallel'
);

select is(
  public.shot_composition_playback_duration(
    '[{"start_seconds":0,"end_seconds":4.2},{"start_seconds":10,"end_seconds":13.8}]'::jsonb,
    '{"version":"shot-composition/v1","layout":"2up-vertical","slots":[{"id":"top","clipSegmentIndex":0},{"id":"bottom","clipSegmentIndex":1}]}'::jsonb
  ),
  3.8::numeric,
  'parallel render window is bounded by the shortest slot'
);

select has_function('public', 'shot_composition_playback_duration', array['jsonb', 'jsonb'], 'composition duration helper exists');

select * from finish();
rollback;
