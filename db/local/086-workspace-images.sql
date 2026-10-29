-- Native editor saves advance this fence; first assembly does not.
ALTER TABLE local_identity.production_workspaces ADD COLUMN native_edit_revision bigint NOT NULL DEFAULT 0 CHECK(native_edit_revision>=0);

-- Immutable first-image generation requests. Results stay in existing task/material ledgers.
CREATE TABLE local_identity.workspace_image_requests(
 task_id uuid PRIMARY KEY REFERENCES public.tasks(id),
 workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),
 episode_id uuid NOT NULL REFERENCES public.episodes(id),
 clip_id uuid NOT NULL,
 item_id text NOT NULL,
 native_edit_revision bigint NOT NULL CHECK(native_edit_revision>=0),
 project_content_sha256 text NOT NULL CHECK(project_content_sha256 ~ '^[0-9a-f]{64}$'),
 image_revision_id uuid NOT NULL REFERENCES public.production_material_revisions(id),
 image_sha256 text NOT NULL CHECK(image_sha256 ~ '^[0-9a-f]{64}$'),
 duration_seconds numeric NOT NULL CHECK(duration_seconds>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.workspace_image_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_image_request_owner ON local_identity.workspace_image_requests TO loop_app
 USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'))
 WITH CHECK(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
REVOKE ALL ON local_identity.workspace_image_requests FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT,INSERT ON local_identity.workspace_image_requests TO loop_app;
