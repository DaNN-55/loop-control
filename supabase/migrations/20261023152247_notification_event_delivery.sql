-- Internal delivery ledger. No browser or anonymous access; no secrets or second HTTP API.
create schema if not exists loop_internal;
revoke all on schema loop_internal from public, anon, authenticated;
create table public.notification_delivery_state (
  singleton boolean primary key default true check(singleton),
  initialized boolean not null default false
);
insert into public.notification_delivery_state default values;
create table public.notification_delivery_events (
  event_id uuid primary key references public.audit_events(id) on delete cascade,
  outcome text not null default 'pending' check(outcome in ('pending','historical','reserved','accepted','skipped','uncertain')),
  delivery_token uuid,
  reserved_at timestamptz,
  completed_at timestamptz,
  check ((outcome in ('reserved','accepted','skipped','uncertain')) = (delivery_token is not null))
);
create index notification_delivery_pending on public.notification_delivery_events(event_id) where outcome='pending';
alter table public.notification_delivery_state enable row level security;
alter table public.notification_delivery_events enable row level security;
revoke all on public.notification_delivery_state, public.notification_delivery_events from public, anon, authenticated;
grant select,insert,update,delete on public.notification_delivery_state, public.notification_delivery_events to service_role;
create function loop_internal.enqueue_notification_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.event_type in ('stage_transition','pre_render_review_package_created','a_roll_task_blocked','b_roll_task_blocked','narration_task_blocked','soundtrack_task_blocked') then
  insert into public.notification_delivery_events(event_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function loop_internal.enqueue_notification_event() from public, anon, authenticated;
-- CREATE TRIGGER takes the audit table lock before backfill, so old transactions
-- cannot commit between the backfill snapshot and trigger installation.
create trigger notification_event_enqueued after insert on public.audit_events for each row execute function loop_internal.enqueue_notification_event();
insert into public.notification_delivery_events(event_id)
select id from public.audit_events where event_type in ('stage_transition','pre_render_review_package_created','a_roll_task_blocked','b_roll_task_blocked','narration_task_blocked','soundtrack_task_blocked') on conflict do nothing;
create function public.initialize_notification_delivery(p_after_time timestamptz default null,p_after_id uuid default null) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.notification_delivery_state where singleton for update;
 if (select initialized from public.notification_delivery_state where singleton) then return false; end if;
 if (p_after_time is null) <> (p_after_id is null) then raise exception 'Both legacy cursor fields are required'; end if;
 update public.notification_delivery_events d set outcome='historical'
 from public.audit_events a where a.id=d.event_id and d.outcome='pending'
 and (p_after_time is null or (a.created_at,a.id)<=(p_after_time,p_after_id));
 update public.notification_delivery_state set initialized=true where singleton;
 return true;
end $$;
create function public.claim_notification_event() returns table(id uuid,created_at timestamptz,event_type text,payload jsonb,delivery_token uuid) language plpgsql security invoker set search_path='' as $$
begin
 if not (select initialized from public.notification_delivery_state where singleton) then raise exception 'Notification delivery is not initialized'; end if;
 return query with candidate as (
  select d.event_id from public.notification_delivery_events d where d.outcome='pending' order by d.event_id for update skip locked limit 1
 ), reserved as (
  update public.notification_delivery_events d set outcome='reserved',delivery_token=gen_random_uuid(),reserved_at=clock_timestamp()
  from candidate c where d.event_id=c.event_id returning d.event_id,d.delivery_token
 ) select a.id,a.created_at,a.event_type,a.payload,r.delivery_token from reserved r join public.audit_events a on a.id=r.event_id;
end $$;
create function public.finish_notification_delivery(p_event_id uuid,p_delivery_token uuid,p_outcome text) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_outcome not in ('accepted','skipped','uncertain') then raise exception 'Invalid delivery outcome'; end if;
 update public.notification_delivery_events set outcome=p_outcome,completed_at=clock_timestamp()
 where event_id=p_event_id and delivery_token=p_delivery_token and outcome='reserved';
 return found;
end $$;
revoke all on function public.initialize_notification_delivery(timestamptz,uuid), public.claim_notification_event(), public.finish_notification_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.initialize_notification_delivery(timestamptz,uuid), public.claim_notification_event(), public.finish_notification_delivery(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
