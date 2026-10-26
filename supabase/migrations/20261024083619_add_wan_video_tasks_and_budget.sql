create table public.generation_account_budgets (
 account_id uuid primary key references public.accounts(id) on delete cascade,
 trial_video_limit_cents integer not null check(trial_video_limit_cents>0),
 total_limit_cents integer not null check(total_limit_cents>=trial_video_limit_cents),
 full_generation_enabled boolean not null default false,
 approved_by uuid not null references auth.users(id),
 approved_at timestamptz not null default now()
);
create table public.paid_generation_reservations (
 task_id uuid primary key references public.tasks(id) on delete cascade,
 account_id uuid not null references public.accounts(id) on delete cascade,
 kind text not null check(kind in ('video','narration')),
 reserved_cents integer not null check(reserved_cents>0),
 provider_task_id text,
 request_state text not null default 'submitting' check(request_state in ('submitting','submitted','succeeded')),
 material_revision_id uuid references public.production_material_revisions(id),
 created_at timestamptz not null default now()
);
create index paid_generation_reservations_account_idx on public.paid_generation_reservations(account_id);
alter table public.generation_account_budgets enable row level security;
alter table public.paid_generation_reservations enable row level security;
revoke all on public.generation_account_budgets,public.paid_generation_reservations from anon,authenticated;
grant select on public.generation_account_budgets,public.paid_generation_reservations to authenticated;
grant all on public.generation_account_budgets,public.paid_generation_reservations to service_role;
create policy budget_owner_read on public.generation_account_budgets for select to authenticated using(exists(select 1 from public.account_memberships m where m.account_id=generation_account_budgets.account_id and m.user_id=auth.uid() and m.role='owner'));
create policy reservation_owner_read on public.paid_generation_reservations for select to authenticated using(exists(select 1 from public.account_memberships m where m.account_id=paid_generation_reservations.account_id and m.user_id=auth.uid() and m.role='owner'));

