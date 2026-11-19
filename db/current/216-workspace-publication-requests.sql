CREATE TABLE local_identity.workspace_publication_requests (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 payload_hash text NOT NULL,
 expected_revision bigint NOT NULL,
 content_sha256 text NOT NULL,
 request_snapshot jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('dispatching','completed','failed','unknown','stale')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX workspace_publication_requests_latest ON local_identity.workspace_publication_requests(workspace_id,created_at DESC);
ALTER TABLE local_identity.workspace_publication_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY publication_request_owner ON local_identity.workspace_publication_requests TO loop_app
 USING(owner_id=local_identity.owner_id() AND EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'))
 WITH CHECK(owner_id=local_identity.owner_id() AND EXISTS(SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'));
REVOKE ALL ON local_identity.workspace_publication_requests FROM PUBLIC,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT,UPDATE,DELETE ON local_identity.workspace_publication_requests TO loop_app;
