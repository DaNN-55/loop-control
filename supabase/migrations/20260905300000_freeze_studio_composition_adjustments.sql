create or replace function public.request_review_render_revision(p_review_package_id uuid, p_composition jsonb, p_reason text)
returns public.episodes
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_package public.review_packages;
  selected_episode public.episodes;
  next_revision integer;
  previous_stage public.episode_stage;
  width integer;
  height integer;
  canonical_composition jsonb;
begin
  if p_composition ? 'studio_project' and (
    jsonb_typeof(p_composition -> 'studio_project') is distinct from 'object'
    or jsonb_typeof(p_composition -> 'studio_project' -> 'composition') is distinct from 'object'
  ) then
    raise exception 'Invalid frozen Studio composition' using errcode = '22023';
  end if;
  canonical_composition := case when p_composition ? 'studio_project'
    then (p_composition -> 'studio_project' -> 'composition') || jsonb_build_object('studio_project', (p_composition -> 'studio_project') - 'composition')
    else p_composition
  end;

  if btrim(coalesce(p_reason, '')) = ''
    or canonical_composition is null
    or jsonb_typeof(canonical_composition) <> 'object'
    or exists (select 1 from jsonb_object_keys(canonical_composition) key where key not in ('aspect_ratio', 'width', 'height', 'captions_enabled', 'caption_style', 'crop', 'pacing', 'transition', 'layout', 'narration_gain_db', 'bgm_gain_db', 'sfx_gain_db', 'studio_project', 'frame_rate', 'allowed_frames'))
    or canonical_composition ->> 'aspect_ratio' not in ('9:16', '16:9', '1:1')
    or jsonb_typeof(canonical_composition -> 'width') <> 'number'
    or jsonb_typeof(canonical_composition -> 'height') <> 'number'
    or jsonb_typeof(canonical_composition -> 'captions_enabled') <> 'boolean'
    or canonical_composition ->> 'caption_style' not in ('cinematic', 'minimal')
    or canonical_composition ->> 'crop' not in ('cover', 'contain')
    or canonical_composition ->> 'pacing' not in ('gentle', 'standard', 'compact')
    or canonical_composition ->> 'transition' not in ('fade', 'cut')
    or canonical_composition ->> 'layout' not in ('lower_third', 'center')
    or jsonb_typeof(canonical_composition -> 'narration_gain_db') <> 'number'
    or jsonb_typeof(canonical_composition -> 'bgm_gain_db') <> 'number'
    or jsonb_typeof(canonical_composition -> 'sfx_gain_db') <> 'number'
    or jsonb_typeof(canonical_composition -> 'frame_rate') <> 'number'
    or (canonical_composition ->> 'frame_rate')::numeric <= 0
    or jsonb_typeof(canonical_composition -> 'allowed_frames') <> 'number'
    or (canonical_composition ->> 'allowed_frames')::numeric < 0
    or (canonical_composition ->> 'allowed_frames')::numeric <> trunc((canonical_composition ->> 'allowed_frames')::numeric)
    or (canonical_composition ? 'studio_project' and (
      jsonb_typeof(canonical_composition -> 'studio_project') <> 'object'
      or exists (select 1 from jsonb_object_keys(canonical_composition -> 'studio_project') key where key not in ('relative_path', 'sha256', 'file_size'))
      or jsonb_typeof(canonical_composition -> 'studio_project' -> 'relative_path') <> 'string'
      or jsonb_typeof(canonical_composition -> 'studio_project' -> 'sha256') <> 'string'
      or jsonb_typeof(canonical_composition -> 'studio_project' -> 'file_size') <> 'number'
    )) then
    raise exception 'Invalid review render composition adjustment' using errcode = '22023';
  end if;

  width := (canonical_composition ->> 'width')::integer;
  height := (canonical_composition ->> 'height')::integer;
  if width < 1
    or height < 1
    or (canonical_composition ->> 'aspect_ratio' = '9:16' and width * 16 <> height * 9)
    or (canonical_composition ->> 'aspect_ratio' = '16:9' and width * 9 <> height * 16)
    or (canonical_composition ->> 'aspect_ratio' = '1:1' and width <> height) then
    raise exception 'Invalid review render composition dimensions' using errcode = '22023';
  end if;

  select * into selected_package from public.current_hyperframes_review_package(p_review_package_id, true);
  select * into selected_episode from public.episodes where id = selected_package.episode_id;
  if (canonical_composition ->> 'frame_rate')::numeric <> (public.shot_duration_settings(selected_episode.id) ->> 'frame_rate')::numeric
    or (canonical_composition ->> 'allowed_frames')::integer <> (public.shot_duration_settings(selected_episode.id) ->> 'allowed_frames')::integer then
    raise exception 'Studio duration settings must match the frozen shot duration settings' using errcode = '22023';
  end if;
  if canonical_composition ? 'studio_project' and (
    canonical_composition #>> '{studio_project,relative_path}' !~ format('^episodes/%s/studio-frozen/[0-9a-f-]{36}/index[.]html$', selected_episode.id::text)
    or canonical_composition #>> '{studio_project,sha256}' !~ '^[0-9a-f]{64}$'
    or (canonical_composition #>> '{studio_project,file_size}')::bigint < 1
  ) then
    raise exception 'Invalid frozen Studio project' using errcode = '22023';
  end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.review_render_composition_revisions
  where pre_render_review_package_id = (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid;
  insert into public.review_render_composition_revisions (
    episode_id, pre_render_review_package_id, revision_number, caption_style, pacing, crop, transition, layout, reason, created_by, composition_config
  ) values (
    selected_episode.id, (selected_package.context_snapshot ->> 'pre_render_review_package_id')::uuid, next_revision,
    canonical_composition ->> 'caption_style', canonical_composition ->> 'pacing', canonical_composition ->> 'crop', canonical_composition ->> 'transition',
    canonical_composition ->> 'layout', btrim(p_reason), auth.uid(), canonical_composition
  );
  previous_stage := selected_episode.stage;
  update public.episodes set stage = 'render_ready', updated_at = now()
  where id = selected_episode.id returning * into selected_episode;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (selected_episode.id, previous_stage, 'render_ready', btrim(p_reason), auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    selected_episode.account_id, selected_episode.id, 'review_render_composition_requested',
    jsonb_build_object('review_package_id', selected_package.id, 'revision_number', next_revision), auth.uid()
  );
  return selected_episode;
end;
$$;

revoke all on function public.request_review_render_revision(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.request_review_render_revision(uuid, jsonb, text) to authenticated;
