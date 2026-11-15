-- ADR-0057. Installing the schema never enables collection. Explicit activation
-- is a separate Owner operation; bootstrap rows are observations, not history.
CREATE TABLE local_identity.production_metric_controls (
 owner_id uuid PRIMARY KEY REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 coverage_started_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE local_identity.production_metric_coverage_periods (
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 started_at timestamptz NOT NULL,
 ended_at timestamptz CHECK (ended_at>=started_at),
 PRIMARY KEY(owner_id,started_at)
);
CREATE UNIQUE INDEX production_metric_coverage_one_open ON local_identity.production_metric_coverage_periods(owner_id) WHERE ended_at IS NULL;
CREATE TABLE local_identity.production_metric_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 event_type text NOT NULL,
 source_key text NOT NULL CHECK (source_key ~ '^[A-Za-z0-9:_.-]{1,200}$'),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 quality_tier text NOT NULL CHECK (quality_tier IN ('unspecified','low','medium','high')),
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=8192),
 UNIQUE(owner_id,episode_id,event_type,source_key)
);
CREATE INDEX production_metric_events_window ON local_identity.production_metric_events(owner_id,occurred_at,id);
CREATE INDEX production_metric_events_episode ON local_identity.production_metric_events(episode_id);
-- Deliberately no episode/account/task identifiers or content in this table.
CREATE TABLE local_identity.production_metric_daily (
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 day date NOT NULL,
 event_type text NOT NULL,
 quality_tier text NOT NULL CHECK (quality_tier IN ('unspecified','low','medium','high')),
 currency text NOT NULL DEFAULT 'none',
 is_test boolean NOT NULL DEFAULT false,
 count bigint NOT NULL CHECK (count>=0),
 amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents>=0),
 PRIMARY KEY(owner_id,day,event_type,quality_tier,currency,is_test)
);
CREATE TABLE local_identity.production_metric_quality_versions (
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK (revision>0),
 tier text NOT NULL CHECK (tier IN ('unspecified','low','medium','high')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,episode_id,revision)
);
CREATE TABLE local_identity.production_metric_task_quality (
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 tier text NOT NULL CHECK (tier IN ('unspecified','low','medium','high')),
 revision integer NOT NULL CHECK (revision>=0),
 frozen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,task_id)
);
CREATE TABLE local_identity.production_metric_delivery_quality (
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 delivery_id uuid NOT NULL REFERENCES local_identity.workspace_deliveries(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 tier text NOT NULL CHECK (tier IN ('unspecified','low','medium','high')),
 revision integer NOT NULL CHECK (revision>=0),
 frozen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,delivery_id)
);
CREATE TABLE local_identity.production_metric_queue_cycles (
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 attempt integer NOT NULL CHECK (attempt>=0),
 enqueued_at timestamptz NOT NULL,
 eligible_at timestamptz NOT NULL,
 claimed_at timestamptz,
 observed_only boolean NOT NULL DEFAULT false,
 PRIMARY KEY(owner_id,task_id,attempt)
);
CREATE TABLE local_identity.production_metric_resources (
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 sampled_at timestamptz NOT NULL,
 cpu_percent numeric CHECK (cpu_percent BETWEEN 0 AND 100),
 memory_used_bytes bigint CHECK (memory_used_bytes>=0),
 memory_total_bytes bigint CHECK (memory_total_bytes>0),
 queue_count integer NOT NULL CHECK (queue_count>=0),
 running_count integer NOT NULL CHECK (running_count>=0),
 resource_wait_count integer NOT NULL CHECK (resource_wait_count>=0 AND resource_wait_count<=queue_count),
 gpu_percent numeric CHECK (gpu_percent IS NULL),
 gap_seconds numeric NOT NULL DEFAULT 0 CHECK (gap_seconds>=0),
 CHECK (memory_used_bytes IS NULL OR memory_total_bytes IS NULL OR memory_used_bytes<=memory_total_bytes),
 PRIMARY KEY(owner_id,sampled_at)
);
CREATE TABLE local_identity.production_metric_resource_daily (
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 day date NOT NULL,
 samples bigint NOT NULL CHECK(samples>0),
 cpu_samples bigint NOT NULL CHECK(cpu_samples>=0),
 cpu_sum numeric NOT NULL CHECK(cpu_sum>=0),
 cpu_max numeric CHECK(cpu_max BETWEEN 0 AND 100),
 memory_samples bigint NOT NULL CHECK(memory_samples>=0),
 memory_used_sum numeric NOT NULL CHECK(memory_used_sum>=0),
 memory_total_sum numeric NOT NULL CHECK(memory_total_sum>=0),
 memory_used_peak bigint CHECK(memory_used_peak>=0),
 queue_peak integer NOT NULL CHECK(queue_peak>=0),
 running_peak integer NOT NULL CHECK(running_peak>=0),
 resource_wait_peak integer NOT NULL CHECK(resource_wait_peak>=0),
 gap_seconds numeric NOT NULL CHECK(gap_seconds>=0),
 PRIMARY KEY(owner_id,day)
);

CREATE FUNCTION local_identity.production_metrics_enabled() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT enabled FROM local_identity.production_metric_controls WHERE owner_id=local_identity.owner_id()),false)
$$;
CREATE FUNCTION local_identity.episode_business_quality(p_episode uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=local_identity.owner_id(); value jsonb;
BEGIN
 IF o IS NULL OR NOT EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=p_episode AND m.user_id=o AND m.role='owner') THEN RAISE EXCEPTION 'Owned episode required' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('tier',tier,'revision',revision) INTO value FROM local_identity.production_metric_quality_versions WHERE owner_id=o AND episode_id=p_episode ORDER BY revision DESC LIMIT 1;
 RETURN coalesce(value,'{"tier":"unspecified","revision":0}'::jsonb);
END $$;

