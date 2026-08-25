create or replace function public.freeze_openai_image_generation_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  blueprint_policy jsonb;
  image_generation jsonb;
begin
  if new.task_type <> 'prepare_visual_brief' then
    return new;
  end if;

  select policy into blueprint_policy
  from public.account_blueprint_versions
  where id = (select blueprint_version_id from public.episodes where id = new.episode_id);
  image_generation := new.input_snapshot #> '{visual_assets,image_generation}';
  if image_generation is null then
    return new;
  end if;

  new.input_snapshot := jsonb_set(
    new.input_snapshot,
    '{visual_assets,image_generation}',
    jsonb_build_object(
      'provider', blueprint_policy #>> '{static_visual,executor,provider}',
      'adapter', blueprint_policy #>> '{static_visual,executor,adapter}',
      'model', blueprint_policy #>> '{static_visual,executor,model}',
      'credential_ref', blueprint_policy #>> '{static_visual,credential_ref}',
      'budget_cents', blueprint_policy #> '{static_visual,budget_cents}',
      'max_attempts', blueprint_policy #> '{static_visual,max_attempts}'
    )
  );
  return new;
end;
$$;

drop trigger if exists freeze_openai_image_generation_config_before_insert on public.tasks;
create trigger freeze_openai_image_generation_config_before_insert
before insert on public.tasks
for each row execute function public.freeze_openai_image_generation_config();

revoke all on function public.freeze_openai_image_generation_config() from public, anon, authenticated;
