-- Empty conversations persist independently from provider receipts. Historical receipts stay unchanged.
CREATE TABLE local_identity.script_studio_conversations (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 script_revision_id uuid,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 target_duration numeric CHECK(target_duration IS NULL OR target_duration BETWEEN 0.1 AND 3600),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(episode_id,script_revision_id) REFERENCES public.production_material_revisions(episode_id,id) ON DELETE CASCADE,
 UNIQUE(owner_id,id)
);
CREATE INDEX script_studio_conversations_scope ON local_identity.script_studio_conversations(owner_id,episode_id,source_sha256,script_revision_id,target_duration,created_at,id);
ALTER TABLE local_identity.script_studio_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY script_studio_conversations_owner ON local_identity.script_studio_conversations TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.script_studio_conversations FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT ON local_identity.script_studio_conversations TO loop_app;