-- One private writer, shared by database producers and narrowly scoped wrappers.
CREATE FUNCTION local_identity.append_production_metric(p_owner uuid,p_episode uuid,p_type text,p_key text,p_payload jsonb,p_at timestamptz DEFAULT NULL,p_tier text DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_payload jsonb; tier text; inserted_id bigint; amount bigint:=0; fact_currency text:='none'; test_episode boolean; activated timestamptz;
BEGIN
 SELECT updated_at INTO activated FROM local_identity.production_metric_controls WHERE owner_id=p_owner AND enabled;
 IF activated IS NULL OR p_at<activated THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=p_episode AND m.user_id=p_owner AND m.role='owner') THEN RAISE EXCEPTION 'Owned metric episode required' USING ERRCODE='42501';END IF;
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9:_.-]{1,200}$' OR p_type IS NULL OR p_type !~ '^[a-z_]{1,64}$' OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>8192 THEN RAISE EXCEPTION 'Invalid metric fact';END IF;
 IF p_payload->>'task_id' IS NOT NULL THEN
  SELECT q.tier INTO tier FROM local_identity.production_metric_task_quality q WHERE q.owner_id=p_owner AND q.task_id=(p_payload->>'task_id')::uuid;
  tier:=coalesce(tier,'unspecified');
 ELSE SELECT v.tier INTO tier FROM local_identity.production_metric_quality_versions v WHERE v.owner_id=p_owner AND v.episode_id=p_episode ORDER BY revision DESC LIMIT 1;END IF;
 tier:=coalesce(p_tier,tier,'unspecified');
 INSERT INTO local_identity.production_metric_events(owner_id,episode_id,event_type,source_key,payload,occurred_at,quality_tier)
 VALUES(p_owner,p_episode,p_type,p_key,p_payload,coalesce(p_at,clock_timestamp()),tier)
 ON CONFLICT(owner_id,episode_id,event_type,source_key) DO NOTHING RETURNING id INTO inserted_id;
 IF inserted_id IS NULL THEN
  SELECT payload INTO current_payload FROM local_identity.production_metric_events WHERE owner_id=p_owner AND episode_id=p_episode AND event_type=p_type AND source_key=p_key;
  IF current_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Metric idempotency content conflict' USING ERRCODE='23505';END IF;
  RETURN false;
 END IF;
 -- Fixed-size increment, never a scan/summary in the business transaction.
 IF p_type='estimate_frozen' AND coalesce((p_payload->>'estimate_known')::boolean,false) THEN amount:=coalesce((p_payload->>'estimated_cents')::bigint,0);fact_currency:=coalesce(p_payload->>'currency','CNY');
 ELSIF p_type='reservation_created' THEN amount:=coalesce((p_payload->>'reserved_cents')::bigint,0);fact_currency:='application_cents';
 ELSIF p_type='attempt_finished' THEN amount:=coalesce((p_payload->>'reported_cents')::bigint,0);fact_currency:='application_cents';
 ELSIF p_type='supplier_paid' THEN amount:=(p_payload->>'paid_cents')::bigint;fact_currency:=p_payload->>'currency';END IF;
 SELECT is_test INTO test_episode FROM public.episodes WHERE id=p_episode;
 INSERT INTO local_identity.production_metric_daily(owner_id,day,event_type,quality_tier,currency,is_test,count,amount_cents)
 VALUES(p_owner,(coalesce(p_at,clock_timestamp()) AT TIME ZONE 'Asia/Shanghai')::date,p_type,tier,fact_currency,test_episode,1,amount)
 ON CONFLICT(owner_id,day,event_type,quality_tier,currency,is_test) DO UPDATE SET count=local_identity.production_metric_daily.count+1,amount_cents=local_identity.production_metric_daily.amount_cents+excluded.amount_cents;
 RETURN true;
END $$;

