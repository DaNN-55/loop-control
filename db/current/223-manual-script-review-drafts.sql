CREATE TABLE local_identity.manual_script_review_drafts (
 episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 version uuid NOT NULL,
 source_text text NOT NULL CHECK (length(source_text) BETWEEN 1 AND 20000),
 target_duration numeric(6,2) CHECK (target_duration BETWEEN 0.1 AND 3600),
 reason text NOT NULL CHECK (length(reason) <= 4000),
 request_id uuid
);
ALTER TABLE local_identity.manual_script_review_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY manual_script_review_owner ON local_identity.manual_script_review_drafts TO loop_app
 USING (owner_id=local_identity.owner_id() AND EXISTS(
  SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id
  WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'
 ))
 WITH CHECK (owner_id=local_identity.owner_id() AND EXISTS(
  SELECT 1 FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id
  WHERE e.id=episode_id AND m.user_id=local_identity.owner_id() AND m.role='owner'
 ));
REVOKE ALL ON local_identity.manual_script_review_drafts FROM PUBLIC,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT,UPDATE,DELETE ON local_identity.manual_script_review_drafts TO loop_app;
