update public.audio_tracks track
set start_seconds = (task.input_snapshot #>> '{audio_track,start_seconds}')::numeric
from public.tasks task
where task.id = track.source_task_id
  and task.task_type = 'generate_narration'
  and track.track_kind = 'narration'
  and task.input_snapshot #>> '{audio_track,cue_id}' <> 'episode_narration'
  and jsonb_typeof(task.input_snapshot #> '{audio_track,start_seconds}') = 'number';

create or replace function public.register_completed_audio_track()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare selected_artifact public.artifacts; track_snapshot jsonb; actual_duration numeric; source_material public.production_material_revisions;
begin
  if new.status <> 'completed' or new.task_type not in ('generate_narration', 'extract_embedded_audio', 'generate_soundtrack') then return new; end if;
  track_snapshot := new.input_snapshot -> 'audio_track';
  if jsonb_typeof(track_snapshot) <> 'object' then raise exception 'Completed audio task is missing its frozen audio track snapshot' using errcode = '22023'; end if;
  if coalesce(new.last_result ->> 'audioDurationSeconds', '') !~ '^[0-9]+([.][0-9]+)?$' or (new.last_result ->> 'audioDurationSeconds')::numeric <= 0 then raise exception 'Completed audio task is missing its probed duration' using errcode = '22023'; end if;
  actual_duration := (new.last_result ->> 'audioDurationSeconds')::numeric;
  if track_snapshot ? 'source_material_revision_id' then
    select material.* into source_material from public.production_material_revisions material join public.material_revision_approvals approval on approval.material_revision_id = material.id where material.id = (track_snapshot ->> 'source_material_revision_id')::uuid and material.episode_id = new.episode_id;
    if not found then raise exception 'Completed audio task source material approval is invalid' using errcode = '22023'; end if;
  end if;
  select * into selected_artifact from public.artifacts artifact where artifact.producer_task_id = new.id and artifact.relative_path = new.input_snapshot #>> '{output,relative_path}';
  if not found then raise exception 'Completed audio task is missing its frozen output artifact' using errcode = '22023'; end if;
  insert into public.audio_tracks (episode_id,source_task_id,source_artifact_id,source_review_package_id,source_material_revision_id,track_kind,cue_id,relative_path,sha256,file_size,start_seconds,duration_seconds)
  values (new.episode_id,new.id,selected_artifact.id,nullif(track_snapshot ->> 'source_review_package_id','')::uuid,source_material.id,track_snapshot ->> 'kind',nullif(track_snapshot ->> 'cue_id',''),selected_artifact.relative_path,selected_artifact.sha256,selected_artifact.file_size,coalesce((track_snapshot ->> 'start_seconds')::numeric,0),actual_duration);
  return new;
end;
$$;

revoke all on function public.register_completed_audio_track() from public, anon, authenticated;
grant execute on function public.register_completed_audio_track() to service_role;
