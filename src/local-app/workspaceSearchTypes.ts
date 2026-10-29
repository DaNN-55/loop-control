export interface WorkspaceSearchHit {
  id: string;
  kind: 'episode' | 'account' | 'material';
  title: string;
  subtitle: string;
  episodeId?: string;
  accountId?: string;
  path?: string;
  sha256?: string;
}

export interface WorkspaceSearchResponse {
  query: string;
  episodes: WorkspaceSearchHit[];
  accounts: WorkspaceSearchHit[];
  materials: WorkspaceSearchHit[];
  hasMore: { episodes: boolean; accounts: boolean; materials: boolean };
}
