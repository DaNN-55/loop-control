update public.account_blueprint_versions blueprint
set policy = jsonb_set(blueprint.policy, '{narration,credential_ref}', to_jsonb('google-tts-default'::text))
where jsonb_typeof(blueprint.policy -> 'narration') = 'object'
  and blueprint.policy #>> '{narration,executor,provider}' = 'google_tts'
  and blueprint.policy #>> '{narration,executor,adapter}' = 'google_tts'
  and coalesce(btrim(blueprint.policy #>> '{narration,credential_ref}'), '') = '';

update public.account_blueprint_versions blueprint
set policy = jsonb_set(blueprint.policy, '{soundtrack,credential_ref}', to_jsonb('freesound-default'::text))
where jsonb_typeof(blueprint.policy -> 'soundtrack') = 'object'
  and blueprint.policy #>> '{soundtrack,executor,provider}' = 'freesound'
  and blueprint.policy #>> '{soundtrack,executor,adapter}' = 'freesound_preview'
  and coalesce(btrim(blueprint.policy #>> '{soundtrack,credential_ref}'), '') = '';

update public.series_versions series_version
set rules = series_version.rules - 'narration' - 'soundtrack'
where series_version.rules ?| array['narration', 'soundtrack'];

alter function public.orchestrate_narration_tasks_configured(uuid)
rename to orchestrate_narration_tasks_without_connection_ref;

create function public.orchestrate_narration_tasks_configured(p_episode_id uuid default null)
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_task public.tasks;
  frozen_credential_ref text;
begin
  for created_task in
    select * from public.orchestrate_narration_tasks_without_connection_ref(p_episode_id)
  loop
    select nullif(btrim(blueprint.policy #>> '{narration,credential_ref}'), '')
    into frozen_credential_ref
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where episode.id = created_task.episode_id;

    if frozen_credential_ref is null then
      raise exception 'Narration task is missing a frozen credential reference' using errcode = '22023';
    end if;

    update public.tasks task
    set input_snapshot = jsonb_set(task.input_snapshot, '{credential_ref}', to_jsonb(frozen_credential_ref))
    where task.id = created_task.id
    returning task.* into created_task;

    return next created_task;
  end loop;
end;
$$;

revoke all on function public.orchestrate_narration_tasks_configured(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_narration_tasks_configured(uuid) to service_role;

alter function public.orchestrate_soundtrack_tasks()
rename to orchestrate_soundtrack_tasks_without_connection_ref;

create function public.orchestrate_soundtrack_tasks()
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_task public.tasks;
  frozen_credential_ref text;
begin
  for created_task in
    select * from public.orchestrate_soundtrack_tasks_without_connection_ref()
  loop
    select nullif(btrim(blueprint.policy #>> '{soundtrack,credential_ref}'), '')
    into frozen_credential_ref
    from public.episodes episode
    join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
    where episode.id = created_task.episode_id;

    if frozen_credential_ref is null then
      raise exception 'Soundtrack task is missing a frozen credential reference' using errcode = '22023';
    end if;

    update public.tasks task
    set input_snapshot = jsonb_set(task.input_snapshot, '{credential_ref}', to_jsonb(frozen_credential_ref))
    where task.id = created_task.id
    returning task.* into created_task;

    return next created_task;
  end loop;
end;
$$;

revoke all on function public.orchestrate_soundtrack_tasks() from public, anon, authenticated;
grant execute on function public.orchestrate_soundtrack_tasks() to service_role;
