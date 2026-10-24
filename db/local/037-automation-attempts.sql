-- Preserve maintenance attempts as well as the durable once-per-slot trigger.
CREATE TABLE local_identity.automation_attempts(
 job_id uuid NOT NULL REFERENCES local_identity.automation_jobs(id),
 attempt integer NOT NULL CHECK(attempt>0),token uuid NOT NULL,
 started_at timestamptz NOT NULL,completed_at timestamptz,
 status text NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
 passed boolean,detail text CHECK(length(detail)<=1000),PRIMARY KEY(job_id,attempt)
);
REVOKE ALL ON local_identity.automation_attempts FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT,INSERT,UPDATE ON local_identity.automation_attempts TO loop_app;
INSERT INTO local_identity.automation_attempts(job_id,attempt,token,started_at,completed_at,status,passed,detail)
 SELECT id,attempt,coalesce(token,gen_random_uuid()),due_at,completed_at,CASE WHEN status='ready' THEN 'interrupted' ELSE status END,passed,detail
 FROM local_identity.automation_jobs WHERE attempt>0;