CREATE FUNCTION local_identity.validate_production_metric_payload(p_payload jsonb) RETURNS void
 LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; v jsonb;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>8192 THEN RAISE EXCEPTION 'Invalid metric payload';END IF;
 FOR k,v IN SELECT entry.key,entry.value FROM jsonb_each(p_payload) AS entry LOOP
  IF NOT k=ANY(ARRAY['task_id','attempt','request_id','request_kind','request_role','response_status','phase','http_status','operation','request_key','reason_code','workspace_id','candidate_id','source_task_id','related_task_id','target_id','change_reason','project_revision','project_sha256','source_kind','confirmation_id','estimate_version','estimated_cents','currency','source_currency','conversion_rate','rate_version','estimate_known','retry_of_task_id','paid_cents','billing_evidence_id']) THEN RAISE EXCEPTION 'Unexpected metric payload field';END IF;
  IF jsonb_typeof(v) NOT IN ('null','string','number','boolean') THEN RAISE EXCEPTION 'Metric payload scalars required';END IF;
  IF jsonb_typeof(v)='string' AND (length(v#>>'{}')>200 OR (v#>>'{}') !~ '^[A-Za-z0-9:_./-]*$') THEN RAISE EXCEPTION 'Metric payload machine identifiers required';END IF;
  IF k IN ('attempt','project_revision','estimated_cents','paid_cents') AND v<>'null'::jsonb AND (jsonb_typeof(v)<>'number' OR (v#>>'{}') !~ '^[0-9]{1,14}$') THEN RAISE EXCEPTION 'Metric nonnegative integer required';END IF;
  IF k='http_status' AND v<>'null'::jsonb AND ((v#>>'{}') !~ '^[1-5][0-9]{2}$' OR jsonb_typeof(v)<>'number') THEN RAISE EXCEPTION 'Invalid HTTP status';END IF;
  IF k='operation' AND v<>'null'::jsonb AND v#>>'{}' NOT IN ('create','poll','download') THEN RAISE EXCEPTION 'Invalid request operation';END IF;
 END LOOP;
END $$;
CREATE FUNCTION local_identity.validate_production_metric_scope(p_episode uuid,p_payload jsonb) RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; ref uuid;
BEGIN
 FOREACH k IN ARRAY ARRAY['task_id','source_task_id','related_task_id','retry_of_task_id'] LOOP
  IF p_payload->>k IS NOT NULL THEN
   ref:=(p_payload->>k)::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.tasks WHERE id=ref AND episode_id=p_episode) THEN RAISE EXCEPTION 'Metric task scope mismatch' USING ERRCODE='42501';END IF;
  END IF;
 END LOOP;
 IF p_payload->>'workspace_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM local_identity.production_workspaces WHERE id=(p_payload->>'workspace_id')::uuid AND episode_id=p_episode) THEN RAISE EXCEPTION 'Metric workspace scope mismatch' USING ERRCODE='42501';END IF;
 IF p_payload->>'confirmation_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_call_confirmations WHERE id=(p_payload->>'confirmation_id')::uuid AND episode_id=p_episode AND consumed_at IS NOT NULL) THEN RAISE EXCEPTION 'Metric confirmation scope mismatch' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION local_identity.record_owned_production_metric(p_episode uuid,p_type text,p_source_key text,p_payload jsonb) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=local_identity.owner_id();
BEGIN
 IF o IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF NOT local_identity.production_metrics_enabled() THEN RETURN false;END IF;
 IF p_type NOT IN ('estimate_frozen','candidate_adopted','candidate_withdrawn','candidate_rejected','retry_relation') THEN RAISE EXCEPTION 'Owner metric type invalid';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=p_episode AND m.user_id=o AND m.role='owner') THEN RAISE EXCEPTION 'Owned metric episode required' USING ERRCODE='42501';END IF;
 PERFORM local_identity.validate_production_metric_payload(p_payload);
 PERFORM local_identity.validate_production_metric_scope(p_episode,p_payload);
 RETURN local_identity.append_production_metric(o,p_episode,p_type,p_source_key,p_payload);
END $$;
CREATE FUNCTION local_identity.record_worker_production_metric(p_task uuid,p_attempt integer,p_lease uuid,p_type text,p_source_key text,p_payload jsonb) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; o uuid; wrote boolean:=false;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tasks t JOIN public.episodes ep ON ep.id=t.episode_id JOIN public.account_memberships m ON m.account_id=ep.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE t.id=p_task AND m.role='owner') THEN RETURN false;END IF;
 PERFORM public.assert_worker_lease(p_task,p_attempt,p_lease);
 IF p_type NOT IN ('provider_request_dispatch','provider_response_observed','provider_outcome_unknown','provider_receipt_persisted','supplier_paid') THEN RAISE EXCEPTION 'Worker metric type invalid';END IF;
 PERFORM local_identity.validate_production_metric_payload(p_payload);
 IF p_payload ? 'task_id' AND p_payload->>'task_id' IS DISTINCT FROM p_task::text OR p_payload ? 'attempt' AND (p_payload->>'attempt')::integer IS DISTINCT FROM p_attempt THEN RAISE EXCEPTION 'Metric attempt scope mismatch' USING ERRCODE='42501';END IF;
 IF p_type='supplier_paid' THEN RAISE EXCEPTION 'No trusted attributed supplier bill adapter is installed' USING ERRCODE='0A000';END IF;
 SELECT episode_id INTO e FROM public.tasks WHERE id=p_task;
 PERFORM local_identity.validate_production_metric_scope(e,p_payload);
 FOR o IN SELECT m.user_id FROM public.episodes ep JOIN public.account_memberships m ON m.account_id=ep.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE ep.id=e AND m.role='owner' LOOP
  wrote:=local_identity.append_production_metric(o,e,p_type,p_source_key,p_payload||jsonb_build_object('task_id',p_task,'attempt',p_attempt)) OR wrote;
 END LOOP;
 RETURN wrote;
END $$;

CREATE FUNCTION local_identity.set_episode_business_quality(p_episode uuid,p_tier text,p_expected_revision integer DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=local_identity.owner_id(); old_value jsonb; n integer;
BEGIN
 IF o IS NULL OR NOT local_identity.production_metrics_enabled() THEN RAISE EXCEPTION 'Production metrics not enabled' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=p_episode AND m.user_id=o AND m.role='owner' FOR UPDATE OF e;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned episode required' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.episodes e WHERE e.id=p_episode AND (e.archived_at IS NOT NULL OR e.stage='production_completed')) OR EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin r WHERE r.episode_id=p_episode) THEN RAISE EXCEPTION 'Episode is read only' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.input_episodes WHERE episode_id=p_episode AND owner_id=o) THEN RAISE EXCEPTION 'Current input episode required' USING ERRCODE='42501';END IF;
 IF p_tier IS NULL OR p_tier NOT IN ('unspecified','low','medium','high') THEN RAISE EXCEPTION 'Invalid business quality';END IF;
 old_value:=local_identity.episode_business_quality(p_episode);
 IF p_expected_revision IS NOT NULL AND p_expected_revision<>(old_value->>'revision')::integer THEN RAISE EXCEPTION 'Business quality revision changed' USING ERRCODE='40001';END IF;
 IF old_value->>'tier'=p_tier THEN RETURN old_value;END IF;
 n:=(old_value->>'revision')::integer+1;
 INSERT INTO local_identity.production_metric_quality_versions(owner_id,episode_id,revision,tier) VALUES(o,p_episode,n,p_tier);
 PERFORM local_identity.append_production_metric(o,p_episode,'quality_changed','quality:'||n,jsonb_build_object('tier',p_tier,'revision',n),NULL,p_tier);
 RETURN jsonb_build_object('tier',p_tier,'revision',n);
END $$;

CREATE FUNCTION local_identity.set_production_metrics_enabled(p_enabled boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=local_identity.owner_id(); previous boolean; e record; q record; at_time timestamptz:=clock_timestamp();
BEGIN
 IF o IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Boolean activation required';END IF;
 INSERT INTO local_identity.production_metric_controls(owner_id) VALUES(o) ON CONFLICT DO NOTHING;
 SELECT enabled INTO previous FROM local_identity.production_metric_controls WHERE owner_id=o FOR UPDATE;
 UPDATE local_identity.production_metric_controls SET enabled=p_enabled,coverage_started_at=CASE WHEN p_enabled THEN coalesce(coverage_started_at,at_time) ELSE coverage_started_at END,updated_at=CASE WHEN previous IS DISTINCT FROM p_enabled THEN at_time ELSE updated_at END WHERE owner_id=o;
 IF previous AND NOT p_enabled THEN UPDATE local_identity.production_metric_coverage_periods SET ended_at=at_time WHERE owner_id=o AND ended_at IS NULL;END IF;
 IF p_enabled AND NOT previous THEN
  INSERT INTO local_identity.production_metric_coverage_periods(owner_id,started_at) VALUES(o,at_time);
  FOR e IN SELECT ep.id,ep.stage FROM public.episodes ep JOIN public.account_memberships m ON m.account_id=ep.account_id WHERE m.user_id=o AND m.role='owner' LOOP
   PERFORM local_identity.append_production_metric(o,e.id,'coverage_observation','coverage:'||extract(epoch from at_time)::text,jsonb_build_object('stage',e.stage,'observed_only',true),at_time);
   FOR q IN SELECT id,attempt,available_at FROM public.tasks WHERE episode_id=e.id AND status='ready' AND invalidated_at IS NULL LOOP
    INSERT INTO local_identity.production_metric_queue_cycles(owner_id,task_id,episode_id,attempt,enqueued_at,eligible_at,observed_only) VALUES(o,q.id,e.id,q.attempt,at_time,greatest(q.available_at,at_time),true) ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
 END IF;
 RETURN (SELECT jsonb_build_object('enabled',enabled,'coverageStartedAt',coverage_started_at) FROM local_identity.production_metric_controls WHERE owner_id=o);
END $$;

CREATE FUNCTION local_identity.capture_production_metric_episode() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.stage IS NOT DISTINCT FROM OLD.stage THEN RETURN NEW;END IF;
 FOR o IN SELECT m.user_id FROM public.account_memberships m JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE m.account_id=NEW.account_id AND m.role='owner' LOOP
  PERFORM local_identity.append_production_metric(o,NEW.id,CASE WHEN TG_OP='INSERT' THEN 'episode_created' ELSE 'stage_changed' END,'stage:'||extensions.gen_random_uuid()::text,jsonb_build_object('from_stage',CASE WHEN TG_OP='UPDATE' THEN OLD.stage ELSE NULL END,'to_stage',NEW.stage,'reason_code',CASE WHEN TG_OP='INSERT' THEN 'episode_created' ELSE 'episode_stage_update' END),CASE WHEN TG_OP='INSERT' THEN NEW.created_at ELSE NULL END);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER production_metrics_episode AFTER INSERT OR UPDATE OF stage ON public.episodes FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_metric_episode();
CREATE FUNCTION local_identity.capture_production_metric_transition() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid; code text;
BEGIN
 code:=CASE WHEN NEW.reason='Exact workspace delivery package verified.' THEN 'verified_delivery' WHEN NEW.actor_id IS NOT NULL THEN 'owner_stage_decision' ELSE 'system_stage_transition' END;
 FOR o IN SELECT m.user_id FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE e.id=NEW.episode_id AND m.role='owner' LOOP
  PERFORM local_identity.append_production_metric(o,NEW.episode_id,'stage_transition_evidence','transition:'||NEW.id,jsonb_build_object('transition_id',NEW.id,'from_stage',NEW.from_stage,'to_stage',NEW.to_stage,'reason_code',code),NEW.created_at);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER production_metrics_transition AFTER INSERT ON public.state_transitions FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_metric_transition();

CREATE FUNCTION local_identity.capture_production_metric_task() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid; tier text; rev integer; queued timestamptz:=clock_timestamp(); a integer; cycle local_identity.production_metric_queue_cycles;
BEGIN
 FOR o IN SELECT m.user_id FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE e.id=NEW.episode_id AND m.role='owner' LOOP
  IF TG_OP='INSERT' AND NEW.created_at<(SELECT updated_at FROM local_identity.production_metric_controls WHERE owner_id=o) THEN CONTINUE;END IF;
  IF TG_OP='INSERT' THEN
   SELECT v.tier,v.revision INTO tier,rev FROM local_identity.production_metric_quality_versions v WHERE v.owner_id=o AND v.episode_id=NEW.episode_id ORDER BY v.revision DESC LIMIT 1;
   INSERT INTO local_identity.production_metric_task_quality(owner_id,task_id,episode_id,tier,revision) VALUES(o,NEW.id,NEW.episode_id,coalesce(tier,'unspecified'),coalesce(rev,0));
  END IF;
  IF NEW.status='ready' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.attempt IS DISTINCT FROM NEW.attempt) THEN
   INSERT INTO local_identity.production_metric_queue_cycles(owner_id,task_id,episode_id,attempt,enqueued_at,eligible_at) VALUES(o,NEW.id,NEW.episode_id,NEW.attempt,queued,greatest(NEW.available_at,queued)) ON CONFLICT DO NOTHING;
   PERFORM local_identity.append_production_metric(o,NEW.episode_id,'queue_entered','queue:'||NEW.id||':'||NEW.attempt,jsonb_build_object('task_id',NEW.id,'attempt',NEW.attempt,'eligible_at',greatest(NEW.available_at,queued),'reason_code',CASE WHEN TG_OP='INSERT' THEN 'submitted' ELSE 'requeued' END),queued);
  ELSIF NEW.status='ready' AND TG_OP='UPDATE' AND NEW.available_at IS DISTINCT FROM OLD.available_at THEN
   UPDATE local_identity.production_metric_queue_cycles SET eligible_at=greatest(NEW.available_at,enqueued_at) WHERE owner_id=o AND task_id=NEW.id AND attempt=NEW.attempt;
   PERFORM local_identity.append_production_metric(o,NEW.episode_id,'queue_eligibility_changed','eligibility:'||NEW.id||':'||NEW.attempt||':'||extensions.gen_random_uuid()::text,jsonb_build_object('task_id',NEW.id,'attempt',NEW.attempt,'eligible_at',greatest(NEW.available_at,queued),'reason_code','backoff_changed'));
  END IF;
  IF NEW.status='running' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.attempt IS DISTINCT FROM NEW.attempt) THEN
   a:=greatest(NEW.attempt-1,0);
   SELECT * INTO cycle FROM local_identity.production_metric_queue_cycles WHERE owner_id=o AND task_id=NEW.id AND attempt=a FOR UPDATE;
   UPDATE local_identity.production_metric_queue_cycles SET claimed_at=coalesce(NEW.claimed_at,queued) WHERE owner_id=o AND task_id=NEW.id AND attempt=a;
   PERFORM local_identity.append_production_metric(o,NEW.episode_id,'task_claimed','claim:'||NEW.id||':'||a,jsonb_build_object('task_id',NEW.id,'attempt',a,'claimed_at',coalesce(NEW.claimed_at,queued),'backoff_seconds',CASE WHEN cycle.task_id IS NOT NULL THEN greatest(0,extract(epoch from cycle.eligible_at-cycle.enqueued_at)) ELSE NULL END,'eligible_wait_seconds',CASE WHEN cycle.task_id IS NOT NULL THEN greatest(0,extract(epoch from coalesce(NEW.claimed_at,queued)-cycle.eligible_at)) ELSE NULL END,'observed_only',coalesce(cycle.observed_only,true)));
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER production_metrics_task AFTER INSERT OR UPDATE OF status,attempt,available_at ON public.tasks FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_metric_task();

CREATE FUNCTION local_identity.capture_production_metric_run() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; o uuid; tier text; t public.tasks;
BEGIN
 SELECT * INTO t FROM public.tasks WHERE id=NEW.task_id;e:=t.episode_id;
 FOR o IN SELECT m.user_id FROM public.episodes ep JOIN public.account_memberships m ON m.account_id=ep.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE ep.id=e AND m.role='owner' LOOP
  SELECT q.tier INTO tier FROM local_identity.production_metric_task_quality q WHERE q.owner_id=o AND q.task_id=NEW.task_id;
  IF TG_OP='INSERT' THEN
   PERFORM local_identity.append_production_metric(o,e,'attempt_started','run:'||NEW.id,jsonb_build_object('run_id',NEW.id,'task_id',NEW.task_id,'attempt',NEW.attempt,'provider',t.provider,'model',t.model,'task_type',t.task_type,'quality_snapshot_known',tier IS NOT NULL),NEW.started_at,coalesce(tier,'unspecified'));
  END IF;
  IF NEW.completed_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.completed_at IS NULL) THEN
   PERFORM local_identity.append_production_metric(o,e,'attempt_finished','run:'||NEW.id,jsonb_build_object('run_id',NEW.id,'task_id',NEW.task_id,'attempt',NEW.attempt,'status',NEW.status,'reported_cents',NEW.actual_cost_cents,'started_at',NEW.started_at,'completed_at',NEW.completed_at,'quality_snapshot_known',tier IS NOT NULL),NEW.completed_at,coalesce(tier,'unspecified'));
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER production_metrics_run AFTER INSERT OR UPDATE OF completed_at,status ON public.task_runs FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_metric_run();

CREATE FUNCTION local_identity.capture_production_metric_reservation() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; o uuid;
BEGIN
 SELECT episode_id INTO e FROM public.tasks WHERE id=NEW.task_id;
 FOR o IN SELECT m.user_id FROM public.episodes ep JOIN public.account_memberships m ON m.account_id=ep.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE ep.id=e AND m.role='owner' LOOP
  PERFORM local_identity.append_production_metric(o,e,'reservation_created','reservation:'||NEW.task_id,jsonb_build_object('task_id',NEW.task_id,'kind',NEW.kind,'reserved_cents',NEW.reserved_cents),NEW.created_at);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER production_metrics_reservation AFTER INSERT ON public.paid_generation_reservations FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_metric_reservation();
CREATE FUNCTION local_identity.capture_production_metric_video_registration() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tasks; o uuid;
BEGIN
 IF NEW.kind<>'video' OR NEW.provider_task_id IS NULL OR NEW.request_state<>'submitted' OR (OLD.provider_task_id IS NOT NULL AND OLD.request_state='submitted') THEN RETURN NEW;END IF;
 SELECT * INTO t FROM public.tasks WHERE id=NEW.task_id;
 FOR o IN SELECT m.user_id FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE e.id=t.episode_id AND m.role='owner' LOOP
  PERFORM local_identity.append_production_metric(o,t.episode_id,'provider_task_registered','remote-task:'||NEW.task_id,jsonb_build_object('task_id',NEW.task_id,'attempt',greatest(t.attempt-1,0),'phase','remote_task_registered'));
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER production_metrics_video_registration AFTER UPDATE OF provider_task_id,request_state ON public.paid_generation_reservations FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_metric_video_registration();

CREATE FUNCTION local_identity.capture_production_metric_dispatch() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; o uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.phase IS NOT DISTINCT FROM OLD.phase THEN RETURN NEW;END IF;
 SELECT episode_id INTO e FROM public.tasks WHERE id=NEW.task_id;
 FOR o IN SELECT m.user_id FROM public.episodes ep JOIN public.account_memberships m ON m.account_id=ep.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE ep.id=e AND m.role='owner' LOOP
  PERFORM local_identity.append_production_metric(o,e,'provider_dispatch_phase','dispatch:'||NEW.task_id||':'||NEW.attempt||':'||NEW.phase,jsonb_build_object('task_id',NEW.task_id,'attempt',NEW.attempt,'request_kind',NEW.kind,'phase',NEW.phase,'reason_code',CASE WHEN NEW.phase='dispatching' THEN 'dispatch_marker_not_delivery_proof' WHEN NEW.phase='received' THEN 'receipt_persisted' ELSE NEW.phase END),NEW.updated_at);
  IF NEW.phase='received' THEN PERFORM local_identity.append_production_metric(o,e,'provider_receipt_persisted','artifact-receipt:'||NEW.task_id||':'||NEW.attempt,jsonb_build_object('task_id',NEW.task_id,'attempt',NEW.attempt,'request_kind',NEW.kind,'phase','artifact_verified'),NEW.updated_at);END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER production_metrics_dispatch AFTER INSERT OR UPDATE OF phase ON local_identity.provider_dispatch_facts FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_metric_dispatch();

-- A request table is the durable task-to-consumed-confirmation relationship;
-- consuming the proposal alone happens too early to establish that relationship.
CREATE FUNCTION local_identity.capture_production_metric_estimate() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dispatch_authorization text; approval local_identity.workspace_call_confirmations; estimate jsonb; pricing jsonb; task uuid; snapshot jsonb; known boolean; fact_payload jsonb; prior uuid; k text; n jsonb;
 prior_task public.tasks; prior_speech local_identity.workspace_narration_requests; prior_code text; changed boolean; comparison text:='unavailable'; comparison_reason text:='request_kind_not_comparable';
BEGIN
 -- Re-setting an existing task reference is not another submission. In
 -- particular, later edits to the prior task cannot rewrite frozen attribution.
 IF TG_OP='UPDATE' AND NEW.task_id IS NOT DISTINCT FROM OLD.task_id THEN RETURN NEW;END IF;
 task:=NEW.task_id;
 IF task IS NULL THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='workspace_visual_candidates' THEN snapshot:=NEW.request_snapshot;dispatch_authorization:=snapshot->>'authorizationHash';
 ELSE dispatch_authorization:=NEW.authorization_hash;
  IF TG_TABLE_NAME='workspace_narration_requests' THEN snapshot:=NEW.request_snapshot;END IF;
 END IF;
 SELECT * INTO approval FROM local_identity.workspace_call_confirmations WHERE authorization_hash=dispatch_authorization AND episode_id=NEW.episode_id AND workspace_id=NEW.workspace_id AND consumed_at IS NOT NULL;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM local_identity.production_metric_controls WHERE owner_id=approval.owner_id AND enabled AND updated_at<=approval.consumed_at) THEN RETURN NEW;END IF;
 estimate:=approval.summary->'estimate';pricing:=estimate->'pricing';
 IF pricing IS NOT NULL AND pricing<>'null'::jsonb THEN
  IF jsonb_typeof(pricing)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(pricing) AS fields(key) WHERE fields.key<>ALL(ARRAY['currency','sourceCurrency','conversionRate','rateVersion','rateSource','units'])) OR pricing->>'currency'<>'CNY' OR coalesce(pricing->>'sourceCurrency','none') NOT IN ('CNY','USD','none') OR coalesce(pricing->>'rateSource','unknown') NOT IN ('published_list','local_assumption','unknown') THEN RAISE EXCEPTION 'Invalid frozen estimate pricing';END IF;
  IF pricing->>'conversionRate' IS NOT NULL AND (jsonb_typeof(pricing->'conversionRate')<>'number' OR (pricing->>'conversionRate')::numeric<=0) THEN RAISE EXCEPTION 'Invalid frozen conversion';END IF;
  IF pricing->>'rateVersion' IS NOT NULL AND (jsonb_typeof(pricing->'rateVersion')<>'string' OR length(pricing->>'rateVersion')>200 OR pricing->>'rateVersion' !~ '^[A-Za-z0-9:_./-]+$') THEN RAISE EXCEPTION 'Invalid frozen rate version';END IF;
  IF pricing->'units' IS NOT NULL AND pricing->'units'<>'null'::jsonb THEN
   IF jsonb_typeof(pricing->'units')<>'object' THEN RAISE EXCEPTION 'Frozen pricing units object required';END IF;
   FOR k,n IN SELECT entry.key,entry.value FROM jsonb_each(pricing->'units') AS entry LOOP
    IF k !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' OR jsonb_typeof(n) NOT IN ('number','null') OR (n#>>'{}')::numeric<0 THEN RAISE EXCEPTION 'Frozen unit rates must be nonnegative numeric values';END IF;
   END LOOP;
  END IF;
 END IF;
 known:=estimate IS NOT NULL AND estimate->>'estimatedCents' IS NOT NULL AND NOT coalesce((estimate->>'manualReservation')::boolean,false);
 fact_payload:=jsonb_build_object('task_id',task,'confirmation_id',approval.id,'estimate_version',estimate->>'version','estimate_known',known,'estimated_cents',CASE WHEN known THEN (estimate->>'estimatedCents')::bigint ELSE NULL END,'currency','CNY','pricing',pricing);
 PERFORM local_identity.append_production_metric(approval.owner_id,NEW.episode_id,'estimate_frozen','estimate:'||task,fact_payload);
 prior:=nullif(snapshot->>'retryOfTaskId','')::uuid;
 IF prior IS NOT NULL THEN
  SELECT * INTO prior_task FROM public.tasks WHERE id=prior AND episode_id=NEW.episode_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retry source scope mismatch' USING ERRCODE='42501';END IF;
  prior_code:=prior_task.last_result#>>'{blockers,0,code}';
  IF prior_code IS NOT NULL AND prior_code !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' THEN prior_code:=NULL;END IF;
  IF TG_TABLE_NAME='workspace_narration_requests' THEN
   SELECT * INTO prior_speech FROM local_identity.workspace_narration_requests r WHERE r.task_id=prior AND r.workspace_id=NEW.workspace_id AND r.shot_id=NEW.shot_id;
   IF FOUND AND prior_speech.request_snapshot->>'selectionVersion'='1' AND snapshot->>'selectionVersion'='1' AND prior_speech.input_fingerprint~'^[0-9a-f]{64}$' AND NEW.input_fingerprint~'^[0-9a-f]{64}$' AND prior_speech.request_snapshot->>'inputFingerprint'=prior_speech.input_fingerprint AND snapshot->>'inputFingerprint'=NEW.input_fingerprint THEN
    changed:=prior_speech.input_fingerprint<>NEW.input_fingerprint;comparison:='narration_input_fingerprint';comparison_reason:=NULL;
   ELSE comparison_reason:='missing_or_unmatched_narration_fingerprint';END IF;
  ELSIF TG_TABLE_NAME='workspace_visual_candidates' THEN
   -- This hash includes authorizationHash/retryOfTaskId, and therefore changes
   -- for a new approval even when the actual generation inputs are identical.
   comparison_reason:='visual_authorization_fingerprint';
  END IF;
  PERFORM local_identity.append_production_metric(approval.owner_id,NEW.episode_id,'retry_relation','retry:'||task,jsonb_build_object('task_id',task,'retry_of_task_id',prior,'confirmation_id',approval.id,'reason_code',CASE prior_task.status WHEN 'failed' THEN 'previous_task_failed' WHEN 'blocked' THEN 'previous_task_blocked' ELSE 'explicit_retry' END,'previous_status',prior_task.status,'previous_blocker_code',prior_code,'prior_provider_result_unknown_marked',coalesce((prior_task.last_result#>'{preflight,checks}') @> '[{"check":"provider_result_unknown"}]'::jsonb,false),'input_changed',changed,'input_comparison',comparison,'input_comparison_unavailable_reason',comparison_reason));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER production_metrics_narration_estimate AFTER INSERT ON local_identity.workspace_narration_requests FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_metric_estimate();
CREATE TRIGGER production_metrics_visual_estimate AFTER INSERT OR UPDATE OF task_id ON local_identity.workspace_visual_candidates FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_metric_estimate();
CREATE TRIGGER production_metrics_audio_estimate AFTER INSERT ON local_identity.workspace_audio_requests FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_metric_estimate();

CREATE FUNCTION local_identity.capture_production_metric_delivery() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid; tier text; rev integer; d record; t public.tasks;
BEGIN
 -- Delivery rows may precede task completion. Freeze on confirmation (insertion),
 -- count a completed delivery only once the authoritative task completes.
 IF TG_TABLE_NAME='workspace_deliveries' THEN
  FOR o IN SELECT m.user_id FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled AND c.updated_at<=NEW.created_at WHERE e.id=NEW.episode_id AND m.role='owner' LOOP
   SELECT v.tier,v.revision INTO tier,rev FROM local_identity.production_metric_quality_versions v WHERE v.owner_id=o AND v.episode_id=NEW.episode_id ORDER BY v.revision DESC LIMIT 1;
   INSERT INTO local_identity.production_metric_delivery_quality(owner_id,delivery_id,episode_id,tier,revision) VALUES(o,NEW.id,NEW.episode_id,coalesce(tier,'unspecified'),coalesce(rev,0)) ON CONFLICT DO NOTHING;
   PERFORM local_identity.append_production_metric(o,NEW.episode_id,'delivery_confirmed','delivery:'||NEW.id,jsonb_build_object('delivery_id',NEW.id,'task_id',NEW.task_id,'quality_snapshot_known',true),NULL,coalesce(tier,'unspecified'));
  END LOOP;
  SELECT * INTO t FROM public.tasks WHERE id=NEW.task_id;
 ELSE t:=NEW;END IF;
 IF t.status='completed' AND t.task_type='prepare_publish_package' AND t.completed_at IS NOT NULL THEN
  FOR d IN SELECT w.*,m.user_id owner_id,q.tier,q.delivery_id IS NOT NULL snapshot_known FROM local_identity.workspace_deliveries w JOIN public.episodes e ON e.id=w.episode_id JOIN public.account_memberships m ON m.account_id=e.account_id AND m.role='owner' JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled LEFT JOIN local_identity.production_metric_delivery_quality q ON q.delivery_id=w.id AND q.owner_id=m.user_id WHERE w.task_id=t.id LOOP
   PERFORM local_identity.append_production_metric(d.owner_id,d.episode_id,'delivery_completed','delivery:'||d.id,jsonb_build_object('delivery_id',d.id,'task_id',t.id,'quality_snapshot_known',d.snapshot_known),t.completed_at,coalesce(d.tier,'unspecified'));
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER production_metrics_delivery AFTER INSERT ON local_identity.workspace_deliveries FOR EACH ROW EXECUTE FUNCTION local_identity.capture_production_metric_delivery();
CREATE TRIGGER production_metrics_delivery_task AFTER UPDATE OF status ON public.tasks FOR EACH ROW WHEN (NEW.status='completed') EXECUTE FUNCTION local_identity.capture_production_metric_delivery();

CREATE FUNCTION local_identity.production_metrics_activity() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=local_identity.owner_id(); q integer; r integer; w integer; capacity integer;
BEGIN
 IF o IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF NOT local_identity.production_metrics_enabled() THEN RETURN jsonb_build_object('enabled',false,'queued',0,'running',0,'resourceWait',0);END IF;
 SELECT s.capacity INTO capacity FROM public.worker_scheduler_settings s WHERE singleton;
 capacity:=coalesce(capacity,1);
 WITH owned AS (SELECT t.*,public.worker_resource_limits(t.input_snapshot,capacity) limits FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id WHERE t.status IN ('ready','running') AND NOT e.is_test AND e.archived_at IS NULL AND t.invalidated_at IS NULL AND local_identity.current_worker_task(t) AND NOT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin b WHERE b.episode_id=e.id) AND EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=o AND m.role='owner')),
 busy AS (SELECT public.worker_resource_limits(t.input_snapshot,capacity) limits FROM public.tasks t WHERE t.status='running' AND t.claimed_at>clock_timestamp()-interval '30 minutes' AND local_identity.current_worker_task(t))
 SELECT count(*) FILTER(WHERE status='ready'),count(*) FILTER(WHERE status='running' AND claimed_at>clock_timestamp()-interval '30 minutes'),count(*) FILTER(WHERE status='ready' AND available_at<=clock_timestamp() AND EXISTS(SELECT 1 FROM jsonb_array_elements(owned.limits) lim WHERE (SELECT count(*) FROM busy WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(busy.limits) used WHERE used->>'key'=lim->>'key'))>=(lim->>'limit')::integer)) INTO q,r,w FROM owned;
 RETURN jsonb_build_object('enabled',true,'queued',q,'running',r,'resourceWait',w);
END $$;
CREATE FUNCTION local_identity.record_production_metric_resource(p_sample jsonb) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=local_identity.owner_id(); at_time timestamptz; inserted integer; old_value jsonb; field text; cpu numeric; mem_used bigint; mem_total bigint; queued integer; running integer; waiting integer; gap numeric;
BEGIN
 IF o IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF NOT local_identity.production_metrics_enabled() THEN RETURN false;END IF;
 IF p_sample IS NULL OR jsonb_typeof(p_sample)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_sample) AS fields(key) WHERE fields.key<>ALL(ARRAY['sampled_at','cpu_percent','memory_used_bytes','memory_total_bytes','queue_count','running_count','resource_wait_count','gpu_percent','gap_seconds'])) OR NOT p_sample ?& ARRAY['sampled_at','queue_count','running_count','resource_wait_count'] OR coalesce(p_sample->'gpu_percent','null'::jsonb)<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid resource sample';END IF;
 IF jsonb_typeof(p_sample->'sampled_at')<>'string' THEN RAISE EXCEPTION 'Resource observation timestamp required';END IF;
 FOREACH field IN ARRAY ARRAY['cpu_percent','memory_used_bytes','memory_total_bytes','queue_count','running_count','resource_wait_count','gap_seconds'] LOOP
  IF p_sample->>field IS NOT NULL AND jsonb_typeof(p_sample->field)<>'number' THEN RAISE EXCEPTION 'Resource numeric value required';END IF;
 END LOOP;
 at_time:=(p_sample->>'sampled_at')::timestamptz;
 IF at_time IS NULL OR at_time>clock_timestamp()+interval '5 seconds' OR at_time<clock_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'Resource sample outside observation window';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(o::text||':production-resource-sample',0));
 IF EXISTS(SELECT 1 FROM local_identity.production_metric_resources WHERE owner_id=o AND sampled_at<>at_time AND sampled_at>at_time-interval '30 seconds') THEN RETURN false;END IF;
 INSERT INTO local_identity.production_metric_resources(owner_id,sampled_at,cpu_percent,memory_used_bytes,memory_total_bytes,queue_count,running_count,resource_wait_count,gpu_percent,gap_seconds)
 VALUES(o,at_time,(p_sample->>'cpu_percent')::numeric,(p_sample->>'memory_used_bytes')::bigint,(p_sample->>'memory_total_bytes')::bigint,(p_sample->>'queue_count')::integer,(p_sample->>'running_count')::integer,(p_sample->>'resource_wait_count')::integer,NULL,coalesce((p_sample->>'gap_seconds')::numeric,0)) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=0 THEN
  SELECT to_jsonb(s)-'owner_id' INTO old_value FROM local_identity.production_metric_resources s WHERE owner_id=o AND sampled_at=at_time;
  IF old_value IS DISTINCT FROM jsonb_build_object('sampled_at',at_time,'cpu_percent',(p_sample->>'cpu_percent')::numeric,'memory_used_bytes',(p_sample->>'memory_used_bytes')::bigint,'memory_total_bytes',(p_sample->>'memory_total_bytes')::bigint,'queue_count',(p_sample->>'queue_count')::integer,'running_count',(p_sample->>'running_count')::integer,'resource_wait_count',(p_sample->>'resource_wait_count')::integer,'gpu_percent',NULL,'gap_seconds',coalesce((p_sample->>'gap_seconds')::numeric,0)) THEN RAISE EXCEPTION 'Resource sample idempotency content conflict' USING ERRCODE='23505';END IF;
 ELSE
  cpu:=(p_sample->>'cpu_percent')::numeric;mem_used:=(p_sample->>'memory_used_bytes')::bigint;mem_total:=(p_sample->>'memory_total_bytes')::bigint;queued:=(p_sample->>'queue_count')::integer;running:=(p_sample->>'running_count')::integer;waiting:=(p_sample->>'resource_wait_count')::integer;gap:=coalesce((p_sample->>'gap_seconds')::numeric,0);
  INSERT INTO local_identity.production_metric_resource_daily(owner_id,day,samples,cpu_samples,cpu_sum,cpu_max,memory_samples,memory_used_sum,memory_total_sum,memory_used_peak,queue_peak,running_peak,resource_wait_peak,gap_seconds)
  VALUES(o,(at_time AT TIME ZONE 'Asia/Shanghai')::date,1,CASE WHEN cpu IS NULL THEN 0 ELSE 1 END,coalesce(cpu,0),cpu,CASE WHEN mem_used IS NULL OR mem_total IS NULL THEN 0 ELSE 1 END,CASE WHEN mem_total IS NOT NULL THEN coalesce(mem_used,0) ELSE 0 END,CASE WHEN mem_used IS NOT NULL THEN coalesce(mem_total,0) ELSE 0 END,mem_used,queued,running,waiting,gap)
  ON CONFLICT(owner_id,day) DO UPDATE SET samples=local_identity.production_metric_resource_daily.samples+1,cpu_samples=local_identity.production_metric_resource_daily.cpu_samples+excluded.cpu_samples,cpu_sum=local_identity.production_metric_resource_daily.cpu_sum+excluded.cpu_sum,cpu_max=greatest(local_identity.production_metric_resource_daily.cpu_max,excluded.cpu_max),memory_samples=local_identity.production_metric_resource_daily.memory_samples+excluded.memory_samples,memory_used_sum=local_identity.production_metric_resource_daily.memory_used_sum+excluded.memory_used_sum,memory_total_sum=local_identity.production_metric_resource_daily.memory_total_sum+excluded.memory_total_sum,memory_used_peak=greatest(local_identity.production_metric_resource_daily.memory_used_peak,excluded.memory_used_peak),queue_peak=greatest(local_identity.production_metric_resource_daily.queue_peak,excluded.queue_peak),running_peak=greatest(local_identity.production_metric_resource_daily.running_peak,excluded.running_peak),resource_wait_peak=greatest(local_identity.production_metric_resource_daily.resource_wait_peak,excluded.resource_wait_peak),gap_seconds=local_identity.production_metric_resource_daily.gap_seconds+excluded.gap_seconds;
 END IF;
 RETURN inserted=1;
