create or replace function public.request_review_render_revision(p_review_package_id uuid, p_composition jsonb, p_reason text)
returns public.episodes
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_package public.review_packages;
  selected_episode public.episodes;
  membership_role public.member_role;
  next_revision integer;
  width integer;
  height integer;
begin
  if btrim(coalesce(p_reason, '')) = ''
    or jsonb_typeof(p_composition) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_composition) key where key not in ('aspect_ratio', 'width', 'height', 'captions_enabled', 'caption_style', 'crop', 'pacing', 'transition', 'layout', 'narration_gain_db', 'bgm_gain_db', 'sfx_gain_db'))
    or p_composition ->> 'aspect_ratio' not in ('9:16', '16:9', '1:1')
    or jsonb_typeof(p_composition -> 'width') <> 'number'
    or jsonb_typeof(p_composition -> 'height') <> 'number'
    or jsonb_typeof(p_composition -> 'captions_enabled') <> 'boolean'
    or p_composition ->> 'caption_style' not in ('cinematic', 'minimal')
    or p_composition ->> 'crop' not in ('cover', 'contain')
    or p_composition ->> 'pacing' not in ('gentle', 'standard', 'compact')
    or p_composition ->> 'transition' not in ('fade', 'cut')
    or p_composition ->> 'layout' not in ('lower_third', 'center')
    or jsonb_typeof(p_composition -> 'narration_gain_db') <> 'number'
    or jsonb_typeof(p_composition -> 'bgm_gain_db') <> 'number'
    or jsonb_typeof(p_composition -> 'sfx_gain_db') <> 'number' then
    raise exception 'Invalid review render composition adjustment' using errcode = '22023';
  end if;
  width := (p_composition ->> 'width')::integer; height := (p_composition ->> 'height')::integer;
  if width < 1 or height < 1 or (p_composition ->> 'aspect_ratio' = '9:16' and width * 16 <> height * 9) or (p_composition ->> 'aspect_ratio' = '16:9' and width * 9 <> height * 16) or (p_composition ->> 'aspect_ratio' = '1:1' and width <> height) then raise exception 'Invalid review render composition dimensions' using errcode = '22023'; end if;
  select package.* into selected_package from public.review_packages package where package.id = p_review_package_id and package.stage = 'qc_review' and package.invalidated_at is null and package.context_snapshot ->> 'review_kind' = 'hyperframes_review_render';
  if not found then raise exception 'Current HyperFrames review package is required' using errcode = '22023'; end if;
  select * into selected_episode from public.episodes where id = selected_package.episode_id for update;
  if selected_episode.stage <> 'qc_review' or exists (select 1 from public.review_packages package where package.episode_id = selected_episode.id and package.stage = 'qc_review' and package.invalidated_at is null and package.revision_number > selected_package.revision_number) then raise exception 'Review render package is no longer current' using errcode = '22023'; end if;
  select role into membership_role from public.account_memberships where account_id = selected_episode.account_id and user_id = auth.uid();
  if membership_role is distinct from 'owner' then raise exception 'Owner membership is required to adjust a review render' using errcode = '42501'; end if;
  select coalesce(max(revision_number), 0) + 1 into next_revision from public.review_render_composition_revisions where pre_render_review_package_id = (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid;
  insert into public.review_render_composition_revisions (episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, created_by, composition_config)
  values (selected_episode.id, (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid, next_revision, p_composition ->> 'caption_style', p_composition ->> 'pacing', p_composition ->> 'crop', p_composition ->> 'transition', p_composition ->> 'layout', btrim(p_reason), auth.uid(), p_composition);
  update public.episodes set stage = 'render_ready', updated_at = now() where id = selected_episode.id returning * into selected_episode;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id) values (selected_episode.id, 'qc_review', 'render_ready', btrim(p_reason), auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (selected_episode.account_id, selected_episode.id, 'review_render_composition_requested', jsonb_build_object('review_package_id', selected_package.id, 'revision_number', next_revision), auth.uid());
  return selected_episode;
end;
$$;
