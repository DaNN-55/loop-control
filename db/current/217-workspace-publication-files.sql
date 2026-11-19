CREATE TABLE local_identity.workspace_publication_files (
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 relative_path text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 file_size bigint NOT NULL CHECK(file_size>0),
 PRIMARY KEY(episode_id,relative_path)
);
CREATE TABLE local_identity.workspace_publication_packages (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 publication_revision bigint NOT NULL,
 export_id uuid NOT NULL REFERENCES local_identity.workspace_exports(id) ON DELETE CASCADE,
 artifacts jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,publication_revision,export_id)
);
ALTER TABLE local_identity.workspace_publication_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.workspace_publication_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY publication_file_owner ON local_identity.workspace_publication_files TO loop_app
 USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'))
 WITH CHECK(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
CREATE POLICY publication_package_owner ON local_identity.workspace_publication_packages TO loop_app
 USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'))
 WITH CHECK(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
REVOKE ALL ON local_identity.workspace_publication_files,local_identity.workspace_publication_packages FROM PUBLIC,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT,DELETE ON local_identity.workspace_publication_files,local_identity.workspace_publication_packages TO loop_app;