create function public.set_generation_budget(p_account_id uuid,p_trial_cents integer,p_total_cents integer,p_full boolean default false)
returns public.generation_account_budgets language plpgsql security definer set search_path='' as $$
declare result public.generation_account_budgets;
begin
 if not exists(select 1 from public.account_memberships where account_id=p_account_id and user_id=auth.uid() and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 if p_trial_cents is null or p_total_cents is null or p_full is null or p_trial_cents<1 or p_total_cents<p_trial_cents or p_total_cents>100000 then raise exception 'Invalid approved budget'; end if;
 insert into public.generation_account_budgets(account_id,trial_video_limit_cents,total_limit_cents,full_generation_enabled,approved_by)
 values(p_account_id,p_trial_cents,p_total_cents,p_full,auth.uid())
 on conflict(account_id) do update set trial_video_limit_cents=excluded.trial_video_limit_cents,total_limit_cents=excluded.total_limit_cents,full_generation_enabled=excluded.full_generation_enabled,approved_by=excluded.approved_by,approved_at=now() returning * into result;
 insert into public.audit_events(account_id,event_type,payload,actor_id) values(p_account_id,'generation_budget_approved',jsonb_build_object('trial_cents',p_trial_cents,'total_cents',p_total_cents,'full',p_full),auth.uid());
 return result;
end $$;
revoke all on function public.set_generation_budget(uuid,integer,integer,boolean) from public,anon;
grant execute on function public.set_generation_budget(uuid,integer,integer,boolean) to authenticated;

create unique index tasks_wan_request_id_idx on public.tasks((input_snapshot->>'wan_request_id')) where provider='bailian';
create function public.request_wan_shot_video(p_episode_id uuid,p_review_package_id uuid,p_shot_id text,p_first_frame_id uuid,p_prompt text,p_duration integer,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.episodes; rp public.review_packages; src public.production_material_revisions; s jsonb; cfg jsonb; pol jsonb; ref uuid; tid uuid:=gen_random_uuid(); existing uuid; image jsonb; typ text;
begin
 select * into e from public.episodes where id=p_episode_id for update;
 if not found or not exists(select 1 from public.account_memberships where account_id=e.account_id and user_id=auth.uid() and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 select id into existing from public.tasks where provider='bailian' and input_snapshot->>'wan_request_id'=p_request_id::text and episode_id=e.id;
 if found then return existing; end if;
 if e.stage<>'storyboard_approved' then raise exception 'Return to the approved storyboard shot workbench first'; end if;
 select * into rp from public.review_packages where id=p_review_package_id and episode_id=e.id and stage='storyboard_review' and invalidated_at is null;
 if not found or not exists(select 1 from public.approvals where review_package_id=rp.id and stage='storyboard_approved' and decision='approved') then raise exception 'Approved current storyboard required'; end if;
 select value into s from jsonb_array_elements(rp.context_snapshot#>'{worker_result,storyboard,shots}') where value->>'id'=p_shot_id;
 if s is null or s->>'shotType' not in ('a_roll','b_roll') then raise exception 'Unknown storyboard shot'; end if;
 typ:=s->>'shotType'; select policy into pol from public.account_blueprint_versions where id=e.blueprint_version_id;
 cfg:=pol->typ;
 if cfg->>'execution_path' is distinct from 'external' or cfg#>>'{executor,provider}' is distinct from 'bailian' or cfg#>>'{executor,adapter}' is distinct from 'wan_video' or cfg#>>'{executor,model}' is distinct from 'wan2.6-i2v-flash' then raise exception 'Select a verified Bailian video connection for this shot capability'; end if;
 ref:=(cfg->>'credential_ref')::uuid;
 if not exists(select 1 from public.external_connection_versions v join public.external_connections c on c.id=v.connection_id where v.id=ref and c.created_by=auth.uid() and c.current_version_id=v.id and v.provider='bailian' and v.adapter='wan_video' and v.revoked_at is null and public.connection_version_is_verified(v.id)) then raise exception 'Current verified Bailian connection required'; end if;
 if p_request_id is null or p_prompt is null or p_duration is null or p_duration not between 2 and 15 or char_length(btrim(p_prompt)) not between 1 and 1500 then raise exception 'Prompt or duration invalid'; end if;
 if not exists(select 1 from public.generation_account_budgets where account_id=e.account_id) then raise exception 'Approve a generation budget first'; end if;
 select * into src from public.production_material_revisions where id=p_first_frame_id and episode_id=e.id and material_type='image' and mime_type in ('image/png','image/jpeg','image/webp','image/bmp') and file_size between 1 and 20971520;
 if not found then raise exception 'Select an uploaded first-frame image from this Episode'; end if;
 image:=jsonb_build_object('artifactType','wan_first_frame','relativePath',src.storage_path,'sha256',src.sha256,'fileSize',src.file_size);
 s:=jsonb_set(s,'{inputBasis}',jsonb_build_array(jsonb_build_object('relativePath',src.storage_path,'sha256',src.sha256)));
 insert into public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,budget_limit_cents,max_attempts,input_snapshot)
 values(tid,e.id,case typ when 'a_roll' then 'generate_a_roll' else 'generate_b_roll' end,'ready','bailian','wan2.6-i2v-flash','wan-video-v1',p_duration*15,1,
 jsonb_build_object('capability',typ||'_generation','wan_request_id',p_request_id,'requested_by',auth.uid(),'storyboard_review_package_id',rp.id,'configuration_hash',tid::text,'shot',s,'executor',cfg->'executor','credential_ref',ref,
 'allowed_tools',jsonb_build_array('read','write'),'budget',jsonb_build_object('limit_cents',p_duration*15,'max_attempts',1),
 'input_artifacts',jsonb_build_array(image),
 'media',jsonb_build_object('adapter','wan_video','wan_video',jsonb_build_object('first_frame',image,'prompt',btrim(p_prompt),'duration_seconds',p_duration,'image_mime',src.mime_type,'resolution','720P','audio',false)),
 'output',jsonb_build_object('required_artifact_types',jsonb_build_array(case typ when 'a_roll' then 'a_roll_video' else 'b_roll_asset' end),'relative_path',format('episodes/%s/wan/%s.mp4',e.id,tid),'review_stage','production_ready')));
 insert into public.audit_events(account_id,episode_id,event_type,payload,actor_id) values(e.account_id,e.id,'wan_video_requested',jsonb_build_object('task_id',tid,'shot_id',p_shot_id,'duration',p_duration,'estimated_cents',p_duration*15),auth.uid());
 return tid;
end $$;
revoke all on function public.request_wan_shot_video(uuid,uuid,text,uuid,text,integer,uuid) from public,anon;
grant execute on function public.request_wan_shot_video(uuid,uuid,text,uuid,text,integer,uuid) to authenticated;

-- Service-only reservation. A repeated task can resume its supplier ID, but
-- an unknown POST result can never silently cause another paid submission.
create function public.reserve_paid_generation(p_task_id uuid,p_attempt integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tasks; aid uuid; b public.generation_account_budgets; r public.paid_generation_reservations; amount integer; k text; used integer; video_used integer;
begin
 select * into t from public.tasks where id=p_task_id and status='running' and attempt=p_attempt for update;
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
create function public.record_wan_submission(p_task_id uuid,p_attempt integer,p_provider_task_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if char_length(p_provider_task_id) not between 1 and 128 or p_provider_task_id !~ '^[a-zA-Z0-9_-]+$' then raise exception 'Invalid supplier task ID'; end if;
 if not exists(select 1 from public.tasks where id=p_task_id and status='running' and attempt=p_attempt and provider='bailian') then raise exception 'Current task attempt required'; end if;
 update public.paid_generation_reservations set provider_task_id=p_provider_task_id,request_state='submitted' where task_id=p_task_id and kind='video' and (provider_task_id is null or provider_task_id=p_provider_task_id);
 if not found then raise exception 'Reservation missing or supplier task changed'; end if;
end $$;
create function public.register_wan_material(p_task_id uuid,p_attempt integer,p_path text,p_sha256 text,p_size bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.tasks; r public.paid_generation_reservations; owner_id uuid; mid uuid; rev integer;
begin
 select * into t from public.tasks where id=p_task_id and status='running' and attempt=p_attempt and provider='bailian' for update;
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
revoke all on function public.reserve_paid_generation(uuid,integer),public.record_wan_submission(uuid,integer,text),public.register_wan_material(uuid,integer,text,text,bigint) from public,anon,authenticated;
grant execute on function public.reserve_paid_generation(uuid,integer),public.record_wan_submission(uuid,integer,text),public.register_wan_material(uuid,integer,text,text,bigint) to service_role;

-- Extend existing claim lists and bypass legacy automatic generators for Wan:
-- the Owner explicitly chooses a first frame in the workbench instead.
do $$
declare sig text; definition text; changed text;
begin
 foreach sig in array array['public.claim_next_worker_task_pre_lease(uuid,integer)','public.claim_next_worker_task_legacy(uuid)'] loop
  definition:=pg_get_functiondef(sig::regprocedure);
  changed:=replace(definition,'''cloudflare'',''whisperx'')','''cloudflare'',''whisperx'',''bailian'')');
  if changed=definition then raise exception 'Claim provider list changed upstream: %',sig; end if;
  execute changed;
 end loop;
 foreach sig in array array['public.orchestrate_a_roll_tasks_for_episode(uuid)','public.orchestrate_b_roll_tasks_configured(uuid)'] loop
  definition:=pg_get_functiondef(sig::regprocedure);
  changed:=regexp_replace(definition,'begin',E'begin\n if exists(select 1 from public.episodes e join public.account_blueprint_versions b on b.id=e.blueprint_version_id where e.id=p_episode_id and b.policy #>> ''{'||case when sig like '%a_roll%' then 'a_roll' else 'b_roll' end||E',executor,provider}''=''bailian'') then return; end if;', 'i');
  execute changed;
 end loop;
end $$;

-- Exact, already approved sample budget; does not alter other accounts.
insert into public.generation_account_budgets(account_id,trial_video_limit_cents,total_limit_cents,approved_by)
select a.id,200,1500,m.user_id from public.accounts a join public.account_memberships m on m.account_id=a.id and m.role='owner' where a.slug='rizhao-jinshan-sample'
on conflict(account_id) do nothing;

create function public.resume_wan_video_task(p_task_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.tasks; aid uuid;
begin
 select * into t from public.tasks where id=p_task_id and provider='bailian' for update;
 select account_id into aid from public.episodes where id=t.episode_id;
 if not exists(select 1 from public.account_memberships where account_id=aid and user_id=auth.uid() and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 if t.status<>'failed' or not exists(select 1 from public.paid_generation_reservations where task_id=t.id and provider_task_id is not null) then raise exception 'Only a failed task with a saved supplier ID can resume; unknown submissions require manual supplier reconciliation'; end if;
 update public.tasks set status='ready',max_attempts=attempt+1,claimed_at=null,completed_at=null where id=t.id;
end $$;
revoke all on function public.resume_wan_video_task(uuid) from public,anon;
grant execute on function public.resume_wan_video_task(uuid) to authenticated;
