export interface RecycleBatchCleanupCandidate {
 episodeId:string;
 revision:string;
 title:string;
 sizeBytes:number;
}
export interface RecycleBatchPreview {
 items:(
  | {episodeId:string;status:'ready';sizeBytes:number}
  | {episodeId:string;status:'skipped'|'failed';reason:string}
 )[];
 candidates:RecycleBatchCleanupCandidate[];
 previewKey:string;
 retained:{episodeId:string;title:string;reason:string}[];
 currentBytes:number;
 afterMoveBytes:number;
 projectedBytes:number;
 limitBytes:number;
 pendingBytes:number;
}

export interface RecycleBatchItemResult {
 episodeId:string;
 status:'success'|'skipped'|'failed';
 reason?:string;
}
export interface RecycleBatchResult {
 items:RecycleBatchItemResult[];
 cleanup?:{
  items:(RecycleBatchItemResult&{title:string})[];
  limitBytes:number;
  usedBytes:number;
  pendingBytes:number;
 };
}

export interface RecycleBinItem {
 episodeId:string;
 revision:string;
 title:string;
 accountName:string;
 recycledAt:string;
 archivedBefore:boolean;
 sizeBytes:number;
 protection:string;
}
export interface RecycleBinSummary {
 items:RecycleBinItem[];
 limitBytes:number;
 settingsRevision:number;
 usedBytes:number;
 pendingBytes:number;
 overLimit:boolean;
}
