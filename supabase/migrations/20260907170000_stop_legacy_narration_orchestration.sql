create or replace function public.orchestrate_narration_tasks(p_episode_id uuid default null)
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

create or replace function public.invalidate_superseded_storyboard_narration_tasks_after_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage <> 'storyboard_approved' or new.decision <> 'approved' or new.review_package_id is null then
    return new;
  end if;

  update public.tasks task
  set status = 'superseded',
      invalidated_at = now(),
      invalidated_reason = 'Superseded by a newer approved storyboard package.'
  where task.episode_id = new.episode_id
    and task.task_type = 'generate_narration'
    and task.status in ('blocked', 'failed')
    and task.invalidated_at is null
    and task.input_snapshot ->> 'storyboard_review_package_id' is not null
    and task.input_snapshot ->> 'storyboard_review_package_id' <> new.review_package_id::text;

  return new;
end;
$$;

drop trigger if exists zzz_invalidate_superseded_storyboard_narration_tasks on public.approvals;
create trigger zzz_invalidate_superseded_storyboard_narration_tasks
after insert on public.approvals
for each row execute function public.invalidate_superseded_storyboard_narration_tasks_after_approval();

update public.tasks task
set status = 'superseded',
    invalidated_at = now(),
    invalidated_reason = case
      when task.input_snapshot ->> 'storyboard_review_package_id' <> '643dcad2-adb9-4263-9642-fcdbdd4f0e42'
        then 'Superseded by a newer approved storyboard package.'
      else 'Legacy automatic narration is superseded by explicit shot TTS.'
    end
where task.episode_id = '92b3067d-ced9-4e85-bc44-1968fa83695a'
  and task.task_type = 'generate_narration'
  and task.status in ('blocked', 'failed')
  and task.invalidated_at is null
  and (
    task.input_snapshot ->> 'storyboard_review_package_id' <> '643dcad2-adb9-4263-9642-fcdbdd4f0e42'
    or (
      task.input_snapshot ->> 'storyboard_review_package_id' = '643dcad2-adb9-4263-9642-fcdbdd4f0e42'
      and task.input_snapshot #>> '{shot_preparation,draft_id}' is null
      and task.last_result -> 'blockers' @> '[{"code":"narration_voice_invalid"}]'::jsonb
    )
  );

revoke all on function public.orchestrate_narration_tasks(uuid) from public, anon, authenticated;
grant execute on function public.orchestrate_narration_tasks(uuid) to service_role;
revoke all on function public.invalidate_superseded_storyboard_narration_tasks_after_approval() from public, anon, authenticated;
