-- Decisions and prepared edits reference immutable registered task outputs.
CREATE TABLE local_identity.workspace_candidate_decisions(
 workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),candidate_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('adopted','rejected')),text_version text NOT NULL,main_script_text text NOT NULL,
 input_fingerprint text NOT NULL,source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),project_sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,candidate_id)
);
CREATE TABLE local_identity.workspace_candidate_adoptions(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),candidate_id uuid NOT NULL,
 input_fingerprint text NOT NULL,project_sha256 text NOT NULL,edit jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.workspace_candidate_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.workspace_candidate_adoptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY candidate_decision_owner ON local_identity.workspace_candidate_decisions TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id)) WITH CHECK(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id));
CREATE POLICY candidate_adoption_owner ON local_identity.workspace_candidate_adoptions TO loop_app USING(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id)) WITH CHECK(EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id));
REVOKE ALL ON local_identity.workspace_candidate_decisions,local_identity.workspace_candidate_adoptions FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT,INSERT ON local_identity.workspace_candidate_decisions,local_identity.workspace_candidate_adoptions TO loop_app;
