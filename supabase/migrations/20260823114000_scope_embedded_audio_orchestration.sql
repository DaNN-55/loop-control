drop function public.orchestrate_embedded_audio_tasks();

create function public.orchestrate_embedded_audio_tasks(p_episode_id uuid default null)
returns setof public.tasks language plpgsql security definer set search_path = ''
as $$
declare candidate record; created_task public.tasks;
begin
  for candidate in
    select material.*, approval.id as approval_id, episode.account_id, episode.blueprint_version_id
    from public.production_material_revisions material
    join public.material_revision_approvals approval on approval.material_revision_id = material.id
    join public.episodes episode on episode.id = material.episode_id
    where material.material_type = 'video'
      and material.storage_path ~* '[.](mp4|mov|webm)$'
      and (p_episode_id is null or material.episode_id = p_episode_id)
    order by material.created_at, material.id for update of material skip locked
  loop
    if exists (select 1 from public.tasks task where task.task_type = 'extract_embedded_audio' and task.input_snapshot ->> 'source_material_revision_id' = candidate.id::text) then continue; end if;
    insert into public.tasks (episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version)
    values (candidate.episode_id,'extract_embedded_audio','ready',jsonb_build_object(
      'capability','embedded_audio_extraction','source_material_revision_id',candidate.id,'source_material_approval_id',candidate.approval_id,'source_video_revision_sha256',candidate.sha256,
      'media',jsonb_build_object('adapter','ffmpeg_extract_audio','embedded_audio',jsonb_build_object('source_relative_path',candidate.storage_path,'duration_seconds',0.001)),
      'audio_track',jsonb_build_object('kind','derived','cue_id',format('material-v%s',candidate.revision_number),'source_material_revision_id',candidate.id,'start_seconds',0,'duration_seconds',0.001),
      'budget',jsonb_build_object('limit_cents',0,'max_attempts',1),'allowed_tools',jsonb_build_array('read','write'),
      'output',jsonb_build_object('required_artifact_types',jsonb_build_array('derived_audio'),'content_type','audio/mpeg','relative_path',format('episodes/%s/audio/derived-material-v%s.mp3',candidate.episode_id,candidate.revision_number),'review_stage','production_ready'),
      'input_artifacts',jsonb_build_array(jsonb_build_object('artifactType','source_video_material','relativePath',candidate.storage_path,'sha256',candidate.sha256,'fileSize',candidate.file_size))),0,1,'ffmpeg','ffmpeg','embedded-audio-v1') returning * into created_task;
    return next created_task;
  end loop;
end;
$$;

revoke all on function public.orchestrate_embedded_audio_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_embedded_audio_tasks(uuid) to service_role;
