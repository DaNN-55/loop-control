-- Retain the authored source independently from the executable filming plan.
CREATE TABLE local_identity.script_studio_confirmations (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 script_revision_id uuid NOT NULL,
 request_id uuid,
 source_text text NOT NULL CHECK(char_length(source_text) BETWEEN 1 AND 20000),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 script_sha256 text NOT NULL CHECK(script_sha256 ~ '^[0-9a-f]{64}$'),
 target_duration numeric CHECK(target_duration IS NULL OR target_duration BETWEEN 0.1 AND 3600),
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(episode_id,script_revision_id) REFERENCES public.production_material_revisions(episode_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,request_id) REFERENCES local_identity.script_format_requests(owner_id,id),
 UNIQUE(owner_id,request_id)
);
CREATE INDEX script_studio_confirmation_revision ON local_identity.script_studio_confirmations(owner_id,episode_id,script_revision_id,created_at DESC);
ALTER TABLE local_identity.script_studio_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY script_studio_confirmation_owner ON local_identity.script_studio_confirmations TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.script_studio_confirmations FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT ON local_identity.script_studio_confirmations TO loop_app;

-- A logical shot can exceed a provider request; never force extra cuts to fit provider limits.
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('local_identity.register_production_preparation(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure) INTO definition;
 IF position('NOT BETWEEN 0.1 AND 120' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected preparation duration contract';END IF;
 EXECUTE replace(definition,'NOT BETWEEN 0.1 AND 120','NOT BETWEEN 0.1 AND 3600');
END $$;
