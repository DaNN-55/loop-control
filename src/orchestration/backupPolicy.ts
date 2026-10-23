export const snapshotTables = {
  accounts: { order: "id.asc", boundaryColumn: "created_at" },
  account_blueprint_versions: { order: "id.asc", boundaryColumn: "created_at" },
  account_memberships: { order: "account_id.asc,user_id.asc", boundaryColumn: undefined },
  episodes: { order: "id.asc", boundaryColumn: "created_at" },
  tasks: { order: "id.asc", boundaryColumn: "created_at" },
  task_runs: { order: "id.asc", boundaryColumn: "started_at" },
  artifacts: { order: "id.asc", boundaryColumn: "created_at" },
  review_packages: { order: "id.asc", boundaryColumn: "created_at" },
  approvals: { order: "id.asc", boundaryColumn: "created_at" },
  state_transitions: { order: "id.asc", boundaryColumn: "created_at" },
  audit_events: { order: "id.asc", boundaryColumn: "created_at" },
  audio_track_annotations: { order: "id.asc", boundaryColumn: "created_at" },
  audio_tracks: { order: "id.asc", boundaryColumn: "created_at" },
  external_connections: { order: "id.asc", boundaryColumn: "created_at" },
  external_connection_versions: { order: "id.asc", boundaryColumn: "created_at" },
  external_connection_verifications: { order: "id.asc", boundaryColumn: "created_at" },
  material_revision_approvals: { order: "id.asc", boundaryColumn: "approved_at" },
  pre_render_review_member_decisions: { order: "review_package_id.asc,member_key.asc", boundaryColumn: "created_at" },
  pre_render_review_members: { order: "id.asc", boundaryColumn: "created_at" },
  production_dependencies: { order: "id.asc", boundaryColumn: "created_at" },
  production_invalidations: { order: "id.asc", boundaryColumn: "created_at" },
  production_material_revisions: { order: "id.asc", boundaryColumn: "created_at" },
  prompt_versions: { order: "id.asc", boundaryColumn: "created_at" },
  qc_review_issues: { order: "id.asc", boundaryColumn: "created_at" },
  review_annotations: { order: "id.asc", boundaryColumn: "created_at" },
  review_render_composition_revisions: { order: "id.asc", boundaryColumn: "created_at" },
  series: { order: "id.asc", boundaryColumn: "created_at" },
  series_versions: { order: "id.asc", boundaryColumn: "created_at" },
  shot_preparation_drafts: { order: "id.asc", boundaryColumn: "created_at" },
  storyboard_audio_selections: { order: "id.asc", boundaryColumn: "created_at" },
  storyboard_review_shots: { order: "review_package_id.asc,shot_id.asc", boundaryColumn: undefined },
  asset_locks: { order: "resource_key.asc", boundaryColumn: "locked_at" },
} as const;

export type SnapshotTable = keyof typeof snapshotTables;

export function formatSnapshotFilename(createdAt: Date): string {
  return `supabase-snapshot-${createdAt.toISOString().replaceAll(":", "-").replace(".", "-")}.json`;
}
