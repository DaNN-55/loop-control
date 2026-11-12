-- Final export evidence is append-only; confirmation binds exact bytes and content.
CREATE TABLE local_identity.workspace_exports (
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),
 episode_id uuid NOT NULL REFERENCES public.episodes(id),
 project_content_version bigint NOT NULL,
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 project jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('failed','ready')),
 artifact jsonb,
 checks jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL DEFAULT local_identity.owner_id() REFERENCES local_identity.owners(id),
 confirmed_at timestamptz,
 confirmed_by uuid REFERENCES local_identity.owners(id)
);
CREATE TABLE local_identity.workspace_export_issues (
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),
 episode_id uuid NOT NULL REFERENCES public.episodes(id),
 export_id uuid REFERENCES local_identity.workspace_exports(id),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 4000),
 resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL DEFAULT local_identity.owner_id() REFERENCES local_identity.owners(id)
);
ALTER TABLE local_identity.workspace_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.workspace_export_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_exports_owner ON local_identity.workspace_exports TO loop_app USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner')) WITH CHECK(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
CREATE POLICY workspace_export_issues_owner ON local_identity.workspace_export_issues TO loop_app USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner')) WITH CHECK(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
REVOKE ALL ON local_identity.workspace_exports,local_identity.workspace_export_issues FROM PUBLIC,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT,UPDATE ON local_identity.workspace_exports,local_identity.workspace_export_issues TO loop_app;
