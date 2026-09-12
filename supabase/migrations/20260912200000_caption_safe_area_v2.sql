create or replace function public.is_valid_shot_caption_contract(p_contract jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  cue jsonb;
  spatial jsonb;
  inset_key text;
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
  if spatial ->> 'anchor' not in ('top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right')
    or coalesce(jsonb_typeof(spatial -> 'max_lines'), 'null') <> 'number'
    or (spatial ->> 'max_lines')::numeric <> trunc((spatial ->> 'max_lines')::numeric)
    or (spatial ->> 'max_lines')::integer not between 1 and 2
    or coalesce(jsonb_typeof(spatial -> 'max_characters_per_line'), 'null') <> 'number'
    or (spatial ->> 'max_characters_per_line')::numeric <> trunc((spatial ->> 'max_characters_per_line')::numeric)
    or (spatial ->> 'max_characters_per_line')::integer not between 1 and 24 then return false;
  end if;
  if spatial ->> 'version' = 'shot-caption-space/v1' then
    if spatial ->> 'safe_area' not in ('title-safe', 'action-safe') then return false; end if;
  elsif spatial ->> 'version' = 'shot-caption-space/v2' then
    if spatial ->> 'safe_area' not in ('title-safe', 'action-safe', 'custom')
      or spatial ->> 'aspect_ratio' not in ('9:16', '16:9', '1:1')
      or coalesce(jsonb_typeof(spatial -> 'insets'), 'null') <> 'object' then return false;
    end if;
    foreach inset_key in array array['top', 'right', 'bottom', 'left'] loop
      if coalesce(jsonb_typeof(spatial -> 'insets' -> inset_key), 'null') <> 'number'
        or (spatial #>> array['insets', inset_key])::numeric not between 0 and 0.4 then return false;
      end if;
    end loop;
    if (spatial #>> '{insets,left}')::numeric + (spatial #>> '{insets,right}')::numeric >= 1
      or (spatial #>> '{insets,top}')::numeric + (spatial #>> '{insets,bottom}')::numeric >= 1 then return false;
    end if;
  else
    return false;
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

revoke all on function public.is_valid_shot_caption_contract(jsonb) from public, anon, authenticated;
