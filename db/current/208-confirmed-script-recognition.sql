-- Bind the Owner-confirmed recognition to its original source and exact saved production script.
CREATE TABLE local_identity.script_recognition_confirmations (
 owner_id uuid NOT NULL,
 request_id uuid NOT NULL,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 script_revision_id uuid NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 script_sha256 text NOT NULL CHECK(script_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,request_id),
 FOREIGN KEY(owner_id,request_id) REFERENCES local_identity.script_format_requests(owner_id,id),
 FOREIGN KEY(episode_id,script_revision_id) REFERENCES public.production_material_revisions(episode_id,id) ON DELETE CASCADE
);
CREATE INDEX script_recognition_confirmations_revision ON local_identity.script_recognition_confirmations(episode_id,script_revision_id);
ALTER TABLE local_identity.script_recognition_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY script_recognition_owner ON local_identity.script_recognition_confirmations TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.script_recognition_confirmations FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT ON local_identity.script_recognition_confirmations TO loop_app;
