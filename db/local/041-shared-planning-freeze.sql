-- Register the existing shared-Harness freeze on future task INSERTs only.
-- Its name runs before 040's zz_namespace_native_task_output trigger.
-- Never rewrite a previously frozen task, run, budget, or failure record.
DO $migration$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tasks'::regclass AND tgname='freeze_shared_planning_harness_before_insert' AND NOT tgisinternal) THEN
  CREATE TRIGGER freeze_shared_planning_harness_before_insert
  BEFORE INSERT ON public.tasks FOR EACH ROW
  EXECUTE FUNCTION public.freeze_shared_planning_harness();
 ELSIF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tasks'::regclass AND tgname='freeze_shared_planning_harness_before_insert' AND NOT tgisinternal
  AND tgfoid='public.freeze_shared_planning_harness()'::regprocedure AND tgtype=7 AND tgenabled='O' AND tgqual IS NULL) THEN
  RAISE EXCEPTION 'Existing shared planning freeze trigger differs; inspect before migration';
 END IF;
END
$migration$;
