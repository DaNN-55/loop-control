create function public.is_valid_shot_caption_contract(p_contract jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  cue jsonb;
  spatial jsonb;
begin
  if coalesce(jsonb_typeof(p_contract), 'null') <> 'object'
    or p_contract ->> 'version' <> 'shot-captions/v1'
    or coalesce(jsonb_typeof(p_contract -> 'enabled'), 'null') <> 'boolean'
    or p_contract ->> 'content_mode' not in ('follow_tts', 'independent')
    or coalesce(jsonb_typeof(p_contract -> 'text'), 'null') <> 'string'
    or ((p_contract ->> 'enabled')::boolean and coalesce(btrim(p_contract ->> 'text'), '') = '')
    or coalesce(jsonb_typeof(p_contract -> 'cues'), 'null') <> 'array'
    or coalesce(jsonb_typeof(p_contract -> 'spatial'), 'null') <> 'object' then return false;
  end if;
  spatial := p_contract -> 'spatial';
  if spatial ->> 'version' <> 'shot-caption-space/v1'
    or spatial ->> 'anchor' not in ('top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right')
    or spatial ->> 'safe_area' not in ('title-safe', 'action-safe')
    or coalesce(jsonb_typeof(spatial -> 'max_lines'), 'null') <> 'number'
    or (spatial ->> 'max_lines')::numeric <> trunc((spatial ->> 'max_lines')::numeric)
    or (spatial ->> 'max_lines')::integer not between 1 and 2
    or coalesce(jsonb_typeof(spatial -> 'max_characters_per_line'), 'null') <> 'number'
    or (spatial ->> 'max_characters_per_line')::numeric <> trunc((spatial ->> 'max_characters_per_line')::numeric)
    or (spatial ->> 'max_characters_per_line')::integer not between 1 and 24 then return false;
  end if;
  for cue in select value from jsonb_array_elements(p_contract -> 'cues') loop
    if coalesce(jsonb_typeof(cue), 'null') <> 'object'
      or coalesce(cue ->> 'id', '') = ''
      or coalesce(jsonb_typeof(cue -> 'text'), 'null') <> 'string'
      or coalesce(jsonb_typeof(cue -> 'start_ms'), 'null') <> 'number'
      or coalesce(jsonb_typeof(cue -> 'end_ms'), 'null') <> 'number'
      or (cue ->> 'start_ms')::numeric < 0
      or (cue ->> 'end_ms')::numeric <= (cue ->> 'start_ms')::numeric then return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

alter table public.shot_preparation_drafts
  add column caption_contract jsonb,
  add column preparation_contract jsonb,
  add column preparation_input_fingerprint text;

create function public.build_shot_preparation_contract(p_draft public.shot_preparation_drafts)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  base jsonb;
  fingerprint text;
begin
  base := jsonb_build_object(
    'version', 'shot-preparation/v1',
    'storyboard_fingerprint', p_draft.input_fingerprint,
    'source_material_revision_id', p_draft.selected_material_revision_id,
    'clip_segments', p_draft.clip_segments,
    'composition', p_draft.composition,
    'audio_mode', p_draft.audio_mode,
    'audio_track_id', p_draft.current_audio_track_id,
    'tts_text', p_draft.tts_text,
    'tts_voice', p_draft.tts_voice,
    'tts_speaking_rate', p_draft.tts_speaking_rate,
    'captions', p_draft.caption_contract
  );
  fingerprint := md5(base::text);
  return base || jsonb_build_object('input_fingerprint', fingerprint);
end;
$$;

update public.shot_preparation_drafts draft
set caption_contract = jsonb_build_object(
  'version', 'shot-captions/v1',
  'enabled', draft.subtitles_enabled,
  'content_mode', case when draft.audio_mode = 'tts' then 'follow_tts' else 'independent' end,
  'text', draft.subtitle_text,
  'cues', '[]'::jsonb,
  'spatial', jsonb_build_object('version', 'shot-caption-space/v1', 'anchor', 'bottom-center', 'safe_area', 'title-safe', 'max_lines', 2, 'max_characters_per_line', 16)
);

update public.shot_preparation_drafts draft
set preparation_contract = public.build_shot_preparation_contract(draft);

update public.shot_preparation_drafts
set preparation_input_fingerprint = preparation_contract ->> 'input_fingerprint';

alter table public.shot_preparation_drafts
  alter column caption_contract set not null,
  alter column preparation_contract set not null,
  alter column preparation_input_fingerprint set not null,
  add constraint shot_preparation_drafts_caption_contract_check check (public.is_valid_shot_caption_contract(caption_contract)),
  add constraint shot_preparation_drafts_preparation_input_fingerprint_check check (preparation_input_fingerprint ~ '^[0-9a-f]{32}$' and preparation_contract ->> 'input_fingerprint' = preparation_input_fingerprint);

create function public.refresh_shot_preparation_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.caption_contract is null then
    new.caption_contract := jsonb_build_object(
      'version', 'shot-captions/v1', 'enabled', new.subtitles_enabled,
      'content_mode', case when new.audio_mode = 'tts' then 'follow_tts' else 'independent' end,
      'text', new.subtitle_text, 'cues', '[]'::jsonb,
      'spatial', jsonb_build_object('version', 'shot-caption-space/v1', 'anchor', 'bottom-center', 'safe_area', 'title-safe', 'max_lines', 2, 'max_characters_per_line', 16)
    );
  end if;
  new.preparation_contract := public.build_shot_preparation_contract(new);
  new.preparation_input_fingerprint := new.preparation_contract ->> 'input_fingerprint';
  return new;
end;
$$;

create trigger refresh_shot_preparation_contract
before insert or update on public.shot_preparation_drafts
for each row execute function public.refresh_shot_preparation_contract();

create function public.save_shot_caption_contract(
  p_episode_id uuid,
  p_review_package_id uuid,
  p_shot_id text,
  p_caption_contract jsonb
)
returns public.shot_preparation_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  draft public.shot_preparation_drafts;
  caption_changed boolean;
begin
  select episode.* into current_episode from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id and membership.user_id = auth.uid() and membership.role = 'owner'
  where episode.id = p_episode_id for update of episode;
  if not found or current_episode.stage not in ('storyboard_approved', 'render_ready', 'qc_review') then
    raise exception 'Owner shot workbench access is required' using errcode = '42501';
  end if;
  if not public.is_valid_shot_caption_contract(p_caption_contract) then
    raise exception 'Shot caption contract is invalid' using errcode = '22023';
  end if;
  select * into draft from public.shot_preparation_drafts
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id) for update;
  if not found then raise exception 'Shot preparation draft is required' using errcode = '22023'; end if;
  if p_caption_contract ->> 'content_mode' = 'follow_tts'
    and (draft.audio_mode <> 'tts' or p_caption_contract ->> 'text' is distinct from draft.tts_text) then
    raise exception 'Follow-TTS captions must reference the current final TTS text' using errcode = '22023';
  end if;
  caption_changed := draft.caption_contract is distinct from p_caption_contract;
  update public.shot_preparation_drafts target
  set caption_contract = p_caption_contract,
      subtitle_text = p_caption_contract ->> 'text',
      subtitles_enabled = (p_caption_contract ->> 'enabled')::boolean,
      frozen_at = case when caption_changed then null else target.frozen_at end,
      frozen_by = case when caption_changed then null else target.frozen_by end,
      confirmation_status = case when caption_changed then 'pending' else target.confirmation_status end,
      confirmation_reason = case when caption_changed then null else target.confirmation_reason end,
      confirmed_at = case when caption_changed then null else target.confirmed_at end,
      confirmed_by = case when caption_changed then null else target.confirmed_by end,
      updated_at = now()
  where target.id = draft.id
  returning * into draft;
  if caption_changed then
    insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
    values (current_episode.account_id, p_episode_id, 'shot_caption_contract_saved', jsonb_build_object('review_package_id', p_review_package_id, 'shot_id', btrim(p_shot_id), 'content_mode', p_caption_contract ->> 'content_mode', 'subtitles_enabled', p_caption_contract -> 'enabled', 'preparation_input_fingerprint', draft.preparation_input_fingerprint), auth.uid());
  end if;
  return draft;
