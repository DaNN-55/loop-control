-- Revision metadata changes in the same transaction as the business row.
create table public.episode_read_revisions (
 episode_id uuid not null references public.episodes(id) on delete cascade,
 section text not null, item_id text not null default '', revision bigint not null default 1,
 primary key(episode_id,section,item_id)
);
alter table public.episode_read_revisions enable row level security;
create policy episode_read_revision_owner on public.episode_read_revisions for select to authenticated using (
 exists(select 1 from public.episodes e join public.account_memberships m on m.account_id=e.account_id where e.id=episode_id and m.user_id=(select auth.uid()) and m.role='owner')
);
revoke all on public.episode_read_revisions from anon,authenticated;
grant select on public.episode_read_revisions to authenticated;
grant all on public.episode_read_revisions to service_role;
create function loop_internal.bump_episode_read_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare source jsonb; eid uuid; seen text[]:='{}'; sources jsonb[]; item text; identity text;
begin
 if TG_OP='INSERT' then sources:=array[to_jsonb(NEW)];
 elsif TG_OP='DELETE' then sources:=array[to_jsonb(OLD)];
 else sources:=array[to_jsonb(OLD),to_jsonb(NEW)]; end if;
 foreach source in array sources loop
  eid:=null;
  case TG_ARGV[1]
   when 'direct' then eid:=(source->>'episode_id')::uuid;
   when 'review' then select episode_id into eid from public.review_packages where id=(source->>'review_package_id')::uuid;
   when 'audio' then select episode_id into eid from public.audio_tracks where id=(source->>'audio_track_id')::uuid;
   when 'task' then select episode_id into eid from public.tasks where id=(source->>'task_id')::uuid;
  end case;
  item:=coalesce(source->>'id',(source->>'review_package_id')||'/'||(source->>'member_key'));
  identity:=eid::text||'/'||item;
  if eid is null or identity=any(seen) or not exists(select 1 from public.episodes where id=eid) then continue;end if;
  seen:=array_append(seen,identity);
  -- Each business row has its own counter; tombstones survive deletion.
  -- No shared episode/section write lock that could invert Worker lock order.
  insert into public.episode_read_revisions(episode_id,section,item_id) values(eid,TG_ARGV[0],item)
   on conflict(episode_id,section,item_id) do update set revision=public.episode_read_revisions.revision+1;
 end loop;
 return null;
end $$;
revoke all on function loop_internal.bump_episode_read_revision() from public,anon,authenticated;
create trigger episode_read_revision after insert or update or delete on public.production_material_revisions for each row execute function loop_internal.bump_episode_read_revision('materialRevisions','direct');
create trigger episode_read_revision after insert or update or delete on public.shot_preparation_drafts for each row execute function loop_internal.bump_episode_read_revision('shotPreparationDrafts','direct');
create trigger episode_read_revision after insert or update or delete on public.storyboard_audio_selections for each row execute function loop_internal.bump_episode_read_revision('storyboardAudioSelections','direct');
create trigger episode_read_revision after insert or update or delete on public.review_packages for each row execute function loop_internal.bump_episode_read_revision('reviewPackages','direct');
create trigger episode_read_revision after insert or update or delete on public.artifacts for each row execute function loop_internal.bump_episode_read_revision('artifacts','direct');
create trigger episode_read_revision after insert or update or delete on public.audio_tracks for each row execute function loop_internal.bump_episode_read_revision('audioTracks','direct');
create trigger episode_read_revision after insert or update or delete on public.tasks for each row execute function loop_internal.bump_episode_read_revision('tasks','direct');
create trigger episode_read_revision after insert or update or delete on public.state_transitions for each row execute function loop_internal.bump_episode_read_revision('transitions','direct');
create trigger episode_read_revision after insert or update or delete on public.review_annotations for each row execute function loop_internal.bump_episode_read_revision('reviewAnnotations','review');
create trigger episode_read_revision after insert or update or delete on public.qc_review_issues for each row execute function loop_internal.bump_episode_read_revision('qcReviewIssues','review');
create trigger episode_read_revision after insert or update or delete on public.pre_render_review_members for each row execute function loop_internal.bump_episode_read_revision('preRenderReviewMembers','review');
create trigger episode_read_revision after insert or update or delete on public.pre_render_review_member_decisions for each row execute function loop_internal.bump_episode_read_revision('preRenderReviewMemberDecisions','review');
create trigger episode_read_revision after insert or update or delete on public.audio_track_annotations for each row execute function loop_internal.bump_episode_read_revision('audioTrackAnnotations','audio');
create trigger episode_read_revision after insert or update or delete on public.task_runs for each row execute function loop_internal.bump_episode_read_revision('taskRuns','task');

