import type {Database} from "../lib/database.types";
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
  "publish_ready",
  "publishing_review",
  "published",
  "metrics_collecting",
  "learning_recorded",
  "production_completed",
] as const;

export type EpisodeStage = Database["public"]["Enums"]["episode_stage"];
