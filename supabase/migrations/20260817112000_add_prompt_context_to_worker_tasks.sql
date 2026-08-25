create or replace function public.attach_prompt_context_to_worker_task_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_episode public.episodes;
  blueprint_policy jsonb;
  selected_series_version public.series_versions;
  context jsonb;
begin
  if new.task_package is null or jsonb_typeof(new.task_package) <> 'object' then return new; end if;
  if coalesce(new.task_package #>> '{episode,id}', new.task_package ->> 'episode_id', '') = '' then return new; end if;
  select episode.* into selected_episode from public.episodes episode where episode.id = coalesce(new.task_package #>> '{episode,id}', new.task_package ->> 'episode_id')::uuid;
  if not found then return new; end if;
  select policy into blueprint_policy from public.account_blueprint_versions where id = selected_episode.blueprint_version_id;
  select series_version.* into selected_series_version from public.series_versions series_version where series_version.id = selected_episode.series_version_id and series_version.account_id = selected_episode.account_id;

  context := jsonb_strip_nulls(jsonb_build_object(
    'version', 'prompt-context/v1',
    'blueprint_version_id', selected_episode.blueprint_version_id,
    'series_version_id', selected_series_version.id,
    'account_hard_constraints', jsonb_strip_nulls(jsonb_build_object(
      'approval_gates', blueprint_policy -> 'approval_gates',
      'allowed_tools', blueprint_policy -> 'allowed_tools',
      'asset_root', blueprint_policy -> 'asset_root',
      'restrictions', blueprint_policy -> 'restrictions',
      'publishing', blueprint_policy -> 'publishing'
    )),
    'account_defaults', jsonb_strip_nulls(jsonb_build_object(
      'positioning', blueprint_policy -> 'positioning',
      'audience', blueprint_policy -> 'audience',
      'tone', blueprint_policy -> 'tone',
      'brand_voice', blueprint_policy -> 'brand_voice',
      'visual_style', blueprint_policy -> 'visual_style',
      'subtitle_style', blueprint_policy -> 'subtitle_style',
      'language', blueprint_policy -> 'language',
      'creative_rules', blueprint_policy -> 'creative_rules'
    )),
    'series_baseline', case when selected_series_version.id is null then null else jsonb_build_object('version_id', selected_series_version.id, 'version', selected_series_version.version, 'rules', selected_series_version.rules) end,
    'episode_input', jsonb_strip_nulls(jsonb_build_object(
      'commission', new.task_package -> 'commission',
      'script_revision', new.task_package -> 'script_revision',
      'input_artifacts', new.task_package -> 'input_artifacts',
      'shot', new.task_package -> 'shot',
      'media', new.task_package -> 'media'
    )),
    'review_feedback', new.task_package -> 'review_feedback'
  ));
  new.task_package := jsonb_set(new.task_package, '{prompt_context}', context || jsonb_build_object('hash', md5(context::text)), true);
  return new;
end;
$$;

create trigger z_attach_prompt_context_to_worker_task_run_before_insert
before insert on public.task_runs
for each row execute function public.attach_prompt_context_to_worker_task_run();

revoke all on function public.attach_prompt_context_to_worker_task_run() from public, anon, authenticated;
