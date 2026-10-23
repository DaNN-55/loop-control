create function public.read_episode_production(p_episode_id uuid,p_known jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare e public.episodes; payload jsonb; changes jsonb:='{}'; hashes jsonb:='{}'; patches jsonb:='{}'; section record; item jsonb; changed jsonb; ids jsonb; digest text; key text;
begin
 select * into e from public.episodes where id=p_episode_id;
 if not found or not exists(select 1 from public.account_memberships where account_id=e.account_id and user_id=(select auth.uid()) and role='owner') then return null; end if;
 payload:=jsonb_build_object(
  'episode',to_jsonb(e),
  'blueprint',(select to_jsonb(b) from public.account_blueprint_versions b where b.id=e.blueprint_version_id),
  'seriesVersion',(select to_jsonb(s) from public.series_versions s where s.id=e.series_version_id),
  'connectionVersions',coalesce((select jsonb_agg(to_jsonb(v) order by v.connection_id,v.version desc) from public.list_external_connection_versions(null) v),'[]'::jsonb),
  'materialRevisions',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.production_material_revisions r where episode_id=p_episode_id),'[]'::jsonb),
  'shotPreparationDrafts',coalesce((select jsonb_agg(to_jsonb(r) order by updated_at desc,id) from public.shot_preparation_drafts r where episode_id=p_episode_id),'[]'::jsonb),
  'storyboardAudioSelections',coalesce((select jsonb_agg(to_jsonb(r) order by updated_at desc,id) from public.storyboard_audio_selections r where episode_id=p_episode_id),'[]'::jsonb),
  'reviewPackages',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.review_packages r where episode_id=p_episode_id),'[]'::jsonb),
  'artifacts',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.artifacts r where episode_id=p_episode_id),'[]'::jsonb),
  'audioTracks',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.audio_tracks r where episode_id=p_episode_id),'[]'::jsonb),
  'tasks',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.tasks r where episode_id=p_episode_id),'[]'::jsonb),
  'transitions',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from public.state_transitions r where episode_id=p_episode_id),'[]'::jsonb),
  'reviewAnnotations',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.review_annotations r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb),
  'qcReviewIssues',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.qc_review_issues r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb),
  'preRenderReviewMembers',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.pre_render_review_members r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb),
  'preRenderReviewMemberDecisions',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,review_package_id,member_key) from public.pre_render_review_member_decisions r where review_package_id in (select id from public.review_packages where episode_id=p_episode_id)),'[]'::jsonb),
  'audioTrackAnnotations',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.audio_track_annotations r where audio_track_id in (select id from public.audio_tracks where episode_id=p_episode_id)),'[]'::jsonb),
  'taskRuns',coalesce((select jsonb_agg(to_jsonb(r) order by started_at desc,id) from (select id,task_id,status,attempt,started_at,completed_at from public.task_runs where task_id in (select id from public.tasks where episode_id=p_episode_id)) r),'[]'::jsonb));
 for section in select * from jsonb_each(payload) loop
  if section.key in ('tasks','taskRuns') then
   changed:='[]';ids:='[]';
   for item in select * from jsonb_array_elements(section.value) loop
    key:=section.key||'/'||(item->>'id');digest:=md5(item::text);hashes:=hashes||jsonb_build_object(key,digest);ids:=ids||jsonb_build_array(item->>'id');
    if p_known->>key is distinct from digest then changed:=changed||jsonb_build_array(item);end if;
   end loop;
   patches:=patches||jsonb_build_object(section.key,jsonb_build_object('rows',changed,'ids',ids));
  else
   digest:=md5(section.value::text);hashes:=hashes||jsonb_build_object(section.key,digest);
   if p_known->>section.key is distinct from digest then changes:=changes||jsonb_build_object(section.key,section.value);end if;
  end if;
 end loop;
 return jsonb_build_object('hashes',hashes,'sections',changes,'patches',patches);
end $$;
revoke all on function public.read_episode_production(uuid,jsonb) from public,anon;
grant execute on function public.read_episode_production(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
