export interface ImportedShot {
 sequence:number;
 visual:string;
 videoPrompt:string;
 narration:string;
 caption:string;
 durationSeconds:number;
}

export interface ImportedScript {
 sourceName:string;
 sourceText:string;
 targetDuration:number|null;
 shots:ImportedShot[];
 version:string;
}

export interface EpisodeImportItem {
 itemId:string;
 title:string;
 sourceName:string;
 sourceText:string;
 targetDuration?:number|null;
 shots?:ImportedShot[];
 duplicate?:'skip'|'create';
}

export interface EpisodeImportReceipt {
 batchId:string;
 items:Array<{
  itemId:string;
  title:string;
  sourceName:string;
  status:'pending'|'succeeded'|'skipped'|'failed';
  reason:string|null;
  episodeId:string|null;
 }>;
}

export interface EpisodeImportHistory {
 batches:Array<{
  batchId:string;
  accountName:string;
  firstTitle:string;
  createdAt:string;
  itemCount:number;
  createdCount:number;
 }>;
 hasMore:boolean;
}

export const episodeImportLimits={items:100,sourceLength:20000,sourceNameLength:255,requestBytes:16*1024*1024};
