-- Restored acceptance clocks must never occupy or replay daily-runtime slots.
-- Preserve the original rows, timestamps, keys and relationships in place.
ALTER TABLE local_identity.automation_plans RENAME TO historical_automation_plans;
ALTER TABLE local_identity.automation_jobs RENAME TO historical_automation_jobs;
ALTER TABLE local_identity.automation_attempts RENAME TO historical_automation_attempts;

CREATE TABLE local_identity.automation_plans
 (LIKE local_identity.historical_automation_plans INCLUDING ALL);
CREATE TABLE local_identity.automation_jobs
 (LIKE local_identity.historical_automation_jobs INCLUDING ALL);
CREATE TABLE local_identity.automation_attempts
 (LIKE local_identity.historical_automation_attempts INCLUDING ALL);
-- LIKE copies checks, defaults and indexes, but not foreign keys.
ALTER TABLE local_identity.automation_jobs ADD FOREIGN KEY(kind)
 REFERENCES local_identity.automation_plans(kind);
ALTER TABLE local_identity.automation_attempts ADD FOREIGN KEY(job_id)
 REFERENCES local_identity.automation_jobs(id);

REVOKE ALL ON local_identity.historical_automation_plans,
 local_identity.historical_automation_jobs,local_identity.historical_automation_attempts
 FROM PUBLIC,loop_owner,loop_worker,loop_anonymous,loop_app;
GRANT SELECT ON local_identity.historical_automation_plans,
 local_identity.historical_automation_jobs,local_identity.historical_automation_attempts TO loop_app;
REVOKE ALL ON local_identity.automation_plans,local_identity.automation_jobs,
 local_identity.automation_attempts FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT,INSERT,UPDATE ON local_identity.automation_plans,
 local_identity.automation_jobs,local_identity.automation_attempts TO loop_app;
