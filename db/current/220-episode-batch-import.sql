CREATE TABLE local_identity.episode_import_batches (
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 payload_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,id)
);

CREATE TABLE local_identity.episode_import_items (
 owner_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 item_id uuid NOT NULL,
 position integer NOT NULL CHECK(position >= 0),
 title text NOT NULL,
 source_name text NOT NULL,
 episode_id uuid UNIQUE REFERENCES public.episodes(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','skipped','failed')),
 reason text,
 payload jsonb CHECK(payload IS NULL OR jsonb_typeof(payload)='object'),
 PRIMARY KEY(owner_id,batch_id,item_id),
 UNIQUE(owner_id,batch_id,position),
 FOREIGN KEY(owner_id,batch_id) REFERENCES local_identity.episode_import_batches(owner_id,id) ON DELETE CASCADE,
 CHECK((payload IS NOT NULL) = (status IN ('pending','failed'))),
 CHECK(episode_id IS NULL OR status='succeeded')
);

CREATE TABLE local_identity.episode_import_drafts (
 episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 version uuid NOT NULL DEFAULT gen_random_uuid(),
 source_name text NOT NULL,
 source_text text NOT NULL CHECK(char_length(source_text) <= 20000),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 target_duration numeric CHECK(target_duration IS NULL OR target_duration BETWEEN 0.1 AND 3600),
 shots jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(shots)='array'),
 CHECK(char_length(trim(source_text)) > 0 OR jsonb_array_length(shots) > 0)
);

ALTER TABLE local_identity.episode_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.episode_import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_identity.episode_import_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY episode_import_batch_owner ON local_identity.episode_import_batches TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
CREATE POLICY episode_import_item_owner ON local_identity.episode_import_items TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
CREATE POLICY episode_import_draft_owner ON local_identity.episode_import_drafts TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.episode_import_batches,local_identity.episode_import_items,local_identity.episode_import_drafts FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT ON local_identity.episode_import_batches,local_identity.episode_import_drafts TO loop_app;
GRANT SELECT,INSERT,UPDATE ON local_identity.episode_import_items TO loop_app;
