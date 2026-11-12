-- Official video direct providers. No calls, credentials, approvals or automatic paid tasks.
-- Native Wan: existing budgets and reservations remain intact. No secrets,
-- automatic budget approval, Provider calls or historical task replay.
ALTER TABLE public.external_connections DROP CONSTRAINT external_connections_provider_adapter_check;
ALTER TABLE public.external_connections ADD CONSTRAINT external_connections_provider_adapter_check CHECK((provider,adapter) IN (('pexels','pexels_video'),('freesound','freesound_preview'),('openai','openai_images'),('cloudflare','workers_ai_images'),('google_tts','google_tts'),('volcengine_tts','volcengine_tts'),('bailian','wan_video'),('volcengine','seedance_video'),('minimax','minimax_video'),('kling','kling_video')));
create or replace function public.official_external_connection_endpoint(p_provider text,p_adapter text)
returns text language sql immutable set search_path='' as $$
select case
 when p_provider='volcengine' and p_adapter='seedance_video' then 'https://ark.cn-beijing.volces.com/api/v3'
 when p_provider='minimax' and p_adapter='minimax_video' then 'https://api.minimax.io'
 when p_provider='kling' and p_adapter='kling_video' then 'https://api-singapore.klingai.com'
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
   when 'a_roll' then (expected_provider,expected_adapter) in (('bailian','wan_video'),('volcengine','seedance_video'),('minimax','minimax_video'),('kling','kling_video'))
   when 'b_roll' then (expected_provider,expected_adapter) in (('bailian','wan_video'),('pexels','pexels_video'),('volcengine','seedance_video'),('minimax','minimax_video'),('kling','kling_video'))
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

