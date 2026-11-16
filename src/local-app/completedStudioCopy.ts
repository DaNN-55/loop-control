import type {OpenChatCutStudioSnapshot} from '../worker/openchatcutStudio.js';
export interface CompletedStudioCopy {studioUrl:string;workspace:OpenChatCutStudioSnapshot;sourcePath:string;copyId:string;sourceSha256:string}
/** Selection is navigation, not an edit to the temporary document. */
export function completedCopyDocumentKey(document:unknown):string{
 return JSON.stringify(document,(key,value)=>key==='selectedId'||key==='selectedIds'?undefined:value);
}
