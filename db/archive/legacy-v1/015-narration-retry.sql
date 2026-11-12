-- Preserve ordinary configuration uniqueness; explicit native retries append history.
DROP INDEX public.tasks_one_narration_per_storyboard_cue_configuration_revision_i;
CREATE UNIQUE INDEX tasks_one_narration_per_storyboard_cue_configuration_revision_i ON public.tasks(episode_id,(input_snapshot->>'storyboard_review_package_id'),(input_snapshot#>>'{audio_track,cue_id}'),(input_snapshot->>'configuration_hash'),coalesce(input_snapshot->>'pre_render_revision',''),coalesce(input_snapshot->>'native_tts_retry_id','')) WHERE task_type='generate_narration';
CREATE OR REPLACE FUNCTION local_identity.generate_input_shot_tts(p_episode_id uuid, p_review_package_id uuid, p_shot_id text, p_retry boolean DEFAULT false)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  native_retry_id uuid;
  current_episode public.episodes;
  selected_package public.review_packages;
  draft public.shot_preparation_drafts;
  blueprint_policy jsonb;
  narration_config jsonb;
  executor jsonb;
  voice jsonb;
  existing_task public.tasks;
  created_task public.tasks;
  provider text;
  adapter text;
  model text;
  prompt_version text;
  credential_ref text;
  config_hash text;
  budget_limit integer;
  max_attempts integer;
  task_snapshot jsonb;
begin
  select episode.* into current_episode
  from public.episodes episode
  join public.account_memberships membership on membership.account_id = episode.account_id
  where episode.id = p_episode_id and membership.user_id = local_identity.owner_id() and membership.role = 'owner'
  for update of episode;
  if not found then raise exception 'Owner membership is required to generate shot narration' using errcode = '42501'; end if;
  IF NOT EXISTS(SELECT 1 FROM local_identity.input_episodes i WHERE i.episode_id=p_episode_id AND i.owner_id=local_identity.owner_id() AND i.enabled AND i.storyboard_enabled) THEN RAISE EXCEPTION 'Native managed storyboard required' USING ERRCODE='42501'; END IF;
  if current_episode.stage not in ('storyboard_approved', 'production_ready', 'render_ready', 'qc_review') then raise exception 'Shot narration can only be generated in the shot workbench' using errcode = '22023'; end if;

  select package.* into selected_package
  from public.review_packages package
  join public.approvals approval on approval.review_package_id = package.id and approval.stage = 'storyboard_approved' and approval.decision = 'approved'
  where package.id = p_review_package_id and package.episode_id = p_episode_id and package.stage = 'storyboard_review' and package.invalidated_at is null
  for update of package;
  if not found then raise exception 'The approved storyboard review package is required' using errcode = '22023'; end if;

  select * into draft from public.shot_preparation_drafts
  where episode_id = p_episode_id and review_package_id = p_review_package_id and shot_id = btrim(p_shot_id)
  for update;
  if not found then raise exception 'The shot preparation draft is required' using errcode = '22023'; end if;
  if draft.audio_mode <> 'tts' then raise exception 'Only TTS shots can generate narration' using errcode = '22023'; end if;
  if coalesce(btrim(coalesce(draft.tts_text, draft.subtitle_text)), '') = '' or coalesce(btrim(draft.tts_voice), '') = '' or draft.tts_speaking_rate is null or draft.tts_speaking_rate <= 0 then
    raise exception 'TTS 草稿必须包含口播内容、声音和有效语速' using errcode = '22023';
  end if;

  select blueprint.policy into blueprint_policy from public.account_blueprint_versions blueprint where blueprint.id = current_episode.blueprint_version_id;
  narration_config := blueprint_policy -> 'narration';
  executor := narration_config -> 'executor';
  provider := executor ->> 'provider';
  adapter := executor ->> 'adapter';
  model := coalesce(nullif(btrim(executor ->> 'model'), ''), 'standard');
  prompt_version := coalesce(nullif(btrim(executor ->> 'prompt_version'), ''), 'narration-v1');
  credential_ref := nullif(btrim(narration_config ->> 'credential_ref'), '');
  if (provider, adapter) not in (('google_tts', 'google_tts'), ('volcengine_tts', 'volcengine_tts')) then
    raise exception '蓝图没有可执行的 TTS Adapter' using errcode = '22023';
  end if;
  if credential_ref is null or credential_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (
    select 1 from public.external_connection_versions version
    join public.external_connections connection on connection.id = version.connection_id
    where version.id = credential_ref::uuid and connection.created_by = local_identity.owner_id()
      and connection.current_version_id = version.id and version.provider = provider and version.adapter = adapter
      and version.revoked_at is null and public.connection_version_is_verified(version.id)
  ) then
    raise exception 'TTS 外部连接版本未验证或与当前蓝图不兼容' using errcode = '22023';
  end if;
  voice := jsonb_build_object(
    'language_code', coalesce(nullif(btrim(draft.tts_language_code), ''), nullif(btrim(narration_config #>> '{voice,language_code}'), ''), 'zh-CN'),
    'name', draft.tts_voice,
    'speaking_rate', draft.tts_speaking_rate
  );
  config_hash := md5(jsonb_build_object('text', coalesce(draft.tts_text, draft.subtitle_text), 'voice', voice, 'provider', provider, 'adapter', adapter, 'model', model, 'prompt_version', prompt_version, 'connection_version_id', credential_ref)::text);

  select task.* into existing_task from public.tasks task
  where task.episode_id = p_episode_id and task.task_type = 'generate_narration'
    and task.input_snapshot #>> '{shot_preparation,draft_id}' = draft.id::text
    and task.input_snapshot ->> 'configuration_hash' = config_hash
  order by task.created_at desc for update limit 1;
  if found and existing_task.status in ('ready', 'running') then return existing_task; end if;
  if found and existing_task.status = 'completed' and public.restore_completed_shot_tts_track(draft.id, existing_task.id) then return existing_task; end if;
  if found and existing_task.status = 'failed' and not p_retry then return existing_task; end if;

  IF FOUND AND existing_task.status='failed' AND p_retry THEN native_retry_id:=gen_random_uuid(); END IF;
  budget_limit := case when (narration_config ->> 'budget_cents') ~ '^[0-9]+$' then (narration_config ->> 'budget_cents')::integer else 0 end;
  max_attempts := case when (narration_config ->> 'max_attempts') ~ '^[1-9][0-9]*$' then (narration_config ->> 'max_attempts')::integer else 1 end;
  task_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'native_tts_retry_id',native_retry_id,'capability', 'narration_generation', 'storyboard_review_package_id', p_review_package_id,
    'configuration_hash', config_hash, 'credential_ref', credential_ref,
    'shot_preparation', jsonb_build_object('draft_id', draft.id, 'episode_id', p_episode_id, 'review_package_id', p_review_package_id, 'shot_id', draft.shot_id),
    'executor', jsonb_build_object('provider', provider, 'adapter', adapter, 'model', model, 'prompt_version', prompt_version),
    'media', jsonb_build_object('adapter', adapter, 'narration', jsonb_build_object('text', coalesce(draft.tts_text, draft.subtitle_text), 'voice', voice)), 'acoustic_alignment', jsonb_build_object('confirmed_text', draft.subtitle_text, 'text_fingerprint', encode(extensions.digest(convert_to(draft.subtitle_text, 'UTF8'), 'sha256'), 'hex')),
    'audio_track', jsonb_build_object('kind', 'narration', 'cue_id', draft.shot_id, 'source_review_package_id', p_review_package_id, 'start_seconds', 0, 'duration_seconds', 0.001),
    'budget', jsonb_build_object('limit_cents', budget_limit, 'max_attempts', max_attempts),
    'allowed_tools', coalesce(narration_config -> 'allowed_tools', jsonb_build_array('read', 'write')),
    'output', jsonb_build_object('required_artifact_types', jsonb_build_array('narration_audio'), 'content_type', 'audio/mpeg', 'relative_path', format('episodes/%s/audio/shot-narration-%s-%s.mp3', p_episode_id, draft.shot_id, config_hash||CASE WHEN native_retry_id IS NULL THEN '' ELSE '-retry-'||native_retry_id::text END), 'review_stage', 'production_ready'),
    'input_artifacts', jsonb_build_array()
  ));
  insert into public.tasks (episode_id, task_type, status, input_snapshot, budget_limit_cents, max_attempts, provider, model, prompt_version)
  values (p_episode_id, 'generate_narration', 'ready'::public.task_status, task_snapshot, budget_limit, max_attempts, provider, model, prompt_version)
  returning * into created_task;
  update public.shot_preparation_drafts
  set current_audio_track_id = null, current_tts_task_id = null, tts_actual_duration_seconds = null, audio_status = 'running', pending_tts_task_id = created_task.id, tts_error = null, updated_at = now()
  where id = draft.id;
  insert into public.audit_events (account_id, episode_id, event_type, payload, actor_id)
  values (current_episode.account_id, p_episode_id, 'shot_tts_generation_requested', jsonb_build_object('task_id', created_task.id, 'shot_id', draft.shot_id, 'configuration_hash', config_hash, 'retry', p_retry), local_identity.owner_id());
  return created_task;
end;
$function$;
REVOKE ALL ON FUNCTION local_identity.generate_input_shot_tts(uuid,uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.generate_input_shot_tts(uuid,uuid,text,boolean) TO loop_owner;
REVOKE EXECUTE ON FUNCTION public.generate_shot_tts(uuid,uuid,text,boolean) FROM loop_owner;
