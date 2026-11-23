export const batchPublicationSelectionLimit=100;
export const batchPublicationDownloadPath='batch-publication-download';

export interface BatchPublicationItem {
 episodeId:string;
 title?:string;
 status:'ready'|'skipped';
 reason?:string;
 folder?:string;
 cover?:boolean;
 text?:boolean;
 warnings?:string[];
}

export interface BatchPublicationPreview {
 items:BatchPublicationItem[];
 bytes:number;
 blockedReason:string|null;
 downloadUrl:string|null;
}