create or replace function public.read_episode_production(p_episode_id uuid,p_known jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare e public.episodes; payload jsonb; changes jsonb:='{}'; hashes jsonb:='{}'; patches jsonb:='{}';
 section record; digest text; versions jsonb; item_versions jsonb; token text; rows_changed jsonb; ids jsonb; row_hashes jsonb; changed_ids uuid[];
begin
 select * into e from public.episodes where id=p_episode_id;
 if not found or not exists(select 1 from public.account_memberships where account_id=e.account_id and user_id=(select auth.uid()) and role='owner') then return null; end if;
 select coalesce(jsonb_object_agg(v.section,v.token),'{}') into versions from (select m.section,sum(m.revision)::text as token from public.episode_read_revisions m where m.episode_id=p_episode_id and m.item_id<>'' group by m.section) v;
 select coalesce(jsonb_object_agg(m.section||'/'||m.item_id,m.revision::text),'{}') into item_versions from public.episode_read_revisions m where m.episode_id=p_episode_id and m.section in ('tasks','taskRuns') and m.item_id<>'';
 payload:=jsonb_build_object(
  'episode',to_jsonb(e),
  'blueprint',(select to_jsonb(b) from public.account_blueprint_versions b where b.id=e.blueprint_version_id),
  'seriesVersion',(select to_jsonb(s) from public.series_versions s where s.id=e.series_version_id),
  'connectionVersions',coalesce((select jsonb_agg(to_jsonb(v) order by v.connection_id,v.version desc) from public.list_external_connection_versions(null) v),'[]'::jsonb));
 for section in select * from jsonb_each(payload) loop
  digest:=md5(section.value::text);hashes:=hashes||jsonb_build_object(section.key,digest);
  if p_known->>section.key is distinct from digest then changes:=changes||jsonb_build_object(section.key,section.value);end if;
 end loop;
 token:='v:'||coalesce(versions->>'materialRevisions','0');hashes:=hashes||jsonb_build_object('materialRevisions',token);
 if p_known->>'materialRevisions' is distinct from token then
  changes:=changes||jsonb_build_object('materialRevisions',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.production_material_revisions r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'shotPreparationDrafts','0');hashes:=hashes||jsonb_build_object('shotPreparationDrafts',token);
 if p_known->>'shotPreparationDrafts' is distinct from token then
  changes:=changes||jsonb_build_object('shotPreparationDrafts',coalesce((select jsonb_agg(to_jsonb(r) order by updated_at desc,id) from public.shot_preparation_drafts r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'storyboardAudioSelections','0');hashes:=hashes||jsonb_build_object('storyboardAudioSelections',token);
 if p_known->>'storyboardAudioSelections' is distinct from token then
  changes:=changes||jsonb_build_object('storyboardAudioSelections',coalesce((select jsonb_agg(to_jsonb(r) order by updated_at desc,id) from public.storyboard_audio_selections r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'reviewPackages','0');hashes:=hashes||jsonb_build_object('reviewPackages',token);
 if p_known->>'reviewPackages' is distinct from token then
  changes:=changes||jsonb_build_object('reviewPackages',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.review_packages r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'artifacts','0');hashes:=hashes||jsonb_build_object('artifacts',token);
 if p_known->>'artifacts' is distinct from token then
  changes:=changes||jsonb_build_object('artifacts',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.artifacts r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'audioTracks','0');hashes:=hashes||jsonb_build_object('audioTracks',token);
 if p_known->>'audioTracks' is distinct from token then
  changes:=changes||jsonb_build_object('audioTracks',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.audio_tracks r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'tasks','0');hashes:=hashes||jsonb_build_object('tasks',token);
 if p_known->>'tasks' is distinct from token then
  select coalesce(jsonb_agg(r.id order by r.created_at desc,r.id),'[]'),coalesce(jsonb_object_agg('tasks/'||r.id,'v:'||coalesce(item_versions->>('tasks/'||r.id),'0')),'{}'),array_agg(r.id) filter(where p_known->>('tasks/'||r.id) is distinct from 'v:'||coalesce(item_versions->>('tasks/'||r.id),'0')) into ids,row_hashes,changed_ids
   from public.tasks r where r.episode_id=p_episode_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id),'[]') into rows_changed
   from public.tasks r where r.id=any(changed_ids);
  hashes:=hashes||row_hashes;
  patches:=patches||jsonb_build_object('tasks',jsonb_build_object('ids',ids,'rows',rows_changed));
 else
  select coalesce(jsonb_object_agg(key,value),'{}') into row_hashes from jsonb_each(p_known) where key like 'tasks/%';hashes:=hashes||row_hashes;
 end if;
 token:='v:'||coalesce(versions->>'transitions','0');hashes:=hashes||jsonb_build_object('transitions',token);
 if p_known->>'transitions' is distinct from token then
  changes:=changes||jsonb_build_object('transitions',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.state_transitions r where episode_id=p_episode_id),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'reviewAnnotations','0')||':'||coalesce(versions->>'reviewPackages','0');hashes:=hashes||jsonb_build_object('reviewAnnotations',token);
 if p_known->>'reviewAnnotations' is distinct from token then
  changes:=changes||jsonb_build_object('reviewAnnotations',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.review_annotations r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'qcReviewIssues','0')||':'||coalesce(versions->>'reviewPackages','0');hashes:=hashes||jsonb_build_object('qcReviewIssues',token);
 if p_known->>'qcReviewIssues' is distinct from token then
  changes:=changes||jsonb_build_object('qcReviewIssues',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.qc_review_issues r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'preRenderReviewMembers','0')||':'||coalesce(versions->>'reviewPackages','0');hashes:=hashes||jsonb_build_object('preRenderReviewMembers',token);
 if p_known->>'preRenderReviewMembers' is distinct from token then
  changes:=changes||jsonb_build_object('preRenderReviewMembers',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.pre_render_review_members r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'preRenderReviewMemberDecisions','0')||':'||coalesce(versions->>'reviewPackages','0');hashes:=hashes||jsonb_build_object('preRenderReviewMemberDecisions',token);
 if p_known->>'preRenderReviewMemberDecisions' is distinct from token then
  changes:=changes||jsonb_build_object('preRenderReviewMemberDecisions',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,review_package_id,member_key) from public.pre_render_review_member_decisions r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'audioTrackAnnotations','0')||':'||coalesce(versions->>'audioTracks','0');hashes:=hashes||jsonb_build_object('audioTrackAnnotations',token);
 if p_known->>'audioTrackAnnotations' is distinct from token then
  changes:=changes||jsonb_build_object('audioTrackAnnotations',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.audio_track_annotations r where audio_track_id in (select id from public.audio_tracks where episode_id=p_episode_id)),'[]'::jsonb));
 end if;
 token:='v:'||coalesce(versions->>'taskRuns','0')||':'||coalesce(versions->>'tasks','0');hashes:=hashes||jsonb_build_object('taskRuns',token);
 if p_known->>'taskRuns' is distinct from token then
  select coalesce(jsonb_agg(r.id order by r.started_at desc,r.id),'[]'),coalesce(jsonb_object_agg('taskRuns/'||r.id,'v:'||coalesce(item_versions->>('taskRuns/'||r.id),'0')),'{}'),array_agg(r.id) filter(where p_known->>('taskRuns/'||r.id) is distinct from 'v:'||coalesce(item_versions->>('taskRuns/'||r.id),'0')) into ids,row_hashes,changed_ids
   from public.task_runs r where r.task_id in (select id from public.tasks where episode_id=p_episode_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'task_id',r.task_id,'status',r.status,'attempt',r.attempt,'started_at',r.started_at,'completed_at',r.completed_at) order by r.started_at desc,r.id),'[]') into rows_changed
   from public.task_runs r where r.id=any(changed_ids);
  hashes:=hashes||row_hashes;
  patches:=patches||jsonb_build_object('taskRuns',jsonb_build_object('ids',ids,'rows',rows_changed));
 else
  select coalesce(jsonb_object_agg(key,value),'{}') into row_hashes from jsonb_each(p_known) where key like 'taskRuns/%';hashes:=hashes||row_hashes;
 end if;
 return jsonb_build_object('hashes',hashes,'sections',changes,'patches',patches);
end $$;
notify pgrst,'reload schema';
