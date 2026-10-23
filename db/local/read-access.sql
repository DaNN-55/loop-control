-- No legacy command is public merely because the dump's owner can execute it.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public,loop_internal,local_identity FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public,loop_internal,local_identity FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public,loop_internal FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public,loop_internal REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA public,local_identity TO loop_owner;
GRANT EXECUTE ON FUNCTION local_identity.owner_id(),local_identity.actor_role(),public.is_account_member(uuid) TO loop_owner;
GRANT SELECT ON public.accounts,public.account_memberships,public.account_blueprint_versions,public.episodes,public.series,public.series_versions TO loop_owner;
GRANT loop_owner TO loop_app;
CREATE TABLE local_identity.import_record(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), imported_at timestamptz NOT NULL, source_created_at timestamptz NOT NULL, archive_sha256 text NOT NULL);
GRANT SELECT ON local_identity.import_record TO loop_owner;
