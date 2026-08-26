create or replace function public.normalize_manual_media_task(p_episode_id uuid, p_input_snapshot jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare snapshot jsonb := coalesce(p_input_snapshot, '{}'::jsonb); capability text := snapshot ->> 'capability'; v_task_type text; target text;
begin
  if capability not in ('a_roll_manual_upload', 'b_roll_manual_upload', 'narration_manual_upload', 'soundtrack_manual_upload') then return snapshot; end if;
  v_task_type := case capability when 'a_roll_manual_upload' then 'generate_a_roll' when 'b_roll_manual_upload' then 'generate_b_roll' when 'narration_manual_upload' then 'generate_narration' else 'generate_soundtrack' end;
  target := case when v_task_type in ('generate_a_roll', 'generate_b_roll') then snapshot #>> '{shot,id}' else snapshot #>> '{audio_track,cue_id}' end;
  update public.tasks task set status = 'superseded'::public.task_status, invalidated_at = now(), invalidated_reason = 'Owner replaced automatic media with a fully satisfying manual upload.'
  where task.episode_id = p_episode_id and task.task_type = v_task_type and task.provider <> 'manual_upload' and task.status in ('ready', 'blocked', 'failed') and case when v_task_type in ('generate_a_roll', 'generate_b_roll') then task.input_snapshot #>> '{shot,id}' else task.input_snapshot #>> '{audio_track,cue_id}' end = target;
  return jsonb_set(snapshot, '{configuration_hash}', to_jsonb('manual-' || md5(snapshot::text)), true);
end;
$$;

revoke all on function public.normalize_manual_media_task(uuid, jsonb) from public, anon, authenticated;
