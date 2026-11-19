CREATE TABLE local_identity.workspace_publications (
 workspace_id uuid PRIMARY KEY REFERENCES local_identity.production_workspaces(id) ON DELETE CASCADE,
 episode_id uuid UNIQUE NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 content jsonb NOT NULL,
 cover jsonb,
 basis_content_sha256 text NOT NULL,
 previous_text jsonb,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.workspace_publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_publication_owner ON local_identity.workspace_publications TO loop_app
 USING(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'))
 WITH CHECK(EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
REVOKE ALL ON local_identity.workspace_publications FROM PUBLIC,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT,UPDATE,DELETE ON local_identity.workspace_publications TO loop_app;
