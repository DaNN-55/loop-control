begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

select is(
  public.clip_segment_union_duration('[{"start_seconds":0,"end_seconds":3},{"start_seconds":2,"end_seconds":4}]'::jsonb),
  4::numeric,
  'overlapping clip ranges are counted once'
);
select is(
  public.clip_segment_union_duration('[{"start_seconds":4,"end_seconds":5},{"start_seconds":0,"end_seconds":2},{"start_seconds":2,"end_seconds":3}]'::jsonb),
  4::numeric,
  'unordered adjacent and disjoint ranges produce their interval union'
);
select ok(
  position('clip_segment_union_duration(p_clip_segments)' in pg_get_functiondef('public.save_shot_workbench_draft(uuid,uuid,text,uuid,jsonb,text,text,boolean,text,text,numeric)'::regprocedure)) > 0,
  'draft persistence uses interval-union duration'
);
select ok(
  position('clip_segment_union_duration(draft.clip_segments)' in pg_get_functiondef('public.generate_shot_sync_preview(uuid,uuid,text)'::regprocedure)) > 0
    and position('clip_segment_union_duration(draft.clip_segments)' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0,
  'preview generation and confirmation use interval-union duration'
);
select ok(
  not has_function_privilege('authenticated', 'public.clip_segment_union_duration(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.clip_segment_union_duration(jsonb)', 'execute'),
  'the internal duration helper is not exposed to API callers'
);

select * from finish();
rollback;
