alter table public.shot_preparation_drafts
  add column bgm_ducking_level text not null default 'off'
  check (bgm_ducking_level in ('off', 'light', 'medium', 'strong'));

create function public.build_shot_audio_mix(p_draft public.shot_preparation_drafts)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  bgm public.storyboard_audio_selections;
  sfx public.storyboard_audio_selections;
  effective_ducking text;
  duck_depth numeric;
begin
  select selection.* into bgm
  from public.storyboard_audio_selections selection
  where selection.episode_id = p_draft.episode_id
    and selection.review_package_id = p_draft.review_package_id
    and selection.target_kind = 'episode'
    and selection.target_id = p_draft.episode_id::text
    and selection.audio_kind = 'bgm'
    and (selection.cue_id is not null or selection.material_revision_id is not null);

  select selection.* into sfx
  from public.storyboard_audio_selections selection
  where selection.episode_id = p_draft.episode_id
    and selection.review_package_id = p_draft.review_package_id
    and selection.target_kind = 'shot'
    and selection.target_id = p_draft.shot_id
    and selection.audio_kind = 'sfx'
    and (selection.cue_id is not null or selection.material_revision_id is not null);

  effective_ducking := case when bgm.id is null or p_draft.audio_mode = 'none' then 'off' else p_draft.bgm_ducking_level end;
  duck_depth := case effective_ducking when 'light' then -6 when 'medium' then -10 when 'strong' then -14 else 0 end;

  return jsonb_build_object(
    'version', 'shot-audio-mix/v1',
    'main_voice', jsonb_build_object(
      'mode', p_draft.audio_mode,
      'track_id', case when p_draft.audio_mode = 'none' then null else p_draft.current_audio_track_id end,
      'gain_db', 0,
      'role', case when p_draft.audio_mode = 'none' then 'none' else 'anchor' end
    ),
    'bgm', case when bgm.id is null then null else jsonb_build_object(
      'selection_id', bgm.id,
      'cue_id', bgm.cue_id,
      'material_revision_id', bgm.material_revision_id,
      'gain_db', -12,
      'role', 'follower',
      'ducking_level', effective_ducking,
      'duck_depth_db', duck_depth
    ) end,
    'sfx', case when sfx.id is null then null else jsonb_build_object(
      'selection_id', sfx.id,
      'cue_id', sfx.cue_id,
      'material_revision_id', sfx.material_revision_id,
      'gain_db', -6,
      'role', 'independent',
      'automatic_ducking', false
    ) end
  );
end;
$$;

