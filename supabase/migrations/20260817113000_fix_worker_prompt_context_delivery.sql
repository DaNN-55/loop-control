create function public.build_prompt_context(p_episode_id uuid, p_input_snapshot jsonb)
returns jsonb
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
  select episode.* into selected_episode from public.episodes episode where episode.id = p_episode_id;
  if not found then raise exception 'Prompt context Episode does not exist' using errcode = 'P0002'; end if;
  select policy into blueprint_policy from public.account_blueprint_versions where id = selected_episode.blueprint_version_id;
  select series_version.* into selected_series_version from public.series_versions series_version where series_version.id = selected_episode.series_version_id and series_version.account_id = selected_episode.account_id;
  context := jsonb_strip_nulls(jsonb_build_object(
    'version', 'prompt-context/v1',
    'blueprint_version_id', selected_episode.blueprint_version_id,
    'series_version_id', selected_series_version.id,
    'account_hard_constraints', jsonb_strip_nulls(jsonb_build_object('approval_gates', blueprint_policy -> 'approval_gates', 'allowed_tools', blueprint_policy -> 'allowed_tools', 'asset_root', blueprint_policy -> 'asset_root', 'restrictions', blueprint_policy -> 'restrictions', 'publishing', blueprint_policy -> 'publishing')),
    'account_defaults', jsonb_strip_nulls(jsonb_build_object('positioning', blueprint_policy -> 'positioning', 'audience', blueprint_policy -> 'audience', 'tone', blueprint_policy -> 'tone', 'brand_voice', blueprint_policy -> 'brand_voice', 'visual_style', blueprint_policy -> 'visual_style', 'subtitle_style', blueprint_policy -> 'subtitle_style', 'language', blueprint_policy -> 'language', 'creative_rules', blueprint_policy -> 'creative_rules')),
    'series_baseline', case when selected_series_version.id is null then null else jsonb_build_object('version_id', selected_series_version.id, 'version', selected_series_version.version, 'rules', selected_series_version.rules) end,
    'episode_input', jsonb_strip_nulls(jsonb_build_object('commission', p_input_snapshot -> 'commission', 'script_revision', p_input_snapshot -> 'script_revision', 'input_artifacts', p_input_snapshot -> 'input_artifacts', 'shot', p_input_snapshot -> 'shot', 'media', p_input_snapshot -> 'media')),
    'review_feedback', p_input_snapshot -> 'review_feedback'
  ));
  return context || jsonb_build_object('hash', md5(context::text));
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
  select selected_task.id, selected_task.attempt, jsonb_build_object('version','worker-task/v1','task_id',selected_task.id,'task_type',selected_task.task_type,'attempt',selected_task.attempt,'budget_limit_cents',selected_task.budget_limit_cents,'max_attempts',selected_task.max_attempts,'provider',selected_task.provider,'model',selected_task.model,'prompt_version',selected_task.prompt_version,'episode_id',episode.id,'account_id',account.id,'blueprint_version_id',episode.blueprint_version_id,'allowed_asset_root',coalesce(blueprint.policy ->> 'asset_root',''),'input_snapshot',selected_task.input_snapshot || jsonb_build_object('prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot)))
  from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
  return query select selected_task.id,selected_task.task_type,selected_task.attempt,selected_task.budget_limit_cents,selected_task.max_attempts,selected_task.provider,selected_task.model,selected_task.prompt_version,episode.id,account.id,episode.blueprint_version_id,episode.title,coalesce(blueprint.policy ->> 'asset_root',''),selected_task.input_snapshot || jsonb_build_object('prompt_context', public.build_prompt_context(episode.id, selected_task.input_snapshot)) from public.episodes episode join public.accounts account on account.id = episode.account_id join public.account_blueprint_versions blueprint on blueprint.id = episode.blueprint_version_id where episode.id = selected_task.episode_id;
end;
$$;

revoke all on function public.build_prompt_context(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_next_worker_task(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_worker_task(uuid) to service_role;
