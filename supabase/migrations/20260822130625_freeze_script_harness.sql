alter table public.prompt_versions add column content_hash text;

create function public.freeze_prompt_harness()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(btrim(new.instructions), '') = '' then
    raise exception 'Prompt Harness content is required' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (
    new.account_id is distinct from old.account_id
    or new.capability is distinct from old.capability
    or new.version is distinct from old.version
    or new.slug is distinct from old.slug
    or new.name is distinct from old.name
    or new.summary is distinct from old.summary
    or new.instructions is distinct from old.instructions
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Prompt Harness content is immutable';
  end if;

  new.content_hash := encode(extensions.digest(new.instructions, 'sha256'), 'hex');
  return new;
end;
$$;

create trigger prompt_versions_freeze_harness
before insert or update on public.prompt_versions
for each row execute function public.freeze_prompt_harness();

update public.prompt_versions set instructions = instructions;

alter table public.prompt_versions
  alter column content_hash set not null,
  add constraint prompt_versions_content_hash_check check (content_hash ~ '^[0-9a-f]{64}$');

create or replace function public.commission_script(
  p_episode_id uuid,
  p_creative_direction text,
  p_core_content text
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_episode public.episodes;
  blueprint_policy jsonb;
  selected_harness public.prompt_versions;
  allowed_tools jsonb;
  budget_limit integer;
  adapter text;
  harness_id_text text;
  executor_model text;
  task_snapshot jsonb;
  created_task public.tasks;
begin
  if coalesce(btrim(p_creative_direction), '') = '' or coalesce(btrim(p_core_content), '') = '' then
    raise exception 'Creative direction and core content are required' using errcode = '22023';
  end if;

  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = auth.uid() and membership.role = 'owner'
  for update of episode;
  if not found then
    raise exception 'Owner membership is required to commission a script' using errcode = '42501';
  end if;
  if current_episode.stage <> 'waiting_input' or current_episode.main_script_revision_id is not null then
    raise exception 'Only an episode waiting for its main script can commission script writing' using errcode = '22023';
  end if;
  if exists (select 1 from public.tasks where episode_id = p_episode_id and task_type = 'draft_script') then
    raise exception 'A script commission already exists for this episode' using errcode = '22023';
  end if;

  select policy into blueprint_policy from public.account_blueprint_versions where id = current_episode.blueprint_version_id;
  if jsonb_typeof(blueprint_policy -> 'allowed_tools') <> 'array'
    or jsonb_array_length(blueprint_policy -> 'allowed_tools') = 0
    or exists (
      select 1 from jsonb_array_elements(blueprint_policy -> 'allowed_tools') tool
      where jsonb_typeof(tool) <> 'string' or coalesce(btrim(tool #>> '{}'), '') = ''
    ) then
    raise exception 'Blueprint % has invalid allowed_tools', current_episode.blueprint_version_id using errcode = '22023';
  end if;
  if jsonb_typeof(blueprint_policy #> '{budgets,script_writing_cents}') <> 'number'
    or blueprint_policy #>> '{budgets,script_writing_cents}' !~ '^[0-9]+$' then
    raise exception 'Blueprint % has invalid script writing budget', current_episode.blueprint_version_id using errcode = '22023';
  end if;

  adapter := nullif(btrim(blueprint_policy #>> '{executors,script_writing,adapter}'), '');
  if adapter is null and blueprint_policy #>> '{executors,script_writing,provider}' = 'codex' then adapter := 'codex'; end if;
  executor_model := nullif(btrim(blueprint_policy #>> '{executors,script_writing,model}'), '');
  if adapter <> 'codex' or executor_model is null then
    raise exception 'Blueprint % must select a registered Codex script Harness and model', current_episode.blueprint_version_id using errcode = '22023';
  end if;

  harness_id_text := nullif(btrim(blueprint_policy #>> '{executors,script_writing,harness_id}'), '');
  if harness_id_text is not null then
    if harness_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Blueprint % has an invalid script Harness id', current_episode.blueprint_version_id using errcode = '22023';
    end if;
    select harness.* into selected_harness
    from public.prompt_versions harness
    where harness.id = harness_id_text::uuid
      and harness.account_id = current_episode.account_id
      and harness.capability = 'script_writing'
      and harness.is_active;
  elsif blueprint_policy #>> '{executors,script_writing,provider}' = 'codex'
    and coalesce(btrim(blueprint_policy #>> '{executors,script_writing,prompt_version}'), '') <> '' then
    select harness.* into selected_harness
    from public.prompt_versions harness
    where harness.account_id = current_episode.account_id
      and harness.capability = 'script_writing'
      and harness.slug = blueprint_policy #>> '{executors,script_writing,prompt_version}'
      and harness.is_active;
  end if;
  if not found then
    raise exception 'Blueprint % must select an active script Harness from its account', current_episode.blueprint_version_id using errcode = '22023';
  end if;
  if coalesce(btrim(selected_harness.instructions), '') = '' then
    raise exception 'Selected script Harness content is empty' using errcode = '22023';
  end if;

  allowed_tools := blueprint_policy -> 'allowed_tools';
  budget_limit := (blueprint_policy #>> '{budgets,script_writing_cents}')::integer;
  task_snapshot := jsonb_build_object(
    'capability', 'script_writing',
    'commission', jsonb_build_object(
      'creative_direction', btrim(p_creative_direction),
      'core_content', btrim(p_core_content)
    ),
    'harness', jsonb_build_object(
      'id', selected_harness.id,
      'version', selected_harness.version,
      'content', selected_harness.instructions,
      'content_hash', selected_harness.content_hash,
      'adapter', 'codex',
      'model', executor_model,
      'prompt_version', selected_harness.slug
    ),
    'executor', jsonb_build_object(
      'provider', 'codex',
      'adapter', 'codex',
      'model', executor_model,
      'prompt_version', selected_harness.slug
    ),
    'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', 2),
    'allowed_tools', allowed_tools,
    'output', jsonb_build_object(
      'required_artifact_types', jsonb_build_array('script'),
      'content_type', 'text/markdown',
      'relative_path', format('episodes/%s/generated-script-v1.md', current_episode.id),
      'review_stage', 'script_review'
    ),
    'input_artifacts', '[]'::jsonb
  );
  task_snapshot := task_snapshot || jsonb_build_object(
    'prompt_context', public.build_prompt_context(current_episode.id, task_snapshot)
  );

  update public.episodes
  set script_source = 'delegated', updated_at = now()
  where id = current_episode.id;

  insert into public.tasks (
    episode_id, task_type, status, input_snapshot, budget_limit_cents,
    max_attempts, provider, model, prompt_version
  ) values (
    current_episode.id,
    'draft_script',
    'ready',
    task_snapshot,
    budget_limit,
    2,
    'codex',
    executor_model,
    selected_harness.slug
  ) returning * into created_task;

  update public.episodes set stage = 'script_draft', updated_at = now() where id = current_episode.id;
  insert into public.state_transitions (episode_id, from_stage, to_stage, reason, actor_id)
  values (current_episode.id, 'waiting_input', 'script_draft', 'Owner froze creative direction, episode prompt, and Harness for script writing.', auth.uid());
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (
    current_episode.account_id,
    current_episode.id,
    'script_commissioned',
    jsonb_build_object(
      'task_id', created_task.id,
      'creative_direction', btrim(p_creative_direction),
      'core_content', btrim(p_core_content),
      'harness_id', selected_harness.id,
      'harness_version', selected_harness.version,
      'harness_content_hash', selected_harness.content_hash
    ),
    auth.uid()
  );
  return created_task;
end;
$$;

create or replace function public.freeze_worker_task_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_task public.tasks;
  selected_episode public.episodes;
begin
  select * into selected_task from public.tasks where id = new.task_id;
  if selected_task.task_type not in ('draft_script', 'prepare_visual_brief', 'draft_storyboard', 'generate_a_roll', 'generate_b_roll', 'generate_narration', 'extract_embedded_audio', 'generate_soundtrack') then return new; end if;
  select * into selected_episode from public.episodes where id = selected_task.episode_id;
  new.task_package := jsonb_strip_nulls(jsonb_build_object(
    'version', 'worker-task/v1',
    'task', jsonb_build_object('id', selected_task.id, 'type', selected_task.task_type, 'attempt', new.attempt),
    'episode', jsonb_build_object('id', selected_episode.id, 'account_id', selected_episode.account_id, 'blueprint_version_id', selected_episode.blueprint_version_id, 'title', selected_episode.title),
    'capability', selected_task.input_snapshot -> 'capability',
    'commission', selected_task.input_snapshot -> 'commission',
    'harness', selected_task.input_snapshot -> 'harness',
    'review_feedback', selected_task.input_snapshot -> 'review_feedback',
    'review_annotations', selected_task.input_snapshot -> 'review_annotations',
    'script_revision', selected_task.input_snapshot -> 'script_revision',
    'series_baseline', selected_task.input_snapshot -> 'series_baseline',
    'visual_review_package', selected_task.input_snapshot -> 'visual_review_package',
    'storyboard_review_package_id', selected_task.input_snapshot -> 'storyboard_review_package_id',
    'shot', selected_task.input_snapshot -> 'shot',
    'executor', selected_task.input_snapshot -> 'executor',
    'media', selected_task.input_snapshot -> 'media',
    'audio_track', selected_task.input_snapshot -> 'audio_track',
    'scheduling', selected_task.input_snapshot -> 'scheduling',
    'budget', (selected_task.input_snapshot -> 'budget') || jsonb_build_object('attempt', new.attempt),
    'allowed_tools', selected_task.input_snapshot -> 'allowed_tools',
    'output', selected_task.input_snapshot -> 'output',
    'input_artifacts', selected_task.input_snapshot -> 'input_artifacts',
    'forbidden_actions', jsonb_build_array('approve', 'publish', 'change_blueprint', 'change_episode_stage')
  ));
  return new;
end;
$$;

create or replace function public.claim_next_worker_task(p_task_id uuid default null)
returns table (task_id uuid, task_type text, attempt integer, budget_limit_cents integer, max_attempts integer, provider text, model text, prompt_version text, episode_id uuid, account_id uuid, blueprint_version_id uuid, title text, allowed_asset_root text, input_snapshot jsonb)
language plpgsql security definer set search_path = ''
as $$
declare reclaimed_task public.tasks; selected_task public.tasks;
begin
  if p_task_id is null then
    for reclaimed_task in select * from public.tasks where status = 'running' and claimed_at < now() - interval '30 minutes' for update skip locked
    loop
      update public.task_runs task_run set status = 'failed', result = jsonb_build_object('version','worker-result/v1','taskId',reclaimed_task.id,'status','failed','artifacts',jsonb_build_array(),'validation',jsonb_build_object('passed',false,'checks',jsonb_build_array(jsonb_build_object('name','worker_lease','passed',false,'detail','Worker lease expired before it reported a result.'))),'actualCostCents',0,'blockers',jsonb_build_array(),'retry',jsonb_build_object('shouldRetry',reclaimed_task.attempt < reclaimed_task.max_attempts,'reason','Worker lease expired.'),'nextStep','Retry the task only after the worker is available.'), completed_at = now() where task_run.task_id = reclaimed_task.id and task_run.status = 'running';
      update public.tasks task set status = case when reclaimed_task.attempt < reclaimed_task.max_attempts then 'ready'::public.task_status else 'failed'::public.task_status end, claimed_at = null, completed_at = case when reclaimed_task.attempt < reclaimed_task.max_attempts then null else now() end, last_result = jsonb_build_object('version','worker-result/v1','taskId',reclaimed_task.id,'status','failed','artifacts',jsonb_build_array(),'validation',jsonb_build_object('passed',false,'checks',jsonb_build_array(jsonb_build_object('name','worker_lease','passed',false,'detail','Worker lease expired before it reported a result.'))),'actualCostCents',0,'blockers',jsonb_build_array(),'retry',jsonb_build_object('shouldRetry',reclaimed_task.attempt < reclaimed_task.max_attempts,'reason','Worker lease expired.'),'nextStep','Retry the task only after the worker is available.') where task.id = reclaimed_task.id;
      insert into public.audit_events (account_id,episode_id,event_type,payload,actor_id) select episode.account_id,episode.id,'worker_lease_expired',jsonb_build_object('task_id',reclaimed_task.id,'attempt',reclaimed_task.attempt - 1),null from public.episodes episode where episode.id = reclaimed_task.episode_id;
    end loop;
  end if;
  select * into selected_task from public.tasks task where task.status = 'ready' and task.provider in ('codex','google_tts','pexels','ffmpeg','freesound','hyperframes') and task.attempt < task.max_attempts and (p_task_id is null or task.id = p_task_id) order by task.created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.tasks task set status = 'running', claimed_at = now(), attempt = task.attempt + 1 where task.id = selected_task.id;
  insert into public.task_runs (task_id,attempt,task_package)
  select selected_task.id, selected_task.attempt, jsonb_build_object('version','worker-task/v1','task_id',selected_task.id,'task_type',selected_task.task_type,'attempt',selected_task.attempt,'budget_limit_cents',selected_task.budget_limit_cents,'max_attempts',selected_task.max_attempts,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'episode_id',episode.id,'account_id',account.id,'blueprint_version_id',episode.blueprint_version_id,'allowed_asset_root',coalesce(blueprint.policy ->> 'asset_root',''),'input_snapshot',selected_task.input_snapshot || jsonb_build_object('prompt_context', coalesce(selected_task.input_snapshot -> 'prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot))))
  from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
  return query select selected_task.id,selected_task.task_type,selected_task.attempt,selected_task.budget_limit_cents,selected_task.max_attempts,selected_task.provider,selected_task.model,selected_task.prompt_version,episode.id,account.id,episode.blueprint_version_id,episode.title,coalesce(blueprint.policy ->> 'asset_root',''),selected_task.input_snapshot || jsonb_build_object('prompt_context', coalesce(selected_task.input_snapshot -> 'prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot))) from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
end;
$$;

revoke all on function public.freeze_prompt_harness() from public, anon, authenticated;
revoke all on function public.freeze_worker_task_run() from public, anon, authenticated;
revoke all on function public.claim_next_worker_task(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_worker_task(uuid) to service_role;
revoke execute on function public.commission_script(uuid, text, text) from public, anon;
grant execute on function public.commission_script(uuid, text, text) to authenticated;
