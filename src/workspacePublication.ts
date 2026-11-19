import type {WorkspaceExportArtifact} from './workspaceExport.js';
import {normalizeDeliveryTags,deliveryTagsError} from './publishing/deliveryMetadata.js';

export interface PublicationText {title:string;description:string;tags:string[]}
export interface PublicationContent extends PublicationText {instruction:string}
export interface PublicationCover {file:WorkspaceExportArtifact;name:string;source:{kind:'upload'|'frame'|'existing';exportId?:string;videoSha256?:string;timeSeconds?:number}}
export interface WorkspacePublication {workspaceId:string;revision:number;content:PublicationContent;cover:PublicationCover|null;basisContentSha256:string;previousText:PublicationText|null;updatedAt:string|null}
export const emptyPublicationContent:PublicationContent={title:'',description:'',tags:[],instruction:''};
export function parsePublicationContent(value:unknown):PublicationContent{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('发布资料格式无效。');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(key=>!['title','description','tags','instruction'].includes(key))||typeof v.title!=='string'||v.title.length>200||typeof v.description!=='string'||v.description.length>5000||typeof v.instruction!=='string'||v.instruction.length>4000||!Array.isArray(v.tags)||v.tags.some(tag=>typeof tag!=='string'))throw Error('标题最多 200 字、简介最多 5000 字、补充要求最多 4000 字。');
 const normalized=normalizeDeliveryTags(v.tags),error=deliveryTagsError(normalized);if(error)throw Error(error);
 const tags=[...new Set(normalized)];
 return{title:v.title,description:v.description,tags,instruction:v.instruction};
}
