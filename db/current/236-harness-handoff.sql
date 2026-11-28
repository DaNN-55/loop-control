CREATE TABLE local_identity.harness_handoffs (
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 handoff_id text NOT NULL CHECK(length(handoff_id) <= 80 AND handoff_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 9999),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 title text NOT NULL,
 product_id text NOT NULL,
 aspect_ratio text,
 duration_seconds numeric,
 account_id uuid,
 series_version_id uuid,
 -- Keep the original ID on deletion: replay must not resurrect a removed production order.
 episode_id uuid UNIQUE,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,handoff_id,revision),
 CHECK(episode_id IS NULL OR account_id IS NOT NULL)
);
ALTER TABLE local_identity.harness_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_handoffs_owner ON local_identity.harness_handoffs TO loop_app
 USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.harness_handoffs FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT,UPDATE ON local_identity.harness_handoffs TO loop_app;
