-- Native Wan: existing budgets and reservations remain intact. No secrets,
-- automatic budget approval, Provider calls or historical task replay.
ALTER TABLE public.external_connections DROP CONSTRAINT external_connections_provider_adapter_check;
ALTER TABLE public.external_connections ADD CONSTRAINT external_connections_provider_adapter_check CHECK((provider,adapter) IN (('pexels','pexels_video'),('freesound','freesound_preview'),('openai','openai_images'),('cloudflare','workers_ai_images'),('google_tts','google_tts'),('volcengine_tts','volcengine_tts'),('bailian','wan_video')));
create or replace function public.official_external_connection_endpoint(p_provider text,p_adapter text)
returns text language sql immutable set search_path='' as $$
select case
 when p_provider='bailian' and p_adapter='wan_video' then 'https://dashscope.aliyuncs.com'
 when p_provider='pexels' and p_adapter='pexels_video' then 'https://api.pexels.com'
 when p_provider='freesound' and p_adapter='freesound_preview' then 'https://freesound.org/apiv2'
 when p_provider='openai' and p_adapter='openai_images' then 'https://api.openai.com/v1'
 when p_provider='cloudflare' and p_adapter='workers_ai_images' then 'https://api.cloudflare.com/client/v4'
 when p_provider='google_tts' and p_adapter='google_tts' then 'https://texttospeech.googleapis.com/v1'
 when p_provider='volcengine_tts' and p_adapter='volcengine_tts' then 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse'
end $$;

