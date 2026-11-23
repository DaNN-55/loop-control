import type {ProductionWorkspace,WorkspaceNarration} from '../productionWorkspace';
import type {StoryboardSpeechDraft} from '../storyboardBatch';

function key(workspaceId:string,shotId:string){return `loop-speech-draft:${workspaceId}:${shotId}:text`;}
function readDraft(workspace:ProductionWorkspace,narration:WorkspaceNarration):StoryboardSpeechDraft|string|undefined{
 try{
  const raw=sessionStorage.getItem(key(workspace.id,narration.shotId));
  if(raw===null)return;
  let value:unknown;
  try{value=JSON.parse(raw);}catch{return raw;}
  if(value&&typeof value==='object'&&'shotId' in value&&'inputFingerprint' in value&&'preparationRevisionId' in value&&'text' in value){
   const draft=value as StoryboardSpeechDraft;
   if(draft.shotId===narration.shotId&&draft.preparationRevisionId===workspace.preparationRevisionId&&draft.inputFingerprint===narration.inputFingerprint&&typeof draft.text==='string')return draft;
   return;
  }
  return raw;
 }catch{/* An unavailable or outdated local draft is optional. */}
}
export function readStoryboardSpeechDraft(workspace:ProductionWorkspace,narration:WorkspaceNarration):StoryboardSpeechDraft|undefined{
 const draft=readDraft(workspace,narration);
 return workspace.preparationRevisionId&&typeof draft==='object'?draft:undefined;
}
export function readNarrationEditorDraft(workspace:ProductionWorkspace,narration:WorkspaceNarration):string|undefined{
 const draft=readDraft(workspace,narration);
 return typeof draft==='string'?draft:draft?.text;
}
export function storeStoryboardSpeechDraft(workspace:ProductionWorkspace,narration:WorkspaceNarration,text:string|null){
 try{
  const storageKey=key(workspace.id,narration.shotId);
  if(text===null||text===narration.text){sessionStorage.removeItem(storageKey);return;}
  if(!workspace.preparationRevisionId||!narration.inputFingerprint){sessionStorage.setItem(storageKey,text);return;}
  const draft:StoryboardSpeechDraft={shotId:narration.shotId,preparationRevisionId:workspace.preparationRevisionId,inputFingerprint:narration.inputFingerprint,text};
  sessionStorage.setItem(storageKey,JSON.stringify(draft));
 }catch{/* The current editor remains usable without browser storage. */}
}