CREATE FUNCTION public.request_official_shot_video(p_episode_id uuid,p_review_package_id uuid,p_shot_id text,p_first_frame_id uuid,p_prompt text,p_duration integer,p_request_id uuid,p_reservation_cents integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.episodes; rp public.review_packages; src public.production_material_revisions; s jsonb; cfg jsonb; pol jsonb; ref uuid; tid uuid:=gen_random_uuid(); existing uuid; image jsonb; typ text; provider_name text; adapter_name text; model_name text;
begin
 if not local_identity.lock_owned_input_episode(p_episode_id) then raise exception 'Managed Owner Episode required' using errcode='42501'; end if;
 select * into e from public.episodes where id=p_episode_id for update;
 if not found or not exists(select 1 from public.account_memberships where account_id=e.account_id and user_id=local_identity.owner_id() and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 select id into existing from public.tasks where provider in ('volcengine','minimax','kling') and input_snapshot->>'wan_request_id'=p_request_id::text and episode_id=e.id;
 if found then
  if not exists(select 1 from public.tasks where id=existing and input_snapshot->>'storyboard_review_package_id'=p_review_package_id::text and input_snapshot#>>'{shot,id}'=p_shot_id and input_snapshot#>>'{media,wan_video,first_frame,relativePath}'=(select storage_path from public.production_material_revisions where id=p_first_frame_id and episode_id=e.id) and input_snapshot#>>'{media,wan_video,prompt}'=btrim(p_prompt) and input_snapshot#>>'{media,wan_video,duration_seconds}'=p_duration::text and budget_limit_cents=p_reservation_cents) then raise exception 'Request identity changed'; end if;
  return existing; end if;
 if e.stage<>'storyboard_approved' then raise exception 'Return to the approved storyboard shot workbench first'; end if;
 select * into rp from public.review_packages where id=p_review_package_id and episode_id=e.id and stage='storyboard_review' and invalidated_at is null and revision_number=(select max(revision_number) from public.review_packages where episode_id=e.id and stage='storyboard_review' and invalidated_at is null);
 if not found or not exists(select 1 from public.approvals where review_package_id=rp.id and stage='storyboard_approved' and decision='approved') then raise exception 'Approved current storyboard required'; end if;
 select value into s from jsonb_array_elements(rp.context_snapshot#>'{worker_result,storyboard,shots}') where value->>'id'=p_shot_id;
 if s is null or s->>'shotType' not in ('a_roll','b_roll') then raise exception 'Unknown storyboard shot'; end if;
 typ:=s->>'shotType'; select policy into pol from public.account_blueprint_versions where id=e.blueprint_version_id;
 cfg:=pol->typ; provider_name:=cfg#>>'{executor,provider}'; adapter_name:=cfg#>>'{executor,adapter}'; model_name:=cfg#>>'{executor,model}';
 if cfg->>'execution_path' is distinct from 'external' or not coalesce((provider_name,adapter_name,model_name) in (('volcengine','seedance_video','doubao-seedance-2-0-260128'),('volcengine','seedance_video','doubao-seedance-2-5-260628'),('minimax','minimax_video','MiniMax-H3'),('kling','kling_video','kling-v3')),false) then raise exception 'Select an official video provider and model'; end if;
 if p_duration < (case when provider_name='kling' then 3 else 4 end) or p_duration>15 then raise exception 'Duration outside model range'; end if;
 if p_reservation_cents is null or p_reservation_cents not between 1 and 100000 then raise exception 'Explicit video cost reservation required'; end if;
 ref:=(cfg->>'credential_ref')::uuid;
 if not exists(select 1 from public.external_connection_versions v join public.external_connections c on c.id=v.connection_id where v.id=ref and c.created_by=local_identity.owner_id() and c.current_version_id=v.id and v.provider=provider_name and v.adapter=adapter_name and v.revoked_at is null and public.connection_version_is_verified(v.id)) then raise exception 'Current verified official video connection required'; end if;
 if p_request_id is null or p_prompt is null or p_duration is null or p_duration not between 2 and 15 or char_length(btrim(p_prompt)) not between 1 and 1500 then raise exception 'Prompt or duration invalid'; end if;
 if not exists(select 1 from public.generation_account_budgets where account_id=e.account_id) then raise exception 'Approve a generation budget first'; end if;
 select * into src from public.production_material_revisions where id=p_first_frame_id and episode_id=e.id and material_type='image' and mime_type in ('image/png','image/jpeg') and file_size between 1 and 10485760;
 if not found then raise exception 'Select an uploaded first-frame image from this Episode'; end if;
 image:=jsonb_build_object('artifactType','wan_first_frame','relativePath',src.storage_path,'sha256',src.sha256,'fileSize',src.file_size);
 s:=jsonb_set(s,'{inputBasis}',jsonb_build_array(jsonb_build_object('relativePath',src.storage_path,'sha256',src.sha256)));
 insert into public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,budget_limit_cents,max_attempts,input_snapshot)
 values(tid,e.id,case typ when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end,'ready',provider_name,model_name,'official-video-v1',p_reservation_cents,1,
 jsonb_build_object('capability',typ||'_generation','wan_request_id',p_request_id,'requested_by',local_identity.owner_id(),'storyboard_review_package_id',rp.id,'configuration_hash',tid::text,'shot',s,'executor',cfg->'executor','credential_ref',ref,
 'allowed_tools',jsonb_build_array('read','write'),'budget',jsonb_build_object('limit_cents',p_reservation_cents,'max_attempts',1),
 'input_artifacts',jsonb_build_array(image),
 'media',jsonb_build_object('adapter',adapter_name,'wan_video',jsonb_build_object('first_frame',image,'prompt',btrim(p_prompt),'duration_seconds',p_duration,'image_mime',src.mime_type,'resolution',case when provider_name='minimax' then '768P' else '720P' end,'audio',provider_name='minimax')),
 'output',jsonb_build_object('content_type','video/mp4','required_artifact_types',jsonb_build_array(case typ when 'a_roll' then 'a_roll_video' else 'b_roll_asset' end),'relative_path',format('episodes/%s/wan/%s.mp4',e.id,tid),'review_stage','production_ready')));
 insert into public.audit_events(account_id,episode_id,event_type,payload,actor_id) values(e.account_id,e.id,'wan_video_requested',jsonb_build_object('task_id',tid,'shot_id',p_shot_id,'duration',p_duration,'estimated_cents',p_reservation_cents),local_identity.owner_id());
 return tid;
end $$;

CREATE UNIQUE INDEX tasks_official_video_request_idx ON public.tasks((input_snapshot->>'wan_request_id')) WHERE provider IN ('volcengine','minimax','kling');
-- Reuse the existing reservation/lease/material protocol for all paid videos.
-- The legacy snapshot key wan_video is preserved as an internal protocol name.
DO $$ DECLARE sig text; original text; changed text; BEGIN
 FOREACH sig IN ARRAY ARRAY[
  'public.resume_wan_video_task(uuid)',
  'local_identity.reserve_wan_generation(uuid,integer,uuid)',
  'local_identity.record_wan_submission(uuid,integer,uuid,text)',
  'local_identity.register_wan_material(uuid,integer,uuid,text,text,bigint)',
  'local_identity.input_media_connection(uuid,integer,uuid,uuid)',
  'local_identity.claim_input_task_pre_lease(uuid,integer)',
  'public.claim_next_worker_task_legacy(uuid)',
  'public.claim_next_worker_task_pre_lease(uuid,integer)',
  'public.orchestrate_a_roll_tasks_for_episode(uuid)',
  'public.orchestrate_b_roll_tasks_configured(uuid)',
  'local_identity.retry_input_media(uuid,uuid)',
  'local_identity.input_worker_call(text,jsonb)'
 ] LOOP
  original:=pg_get_functiondef(sig::regprocedure); changed:=original;
  changed:=regexp_replace(changed, '([a-z_]+[.])?provider[[:space:]]*=[[:space:]]*''bailian''', E'\\1provider IN (''bailian'',''volcengine'',''minimax'',''kling'')','gi');
  changed:=replace(changed,'''pexels'',''freesound'',''bailian''','''pexels'',''freesound'',''bailian'',''volcengine'',''minimax'',''kling''');
  changed:=replace(changed,'''cloudflare'',''whisperx'',''bailian''','''cloudflare'',''whisperx'',''bailian'',''volcengine'',''minimax'',''kling''');
  changed:=replace(changed,'''{a_roll,executor,provider}''=''bailian''', '''{a_roll,executor,provider}'' IN (''bailian'',''volcengine'',''minimax'',''kling'')');
  changed:=replace(changed,'''{b_roll,executor,provider}''=''bailian''', '''{b_roll,executor,provider}'' IN (''bailian'',''volcengine'',''minimax'',''kling'')');
  IF sig='local_identity.reserve_wan_generation(uuid,integer,uuid)' THEN
   changed:=replace(changed,'amount:=(t.input_snapshot#>>''{media,wan_video,duration_seconds}'')::integer*15;', 'amount:=CASE WHEN t.provider=''bailian'' THEN (t.input_snapshot#>>''{media,wan_video,duration_seconds}'')::integer*15 ELSE t.budget_limit_cents END;');
   changed:=replace(changed,'amount<30 or amount>225','amount<1 or amount>100000');
  END IF;
  IF changed=original THEN RAISE EXCEPTION 'Official video integration function changed: %',sig; END IF;
  EXECUTE changed;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.request_official_shot_video(uuid,uuid,text,uuid,text,integer,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_official_shot_video(uuid,uuid,text,uuid,text,integer,uuid,integer) TO loop_owner;

-- Explicit new takes may coexist with completed paid videos, but only one
-- request per storyboard shot may be ready/running at a time.
DROP INDEX public.tasks_one_a_roll_per_storyboard_shot_revision_idx;
CREATE UNIQUE INDEX tasks_one_a_roll_per_storyboard_shot_revision_idx
ON public.tasks(episode_id,(input_snapshot->>'storyboard_review_package_id'),(input_snapshot#>>'{shot,id}'),coalesce(input_snapshot->>'pre_render_revision',''))
WHERE task_type='generate_a_roll' AND status<>'superseded' AND (provider IS NULL OR provider NOT IN ('bailian','volcengine','minimax','kling'));
DROP INDEX public.tasks_one_active_native_wan_shot_idx;
CREATE UNIQUE INDEX tasks_one_active_native_wan_shot_idx
ON public.tasks(episode_id,(input_snapshot->>'storyboard_review_package_id'),(input_snapshot#>>'{shot,id}'))
WHERE provider IN ('bailian','volcengine','minimax','kling') AND task_type IN ('generate_a_roll','generate_b_roll') AND status IN ('ready','running');
