-- Preserve each probe on the same token-fenced job and attempt as its outcome.
ALTER TABLE local_identity.automation_jobs ADD COLUMN checks jsonb
 CHECK(checks IS NULL OR (jsonb_typeof(checks)='array' AND jsonb_array_length(checks)=3));
ALTER TABLE local_identity.automation_attempts ADD COLUMN checks jsonb
 CHECK(checks IS NULL OR (jsonb_typeof(checks)='array' AND jsonb_array_length(checks)=3));
