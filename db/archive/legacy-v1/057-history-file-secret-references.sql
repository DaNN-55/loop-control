-- Preserve original file identities and reversible secret-reference replacements.
CREATE TABLE local_identity.history_file_protections(
 original_sha256 text PRIMARY KEY CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 protected_sha256 text NOT NULL CHECK(protected_sha256 ~ '^[a-f0-9]{64}$'),
 protected_bytes bigint NOT NULL CHECK(protected_bytes>=0),
 replacements jsonb NOT NULL,verified_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON local_identity.history_file_protections FROM PUBLIC;
ALTER TABLE local_identity.history_file_protections ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_history_file_protections ON local_identity.history_file_protections TO loop_owner USING(EXISTS(SELECT 1 FROM local_identity.history_files f JOIN local_identity.history_sources s ON s.id=f.source_id WHERE f.sha256=original_sha256 AND s.owner_id=local_identity.owner_id()));
GRANT SELECT ON local_identity.history_file_protections TO loop_owner;