end;
$$;

create or replace function public.protect_frozen_shot_preparation_inputs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_stage public.episode_stage;
begin
  select stage into current_stage from public.episodes where id = old.episode_id;
  if old.frozen_at is not null
    and current_stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review')
    and (
      old.selected_material_revision_id is distinct from new.selected_material_revision_id
      or old.clip_segments is distinct from new.clip_segments
      or old.composition is distinct from new.composition
      or old.audio_mode is distinct from new.audio_mode
      or old.tts_text is distinct from new.tts_text
      or old.tts_voice is distinct from new.tts_voice
      or old.tts_speaking_rate is distinct from new.tts_speaking_rate
      or old.subtitle_text is distinct from new.subtitle_text
      or old.subtitles_enabled is distinct from new.subtitles_enabled
      or old.caption_contract is distinct from new.caption_contract
    ) then
    raise exception 'Frozen shot drafts cannot be edited; create a new storyboard revision' using errcode = '22023';
  end if;
  return new;
end;
$$;

do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef('public.has_current_shot_preparation_snapshot(uuid, uuid)'::regprocedure);
  patched := replace(definition,
    'draft.input_fingerprint = md5(required.value::text)',
    'draft.input_fingerprint = md5(required.value::text) and draft.preparation_contract is not null and draft.preparation_input_fingerprint = draft.preparation_contract ->> ''input_fingerprint''');
  if patched = definition then raise exception 'has_current_shot_preparation_snapshot caption patch target is unknown'; end if;
  execute patched;

  definition := pg_get_functiondef('public.create_shot_preparation_review_package(uuid, uuid)'::regprocedure);
  patched := replace(definition,
    '''input_fingerprint'', draft.input_fingerprint, ''audio_mode'', draft.audio_mode,',
    '''input_fingerprint'', draft.preparation_input_fingerprint, ''preparation_contract'', draft.preparation_contract, ''audio_mode'', draft.audio_mode,');
  patched := replace(patched,
    '''shot_id'', shot ->> ''id'', ''confirmation_status'', ''confirmed'', ''input_fingerprint'', draft.input_fingerprint,',
    '''shot_id'', shot ->> ''id'', ''confirmation_status'', ''confirmed'', ''input_fingerprint'', draft.preparation_input_fingerprint, ''preparation_contract'', draft.preparation_contract,');
  if patched = definition or position('''preparation_contract'', draft.preparation_contract' in patched) = 0 then
    raise exception 'create_shot_preparation_review_package caption patch target is unknown';
  end if;
  execute patched;

  definition := pg_get_functiondef('public.orchestrate_review_render_tasks(uuid)'::regprocedure);
  patched := replace(definition,
    '''input_fingerprint'', member.evidence_snapshot ->> ''input_fingerprint'',',
    '''input_fingerprint'', member.evidence_snapshot ->> ''input_fingerprint'', ''preparation_contract'', member.evidence_snapshot -> ''preparation_contract'',');
  if patched = definition then raise exception 'orchestrate_review_render_tasks caption patch target is unknown'; end if;
  execute patched;
end;
$$;

revoke all on function public.is_valid_shot_caption_contract(jsonb) from public, anon, authenticated;
revoke all on function public.build_shot_preparation_contract(public.shot_preparation_drafts) from public, anon, authenticated;
revoke all on function public.refresh_shot_preparation_contract() from public, anon, authenticated;
revoke all on function public.save_shot_caption_contract(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.save_shot_caption_contract(uuid, uuid, text, jsonb) to authenticated;