create or replace function public.validate_blueprint_external_connections()
returns trigger language plpgsql security definer set search_path='' as $$
declare k text; ref text; expected_provider text; expected_adapter text;
begin
 foreach k in array array['a_roll','b_roll','soundtrack','narration','static_visual'] loop
  ref:=nullif(btrim(new.policy #>> array[k,'credential_ref']),'');
  if ref is null then continue; end if;
  expected_provider:=new.policy #>> array[k,'executor','provider']; expected_adapter:=new.policy #>> array[k,'executor','adapter'];
  if not coalesce(case k
   when 'a_roll' then (expected_provider,expected_adapter)=('bailian','wan_video')
   when 'b_roll' then (expected_provider,expected_adapter) in (('bailian','wan_video'),('pexels','pexels_video'))
   when 'soundtrack' then (expected_provider,expected_adapter)=('freesound','freesound_preview')
   when 'narration' then (expected_provider,expected_adapter) in (('google_tts','google_tts'),('volcengine_tts','volcengine_tts'))
   when 'static_visual' then (expected_provider,expected_adapter) in (('openai','openai_images'),('cloudflare','workers_ai_images')) end,false)
  then raise exception '% uses an incompatible connection Adapter',k using errcode='22023'; end if;
  if ref !~ '^[0-9a-f-]{36}$' or not exists (
   select 1 from public.external_connection_versions v join public.external_connections c on c.id=v.connection_id
   join public.account_memberships m on m.account_id=new.account_id and m.user_id=c.created_by and m.role='owner'
   where v.id=ref::uuid and c.created_by=local_identity.owner_id() and c.current_version_id=v.id and v.revoked_at is null
   and v.provider=expected_provider and v.adapter=expected_adapter and public.connection_version_is_verified(v.id)
  ) then raise exception '% requires this Owner current verified connection',k using errcode='22023'; end if;
 end loop;
 return new;
end $$;

CREATE FUNCTION public.set_generation_budget(p_account_id uuid,p_trial_cents integer,p_total_cents integer,p_full boolean default false)
returns public.generation_account_budgets language plpgsql security definer set search_path='' as $$
declare result public.generation_account_budgets;
begin
 if not exists(select 1 from public.account_memberships where account_id=p_account_id and user_id=local_identity.owner_id() and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 if p_trial_cents is null or p_total_cents is null or p_full is null or p_trial_cents<1 or p_total_cents<p_trial_cents or p_total_cents>100000 then raise exception 'Invalid approved budget'; end if;
 insert into public.generation_account_budgets(account_id,trial_video_limit_cents,total_limit_cents,full_generation_enabled,approved_by)
 values(p_account_id,p_trial_cents,p_total_cents,p_full,local_identity.owner_id())
 on conflict(account_id) do update set trial_video_limit_cents=excluded.trial_video_limit_cents,total_limit_cents=excluded.total_limit_cents,full_generation_enabled=excluded.full_generation_enabled,approved_by=excluded.approved_by,approved_at=now() returning * into result;
 insert into public.audit_events(account_id,event_type,payload,actor_id) values(p_account_id,'generation_budget_approved',jsonb_build_object('trial_cents',p_trial_cents,'total_cents',p_total_cents,'full',p_full),local_identity.owner_id());
 return result;
end $$;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_wan_request_id_idx ON public.tasks((input_snapshot->>'wan_request_id')) WHERE provider='bailian';
CREATE FUNCTION public.request_wan_shot_video(p_episode_id uuid,p_review_package_id uuid,p_shot_id text,p_first_frame_id uuid,p_prompt text,p_duration integer,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.episodes; rp public.review_packages; src public.production_material_revisions; s jsonb; cfg jsonb; pol jsonb; ref uuid; tid uuid:=gen_random_uuid(); existing uuid; image jsonb; typ text;
begin
 if not local_identity.lock_owned_input_episode(p_episode_id) then raise exception 'Managed Owner Episode required' using errcode='42501'; end if;
 select * into e from public.episodes where id=p_episode_id for update;
 if not found or not exists(select 1 from public.account_memberships where account_id=e.account_id and user_id=local_identity.owner_id() and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 select id into existing from public.tasks where provider='bailian' and input_snapshot->>'wan_request_id'=p_request_id::text and episode_id=e.id;
 if found then
  if not exists(select 1 from public.tasks where id=existing and input_snapshot->>'storyboard_review_package_id'=p_review_package_id::text and input_snapshot#>>'{shot,id}'=p_shot_id and input_snapshot#>>'{media,wan_video,first_frame,relativePath}'=(select storage_path from public.production_material_revisions where id=p_first_frame_id and episode_id=e.id) and input_snapshot#>>'{media,wan_video,prompt}'=btrim(p_prompt) and input_snapshot#>>'{media,wan_video,duration_seconds}'=p_duration::text) then raise exception 'Request identity changed'; end if;
  return existing; end if;
 if e.stage<>'storyboard_approved' then raise exception 'Return to the approved storyboard shot workbench first'; end if;
 select * into rp from public.review_packages where id=p_review_package_id and episode_id=e.id and stage='storyboard_review' and invalidated_at is null and revision_number=(select max(revision_number) from public.review_packages where episode_id=e.id and stage='storyboard_review' and invalidated_at is null);
 if not found or not exists(select 1 from public.approvals where review_package_id=rp.id and stage='storyboard_approved' and decision='approved') then raise exception 'Approved current storyboard required'; end if;
 select value into s from jsonb_array_elements(rp.context_snapshot#>'{worker_result,storyboard,shots}') where value->>'id'=p_shot_id;
 if s is null or s->>'shotType' not in ('a_roll','b_roll') then raise exception 'Unknown storyboard shot'; end if;
 typ:=s->>'shotType'; select policy into pol from public.account_blueprint_versions where id=e.blueprint_version_id;
 cfg:=pol->typ;
 if cfg->>'execution_path' is distinct from 'external' or cfg#>>'{executor,provider}' is distinct from 'bailian' or cfg#>>'{executor,adapter}' is distinct from 'wan_video' or cfg#>>'{executor,model}' is distinct from 'wan2.6-i2v-flash' then raise exception 'Select a verified Bailian video connection for this shot capability'; end if;
 ref:=(cfg->>'credential_ref')::uuid;
 if not exists(select 1 from public.external_connection_versions v join public.external_connections c on c.id=v.connection_id where v.id=ref and c.created_by=local_identity.owner_id() and c.current_version_id=v.id and v.provider='bailian' and v.adapter='wan_video' and v.revoked_at is null and public.connection_version_is_verified(v.id)) then raise exception 'Current verified Bailian connection required'; end if;
 if p_request_id is null or p_prompt is null or p_duration is null or p_duration not between 2 and 15 or char_length(btrim(p_prompt)) not between 1 and 1500 then raise exception 'Prompt or duration invalid'; end if;
 if not exists(select 1 from public.generation_account_budgets where account_id=e.account_id) then raise exception 'Approve a generation budget first'; end if;
 select * into src from public.production_material_revisions where id=p_first_frame_id and episode_id=e.id and material_type='image' and mime_type in ('image/png','image/jpeg','image/webp','image/bmp') and file_size between 1 and 20971520;
 if not found then raise exception 'Select an uploaded first-frame image from this Episode'; end if;
 image:=jsonb_build_object('artifactType','wan_first_frame','relativePath',src.storage_path,'sha256',src.sha256,'fileSize',src.file_size);
 s:=jsonb_set(s,'{inputBasis}',jsonb_build_array(jsonb_build_object('relativePath',src.storage_path,'sha256',src.sha256)));
 insert into public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,budget_limit_cents,max_attempts,input_snapshot)
 values(tid,e.id,case typ when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end,'ready','bailian','wan2.6-i2v-flash','wan-video-v1',p_duration*15,1,
 jsonb_build_object('capability',typ||'_generation','wan_request_id',p_request_id,'requested_by',local_identity.owner_id(),'storyboard_review_package_id',rp.id,'configuration_hash',tid::text,'shot',s,'executor',cfg->'executor','credential_ref',ref,
 'allowed_tools',jsonb_build_array('read','write'),'budget',jsonb_build_object('limit_cents',p_duration*15,'max_attempts',1),
 'input_artifacts',jsonb_build_array(image),
 'media',jsonb_build_object('adapter','wan_video','wan_video',jsonb_build_object('first_frame',image,'prompt',btrim(p_prompt),'duration_seconds',p_duration,'image_mime',src.mime_type,'resolution','720P','audio',false)),
 'output',jsonb_build_object('content_type','video/mp4','required_artifact_types',jsonb_build_array(case typ when 'a_roll' then 'a_roll_video' else 'b_roll_asset' end),'relative_path',format('episodes/%s/wan/%s.mp4',e.id,tid),'review_stage','production_ready')));
 insert into public.audit_events(account_id,episode_id,event_type,payload,actor_id) values(e.account_id,e.id,'wan_video_requested',jsonb_build_object('task_id',tid,'shot_id',p_shot_id,'duration',p_duration,'estimated_cents',p_duration*15),local_identity.owner_id());
 return tid;
end $$;
CREATE FUNCTION public.resume_wan_video_task(p_task_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.tasks; aid uuid;
begin
 select * into t from public.tasks where id=p_task_id and provider='bailian' for update;
 if not local_identity.lock_owned_input_episode(t.episode_id) then raise exception 'Managed Owner Episode required' using errcode='42501'; end if;
 select account_id into aid from public.episodes where id=t.episode_id;
 if not exists(select 1 from public.account_memberships where account_id=aid and user_id=local_identity.owner_id() and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 if t.invalidated_at is not null or not exists(select 1 from public.episodes e join public.review_packages p on p.episode_id=e.id where e.id=t.episode_id and e.stage='storyboard_approved' and p.id::text=t.input_snapshot->>'storyboard_review_package_id' and p.invalidated_at is null and p.revision_number=(select max(revision_number) from public.review_packages where episode_id=e.id and stage='storyboard_review' and invalidated_at is null)) then raise exception 'Current approved storyboard required'; end if;
 if t.status not in ('failed','blocked') or not exists(select 1 from public.paid_generation_reservations where task_id=t.id and provider_task_id is not null) then raise exception 'Only a failed task with a saved supplier ID can resume; unknown submissions require manual supplier reconciliation'; end if;
 update public.tasks set status='ready',max_attempts=attempt+1,claimed_at=null,completed_at=null where id=t.id;
end $$;
CREATE FUNCTION local_identity.reserve_wan_generation(p_task_id uuid,p_attempt integer,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tasks; aid uuid; b public.generation_account_budgets; r public.paid_generation_reservations; amount integer; k text; used integer; video_used integer;
begin
 if local_identity.actor_role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501'; end if;
 perform public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
 if not exists(select 1 from public.tasks t where t.id=p_task_id and t.provider='bailian' and local_identity.input_task_allowed(t.episode_id,t.task_type)) then raise exception 'Managed Wan task required' using errcode='42501'; end if;
 select * into t from public.tasks where id=p_task_id and status='running' and attempt=p_attempt+1 for update;
 if not found then raise exception 'Current running task attempt required'; end if;
 select account_id into aid from public.episodes where id=t.episode_id;
 select * into b from public.generation_account_budgets where account_id=aid for update;
 if not found then
  if t.provider='bailian' then raise exception 'No approved paid-generation budget'; end if;
  return jsonb_build_object('new',true,'unlimited_legacy',true);
 end if;
 select * into r from public.paid_generation_reservations where task_id=t.id;
 if found then return to_jsonb(r)||jsonb_build_object('new',false); end if;
 if t.provider='bailian' then
  k:='video'; amount:=(t.input_snapshot#>>'{media,wan_video,duration_seconds}')::integer*15;
  if amount is null or amount<30 or amount>225 then raise exception 'Invalid frozen video duration'; end if;
 elsif t.provider in ('google_tts','volcengine_tts') and t.task_type='generate_narration' then
  k:='narration'; amount:=greatest(1,char_length(t.input_snapshot#>>'{media,narration,text}'));
  -- Conservatively reserve 0.01 CNY per character, above the approved public
  -- standard-voice rate. This is a reservation, not a claim about actual billing.
 else raise exception 'Unsupported paid task'; end if;
 select coalesce(sum(reserved_cents),0),coalesce(sum(reserved_cents) filter(where kind='video'),0) into used,video_used from public.paid_generation_reservations where account_id=aid;
 if used+amount>b.total_limit_cents then raise exception '整片视频与配音预算不足，已停止提交'; end if;
 if k='video' and not b.full_generation_enabled and video_used+amount>b.trial_video_limit_cents then raise exception '首轮试片预算已用完，请先审看试片再批准后续制作'; end if;
 insert into public.paid_generation_reservations(task_id,account_id,kind,reserved_cents) values(t.id,aid,k,amount) returning * into r;
 return to_jsonb(r)||jsonb_build_object('new',true);
end $$;
CREATE FUNCTION local_identity.record_wan_submission(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_provider_task_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if local_identity.actor_role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501'; end if;
 perform public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
 if not exists(select 1 from public.tasks t where t.id=p_task_id and t.provider='bailian' and local_identity.input_task_allowed(t.episode_id,t.task_type)) then raise exception 'Managed Wan task required' using errcode='42501'; end if;
 if char_length(p_provider_task_id) not between 1 and 128 or p_provider_task_id !~ '^[a-zA-Z0-9_-]+$' then raise exception 'Invalid supplier task ID'; end if;
 if not exists(select 1 from public.tasks where id=p_task_id and status='running' and attempt=p_attempt+1 and provider='bailian') then raise exception 'Current task attempt required'; end if;
 update public.paid_generation_reservations set provider_task_id=p_provider_task_id,request_state='submitted' where task_id=p_task_id and kind='video' and (provider_task_id is null or provider_task_id=p_provider_task_id);
 if not found then raise exception 'Reservation missing or supplier task changed'; end if;
end $$;
CREATE FUNCTION local_identity.register_wan_material(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_path text,p_sha256 text,p_size bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.tasks; r public.paid_generation_reservations; owner_id uuid; mid uuid; rev integer;
begin
 if local_identity.actor_role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501'; end if;
 perform public.assert_worker_lease(p_task_id,p_attempt,p_lease_token);
 select * into t from public.tasks where id=p_task_id and status='running' and attempt=p_attempt+1 and provider='bailian' for update;
 if not found then raise exception 'Current task attempt required'; end if;
 select * into r from public.paid_generation_reservations where task_id=t.id and provider_task_id is not null for update;
 if not found then raise exception 'Submitted video reservation required'; end if;
 if r.material_revision_id is not null then return r.material_revision_id; end if;
 if p_sha256 is null or p_size is null or p_path is distinct from t.input_snapshot#>>'{output,relative_path}' or p_sha256 !~ '^[0-9a-f]{64}$' or p_size<=0 then raise exception 'Invalid output manifest'; end if;
 owner_id:=(t.input_snapshot->>'requested_by')::uuid;
 if not exists(select 1 from public.account_memberships where account_id=r.account_id and user_id=owner_id and role='owner') then raise exception 'Original requesting Owner no longer has access'; end if;
 perform 1 from public.episodes where id=t.episode_id for update;
 select coalesce(max(revision_number),0)+1 into rev from public.production_material_revisions where episode_id=t.episode_id and material_type='video';
 insert into public.production_material_revisions(episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose)
 values(t.episode_id,rev,'video','worker','wan-'||(t.input_snapshot#>>'{shot,id}')||'.mp4',p_path,'video/mp4',p_sha256,p_size,false,owner_id,case t.task_type when 'generate_a_roll' then 'a_roll' else 'b_roll' end) returning id into mid;
 update public.paid_generation_reservations set request_state='succeeded',material_revision_id=mid where task_id=t.id;
 return mid;
end $$;
CREATE OR REPLACE FUNCTION local_identity.input_media_connection(p_task_id uuid,p_attempt integer,p_lease_token uuid,p_version_id uuid) RETURNS TABLE(version_id uuid,provider text,adapter text,endpoint text,secret_ref uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF local_identity.actor_role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker service role required' USING ERRCODE='42501'; END IF;
 PERFORM public.refresh_worker_task_lease(p_task_id,p_attempt,p_lease_token);
 RETURN QUERY SELECT v.id,v.provider,v.adapter,v.endpoint,b.secret_ref FROM public.tasks t
 JOIN local_identity.input_episodes i ON i.episode_id=t.episode_id AND i.enabled
 JOIN public.external_connection_versions v ON v.id=p_version_id
 JOIN public.external_connections c ON c.id=v.connection_id AND c.created_by=i.owner_id AND c.current_version_id=v.id
 JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=i.owner_id AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=v.id AND q.owner_id=i.owner_id AND q.qualified
 WHERE t.id=p_task_id AND v.revoked_at IS NULL AND (
  (i.media_enabled AND t.task_type IN ('generate_a_roll','generate_b_roll','generate_soundtrack') AND t.provider IN ('pexels','freesound','bailian') AND t.input_snapshot->>'credential_ref'=v.id::text AND v.provider=t.provider AND v.adapter=t.input_snapshot#>>'{media,adapter}') OR
  (t.task_type='prepare_visual_brief' AND v.provider IN ('openai','cloudflare') AND t.input_snapshot#>>'{visual_assets,image_generation,credential_ref}'=v.id::text AND v.provider=t.input_snapshot#>>'{visual_assets,image_generation,provider}' AND v.adapter=t.input_snapshot#>>'{visual_assets,image_generation,adapter}')
 ) AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence pe WHERE pe.version_id=v.id AND pe.mode='live' AND pe.outcome='verified');
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen media connection unavailable' USING ERRCODE='42501'; END IF;
END $$;

-- Extend existing claimant and planner functions without weakening their locks,
-- capacity, live lease, task scope or result generation checks.
DO $$ DECLARE sig text; original text; changed text; BEGIN
 FOREACH sig IN ARRAY ARRAY['local_identity.claim_input_task_pre_lease(uuid,integer)','public.claim_next_worker_task_legacy(uuid)','public.claim_next_worker_task_pre_lease(uuid,integer)'] LOOP
  original:=pg_get_functiondef(sig::regprocedure);
  changed:=replace(original,'''cloudflare'',''whisperx'')','''cloudflare'',''whisperx'',''bailian'')');
  IF changed=original THEN RAISE EXCEPTION 'Claim list changed: %',sig; END IF; EXECUTE changed;
 END LOOP;
 FOREACH sig IN ARRAY ARRAY['public.orchestrate_a_roll_tasks_for_episode(uuid)','public.orchestrate_b_roll_tasks_configured(uuid)'] LOOP
  original:=pg_get_functiondef(sig::regprocedure);
  changed:=regexp_replace(original,'begin',E'begin\n if exists(select 1 from public.episodes e join public.account_blueprint_versions b on b.id=e.blueprint_version_id where e.id=p_episode_id and b.policy #>> ''{'||case when sig like '%a_roll%' then 'a_roll' else 'b_roll' end||E',executor,provider}''=''bailian'') then return; end if;', 'i');
  IF changed=original THEN RAISE EXCEPTION 'Planner changed: %',sig; END IF; EXECUTE changed;
 END LOOP;
 original:=pg_get_functiondef('local_identity.retry_input_media(uuid,uuid)'::regprocedure);
 changed:=replace(original,'IF previous.task_type <>',E'IF previous.provider=''bailian'' THEN RAISE EXCEPTION ''Resume the saved Wan task; automatic paid retry is forbidden''; END IF;\n IF previous.task_type <>');
 IF changed=original THEN RAISE EXCEPTION 'Media retry guard changed'; END IF; EXECUTE changed;
 original:=pg_get_functiondef('local_identity.input_worker_call(text,jsonb)'::regprocedure);
 changed:=replace(original,'PERFORM public.report_worker_result(',E'IF p_args#>>''{p_result,status}''=''completed'' AND EXISTS(SELECT 1 FROM public.tasks WHERE id=selected_task_id AND provider=''bailian'') THEN\n PERFORM local_identity.register_wan_material(selected_task_id,(p_args->>''p_attempt'')::integer,(p_args->>''p_lease_token'')::uuid,p_args#>>''{p_result,artifacts,0,relativePath}'',p_args#>>''{p_result,artifacts,0,sha256}'',(p_args#>>''{p_result,artifacts,0,fileSize}'')::bigint);\n END IF;\n PERFORM public.report_worker_result(');
 IF changed=original THEN RAISE EXCEPTION 'Native result dispatcher changed'; END IF; EXECUTE changed;
END $$;
REVOKE ALL ON FUNCTION public.set_generation_budget(uuid,integer,integer,boolean),public.request_wan_shot_video(uuid,uuid,text,uuid,text,integer,uuid),public.resume_wan_video_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_generation_budget(uuid,integer,integer,boolean),public.request_wan_shot_video(uuid,uuid,text,uuid,text,integer,uuid),public.resume_wan_video_task(uuid) TO loop_owner;
REVOKE ALL ON FUNCTION local_identity.reserve_wan_generation(uuid,integer,uuid),local_identity.record_wan_submission(uuid,integer,uuid,text),local_identity.register_wan_material(uuid,integer,uuid,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.reserve_wan_generation(uuid,integer,uuid),local_identity.record_wan_submission(uuid,integer,uuid,text) TO loop_worker;
