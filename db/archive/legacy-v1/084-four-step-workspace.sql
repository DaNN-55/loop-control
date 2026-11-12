-- A draft is editable before it is deliverable. No legacy approvals are fabricated.
CREATE TABLE local_identity.production_workspaces(
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
 episode_id uuid NOT NULL UNIQUE REFERENCES public.episodes(id) ON DELETE RESTRICT,
 workflow_version text NOT NULL DEFAULT 'four-step/v1' CHECK(workflow_version='four-step/v1'),
 script_revision_id uuid NOT NULL REFERENCES public.production_material_revisions(id),
 storyboard_package_id uuid NOT NULL REFERENCES public.review_packages(id),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 bindings jsonb NOT NULL CHECK(jsonb_typeof(bindings)='array'),
 project_path text NOT NULL,
 project_sha256 text NOT NULL CHECK(project_sha256 ~ '^[0-9a-f]{64}$'),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 project_size bigint NOT NULL CHECK(project_size>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.production_workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY production_workspace_owner ON local_identity.production_workspaces TO loop_app
 USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'))
 WITH CHECK(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
REVOKE ALL ON local_identity.production_workspaces FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT,INSERT,UPDATE ON local_identity.production_workspaces TO loop_app;

CREATE TABLE local_identity.production_workspace_versions(
 workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),
 episode_id uuid NOT NULL REFERENCES public.episodes(id),
 revision bigint NOT NULL,
 script_revision_id uuid NOT NULL REFERENCES public.production_material_revisions(id),
 storyboard_package_id uuid NOT NULL REFERENCES public.review_packages(id),
 project_path text NOT NULL,
 project_sha256 text NOT NULL,
 project_size bigint NOT NULL,
 content_sha256 text NOT NULL,
 reason text,
 created_by uuid NOT NULL DEFAULT local_identity.owner_id() REFERENCES local_identity.owners(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,project_sha256)
);
ALTER TABLE local_identity.production_workspace_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY production_workspace_version_owner ON local_identity.production_workspace_versions TO loop_app
 USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'))
 WITH CHECK(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
REVOKE ALL ON local_identity.production_workspace_versions FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT,INSERT ON local_identity.production_workspace_versions TO loop_app;