END $$;
CREATE FUNCTION local_identity.prune_production_metrics() RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=local_identity.owner_id(); events integer; resources integer; daily integer; cycles integer; quality integer; tasks integer; deliveries integer; coverage integer; resource_daily integer;
BEGIN
 IF o IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 DELETE FROM local_identity.production_metric_events WHERE owner_id=o AND occurred_at<clock_timestamp()-interval '12 months';GET DIAGNOSTICS events=ROW_COUNT;
 DELETE FROM local_identity.production_metric_resources WHERE owner_id=o AND sampled_at<clock_timestamp()-interval '30 days';GET DIAGNOSTICS resources=ROW_COUNT;
 DELETE FROM local_identity.production_metric_daily WHERE owner_id=o AND day<(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-interval '24 months';GET DIAGNOSTICS daily=ROW_COUNT;
 DELETE FROM local_identity.production_metric_resource_daily WHERE owner_id=o AND day<(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-interval '24 months';GET DIAGNOSTICS resource_daily=ROW_COUNT;
 DELETE FROM local_identity.production_metric_queue_cycles WHERE owner_id=o AND coalesce(claimed_at,enqueued_at)<clock_timestamp()-interval '12 months' AND EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=task_id AND t.status NOT IN ('ready','running'));GET DIAGNOSTICS cycles=ROW_COUNT;
 DELETE FROM local_identity.production_metric_quality_versions v WHERE owner_id=o AND created_at<clock_timestamp()-interval '12 months' AND EXISTS(SELECT 1 FROM local_identity.production_metric_quality_versions newer WHERE newer.owner_id=v.owner_id AND newer.episode_id=v.episode_id AND newer.revision>v.revision);GET DIAGNOSTICS quality=ROW_COUNT;
 DELETE FROM local_identity.production_metric_task_quality q WHERE owner_id=o AND frozen_at<clock_timestamp()-interval '12 months' AND EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=q.task_id AND t.status NOT IN ('ready','running'));GET DIAGNOSTICS tasks=ROW_COUNT;
 DELETE FROM local_identity.production_metric_delivery_quality WHERE owner_id=o AND frozen_at<clock_timestamp()-interval '12 months';GET DIAGNOSTICS deliveries=ROW_COUNT;
 DELETE FROM local_identity.production_metric_coverage_periods WHERE owner_id=o AND ended_at<clock_timestamp()-interval '24 months';GET DIAGNOSTICS coverage=ROW_COUNT;
 RETURN jsonb_build_object('events',events,'resources',resources,'daily',daily,'resourceDaily',resource_daily,'queueCycles',cycles,'obsoleteQualityVersions',quality,'finishedTaskSnapshots',tasks,'deliverySnapshots',deliveries,'coveragePeriods',coverage);
