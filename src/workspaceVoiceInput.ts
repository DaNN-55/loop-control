import {validateWorkspaceVisualDraft,type WorkspaceVisualDraft} from './workspaceVisualDraft.js';

/** An editable source choice, never evidence that the current timeline has adopted it. */
export interface WorkspaceVoiceInput {
 version:'workspace-voice-input/v1';mode:'source';
 visual:{materialRevisionId:string;sha256:string}|null;
 audioTrack:{id:string;sha256:string}|null;
 visualDraft:WorkspaceVisualDraft;
}
export function validateWorkspaceVoiceInput(value:unknown):asserts value is WorkspaceVoiceInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('原声输入格式无效。');
 const v=value as Record<string,unknown>,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,sha=/^[a-f0-9]{64}$/;
 if(v.version!=='workspace-voice-input/v1'||v.mode!=='source'||Object.keys(v).some(k=>!['version','mode','visual','audioTrack','visualDraft'].includes(k)))throw Error('原声输入字段或版本无效。');
 for(const [key,idKey] of [['visual','materialRevisionId'],['audioTrack','id']] as const){
  const pointer=v[key];if(pointer===null)continue;
  if(!pointer||typeof pointer!=='object'||Array.isArray(pointer)||Object.keys(pointer).some(k=>![idKey,'sha256'].includes(k)))throw Error('原声来源身份无效。');
  const p=pointer as Record<string,unknown>;if(typeof p[idKey]!=='string'||!uuid.test(p[idKey])||typeof p.sha256!=='string'||!sha.test(p.sha256))throw Error('原声来源身份无效。');
 }
 validateWorkspaceVisualDraft(v.visualDraft);
}
