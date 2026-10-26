CREATE OR REPLACE FUNCTION public.freeze_shared_planning_harness()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  planning_executor jsonb;
  planning_capability text;
  selected_harness public.prompt_versions;
begin
  if new.task_type <> 'prepare_visual_brief' or new.input_snapshot ->> 'capability' <> 'visual_planning' or new.input_snapshot ? 'harness' then
    return new;
  end if;

  select blueprint.policy #> array['executors', case when blueprint.is_snapshot then 'visual_planning' else 'storyboard_planning' end],
         case when blueprint.is_snapshot then 'visual_planning' else 'storyboard_planning' end
  into planning_executor, planning_capability
  from public.episodes episode
  join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id
  where episode.id = new.episode_id;

  if coalesce(btrim(planning_executor ->> 'adapter'), '') <> 'codex'
    or coalesce(btrim(planning_executor ->> 'model'), '') = ''
    or coalesce(btrim(planning_executor ->> 'harness_id'), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Visual preparation requires the shared storyboard Adapter, model, and Harness' using errcode = '22023';
  end if;

  select harness.*
  into selected_harness
  from public.prompt_versions harness
  join public.episodes episode on episode.account_id = harness.account_id
  where episode.id = new.episode_id
    and harness.id = (planning_executor ->> 'harness_id')::uuid
     and (harness.capability = 'storyboard_planning' or planning_capability = 'visual_planning' and harness.capability = 'visual_planning')
    and harness.is_active;

  if not found or coalesce(btrim(selected_harness.instructions), '') = '' then
    raise exception 'Visual preparation requires an active shared storyboard Harness' using errcode = '22023';
  end if;

  new.input_snapshot := jsonb_set(new.input_snapshot, '{harness}', jsonb_build_object(
    'id', selected_harness.id,
    'version', selected_harness.version,
    'content', selected_harness.instructions,
    'content_hash', selected_harness.content_hash,
    'adapter', 'codex',
    'model', planning_executor ->> 'model',
    'prompt_version', selected_harness.slug
  ), true);
  new.input_snapshot := jsonb_set(new.input_snapshot, '{executor}', jsonb_build_object(
    'provider', 'codex',
    'adapter', 'codex',
    'model', planning_executor ->> 'model',
    'prompt_version', selected_harness.slug
  ), true);
  new.model := planning_executor ->> 'model';
  new.prompt_version := selected_harness.slug;
  return new;
end;
$function$
