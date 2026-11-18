-- Retire Owner-assigned business quality. Keep production observations and money.
-- Applied baselines remain immutable. Rehearse and back up before this contract step.
LOCK TABLE local_identity.production_metric_events,local_identity.production_metric_daily IN ACCESS EXCLUSIVE MODE;

DROP FUNCTION local_identity.set_episode_business_quality(uuid,text,integer);
DROP FUNCTION local_identity.episode_business_quality(uuid);
DROP FUNCTION local_identity.append_production_metric(uuid,uuid,text,text,jsonb,timestamptz,text);

-- Group without the retired dimension before dropping its primary-key column.
CREATE TEMP TABLE production_metric_daily_merged ON COMMIT DROP AS
 SELECT owner_id,day,event_type,currency,is_test,sum(count)::bigint count,sum(amount_cents)::bigint amount_cents
 FROM local_identity.production_metric_daily WHERE event_type<>'quality_changed'
 GROUP BY owner_id,day,event_type,currency,is_test;
DELETE FROM local_identity.production_metric_daily;
ALTER TABLE local_identity.production_metric_daily DROP CONSTRAINT production_metric_daily_pkey;
ALTER TABLE local_identity.production_metric_daily DROP COLUMN quality_tier;
ALTER TABLE local_identity.production_metric_daily ADD PRIMARY KEY(owner_id,day,event_type,currency,is_test);
INSERT INTO local_identity.production_metric_daily SELECT * FROM production_metric_daily_merged;
DELETE FROM local_identity.production_metric_events WHERE event_type='quality_changed';
UPDATE local_identity.production_metric_events SET payload=payload-'quality_snapshot_known' WHERE payload ? 'quality_snapshot_known';
ALTER TABLE local_identity.production_metric_events DROP COLUMN quality_tier;

CREATE FUNCTION local_identity.append_production_metric(p_owner uuid,p_episode uuid,p_type text,p_key text,p_payload jsonb,p_at timestamptz DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_payload jsonb; inserted_id bigint; amount bigint:=0; fact_currency text:='none'; test_episode boolean; activated timestamptz;
BEGIN
 SELECT updated_at INTO activated FROM local_identity.production_metric_controls WHERE owner_id=p_owner AND enabled;
 IF activated IS NULL OR p_at<activated THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=p_episode AND m.user_id=p_owner AND m.role='owner') THEN RAISE EXCEPTION 'Owned metric episode required' USING ERRCODE='42501';END IF;
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9:_.-]{1,200}$' OR p_type IS NULL OR p_type !~ '^[a-z_]{1,64}$' OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>8192 THEN RAISE EXCEPTION 'Invalid metric fact';END IF;
 INSERT INTO local_identity.production_metric_events(owner_id,episode_id,event_type,source_key,payload,occurred_at)
 VALUES(p_owner,p_episode,p_type,p_key,p_payload,coalesce(p_at,clock_timestamp()))
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
 INSERT INTO local_identity.production_metric_daily(owner_id,day,event_type,currency,is_test,count,amount_cents)
 VALUES(p_owner,(coalesce(p_at,clock_timestamp()) AT TIME ZONE 'Asia/Shanghai')::date,p_type,fact_currency,test_episode,1,amount)
 ON CONFLICT(owner_id,day,event_type,currency,is_test) DO UPDATE SET count=local_identity.production_metric_daily.count+1,amount_cents=local_identity.production_metric_daily.amount_cents+excluded.amount_cents;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION local_identity.capture_production_metric_task() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid; queued timestamptz:=clock_timestamp(); a integer; cycle local_identity.production_metric_queue_cycles;
BEGIN
 FOR o IN SELECT m.user_id FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE e.id=NEW.episode_id AND m.role='owner' LOOP
  IF TG_OP='INSERT' AND NEW.created_at<(SELECT updated_at FROM local_identity.production_metric_controls WHERE owner_id=o) THEN CONTINUE;END IF;
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

