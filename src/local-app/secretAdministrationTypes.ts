export type SecretCategory='system'|'connection'|'history'|'unreferenced';
export interface SecretConnectionUse {connectionId:string;name:string;provider:string;version:number;current:boolean;revoked:boolean}
export interface SecretMetadata {
 reference:string;names:string[];aliases:string[];purpose:string;category:SecretCategory;
 runtimeUses:string[];connections:SecretConnectionUse[];pendingUses:string[];
 history:{metadataOccurrences:number;fileOccurrences:number;files:string[]};
 revealAllowed:boolean;state:string;
}
export interface SecretList {items:SecretMetadata[];total:number;page:number;pageSize:number;observedAt:string}
