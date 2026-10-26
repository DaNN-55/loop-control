import fs from'node:fs';import{runtimeContext}from'../../../scripts/runtime/environment.mjs';const c=runtimeContext(),id='c4355dd9-c71d-4a1d-9a95-2d54bb228db0',hash=()=>c.sql(`select md5(to_jsonb(t)::text) from tasks t where id='${id}'`),before=hash(),sql=`BEGIN;
CREATE TEMP TABLE loop_planning_attempt_probe (LIKE public.tasks INCLUDING DEFAULTS);
CREATE TRIGGER probe BEFORE INSERT ON loop_planning_attempt_probe FOR EACH ROW EXECUTE FUNCTION local_identity.freeze_native_planning_attempt_limit();
INSERT INTO loop_planning_attempt_probe SELECT t.* FROM public.tasks t WHERE id='${id}';
INSERT INTO loop_planning_attempt_probe SELECT (jsonb_populate_record(NULL::public.tasks,to_jsonb(t)||jsonb_build_object('id',gen_random_uuid(),'task_type','draft_storyboard'))).* FROM public.tasks t WHERE id='${id}';
INSERT INTO loop_planning_attempt_probe SELECT (jsonb_populate_record(NULL::public.tasks,to_jsonb(t)||jsonb_build_object('id',gen_random_uuid(),'task_type','generate_narration'))).* FROM public.tasks t WHERE id='${id}';
INSERT INTO loop_planning_attempt_probe SELECT (jsonb_populate_record(NULL::public.tasks,to_jsonb(t)||jsonb_build_object('id',gen_random_uuid(),'episode_id',gen_random_uuid()))).* FROM public.tasks t WHERE id='${id}';
DO $$ BEGIN
IF (SELECT count(*) FROM loop_planning_attempt_probe)<>4 THEN RAISE EXCEPTION 'Probe coverage missing';END IF;
IF (SELECT count(*) FROM loop_planning_attempt_probe WHERE episode_id='cf4765d7-8e50-412f-8b4d-ad536dc5254c' AND task_type IN('prepare_visual_brief','draft_storyboard') AND max_attempts=1 AND input_snapshot#>>'{budget,max_attempts}'='1')<>2 THEN RAISE EXCEPTION 'Native planning limit did not freeze';END IF;
IF (SELECT count(*) FROM loop_planning_attempt_probe WHERE (episode_id<>'cf4765d7-8e50-412f-8b4d-ad536dc5254c' OR task_type='generate_narration') AND max_attempts=2 AND input_snapshot#>>'{budget,max_attempts}'='2')<>2 THEN RAISE EXCEPTION 'Unrelated input was changed';END IF;
END $$;
SELECT json_build_object('passed',true,'cases',4,'nativePlanningLimit',1,'unrelatedLimitPreserved',2,'transaction','ROLLBACK');
ROLLBACK;`;
const result=JSON.parse(c.sql(sql)),after=hash();if(before!==after)throw Error('Frozen failed task was modified');fs.writeFileSync('docs/verification/local-final-acceptance-20261026/planning-limits-rollback-check.json',JSON.stringify({...result,at:new Date().toISOString(),database:c.database,oldFailureHashBefore:before,oldFailureHashAfter:after},null,2)+'\n');console.log(JSON.stringify(result));
