create or replace function public.record_manual_publication(
  p_episode_id uuid,
  p_platform text,
  p_publishing_account text,
  p_external_url text default null,
  p_external_content_id text default null,
  p_published_at timestamptz default null,
  p_notes text default ''
)
returns public.publication_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_record public.publication_records;
  current_stage public.episode_stage;
begin
  select episode.stage into current_stage
  from public.episodes episode
  where episode.id = p_episode_id;
  if not found then raise exception 'Episode % does not exist', p_episode_id using errcode = 'P0002'; end if;

  if current_stage = 'qc_passed' then
    perform public.transition_episode(p_episode_id, 'publish_ready'::public.episode_stage, 'Owner confirmed the verified publish package while recording manual publication.');
    current_stage := 'publish_ready';
  end if;
  if current_stage = 'publish_ready' then
    perform public.transition_episode(p_episode_id, 'publishing_review'::public.episode_stage, 'Owner opened manual publication confirmation.');
  end if;

  created_record := public.record_publication(
    p_episode_id,
    p_platform,
    p_publishing_account,
    p_external_url,
    p_external_content_id,
    p_published_at,
    'published'::public.publication_status,
    p_notes,
    'manual'::public.publication_source,
    null
  );
  perform public.transition_episode(
    p_episode_id,
    'published'::public.episode_stage,
    format('Owner confirmed manual publication on %s via %s.', created_record.platform, created_record.publishing_account)
  );
  return created_record;
end;
$$;

revoke all on function public.record_manual_publication(uuid, text, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.record_manual_publication(uuid, text, text, text, text, timestamptz, text) to authenticated;
