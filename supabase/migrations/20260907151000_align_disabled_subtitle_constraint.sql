alter table public.shot_preparation_drafts
  drop constraint if exists shot_preparation_drafts_subtitle_text_check;

alter table public.shot_preparation_drafts
  add constraint shot_preparation_drafts_subtitle_text_check
  check (not subtitles_enabled or char_length(btrim(subtitle_text)) > 0);
