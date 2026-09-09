begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(3);

select ok(
  position('and not exists (' in pg_get_functiondef('public.seed_shot_preparation_drafts_after_storyboard_approval()'::regprocedure)) > 0
    and position('and existing.source_review_package_id = package_record.id' in pg_get_functiondef('public.seed_shot_preparation_drafts_after_storyboard_approval()'::regprocedure)) > 0,
  'seeded audio history uses explicit idempotency without the removed unique constraint'
);

select ok(
  position('where not exists (' in pg_get_functiondef('public.reuse_shot_preparation_history_after_storyboard_approval()'::regprocedure)) > 0
    and position('and existing.source_review_package_id = package_record.id' in pg_get_functiondef('public.reuse_shot_preparation_history_after_storyboard_approval()'::regprocedure)) > 0,
  'reused audio history uses explicit idempotency without the removed unique constraint'
);

select is(
  (select count(*) from pg_constraint where conname = 'audio_tracks_episode_id_track_kind_cue_id_source_review_package_id_key'),
  0::bigint,
  'the obsolete cross-package-blocking audio uniqueness constraint remains absent'
);

select * from finish();
rollback;
