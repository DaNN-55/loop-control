-- Retire account-wide lifetime/trial ceilings. Per-request reservations, leases,
-- ownership, explicit authorization and unknown-submission fencing remain active.
-- Keep historical budget rows and reservation records; no stored production is changed.
DO $migration$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('request_official_shot_video(uuid,uuid,text,uuid,text,integer,uuid,integer)'::regprocedure);
 changed:=original;
 IF strpos(changed,$old$ if not exists(select 1 from public.generation_account_budgets where account_id=e.account_id) then raise exception 'Approve a generation budget first'; end if;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: request_official_shot_video(uuid,uuid,text,uuid,text,integer,uuid,integer)';END IF;
 changed:=replace(changed,$old$ if not exists(select 1 from public.generation_account_budgets where account_id=e.account_id) then raise exception 'Approve a generation budget first'; end if;
$old$,$new$$new$);
 EXECUTE changed;
END $migration$;

DO $migration$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('request_wan_shot_video(uuid,uuid,text,uuid,text,integer,uuid)'::regprocedure);
 changed:=original;
 IF strpos(changed,$old$ if not exists(select 1 from public.generation_account_budgets where account_id=e.account_id) then raise exception 'Approve a generation budget first'; end if;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: request_wan_shot_video(uuid,uuid,text,uuid,text,integer,uuid)';END IF;
 changed:=replace(changed,$old$ if not exists(select 1 from public.generation_account_budgets where account_id=e.account_id) then raise exception 'Approve a generation budget first'; end if;
$old$,$new$$new$);
 EXECUTE changed;
END $migration$;

DO $migration$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.request_workspace_official_visual(uuid,uuid,text,uuid,text,integer,uuid,integer)'::regprocedure);
 changed:=original;
 IF strpos(changed,$old$ if not exists(select 1 from public.generation_account_budgets where account_id=e.account_id) then raise exception 'Approve a generation budget first'; end if;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.request_workspace_official_visual(uuid,uuid,text,uuid,text,integer,uuid,integer)';END IF;
 changed:=replace(changed,$old$ if not exists(select 1 from public.generation_account_budgets where account_id=e.account_id) then raise exception 'Approve a generation budget first'; end if;
$old$,$new$$new$);
 EXECUTE changed;
END $migration$;

DO $migration$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.request_workspace_wan_visual(uuid,uuid,text,uuid,text,integer,uuid)'::regprocedure);
 changed:=original;
 IF strpos(changed,$old$ if not exists(select 1 from public.generation_account_budgets where account_id=e.account_id) then raise exception 'Approve a generation budget first'; end if;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.request_workspace_wan_visual(uuid,uuid,text,uuid,text,integer,uuid)';END IF;
 changed:=replace(changed,$old$ if not exists(select 1 from public.generation_account_budgets where account_id=e.account_id) then raise exception 'Approve a generation budget first'; end if;
$old$,$new$$new$);
 EXECUTE changed;
END $migration$;

DO $migration$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.reserve_wan_generation(uuid,integer,uuid)'::regprocedure);
 changed:=original;
 IF strpos(changed,$old$declare t public.tasks; aid uuid; b public.generation_account_budgets; r public.paid_generation_reservations; amount integer; k text; used integer; video_used integer;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.reserve_wan_generation(uuid,integer,uuid)';END IF;
 changed:=replace(changed,$old$declare t public.tasks; aid uuid; b public.generation_account_budgets; r public.paid_generation_reservations; amount integer; k text; used integer; video_used integer;
$old$,$new$declare t public.tasks; aid uuid; r public.paid_generation_reservations; amount integer; k text;
$new$);
 IF strpos(changed,$old$ select * into b from public.generation_account_budgets where account_id=aid for update;
 if not found then
  if t.provider IN ('bailian','volcengine','minimax','kling') then raise exception 'No approved paid-generation budget'; end if;
  return jsonb_build_object('new',true,'unlimited_legacy',true);
 end if;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.reserve_wan_generation(uuid,integer,uuid)';END IF;
 changed:=replace(changed,$old$ select * into b from public.generation_account_budgets where account_id=aid for update;
 if not found then
  if t.provider IN ('bailian','volcengine','minimax','kling') then raise exception 'No approved paid-generation budget'; end if;
  return jsonb_build_object('new',true,'unlimited_legacy',true);
 end if;
$old$,$new$$new$);
 IF strpos(changed,$old$ select coalesce(sum(reserved_cents),0),coalesce(sum(reserved_cents) filter(where kind='video'),0) into used,video_used from public.paid_generation_reservations where account_id=aid;
 if used+amount>b.total_limit_cents then raise exception '整片视频与配音预算不足，已停止提交'; end if;
 if k='video' and not b.full_generation_enabled and video_used+amount>b.trial_video_limit_cents then raise exception '首轮试片预算已用完，请先审看试片再批准后续制作'; end if;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.reserve_wan_generation(uuid,integer,uuid)';END IF;
 changed:=replace(changed,$old$ select coalesce(sum(reserved_cents),0),coalesce(sum(reserved_cents) filter(where kind='video'),0) into used,video_used from public.paid_generation_reservations where account_id=aid;
 if used+amount>b.total_limit_cents then raise exception '整片视频与配音预算不足，已停止提交'; end if;
 if k='video' and not b.full_generation_enabled and video_used+amount>b.trial_video_limit_cents then raise exception '首轮试片预算已用完，请先审看试片再批准后续制作'; end if;
$old$,$new$$new$);
 EXECUTE changed;
END $migration$;

DO $migration$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.queue_workspace_images(uuid)'::regprocedure);
 changed:=original;
 IF strpos(changed,$old$DECLARE v local_identity.workspace_visual_candidates;w local_identity.production_workspaces;cfg jsonb;auth local_identity.script_productions;tid uuid;frozen jsonb;aid uuid;account_budget public.generation_account_budgets;BEGIN
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.queue_workspace_images(uuid)';END IF;
 changed:=replace(changed,$old$DECLARE v local_identity.workspace_visual_candidates;w local_identity.production_workspaces;cfg jsonb;auth local_identity.script_productions;tid uuid;frozen jsonb;aid uuid;account_budget public.generation_account_budgets;BEGIN
$old$,$new$DECLARE v local_identity.workspace_visual_candidates;w local_identity.production_workspaces;cfg jsonb;auth local_identity.script_productions;tid uuid;frozen jsonb;aid uuid;BEGIN
$new$);
 IF strpos(changed,$old$ SELECT * INTO account_budget FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF account_budget.account_id IS NULL THEN RAISE EXCEPTION 'Approve a generation budget first';END IF;
 IF (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+(SELECT coalesce(sum(t.budget_limit_cents),0) FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id WHERE e.account_id=aid AND t.task_type='generate_static_visual' AND t.status IN ('ready','running') AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id))+(v.request_snapshot->>'reservationCents')::integer>account_budget.total_limit_cents THEN RAISE EXCEPTION '图片生成预算不足' USING ERRCODE='22023';END IF;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.queue_workspace_images(uuid)';END IF;
 changed:=replace(changed,$old$ SELECT * INTO account_budget FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF account_budget.account_id IS NULL THEN RAISE EXCEPTION 'Approve a generation budget first';END IF;
 IF (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+(SELECT coalesce(sum(t.budget_limit_cents),0) FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id WHERE e.account_id=aid AND t.task_type='generate_static_visual' AND t.status IN ('ready','running') AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id))+(v.request_snapshot->>'reservationCents')::integer>account_budget.total_limit_cents THEN RAISE EXCEPTION '图片生成预算不足' USING ERRCODE='22023';END IF;
$old$,$new$$new$);
 EXECUTE changed;
END $migration$;

DO $migration$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.reserve_workspace_images(uuid,integer,uuid)'::regprocedure);
 changed:=original;
 IF strpos(changed,$old$DECLARE t public.tasks;v local_identity.workspace_visual_candidates;aid uuid;b public.generation_account_budgets;BEGIN
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.reserve_workspace_images(uuid,integer,uuid)';END IF;
 changed:=replace(changed,$old$DECLARE t public.tasks;v local_identity.workspace_visual_candidates;aid uuid;b public.generation_account_budgets;BEGIN
$old$,$new$DECLARE t public.tasks;v local_identity.workspace_visual_candidates;aid uuid;BEGIN
$new$);
 IF strpos(changed,$old$ SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF b.account_id IS NULL THEN RAISE EXCEPTION 'Approve a generation budget first';END IF;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.reserve_workspace_images(uuid,integer,uuid)';END IF;
 changed:=replace(changed,$old$ SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF b.account_id IS NULL THEN RAISE EXCEPTION 'Approve a generation budget first';END IF;
$old$,$new$$new$);
 IF strpos(changed,$old$ IF (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+t.budget_limit_cents>b.total_limit_cents THEN RAISE EXCEPTION '图片生成预算不足';END IF;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.reserve_workspace_images(uuid,integer,uuid)';END IF;
 changed:=replace(changed,$old$ IF (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+t.budget_limit_cents>b.total_limit_cents THEN RAISE EXCEPTION '图片生成预算不足';END IF;
$old$,$new$$new$);
 EXECUTE changed;
END $migration$;

DO $migration$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.reserve_workspace_configured_video(uuid,integer,uuid)'::regprocedure);
 changed:=original;
 IF strpos(changed,$old$DECLARE result jsonb;v local_identity.workspace_visual_candidates;r public.paid_generation_reservations;b public.generation_account_budgets;amount integer;used integer;video_used integer;BEGIN
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.reserve_workspace_configured_video(uuid,integer,uuid)';END IF;
 changed:=replace(changed,$old$DECLARE result jsonb;v local_identity.workspace_visual_candidates;r public.paid_generation_reservations;b public.generation_account_budgets;amount integer;used integer;video_used integer;BEGIN
$old$,$new$DECLARE result jsonb;v local_identity.workspace_visual_candidates;r public.paid_generation_reservations;amount integer;BEGIN
$new$);
 IF strpos(changed,$old$ SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=r.account_id FOR UPDATE;
 SELECT coalesce(sum(reserved_cents),0),coalesce(sum(reserved_cents) FILTER(WHERE kind='video'),0) INTO used,video_used FROM public.paid_generation_reservations WHERE account_id=r.account_id;
 IF used-r.reserved_cents+amount>b.total_limit_cents OR (NOT b.full_generation_enabled AND video_used-r.reserved_cents+amount>b.trial_video_limit_cents) THEN RAISE EXCEPTION '账号生成预算不足';END IF;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.reserve_workspace_configured_video(uuid,integer,uuid)';END IF;
 changed:=replace(changed,$old$ SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=r.account_id FOR UPDATE;
 SELECT coalesce(sum(reserved_cents),0),coalesce(sum(reserved_cents) FILTER(WHERE kind='video'),0) INTO used,video_used FROM public.paid_generation_reservations WHERE account_id=r.account_id;
 IF used-r.reserved_cents+amount>b.total_limit_cents OR (NOT b.full_generation_enabled AND video_used-r.reserved_cents+amount>b.trial_video_limit_cents) THEN RAISE EXCEPTION '账号生成预算不足';END IF;
$old$,$new$$new$);
 EXECUTE changed;
END $migration$;

DO $migration$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.queue_workspace_visual(uuid)'::regprocedure);
 changed:=original;
 IF strpos(changed,$old$DECLARE v local_identity.workspace_visual_candidates;tid uuid;aid uuid;account_budget public.generation_account_budgets;cfg jsonb;BEGIN
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.queue_workspace_visual(uuid)';END IF;
 changed:=replace(changed,$old$DECLARE v local_identity.workspace_visual_candidates;tid uuid;aid uuid;account_budget public.generation_account_budgets;cfg jsonb;BEGIN
$old$,$new$DECLARE v local_identity.workspace_visual_candidates;tid uuid;aid uuid;cfg jsonb;BEGIN
$new$);
 IF strpos(changed,$old$ SELECT * INTO account_budget FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF account_budget.account_id IS NULL THEN RAISE EXCEPTION 'Approve a generation budget first';END IF;
 IF (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+(SELECT coalesce(sum(t.budget_limit_cents),0) FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id WHERE e.account_id=aid AND t.status IN ('ready','running') AND t.provider IN ('bailian','volcengine','minimax','kling','openai') AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id))+(v.request_snapshot->>'reservationCents')::integer>account_budget.total_limit_cents THEN RAISE EXCEPTION 'Video generation budget insufficient' USING ERRCODE='22023';END IF;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.queue_workspace_visual(uuid)';END IF;
 changed:=replace(changed,$old$ SELECT * INTO account_budget FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF account_budget.account_id IS NULL THEN RAISE EXCEPTION 'Approve a generation budget first';END IF;
 IF (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+(SELECT coalesce(sum(t.budget_limit_cents),0) FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id WHERE e.account_id=aid AND t.status IN ('ready','running') AND t.provider IN ('bailian','volcengine','minimax','kling','openai') AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id))+(v.request_snapshot->>'reservationCents')::integer>account_budget.total_limit_cents THEN RAISE EXCEPTION 'Video generation budget insufficient' USING ERRCODE='22023';END IF;
$old$,$new$$new$);
 EXECUTE changed;
END $migration$;

DO $migration$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.queue_selected_workspace_narration(uuid,text,jsonb,boolean)'::regprocedure);
 changed:=original;
 IF strpos(changed,$old$DECLARE w local_identity.production_workspaces;n local_identity.workspace_narrations;d public.shot_preparation_drafts;a local_identity.script_productions;e public.episodes;t public.tasks;b public.generation_account_budgets;cfg jsonb;frozen jsonb;amount integer;hash text;BEGIN
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.queue_selected_workspace_narration(uuid,text,jsonb,boolean)';END IF;
 changed:=replace(changed,$old$DECLARE w local_identity.production_workspaces;n local_identity.workspace_narrations;d public.shot_preparation_drafts;a local_identity.script_productions;e public.episodes;t public.tasks;b public.generation_account_budgets;cfg jsonb;frozen jsonb;amount integer;hash text;BEGIN
$old$,$new$DECLARE w local_identity.production_workspaces;n local_identity.workspace_narrations;d public.shot_preparation_drafts;a local_identity.script_productions;e public.episodes;t public.tasks;cfg jsonb;frozen jsonb;amount integer;hash text;BEGIN
$new$);
 IF strpos(changed,$old$ SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=e.account_id FOR UPDATE;
 IF b.account_id IS NULL OR amount<greatest(1,char_length(d.tts_text)) OR amount>100000 OR (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=e.account_id)+(SELECT coalesce(sum(task.budget_limit_cents),0) FROM public.tasks task JOIN public.episodes ep ON ep.id=task.episode_id WHERE ep.account_id=e.account_id AND task.status IN ('ready','running') AND task.task_type='generate_narration' AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=task.id))+amount>b.total_limit_cents THEN RAISE EXCEPTION '口播生成预算不足，请先允许账号生成额度并填写本次预留' USING ERRCODE='22023';END IF;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.queue_selected_workspace_narration(uuid,text,jsonb,boolean)';END IF;
 changed:=replace(changed,$old$ SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=e.account_id FOR UPDATE;
 IF b.account_id IS NULL OR amount<greatest(1,char_length(d.tts_text)) OR amount>100000 OR (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=e.account_id)+(SELECT coalesce(sum(task.budget_limit_cents),0) FROM public.tasks task JOIN public.episodes ep ON ep.id=task.episode_id WHERE ep.account_id=e.account_id AND task.status IN ('ready','running') AND task.task_type='generate_narration' AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=task.id))+amount>b.total_limit_cents THEN RAISE EXCEPTION '口播生成预算不足，请先允许账号生成额度并填写本次预留' USING ERRCODE='22023';END IF;
$old$,$new$ IF amount IS NULL OR amount<greatest(1,char_length(d.tts_text)) OR amount>100000 THEN RAISE EXCEPTION 'Invalid per-request narration reservation' USING ERRCODE='22023';END IF;
$new$);
 EXECUTE changed;
END $migration$;

DO $migration$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.reserve_workspace_narration_submission(uuid,integer,uuid)'::regprocedure);
 changed:=original;
 IF strpos(changed,$old$DECLARE r local_identity.workspace_narration_requests;t public.tasks;b public.generation_account_budgets;aid uuid;BEGIN
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.reserve_workspace_narration_submission(uuid,integer,uuid)';END IF;
 changed:=replace(changed,$old$DECLARE r local_identity.workspace_narration_requests;t public.tasks;b public.generation_account_budgets;aid uuid;BEGIN
$old$,$new$DECLARE r local_identity.workspace_narration_requests;t public.tasks;aid uuid;BEGIN
$new$);
 IF strpos(changed,$old$ SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF b.account_id IS NULL OR (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+t.budget_limit_cents>b.total_limit_cents THEN RAISE EXCEPTION '口播生成预算不足';END IF;
$old$)=0 THEN RAISE EXCEPTION 'Account budget retirement guard changed: local_identity.reserve_workspace_narration_submission(uuid,integer,uuid)';END IF;
 changed:=replace(changed,$old$ SELECT * INTO b FROM public.generation_account_budgets WHERE account_id=aid FOR UPDATE;
 IF b.account_id IS NULL OR (SELECT coalesce(sum(reserved_cents),0) FROM public.paid_generation_reservations WHERE account_id=aid)+t.budget_limit_cents>b.total_limit_cents THEN RAISE EXCEPTION '口播生成预算不足';END IF;
$old$,$new$$new$);
 EXECUTE changed;
END $migration$;

COMMENT ON TABLE public.generation_account_budgets IS 'Historical account budget settings; no longer consulted by generation admission or submission.';
