export type WorkspaceSearchCategory='all'|'episodes'|'materials'|'accounts';
export interface WorkspaceSearchLocation{q:string;category:WorkspaceSearchCategory;page:number;open?:boolean}
export interface WorkspaceSearchHit {
  id: string;
  kind: 'episode' | 'account' | 'material';
  title: string;
  subtitle: string;
  episodeId?: string;
  accountId?: string;
  path?: string;
  sha256?: string;
  fileType?: 'script'|'image'|'video'|'audio'|'record'|'file';
  typeLabel?: string;
}

export interface WorkspaceSearchResponse {
  query: string;
  pagination?:{category:WorkspaceSearchCategory;page:number;pageSize:number;total:{episodes:number;materials:number;accounts:number};pages:{episodes:number;materials:number;accounts:number}};
  episodes: WorkspaceSearchHit[];
  accounts: WorkspaceSearchHit[];
  materials: WorkspaceSearchHit[];
  hasMore: { episodes: boolean; accounts: boolean; materials: boolean };
}