CREATE OR REPLACE FUNCTION local_identity.capture_production_metric_run() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; o uuid; t public.tasks;
BEGIN
 SELECT * INTO t FROM public.tasks WHERE id=NEW.task_id;e:=t.episode_id;
 FOR o IN SELECT m.user_id FROM public.episodes ep JOIN public.account_memberships m ON m.account_id=ep.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE ep.id=e AND m.role='owner' LOOP
  IF TG_OP='INSERT' THEN
   PERFORM local_identity.append_production_metric(o,e,'attempt_started','run:'||NEW.id,jsonb_build_object('run_id',NEW.id,'task_id',NEW.task_id,'attempt',NEW.attempt,'provider',t.provider,'model',t.model,'task_type',t.task_type),NEW.started_at);
  END IF;
  IF NEW.completed_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.completed_at IS NULL) THEN
   PERFORM local_identity.append_production_metric(o,e,'attempt_finished','run:'||NEW.id,jsonb_build_object('run_id',NEW.id,'task_id',NEW.task_id,'attempt',NEW.attempt,'status',NEW.status,'reported_cents',NEW.actual_cost_cents,'started_at',NEW.started_at,'completed_at',NEW.completed_at),NEW.completed_at);
  END IF;
 END LOOP;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION local_identity.capture_production_metric_delivery() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid; d record; t public.tasks;
BEGIN
 -- Delivery rows may precede task completion. Count a completed delivery only
 -- once the authoritative task completes; insertion records confirmation only.
 IF TG_TABLE_NAME='workspace_deliveries' THEN
  FOR o IN SELECT m.user_id FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled AND c.updated_at<=NEW.created_at WHERE e.id=NEW.episode_id AND m.role='owner' LOOP
   PERFORM local_identity.append_production_metric(o,NEW.episode_id,'delivery_confirmed','delivery:'||NEW.id,jsonb_build_object('delivery_id',NEW.id,'task_id',NEW.task_id),NULL);
  END LOOP;
  SELECT * INTO t FROM public.tasks WHERE id=NEW.task_id;
 ELSE t:=NEW;END IF;
 IF t.status='completed' AND t.task_type='prepare_publish_package' AND t.completed_at IS NOT NULL THEN
  FOR d IN SELECT w.*,m.user_id owner_id FROM local_identity.workspace_deliveries w JOIN public.episodes e ON e.id=w.episode_id JOIN public.account_memberships m ON m.account_id=e.account_id AND m.role='owner' JOIN local_identity.production_metric_controls c ON c.owner_id=m.user_id AND c.enabled WHERE w.task_id=t.id LOOP
   PERFORM local_identity.append_production_metric(d.owner_id,d.episode_id,'delivery_completed','delivery:'||d.id,jsonb_build_object('delivery_id',d.id,'task_id',t.id),t.completed_at);
  END LOOP;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION local_identity.prune_production_metrics() RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=local_identity.owner_id(); events integer; resources integer; daily integer; cycles integer; coverage integer; resource_daily integer;
BEGIN
 IF o IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 DELETE FROM local_identity.production_metric_events WHERE owner_id=o AND occurred_at<clock_timestamp()-interval '12 months';GET DIAGNOSTICS events=ROW_COUNT;
 DELETE FROM local_identity.production_metric_resources WHERE owner_id=o AND sampled_at<clock_timestamp()-interval '30 days';GET DIAGNOSTICS resources=ROW_COUNT;
 DELETE FROM local_identity.production_metric_daily WHERE owner_id=o AND day<(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-interval '24 months';GET DIAGNOSTICS daily=ROW_COUNT;
 DELETE FROM local_identity.production_metric_resource_daily WHERE owner_id=o AND day<(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-interval '24 months';GET DIAGNOSTICS resource_daily=ROW_COUNT;
 DELETE FROM local_identity.production_metric_queue_cycles WHERE owner_id=o AND coalesce(claimed_at,enqueued_at)<clock_timestamp()-interval '12 months' AND EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=task_id AND t.status NOT IN ('ready','running'));GET DIAGNOSTICS cycles=ROW_COUNT;
 DELETE FROM local_identity.production_metric_coverage_periods WHERE owner_id=o AND ended_at<clock_timestamp()-interval '24 months';GET DIAGNOSTICS coverage=ROW_COUNT;
 RETURN jsonb_build_object('events',events,'resources',resources,'daily',daily,'resourceDaily',resource_daily,'queueCycles',cycles,'coveragePeriods',coverage);
END $$;

DROP TABLE local_identity.production_metric_task_quality;
DROP TABLE local_identity.production_metric_delivery_quality;
DROP TABLE local_identity.production_metric_quality_versions;
REVOKE ALL ON FUNCTION local_identity.append_production_metric(uuid,uuid,text,text,jsonb,timestamptz) FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
