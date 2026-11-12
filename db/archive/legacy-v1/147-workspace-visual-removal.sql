-- Visual removal changes gallery visibility without rewriting adoption history.
ALTER TABLE local_identity.workspace_visual_candidates
 ADD COLUMN dismissed_at timestamptz,
 ADD COLUMN source_artifact_id uuid REFERENCES public.artifacts(id);
GRANT UPDATE(dismissed_at) ON local_identity.workspace_visual_candidates TO loop_app;
GRANT DELETE ON local_identity.workspace_visual_image_choices TO loop_app;