END $$;

-- FK cascades remove all attributable statistics on permanent episode deletion.
-- Anonymous daily increments are intentionally independent and remain retained.
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['production_metric_controls','production_metric_coverage_periods','production_metric_events','production_metric_daily','production_metric_quality_versions','production_metric_task_quality','production_metric_delivery_quality','production_metric_queue_cycles','production_metric_resources','production_metric_resource_daily'] LOOP
  EXECUTE format('ALTER TABLE local_identity.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY production_metric_owner_read ON local_identity.%I FOR SELECT TO loop_app USING(owner_id=local_identity.owner_id())',t);
  EXECUTE format('REVOKE ALL ON local_identity.%I FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous',t);
  EXECUTE format('GRANT SELECT ON local_identity.%I TO loop_app',t);
 END LOOP;
END $$;
REVOKE ALL ON SEQUENCE local_identity.production_metric_events_id_seq FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.append_production_metric(uuid,uuid,text,text,jsonb,timestamptz,text),local_identity.validate_production_metric_payload(jsonb),local_identity.capture_production_metric_episode(),local_identity.capture_production_metric_task(),local_identity.capture_production_metric_run(),local_identity.capture_production_metric_reservation(),local_identity.capture_production_metric_dispatch(),local_identity.capture_production_metric_delivery() FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.validate_production_metric_scope(uuid,jsonb),local_identity.capture_production_metric_estimate() FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.capture_production_metric_transition() FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.capture_production_metric_video_registration() FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
REVOKE ALL ON FUNCTION local_identity.production_metrics_enabled(),local_identity.episode_business_quality(uuid),local_identity.set_episode_business_quality(uuid,text,integer),local_identity.set_production_metrics_enabled(boolean),local_identity.record_owned_production_metric(uuid,text,text,jsonb),local_identity.production_metrics_activity(),local_identity.record_production_metric_resource(jsonb),local_identity.prune_production_metrics(),local_identity.record_worker_production_metric(uuid,integer,uuid,text,text,jsonb) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT EXECUTE ON FUNCTION local_identity.production_metrics_enabled(),local_identity.episode_business_quality(uuid),local_identity.set_episode_business_quality(uuid,text,integer),local_identity.set_production_metrics_enabled(boolean),local_identity.record_owned_production_metric(uuid,text,text,jsonb),local_identity.production_metrics_activity(),local_identity.record_production_metric_resource(jsonb),local_identity.prune_production_metrics() TO loop_app;
GRANT EXECUTE ON FUNCTION local_identity.record_worker_production_metric(uuid,integer,uuid,text,text,jsonb) TO loop_worker;
