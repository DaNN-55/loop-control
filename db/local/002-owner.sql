CREATE TABLE local_identity.credentials(
 owner_id uuid PRIMARY KEY REFERENCES local_identity.owners(id) ON DELETE RESTRICT,
 password_digest jsonb NOT NULL,
 failed_attempts integer NOT NULL DEFAULT 0,
 locked_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE local_identity.sessions(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 owner_id uuid NOT NULL REFERENCES local_identity.credentials(owner_id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 CHECK(expires_at>created_at)
);
REVOKE ALL ON local_identity.credentials,local_identity.sessions FROM PUBLIC;
GRANT SELECT ON local_identity.owners,local_identity.credentials TO loop_app;
GRANT UPDATE(failed_attempts,locked_until) ON local_identity.credentials TO loop_app;
GRANT SELECT,INSERT,UPDATE ON local_identity.sessions TO loop_app;
GRANT SELECT ON public.episode_read_revisions,public.production_material_revisions,public.shot_preparation_drafts,public.storyboard_audio_selections,public.review_packages,public.artifacts,public.audio_tracks,public.tasks,public.state_transitions,public.review_annotations,public.qc_review_issues,public.pre_render_review_members,public.pre_render_review_member_decisions,public.audio_track_annotations,public.task_runs TO loop_owner;
GRANT EXECUTE ON FUNCTION public.read_episode_production(uuid,jsonb),public.list_external_connection_versions(uuid) TO loop_owner;