create function public.is_valid_shot_audio_mix(p_mix jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  main_voice jsonb := p_mix -> 'main_voice';
  bgm jsonb := p_mix -> 'bgm';
  sfx jsonb := p_mix -> 'sfx';
begin
  if coalesce(jsonb_typeof(p_mix), 'null') <> 'object'
    or p_mix ->> 'version' <> 'shot-audio-mix/v1'
    or coalesce(jsonb_typeof(main_voice), 'null') <> 'object'
    or main_voice ->> 'mode' not in ('tts', 'source', 'none')
    or main_voice ->> 'role' is distinct from (case when main_voice ->> 'mode' = 'none' then 'none' else 'anchor' end)
    or coalesce(jsonb_typeof(main_voice -> 'gain_db'), 'null') <> 'number'
    or (main_voice ->> 'mode' = 'none' and jsonb_typeof(main_voice -> 'track_id') <> 'null') then return false;
  end if;
  if jsonb_typeof(bgm) <> 'null' and (
    coalesce(bgm ->> 'selection_id', '') = '' or bgm ->> 'role' <> 'follower'
    or bgm ->> 'ducking_level' not in ('off', 'light', 'medium', 'strong')
    or (bgm ->> 'duck_depth_db')::numeric is distinct from (case bgm ->> 'ducking_level' when 'light' then -6 when 'medium' then -10 when 'strong' then -14 else 0 end)
  ) then return false; end if;
  if jsonb_typeof(sfx) <> 'null' and (
    coalesce(sfx ->> 'selection_id', '') = '' or sfx ->> 'role' <> 'independent'
    or coalesce((sfx ->> 'automatic_ducking')::boolean, true)
  ) then return false; end if;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.build_shot_preparation_contract(p_draft public.shot_preparation_drafts)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  base jsonb;
begin
  base := jsonb_build_object(
    'version', 'shot-preparation/v1',
    'storyboard_fingerprint', p_draft.input_fingerprint,
    'source_material_revision_id', p_draft.selected_material_revision_id,
    'clip_segments', p_draft.clip_segments,
    'composition', p_draft.composition,
    'audio_mode', p_draft.audio_mode,
    'audio_track_id', case when p_draft.audio_mode = 'none' then null else p_draft.current_audio_track_id end,
    'tts_text', p_draft.tts_text,
    'tts_voice', p_draft.tts_voice,
    'tts_speaking_rate', p_draft.tts_speaking_rate,
    'audio_mix', public.build_shot_audio_mix(p_draft),
    'captions', p_draft.caption_contract
  );
  return base || jsonb_build_object('input_fingerprint', md5(base::text));
end;
$$;

create function public.save_shot_audio_mix(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_bgm_ducking_level text
)
returns public.shot_preparation_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.shot_preparation_drafts;
  changed boolean;
begin
  if p_bgm_ducking_level not in ('off', 'light', 'medium', 'strong') then
    raise exception 'BGM ducking level is invalid' using errcode = '22023';
  end if;
  select target.* into draft
  from public.shot_preparation_drafts target
  join public.episodes episode on episode.id = target.episode_id
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where target.episode_id = p_episode_id and target.review_package_id = p_review_package_id and target.shot_id = btrim(p_shot_id)
  for update of target;
  if not found then raise exception 'Owner shot workbench access is required' using errcode = '42501'; end if;
  if p_bgm_ducking_level <> 'off' and (draft.audio_mode = 'none' or not exists (
    select 1 from public.storyboard_audio_selections selection
    where selection.episode_id = p_episode_id and selection.review_package_id = p_review_package_id
      and selection.target_kind = 'episode' and selection.target_id = p_episode_id::text and selection.audio_kind = 'bgm'
      and (selection.cue_id is not null or selection.material_revision_id is not null)
  )) then raise exception 'BGM ducking requires BGM and an audible main voice' using errcode = '22023'; end if;
  changed := draft.bgm_ducking_level is distinct from p_bgm_ducking_level;
  update public.shot_preparation_drafts target set
    bgm_ducking_level = p_bgm_ducking_level,
    frozen_at = case when changed then null else target.frozen_at end,
    frozen_by = case when changed then null else target.frozen_by end,
    confirmation_status = case when changed then 'pending' else target.confirmation_status end,
    confirmation_reason = case when changed then null else target.confirmation_reason end,
    confirmed_at = case when changed then null else target.confirmed_at end,
    confirmed_by = case when changed then null else target.confirmed_by end,
    updated_at = now()
  where target.id = draft.id returning * into draft;
  return draft;
end;
$$;

create function public.refresh_shot_audio_mix_after_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.shot_preparation_drafts draft set
    frozen_at = null, frozen_by = null, confirmation_status = 'pending', confirmation_reason = null,
    confirmed_at = null, confirmed_by = null, updated_at = now()
  where draft.episode_id = new.episode_id and draft.review_package_id = new.review_package_id
    and (new.target_kind = 'episode' or draft.shot_id = new.target_id);
  return new;
end;
$$;

create trigger refresh_shot_audio_mix_after_selection
after insert or update of cue_id, material_revision_id on public.storyboard_audio_selections
for each row execute function public.refresh_shot_audio_mix_after_selection();

create function public.copy_shot_audio_mix_to_revised_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare previous public.shot_preparation_drafts;
begin
  select draft.* into previous from public.shot_preparation_drafts draft
  where draft.episode_id = new.episode_id and draft.shot_id = new.shot_id and draft.review_package_id <> new.review_package_id
  order by (draft.input_fingerprint = new.input_fingerprint) desc, draft.updated_at desc, draft.id desc limit 1;
  if found then update public.shot_preparation_drafts set bgm_ducking_level = previous.bgm_ducking_level where id = new.id; end if;
  return new;
end;
$$;

create trigger copy_shot_audio_mix_to_revised_draft
after insert on public.shot_preparation_drafts
for each row execute function public.copy_shot_audio_mix_to_revised_draft();

update public.shot_preparation_drafts set updated_at = updated_at;

alter table public.shot_preparation_drafts
  add constraint shot_preparation_drafts_audio_mix_contract_check
  check (public.is_valid_shot_audio_mix(preparation_contract -> 'audio_mix'));

do $$
declare definition text; patched text;
begin
  definition := pg_get_functiondef('public.protect_frozen_shot_preparation_inputs()'::regprocedure);
  patched := replace(definition, 'or old.caption_contract is distinct from new.caption_contract', 'or old.caption_contract is distinct from new.caption_contract or old.bgm_ducking_level is distinct from new.bgm_ducking_level');
  if patched = definition then raise exception 'protect_frozen_shot_preparation_inputs audio mix patch target is unknown'; end if;
  execute patched;
end $$;

revoke all on function public.build_shot_audio_mix(public.shot_preparation_drafts) from public, anon, authenticated;
revoke all on function public.is_valid_shot_audio_mix(jsonb) from public, anon, authenticated;
revoke all on function public.save_shot_audio_mix(uuid, uuid, text, text) from public, anon;
grant execute on function public.save_shot_audio_mix(uuid, uuid, text, text) to authenticated;
revoke all on function public.refresh_shot_audio_mix_after_selection() from public, anon, authenticated;
revoke all on function public.copy_shot_audio_mix_to_revised_draft() from public, anon, authenticated;
