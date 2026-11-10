import type { Database } from "../lib/database.types";

type Episode = Database["public"]["Tables"]["episodes"]["Row"];
type Blueprint = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
type SeriesVersion = Database["public"]["Tables"]["series_versions"]["Row"];
type MaterialRevision = Database["public"]["Tables"]["production_material_revisions"]["Row"];
type ShotPreparationDraft = Database["public"]["Tables"]["shot_preparation_drafts"]["Row"];
type StoryboardAudioSelection = Database["public"]["Tables"]["storyboard_audio_selections"]["Row"];
type ReviewPackage = Database["public"]["Tables"]["review_packages"]["Row"];
type ReviewAnnotation = Database["public"]["Tables"]["review_annotations"]["Row"];
type QcReviewIssue = Database["public"]["Tables"]["qc_review_issues"]["Row"];
type Artifact = Database["public"]["Tables"]["artifacts"]["Row"];
type AudioTrack = Database["public"]["Tables"]["audio_tracks"]["Row"];
type AudioTrackAnnotation = Database["public"]["Tables"]["audio_track_annotations"]["Row"];
type PreRenderReviewMember = Database["public"]["Tables"]["pre_render_review_members"]["Row"];
type PreRenderMemberDecision = Database["public"]["Tables"]["pre_render_review_member_decisions"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
type TaskRun = Pick<Database["public"]["Tables"]["task_runs"]["Row"], "attempt" | "completed_at" | "id" | "started_at" | "status" | "task_id">;
type Transition = Database["public"]["Tables"]["state_transitions"]["Row"];
type ExternalConnectionVersion = Database["public"]["Functions"]["list_external_connection_versions"]["Returns"][number];

export interface EpisodeProductionSnapshot {
  artifacts: Artifact[];
  audioTrackAnnotations: AudioTrackAnnotation[];
  audioTracks: AudioTrack[];
  blueprint: Blueprint | null;
  connectionVersions: ExternalConnectionVersion[];
  episode: Episode;
  materialRevisions: MaterialRevision[];
  preRenderReviewMemberDecisions: PreRenderMemberDecision[];
  preRenderReviewMembers: PreRenderReviewMember[];
  qcReviewIssues: QcReviewIssue[];
  reviewAnnotations: ReviewAnnotation[];
  reviewPackages: ReviewPackage[];
  seriesVersion: SeriesVersion | null;
  shotPreparationDrafts: ShotPreparationDraft[];
  storyboardAudioSelections: StoryboardAudioSelection[];
  taskRuns: TaskRun[];
  tasks: Task[];
  transitions: Transition[];
}
