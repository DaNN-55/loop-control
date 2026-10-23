-- Trusted Worker only; browser cannot nominate an arbitrary reusable artifact.
create function public.final_render_reuse_source(p_task_id uuid,p_attempt integer,p_lease_token uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('reviewPackageId',p.id,'inputsMatch',source.input_snapshot->'review_render'=t.input_snapshot#>'{final_render,review_render}','video',case when v.id is null then null else jsonb_build_object('artifactType',v.artifact_type,'relativePath',v.relative_path,'sha256',v.sha256,'fileSize',v.file_size) end)
 from public.tasks t
 join public.episodes e on e.id=t.episode_id and e.stage='qc_passed'
 join public.review_packages p on p.id=(t.input_snapshot#>>'{final_render,source_review_package_id}')::uuid and p.episode_id=e.id and p.stage='qc_review' and p.invalidated_at is null
 join public.tasks source on source.id=p.task_id and source.episode_id=e.id and source.status='completed' and source.provider='openchatcut' and source.task_type='generate_review_render'
 left join lateral(select a.* from public.artifacts a where a.id=p.artifact_id and a.episode_id=e.id and a.producer_task_id=source.id and a.artifact_type in ('render','review_render_video') order by a.created_at desc,a.id limit 1)v on true
 where t.id=p_task_id and t.task_type='generate_final_render' and t.status='running' and t.attempt=p_attempt+1 and p_lease_token is not null and t.lease_token=p_lease_token and exists(select 1 from public.task_runs r where r.task_id=t.id and r.attempt=p_attempt and r.lease_token=p_lease_token and r.status='running') and t.claimed_at>now()-interval '30 minutes'

 and exists(select 1 from public.approvals a join public.account_memberships m on m.account_id=e.account_id and m.user_id=a.actor_id and m.role='owner' where a.review_package_id=p.id and a.episode_id=e.id and a.stage='qc_passed' and a.decision='approved');
$$;
revoke all on function public.final_render_reuse_source(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.final_render_reuse_source(uuid,integer,uuid) to service_role;
notify pgrst,'reload schema';
