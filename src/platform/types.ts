export const episodeStages = [
  "waiting_input",
  "brief_draft",
  "script_draft",
  "script_review",
  "script_approved",
  "visual_draft",
  "visual_review",
  "visual_approved",
  "storyboard_draft",
  "storyboard_review",
  "storyboard_approved",
  "production_ready",
  "render_ready",
  "qc_review",
  "qc_passed",
  "production_completed",
] as const;

export type EpisodeStage = (typeof episodeStages)[number];
